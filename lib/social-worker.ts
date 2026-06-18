import type PgBoss from "pg-boss";
import { isBareGeoAnchor } from "./seo-policy";
import { db } from "./db";
import {
  socialPosts,
  socialPostVariants,
  socialPostAssets,
  socialPostJobs,
  socialPostLogs,
  errorLogs,
  ContentType,
  articles,
} from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import type { SocialPostJobData } from "./queue";
import { getPgBoss, SOCIAL_VIDEO_GENERATION_QUEUE } from "./queue";
import { PLATFORM_LIMITS, PLATFORM_ASPECT_RATIOS } from "./social-validation";
import { learningService } from "./learning-service";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator, sampleArmForType } from "./generation-orchestrator";

// Platform character limits
const CHAR_LIMITS = {
  x: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
} as const;

// ============================================================================
// SEO/GEO HELPER FUNCTIONS
// ============================================================================

function generateSEOKeywords(topic: string, title: string, location: string, industry: string): string[] {
  const keywords: string[] = [];
  
  // Extract key terms from topic and title
  const topicTerms = topic.split(/\s+/).filter(t => t.length > 3);
  const titleTerms = title.split(/\s+/).filter(t => t.length > 3);
  
  // Location-based keywords — never emit bare city/state names (SEO policy §6)
  // Always pair location with a service/industry token for semantic context
  if (location) {
    // POLICY: skip bare geo (e.g. "Boston", "Boston MA") — must have service context
    if (!isBareGeoAnchor(location)) {
      keywords.push(location);
    }
    if (industry) keywords.push(`${industry} in ${location}`);
    if (topic) keywords.push(`${topic} in ${location}`);
  }
  
  // Industry keywords
  if (industry) {
    keywords.push(industry);
    if (topic) keywords.push(`${industry} ${topic}`);
  }
  
  // Topic keywords
  topicTerms.slice(0, 3).forEach(term => keywords.push(term.toLowerCase()));
  titleTerms.slice(0, 3).forEach(term => keywords.push(term.toLowerCase()));
  
  // Remove duplicates and return
  return Array.from(new Set(keywords)).slice(0, 15);
}

function generateGeoTags(location: string, platforms: string[]): Array<{ platform: string; tag: string }> {
  const geoTags: Array<{ platform: string; tag: string }> = [];
  
  if (!location) return geoTags;

  // POLICY: bare city/state-only geo tags are forbidden (SEO policy §6).
  // Generate NO geo-tag entries for bare location strings — they will be
  // resolved by the upstream AI social post generator with full service context.
  if (isBareGeoAnchor(location)) {
    console.log(`[SocialWorker] Skipped bare geo-tag for "${location}" — requires service/topic context`);
    return geoTags;
  }
  
  // Location already contains service context (e.g. "home care Boston") — safe to tag
  platforms.forEach(platform => {
    switch (platform) {
      case "x":
        geoTags.push({ platform, tag: `#${location.replace(/\s+/g, "")}` });
        break;
      case "instagram":
        geoTags.push({ platform, tag: `Location: ${location}` });
        break;
      case "facebook":
      case "linkedin":
      case "pinterest":
        geoTags.push({ platform, tag: location });
        break;
    }
  });
  
  return geoTags;
}

// ============================================================================
// SOCIAL POST GENERATION WORKER
// ============================================================================

