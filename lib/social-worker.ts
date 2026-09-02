import type { Job } from "bullmq";

import { isBareGeoAnchor } from "./seo-policy";
import { db } from "./db";
import { createNotification } from "./notification-service";
import { logError } from "./error-logger";
import {
  socialPosts,
  socialPostVariants,
  socialPostAssets,
  socialPostJobs,
  socialPostLogs,
  ContentType,
  articles,
} from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { SocialPostJobData } from "./queue";
import { addVideoGenerationJob, SOCIAL_VIDEO_GENERATION_QUEUE } from "./queue";
import {
  assertEntityTeam,
  BillingSettlementError,
  currentTenantTeamId,
  isBillingSettlementError,
} from "./pipeline-worker";
import { PLATFORM_LIMITS, PLATFORM_ASPECT_RATIOS } from "./social-validation";
import { learningService } from "./learning-service";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator, sampleArmForType } from "./generation-orchestrator";
import { isProviderAccountingError } from "./cost-telemetry";

// Platform character limits
const CHAR_LIMITS = {
  x: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
} as const;

export interface AutomaticVideoDependencies {
  addJob?: typeof addVideoGenerationJob;
  isMediaFeatureEnabled?: () => boolean;
}

/**
 * Metered follow-on used by social generation. It deliberately mirrors the
 * direct video route: advisory quota gate, spending-cap reservation, credit
 * reservation, atomic user slot, durable intent, then enqueue.
 */
export async function enqueueAutomaticSocialVideo(
  args: { socialPostId: number; teamId: number; userId: number; platform: string },
  dependencies: AutomaticVideoDependencies = {}
): Promise<string | null> {
  // This must be first: automatic video is optional, and a disabled media
  // capability must not consume quota, reserve cap/credits, or claim a slot.
  const isMediaFeatureEnabled =
    dependencies.isMediaFeatureEnabled ??
    (await import("./storage")).isMediaFeatureEnabled;
  if (!isMediaFeatureEnabled()) {
    console.warn(
      `[SocialWorker] Skipping automatic video for social post ${args.socialPostId}: media generation is disabled`
    );
    return null;
  }

  const { checkVideoGate, acquireVideoSlot, releaseVideoSlot } = await import("./user-gate");
  const { checkUsageCap, cancelCapReservation } = await import("./usage-caps");
  const { reserveCredits, releaseReservation } = await import("./billing");
  const creditRunId = `social-auto-video:${args.teamId}:${args.socialPostId}:${args.platform}`;

  const [current] = await db.select({
    videoCreditRunId: socialPosts.videoCreditRunId,
    videoStatus: socialPosts.videoStatus,
  }).from(socialPosts).where(and(
    eq(socialPosts.id, args.socialPostId),
    eq(socialPosts.teamId, args.teamId)
  )).limit(1);
  if (current?.videoCreditRunId === creditRunId &&
      ["PENDING", "GENERATING", "READY"].includes(current.videoStatus ?? "")) {
    return null;
  }

  const gate = await checkVideoGate(args.userId, args.teamId);
  if (!gate.allowed) throw new Error(gate.message ?? "Automatic video quota exceeded");

  let capReservationId: number | null = null;
  let slotAcquired = false;
  let reserved = false;
  try {
    capReservationId = await checkUsageCap(args.teamId, 15);
    const reservation = await reserveCredits({
      teamId: args.teamId,
      operationType: "video",
      runId: creditRunId,
      userId: args.userId,
    });
    if (!reservation.ok) throw new Error("Insufficient credits for automatic social video");
    reserved = true;

    slotAcquired = await acquireVideoSlot(args.userId, args.teamId);
    if (!slotAcquired) throw new Error("Automatic video concurrency limit reached");

    const [intent] = await db.update(socialPosts).set({
      videoCreditRunId: creditRunId,
      videoCapReservationId: capReservationId,
      videoStatus: "PENDING",
      videoStage: "queued",
      videoProgress: 0,
      updatedAt: new Date(),
    }).where(and(
      eq(socialPosts.id, args.socialPostId),
      eq(socialPosts.teamId, args.teamId),
      sql`${socialPosts.videoCreditRunId} IS NULL OR ${socialPosts.videoCreditRunId} = ${creditRunId}`
    )).returning({ id: socialPosts.id });
    if (!intent) throw new Error("A different automatic video intent already exists");

    const jobId = await (dependencies.addJob ?? addVideoGenerationJob)({
      socialPostId: args.socialPostId,
      platform: args.platform,
      teamId: args.teamId,
      creditRunId,
      userId: args.userId,
    });
    if (!jobId) throw new Error("Video queue did not accept the automatic job");
    await db.update(socialPosts).set({
      videoStatus: "GENERATING",
      updatedAt: new Date(),
    }).where(and(
      eq(socialPosts.id, args.socialPostId),
      eq(socialPosts.videoCreditRunId, creditRunId)
    ));
    return String(jobId);
  } catch (error) {
    if (slotAcquired) await releaseVideoSlot(args.userId).catch(() => {});
    if (capReservationId !== null) await cancelCapReservation(capReservationId).catch(() => {});
    if (reserved) {
      await releaseReservation({
        teamId: args.teamId,
        runId: creditRunId,
        reason: `Automatic video enqueue failed for social post ${args.socialPostId}`,
      }).catch(() => {});
    }
    await db.update(socialPosts).set({
      videoCreditRunId: null,
      videoCapReservationId: null,
      videoStatus: "FAILED_ENQUEUE",
      videoStage: null,
      updatedAt: new Date(),
    }).where(and(
      eq(socialPosts.id, args.socialPostId),
      eq(socialPosts.teamId, args.teamId),
      eq(socialPosts.videoCreditRunId, creditRunId)
    )).catch(() => {});
    throw error;
  }
}

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