export async function processSocialPostGeneration(job: PgBoss.Job<SocialPostJobData>) {
  const { socialPostId, userId, prompt, platforms, tone, mood, industry, includeImage, generateVideos, userEmail } = job.data;
  
  console.log(`🎭 Processing social post generation ${socialPostId} for ${platforms.length} platforms${generateVideos ? ' (with video)' : ''}`);

  try {
    // Update status to GENERATING
    await db
      .update(socialPosts)
      .set({ status: "GENERATING", jobId: job.id })
      .where(eq(socialPosts.id, socialPostId));

    // Log generation start
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "GENERATION_START",
      stage: "GEMINI",
      severity: "info",
      message: `Starting social post generation for ${platforms.length} platforms`,
      payloadJson: { platforms, tone, mood, industry },
    });

    // Register job in tracking table
    await db.insert(socialPostJobs).values({
      socialPostId,
      jobId: job.id,
      jobType: "GENERATION",
      status: "ACTIVE",
      startedAt: new Date(),
    });

    // Import AI providers
    const { generateSocialPostWithGemini } = await import("./gemini-social");
    const { enhanceSocialPostWithGPT } = await import("./openai-social");
    
    // Get post details to extract location, company name for SEO/GEO and validation
    const [postDetails] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId));
    
    const location = postDetails?.location || "";
    const topic = postDetails?.topic || "";
    const title = postDetails?.title || "";
    const landingPageUrl = postDetails?.landingPageUrl || undefined;
    const companyName = postDetails?.companyName || undefined;
    
    // Generate SEO keywords and geo-tags
    const seoKeywords = generateSEOKeywords(topic, title, location, industry || "");
    const geoTags = generateGeoTags(location, platforms);
    
    // Update post with SEO/GEO metadata
    await db
      .update(socialPosts)
      .set({ 
        seoKeywordsJson: seoKeywords,
        geoTagsJson: geoTags,
      })
      .where(eq(socialPosts.id, socialPostId));

    // Fetch learned patterns once — only when critic loop is active so we never
    // attribute patterns that didn't actually influence the generation run.
    const disableCriticLoop = process.env.DISABLE_CRITIC_LOOP === "true";
    const socialEnhancement = (!disableCriticLoop && postDetails?.teamId)
      ? await getPromptEnhancement(postDetails.teamId, ContentType.SOCIAL)
          .catch(() => ({ patternsUsed: [] as number[] }))
      : { patternsUsed: [] as number[] };
    const capturedPatternIds = socialEnhancement.patternsUsed;

    // Pre-sample a SINGLE arm BEFORE launching concurrent platform promises.
    // All platforms belong to the same social post (same team+contentType), so
    // they must share one arm assignment. Sampling inside Promise.all would give
    // each platform a different random Thompson draw, and the ?= capture would
    // record whichever platform resolved first — non-deterministic and wrong.
    let capturedSocialArmId: number | undefined;
    if (!disableCriticLoop && postDetails?.teamId) {
      capturedSocialArmId = await sampleArmForType(postDetails.teamId, ContentType.SOCIAL)
        .catch(() => undefined);
    }

    // CONCURRENT PROCESSING: Generate posts for all platforms in parallel
    console.log(`🚀 Generating ${platforms.length} platform variants concurrently...`);
    
    const platformPromises = platforms.map(async (platform) => {
      const retryWithBackoff = async <T>(
        fn: () => Promise<T>,
        maxRetries = 3,
        platform: string
      ): Promise<T> => {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
            console.error(`❌ Attempt ${attempt}/${maxRetries} failed for ${platform}:`, error);
            if (attempt < maxRetries) {
              const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
              console.log(`⏳ Retrying ${platform} in ${delayMs / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
        }
        throw lastError;
      };

      try {
        console.log(`📱 Generating ${platform} post for social post ${socialPostId}`);

        // Create variant with GENERATING status
        const [variantRow] = await db.insert(socialPostVariants).values({
          socialPostId,
          platform,
          caption: "", // Will be updated after generation
          characterCount: 0,
          hashtagsJson: [],
          emojisJson: [],
          hyperlinksJson: [],
          characterLimit: CHAR_LIMITS[platform as keyof typeof CHAR_LIMITS],
          status: "GENERATING",
        }).returning();
        const variant = variantRow!;

        // STAGE 1: Gemini generates initial content (with retry)
        const geminiResult = await retryWithBackoff(
          () => generateSocialPostWithGemini({
            prompt,
            platform,
            tone: tone || "professional",
            mood: mood || "informative",
            industry: industry || "general",
            characterLimit: CHAR_LIMITS[platform as keyof typeof CHAR_LIMITS],
            location: location || undefined,
            topic: topic || undefined,
            title: title || undefined,
            companyName: companyName || undefined,
          }),
          3,
          platform
        );

        console.log(`✅ Gemini generated ${platform} post (${geminiResult.caption.length} chars)${location ? ` for ${location}` : ''}`);

        let platformQualityScore = 80;

        // STAGE 1.5: GenerationOrchestrator — critic-in-the-loop + patternsUsedJson attribution
        // Reviews the Gemini caption for structural / channel / humanness defects
        // and patches them before GPT enhancement. Bounded to 2 passes.
        // Controlled by DISABLE_CRITIC_LOOP=true env var (orchestrator handles flag internally).
        // contentId=socialPostId so content_review_service.socialPostId field is set correctly.
        if (postDetails?.teamId) {
          try {
            const orchestratorResult = await runGenerationOrchestrator({
              teamId: postDetails.teamId,
              contentType: ContentType.SOCIAL,
              contentId: socialPostId,
              content: geminiResult.caption,
              patternsUsed: capturedPatternIds,
              brief: { topic: topic || prompt, location: location || undefined },
              kind: "social",
            });
            if (orchestratorResult.repairs > 0) {
              geminiResult.caption = orchestratorResult.content;
              console.log(
                `🔧 Stage 1.5: Critic applied ${orchestratorResult.repairs} repair(s) to ${platform} caption`
              );
            } else if (orchestratorResult.orchestrated) {
              console.log(`✅ Stage 1.5: ${platform} caption passed critic review`);
            }
            // Capture quality score for cross-platform aggregation at completion.
            // armId is pre-sampled above (shared for all platforms) — do NOT override.
            if (orchestratorResult.orchestrated && orchestratorResult.qualityScore > 0) {
              platformQualityScore = orchestratorResult.qualityScore;
            }
          } catch (criticError) {
            console.warn(`⚠️ Social orchestrator failed, continuing:`, (criticError as Error).message);
          }
        }

        // STAGE 2: GPT-4 enhances with hashtags, emojis, hyperlinks (with retry)
        const gptResult = await retryWithBackoff(
          () => enhanceSocialPostWithGPT({
            caption: geminiResult.caption,
            platform,
            tone: tone || "professional",
            userEmail: userEmail || "contact@example.com",
            location: location || undefined,
            topic: topic || undefined,
            industry: industry || undefined,
            landingPageUrl: landingPageUrl || undefined,
            companyName: companyName || undefined,
          }),
          3,
          platform
        );

        console.log(`✅ GPT-4 enhanced ${platform} post with ${gptResult.hashtags.length} hashtags`);

        // Build hashtags string for easy copy-paste
        const hashtagsString = gptResult.hashtags.map(h => h.tag).join(" ");

        // Update variant with final content and READY status
        await db
          .update(socialPostVariants)
          .set({
            caption: gptResult.caption,
            characterCount: gptResult.caption.length,
            hashtags: hashtagsString,
            hashtagsJson: gptResult.hashtags,
            emojisJson: gptResult.emojis || [],
            hyperlinksJson: gptResult.hyperlinks || [],
            status: "READY",
          })
          .where(eq(socialPostVariants.id, variant.id));

        // Log platform completion
        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "PLATFORM_GENERATED",
          stage: "GPT4",
          severity: "info",
          message: `Generated ${platform} post (${gptResult.caption.length} chars, ${gptResult.hashtags.length} hashtags)`,
          payloadJson: { 
            platform, 
            characterCount: gptResult.caption.length,
            hashtagCount: gptResult.hashtags.length,
          },
        });

        return { platform, success: true, variantId: variant.id, qualityScore: platformQualityScore };
      } catch (error) {
        console.error(`❌ Failed to generate ${platform} post after all retries:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Mark variant as FAILED
        await db
          .update(socialPostVariants)
          .set({
            status: "FAILED",
            errorMessage: errorMessage.slice(0, 500),
          })
          .where(and(eq(socialPostVariants.socialPostId, socialPostId), eq(socialPostVariants.platform, platform)));

        // Log error
        await db.insert(errorLogs).values({
          errorType: "SOCIAL_VARIANT",
          errorMessage: `${platform} variant generation failed: ${errorMessage}`,
          stackTrace: error instanceof Error ? error.stack : undefined,
          severity: "error",
        });

        return { platform, success: false, error: errorMessage };
      }
    });

    // Wait for all platforms to complete
    const platformResults = await Promise.all(platformPromises);
    const successfulPlatforms = platformResults.filter(r => r.success);
    const failedPlatforms = platformResults.filter(r => !r.success);
    // Average quality score across all platforms that ran the orchestrator
    const avgQualityScore = successfulPlatforms.length > 0
      ? Math.round(
          successfulPlatforms.reduce((sum, r) => sum + ((r as any).qualityScore ?? 80), 0) /
            successfulPlatforms.length
        )
      : 80;

    console.log(`✅ Generated ${successfulPlatforms.length}/${platforms.length} platform variants`);
    if (failedPlatforms.length > 0) {
      console.warn(`⚠️ Failed platforms: ${failedPlatforms.map(r => r.platform).join(", ")}`);
    }

    // STAGE 3: Attach image if requested
    // Strategy: reuse the parent article's hero image at $0.00 cost.
    // Only fall back to AI generation if no usable hero image exists.
    if (includeImage) {
      let attachedImageUrl: string | null = null;

      // Try to reuse the parent article's hero image
      if (postDetails?.articleId) {
        try {
          const [parentArticle] = await db
            .select({ heroImageUrl: articles.heroImageUrl })
            .from(articles)
            .where(eq(articles.id, postDetails.articleId))
            .limit(1);

          const heroUrl = parentArticle?.heroImageUrl;
          if (heroUrl && heroUrl.startsWith("http")) {
            attachedImageUrl = heroUrl;
            console.log(`♻️ Reusing article hero image for social post ${socialPostId}: ${heroUrl}`);
          }
        } catch (err) {
          console.warn(`⚠️ Could not fetch parent article hero image:`, err instanceof Error ? err.message : err);
        }
      }

      if (attachedImageUrl) {
        // Store the reused hero image as a social post asset for each platform
        const assetInserts = platforms.map((platform) => ({
          socialPostId,
          platform,
          assetType: "image" as const,
          promptUsed: "reused_from_article_hero",
          storageUrl: attachedImageUrl!,
          altText: `${companyName || "Article"} hero image`,
          aspectRatio: "16:9",
          fileFormat: "png",
        }));

        await db.insert(socialPostAssets).values(assetInserts);

        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "IMAGE_REUSED",
          stage: "IMAGE_GEN",
          severity: "info",
          message: `Reused article hero image for ${platforms.length} platform(s) — $0.00 AI cost`,
          payloadJson: { platforms, sourceArticleId: postDetails?.articleId, heroImageUrl: attachedImageUrl },
        });

        console.log(`✅ Hero image reused for ${platforms.length} social platform(s)`);
      } else {
        // Fallback: generate new AI social images (no parent article or no hero image available)
        console.log(`🎨 No reusable hero image — generating social images via AI`);
        const { generateSocialImages } = await import("./gemini-social-image-generator");

        const imageResults = await generateSocialImages({
          socialPostId,
          prompt,
          platforms,
          industry: industry || "general",
          companyName: companyName || undefined,
        });

        console.log(`🖼️ Generated ${imageResults.length} platform-specific images`);

        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "IMAGE_GENERATED",
          stage: "IMAGE_GEN",
          severity: "info",
          message: `Generated ${imageResults.length} images for platforms: ${platforms.join(", ")}`,
          payloadJson: { imageCount: imageResults.length },
        });
      }
    }

    // STAGE 4: Queue video generation if requested
    if (generateVideos && companyName) {
      try {
        console.log(`🎬 Queueing video generation for social post ${socialPostId}`);
        
        const boss = await getPgBoss();
        const videoJobId = await boss.send(
          SOCIAL_VIDEO_GENERATION_QUEUE,
          { socialPostId, platform: "tiktok" },
          {
            retryLimit: 2,
            retryDelay: 30,
            expireInSeconds: 900, // 15 minutes max
          }
        );

        if (videoJobId) {
          // Update post with video status
          await db
            .update(socialPosts)
            .set({ videoStatus: "GENERATING", videoProgress: 0, videoStage: "queued" })
            .where(eq(socialPosts.id, socialPostId));

          // Log video queue event
          await db.insert(socialPostLogs).values({
            socialPostId,
            eventType: "VIDEO_QUEUED",
            stage: "VIDEO_GEN",
            severity: "info",
            message: `Video generation queued with job ${videoJobId}`,
            payloadJson: { jobId: videoJobId, platform: "tiktok" },
          });

          console.log(`✅ Video generation queued for social post ${socialPostId} (job: ${videoJobId})`);
        } else {
          console.warn(`⚠️ Failed to queue video generation for social post ${socialPostId}`);
        }
      } catch (videoError) {
        console.error(`❌ Video queueing failed for social post ${socialPostId}:`, videoError);
        // Don't fail the whole job - video is optional
        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "VIDEO_QUEUE_FAILED",
          stage: "VIDEO_GEN",
          severity: "warning",
          message: `Video queueing failed: ${videoError instanceof Error ? videoError.message : String(videoError)}`,
        });
      }
    } else if (generateVideos && !companyName) {
      console.warn(`⚠️ Video generation requested but no company name provided for social post ${socialPostId}`);
      await db.insert(socialPostLogs).values({
        socialPostId,
        eventType: "VIDEO_SKIPPED",
        stage: "VIDEO_GEN",
        severity: "warning",
        message: "Video generation skipped: company name is required",
      });
    }

    // Update status to READY
    await db
      .update(socialPosts)
      .set({ status: "READY", updatedAt: new Date() })
      .where(eq(socialPosts.id, socialPostId));

    // Mark job as completed
    await db
      .update(socialPostJobs)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(socialPostJobs.jobId, job.id));

    // Log final completion
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "READY",
      stage: "COMPLETE",
      severity: "info",
      message: `Social post generation completed for ${platforms.length} platforms`,
      payloadJson: { 
        platforms, 
        variantsGenerated: platforms.length,
        imagesGenerated: includeImage ? platforms.length : 0,
      },
    });

    console.log(`✅ Social post ${socialPostId} generation completed successfully`);

    // Record generation for AI Learning System
    try {
      if (postDetails?.teamId) {
        await recordContentGenerated(
          postDetails.teamId,
          ContentType.SOCIAL,
          socialPostId,
          capturedPatternIds,
          avgQualityScore,
          { armId: capturedSocialArmId }
        );
        console.log(`📊 Recorded social post generation for AI Learning`);
      }
    } catch (learningError) {
      console.warn(`⚠️ Failed to record learning metrics:`, learningError);
    }
  } catch (error) {
    console.error(`❌ Social post generation failed for ${socialPostId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update status to FAILED
    await db
      .update(socialPosts)
      .set({ 
        status: "FAILED", 
        errorMessage: errorMessage.slice(0, 500),
        updatedAt: new Date() 
      })
      .where(eq(socialPosts.id, socialPostId));

    // Mark job as failed
    await db
      .update(socialPostJobs)
      .set({ 
        status: "FAILED", 
        errorMessage: errorMessage.slice(0, 500),
        completedAt: new Date() 
      })
      .where(eq(socialPostJobs.jobId, job.id));

    // Log to error_logs table
    await db.insert(errorLogs).values({
      errorType: "SOCIAL",
      errorMessage: `Social post generation failed: ${errorMessage}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
      severity: "error",
    });

    // Log failure event
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "FAILED",
      stage: "ERROR",
      severity: "error",
      message: `Generation failed: ${errorMessage.slice(0, 500)}`,
      payloadJson: { 
        error: errorMessage,
        platforms,
      },
    });

    throw error;
  }
}