export async function processSocialPostGeneration(job: Job<SocialPostJobData>) {
  const { socialPostId, userId, prompt, platforms, tone, mood, industry, includeImage, generateVideos, userEmail } = job.data;
  
  console.log(`🎭 Processing social post generation ${socialPostId} for ${platforms.length} platforms${generateVideos ? ' (with video)' : ''}`);

  try {
    const [postDetails] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId));

    assertEntityTeam({
      entity: "socialPost",
      entityId: socialPostId,
      jobTeamId: currentTenantTeamId(),
      entityTeamId: postDetails?.teamId,
    });
    const validatedPostTeamId = postDetails?.teamId;
    if (!Number.isInteger(validatedPostTeamId) || (validatedPostTeamId ?? 0) <= 0) {
      throw new Error(`Social post ${socialPostId} has no validated team`);
    }
    const teamId = validatedPostTeamId!;

    // READY is the durable delivery checkpoint. A retry after a debit failure
    // settles only; it must never call either content provider again.
    if (
      postDetails?.status === "READY" &&
      postDetails.billingRunId === job.data.creditRunId &&
      !postDetails.billingSettledAt &&
      job.data.creditRunId
    ) {
      const { debitReservation } = await import("@/lib/billing");
      let debitResult;
      try {
        debitResult = await debitReservation({
          teamId,
          runId: job.data.creditRunId,
          userId,
          jobId: String(job.id ?? ""),
        });
      } catch (cause) {
        throw new BillingSettlementError(
          `Debit settlement failed for delivered social post ${socialPostId}`,
          job.data.creditRunId,
          cause
        );
      }
      if (!debitResult.ok) {
        throw new BillingSettlementError(
          `Debit settlement failed for delivered social post ${socialPostId}`,
          job.data.creditRunId
        );
      }
      await db.update(socialPosts)
        .set({ billingSettledAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(socialPosts.id, socialPostId),
          eq(socialPosts.teamId, teamId),
          eq(socialPosts.billingRunId, job.data.creditRunId)
        ));
      return;
    }

    // Cost ceiling gate — INSIDE the try so BUDGET_EXCEEDED flows through this
    // catch (status=FAILED write) before createPipelineWorker releases the
    // reservation and stops retries. Keyed by the same creditRunId the wrapper
    // uses for run-context telemetry attribution.
    if (job.data.creditRunId) {
      const { assertRunBudget } = await import("@/lib/cost-ceilings");
      await assertRunBudget(job.data.creditRunId, "social_post", "text_gen");
    }

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

    // Register job in tracking table.
    // Use onConflictDoNothing so pg-boss retries are idempotent — a duplicate
    // job.id insert on retry simply no-ops instead of crashing the worker.
    await db.insert(socialPostJobs).values({
      socialPostId,
      jobId: String(job.id ?? ""),
      jobType: "GENERATION",
      status: "ACTIVE",
      startedAt: new Date(),
    }).onConflictDoNothing();

    // Import AI providers
    const { generateSocialPostWithGemini } = await import("./gemini-social");
    const { enhanceSocialPostWithGPT } = await import("./openai-social");
    
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
    const socialEnhancement = !disableCriticLoop
      ? await getPromptEnhancement(teamId, ContentType.SOCIAL, {
          stableId: String(socialPostId),
          campaignId: postDetails?.campaignId ?? null,
        })
          .catch(() => ({ patternsUsed: [] as number[], variantArmId: undefined }))
      : { patternsUsed: [] as number[], variantArmId: undefined };
    const capturedPatternIds = socialEnhancement.patternsUsed;
    const socialVariantArmId = socialEnhancement.variantArmId;

    // Pre-sample a SINGLE arm BEFORE launching concurrent platform promises.
    // All platforms belong to the same social post (same team+contentType), so
    // they must share one arm assignment. Sampling inside Promise.all would give
    // each platform a different random Thompson draw, and the ?= capture would
    // record whichever platform resolved first — non-deterministic and wrong.
    let capturedSocialArmId: number | undefined;
    if (!disableCriticLoop) {
      capturedSocialArmId = await sampleArmForType(teamId, ContentType.SOCIAL)
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
            if (isProviderAccountingError(error)) throw error;
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
            teamId,
            socialPostId,
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
        // armIdOverride: pass the pre-sampled shared arm so each platform variant does NOT
        // fire an extra sampleArm() DB query (one arm per post, not one per platform).
        if (teamId) {
          try {
            const orchestratorResult = await runGenerationOrchestrator({
              teamId,
              campaignId: postDetails?.campaignId ?? null,
              contentType: ContentType.SOCIAL,
              contentId: socialPostId,
              content: geminiResult.caption,
              patternsUsed: capturedPatternIds,
              brief: { topic: topic || prompt, location: location || undefined },
              kind: "social",
              armIdOverride: capturedSocialArmId,
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
            if (isProviderAccountingError(criticError)) throw criticError;
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
        if (isProviderAccountingError(error)) throw error;
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

        // Log error via centralized logger (Slack + DB)
        await logError({
          errorType: "SOCIAL",
          errorMessage: `${platform} variant generation failed: ${errorMessage}`,
          stackTrace: error instanceof Error ? error.stack : undefined,
          severity: "error",
        }).catch((e) => console.error("[social-worker] logError failed:", e));

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
          teamId,
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
        
        const videoJobId = await enqueueAutomaticSocialVideo({
          socialPostId,
          platform: "tiktok",
          teamId,
          userId,
        });

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

    // Only mark READY when at least one platform variant succeeded.
    // If ALL platforms failed, throw so pg-boss retries the job and the
    // post does not sit silently in READY with zero usable variants.
    const finalStatus = successfulPlatforms.length > 0 ? "READY" : "FAILED";

    // Scope the update to both id AND teamId for defence-in-depth write isolation.
    const postTeamId = job.data.teamId ?? postDetails?.teamId;
    const updateWhere = postTeamId
      ? and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, postTeamId))
      : eq(socialPosts.id, socialPostId);

    await db
      .update(socialPosts)
      .set({
        status: finalStatus,
        billingRunId: finalStatus === "READY" ? (job.data.creditRunId ?? null) : null,
        updatedAt: new Date(),
      })
      .where(updateWhere);

    if (finalStatus === "FAILED") {
      // Throw so pg-boss retries; billing reservation will be released by the outer catch.
      throw new Error(
        `All ${platforms.length} platform variants failed for social post ${socialPostId}. ` +
        `Failed platforms: ${failedPlatforms.map((r) => r.platform).join(", ")}.`
      );
    }

    // Mark job as completed
    await db
      .update(socialPostJobs)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(socialPostJobs.jobId, String(job.id ?? "")));

    // Log final completion with accurate variant counts
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "READY",
      stage: "COMPLETE",
      severity: "info",
      message: `Social post generation completed for ${successfulPlatforms.length}/${platforms.length} platforms`,
      payloadJson: { 
        platforms, 
        variantsGenerated: successfulPlatforms.length,
        imagesGenerated: includeImage ? successfulPlatforms.length : 0,
        failedPlatforms: failedPlatforms.map((r) => r.platform),
      },
    });

    console.log(`✅ Social post ${socialPostId} generation completed successfully`);

    void createNotification({
      teamId: job.data.teamId ?? postDetails?.teamId,
      type: "success",
      category: "social_post",
      title: "Social Post Ready",
      message: `Your social post has been generated successfully across ${successfulPlatforms.length} platform(s).`,
      entityId: socialPostId,
      entityType: "social_post",
      actionUrl: `/social/${socialPostId}`,
    }).catch(() => {});

    // Two-bucket billing: DEBIT reservation on success
    const teamIdForBilling = job.data.teamId ?? postDetails?.teamId;
    if (job.data.creditRunId && teamIdForBilling) {
      const { debitReservation } = await import("@/lib/billing");
      let debitResult;
      try {
        debitResult = await debitReservation({
          teamId: teamIdForBilling,
          runId: job.data.creditRunId,
          jobId: String(job.id ?? ""),
        });
      } catch (cause) {
        throw new BillingSettlementError(
          `Debit settlement failed for delivered social post ${socialPostId}`,
          job.data.creditRunId,
          cause
        );
      }
      if (!debitResult.ok) {
        throw new BillingSettlementError(
          `Debit settlement failed for delivered social post ${socialPostId}`,
          job.data.creditRunId
        );
      }
      await db.update(socialPosts)
        .set({ billingSettledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamIdForBilling)));
      // Record completed usage event — populates spending cap meter so caps can trip.
      const { recordUsageEvent } = await import("@/lib/usage-caps");
      await recordUsageEvent({
        teamId: teamIdForBilling,
        campaignId: postDetails?.campaignId ?? null,
        action: "social_post",
        units: 1,
        costEstimateCents: 5,
        jobId: String(job.id ?? ""),
        metadata: { socialPostId },
      }).catch((err) => console.warn(`[usage-caps] recordUsageEvent failed (non-fatal): ${err?.message}`));
    }

    // Record generation for AI Learning System
    try {
      if (postDetails?.teamId) {
        await recordContentGenerated(
          postDetails.teamId,
          ContentType.SOCIAL,
          socialPostId,
          capturedPatternIds,
          avgQualityScore,
          { armId: capturedSocialArmId, variantArmId: socialVariantArmId }
        );
        console.log(`📊 Recorded social post generation for AI Learning`);
      }
    } catch (learningError) {
      console.warn(`⚠️ Failed to record learning metrics:`, learningError);
    }
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    if (isBillingSettlementError(error)) {
      // Delivery is durable. Preserve READY metadata and let the shared
      // pipeline handler retry settlement without releasing the reservation.
      throw error;
    }
    console.error(`❌ Social post generation failed for ${socialPostId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update status to FAILED — scope by teamId for defence-in-depth write isolation.
    const catchTeamId = job.data.teamId;
    const catchUpdateWhere = catchTeamId
      ? and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, catchTeamId))
      : eq(socialPosts.id, socialPostId);
    await db
      .update(socialPosts)
      .set({ 
        status: "FAILED", 
        errorMessage: errorMessage.slice(0, 500),
        updatedAt: new Date() 
      })
      .where(catchUpdateWhere);

    // Mark job as failed
    await db
      .update(socialPostJobs)
      .set({ 
        status: "FAILED", 
        errorMessage: errorMessage.slice(0, 500),
        completedAt: new Date() 
      })
      .where(eq(socialPostJobs.jobId, String(job.id ?? "")));

    // Log to error_logs table via centralized logger (Slack + DB)
    await logError({
      errorType: "SOCIAL",
      errorMessage: `Social post generation failed: ${errorMessage}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
      severity: "error",
    }).catch((e) => console.error("[social-worker] logError failed:", e));

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

    void createNotification({
      teamId: job.data.teamId,
      type: "error",
      category: "social_post",
      title: "Social Post Failed",
      message: `Social post generation failed: ${errorMessage.slice(0, 200)}`,
      entityId: socialPostId,
      entityType: "social_post",
      actionUrl: `/social/${socialPostId}`,
    }).catch(() => {});

    // Rethrow — createPipelineWorker (the only registration point) classifies
    // the error, releases the credit reservation on the final attempt, and
    // converts fatal codes to UnrecoverableError.
    throw error;
  }
}
