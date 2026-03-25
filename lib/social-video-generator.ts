import { db } from "./db";
import { socialPosts, socialPostAssets } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { generateVideoScript } from "./gemini-video-script-generator";
import { generateVideoImages } from "./social-video-image-generator";
import { generateVideoTTS } from "./social-video-tts-generator";
import { composeVideo, cleanupTempFiles } from "./social-video-compositor";
import { generateVideoSEOMetadata } from "./video-seo-optimizer";

export interface GenerateSocialVideoRequest {
  socialPostId: number;
  platform?: string; // Optional: default to "tiktok" (9:16)
}

export interface GenerateSocialVideoResult {
  videoUrl: string;
  duration: number;
  resolution: string;
  fileSize: number;
  scriptSummary: {
    title: string;
    scenes: number;
    hashtags: string[];
  };
}

export async function generateSocialVideo(
  request: GenerateSocialVideoRequest
): Promise<GenerateSocialVideoResult> {
  const { socialPostId, platform = "facebook" } = request;
  
  // Performance timing
  const timings: Record<string, number> = {};
  const startTotal = Date.now();
  const markTime = (label: string) => {
    timings[label] = Date.now() - startTotal;
    console.log(`⏱️ [${label}] ${timings[label]}ms elapsed`);
  };

  console.log(`\n🎬 Starting 60-second video generation for Social Post ${socialPostId}`);
  console.log(`Platform: ${platform}`);

  try {
    // Step 1: Fetch social post data
    console.log(`\n📊 Step 1/5: Fetching social post data...`);
    const [post] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId))
      .limit(1);

    if (!post) {
      throw new Error(`Social post ${socialPostId} not found`);
    }

    // Validate company name (required for video generation)
    if (!post.companyName) {
      // Update status to FAILED with error message
      await db
        .update(socialPosts)
        .set({ 
          videoStatus: "FAILED"
        })
        .where(eq(socialPosts.id, socialPostId));
      
      throw new Error("Company name is required for video generation. Please edit this post to add your company name.");
    }

    // Update status to GENERATING
    await db
      .update(socialPosts)
      .set({ videoStatus: "GENERATING" })
      .where(eq(socialPosts.id, socialPostId));

    // Get article content if linked
    let articleContent: string | undefined;
    if (post.articleId) {
      const { articles } = await import("@/shared/schema");
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, post.articleId))
        .limit(1);
      
      if (article?.finalHtmlContent) {
        // Extract text from HTML for article summary
        articleContent = article.finalHtmlContent.replace(/<[^>]*>/g, " ").slice(0, 2000);
      }
    }

    // Step 2: Generate 4-scene video script with Gemini
    console.log(`\n📝 Step 2/5: Generating video script with Gemini...`);
    markTime("script_start");
    const script = await generateVideoScript({
      topic: post.topic,
      title: post.title,
      location: post.location,
      tone: post.tone || "Professional",
      mood: post.mood || "Informative",
      industry: post.industry || "Business",
      companyName: post.companyName, // Already validated above
      articleContent,
      landingPageUrl: post.landingPageUrl || undefined,
    });
    markTime("script_complete");

    console.log(`  ✅ Script generated: ${script.scenes.length} scenes`);

    // Save script to database + update progress
    await db
      .update(socialPosts)
      .set({ 
        videoScriptJson: script as any,
        videoProgress: 20,
        videoStage: "script_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    // Step 3 & 4: PARALLEL GENERATION for 2x speed boost
    // Generate images and TTS simultaneously since they don't depend on each other
    console.log(`\n🚀 Step 3-4/5: Generating images and voiceover in parallel...`);
    markTime("parallel_start");
    
    // Update progress to show parallel work starting
    await db
      .update(socialPosts)
      .set({ 
        videoProgress: 25,
        videoStage: "parallel_generation",
      })
      .where(eq(socialPosts.id, socialPostId));

    const [images, audio] = await Promise.all([
      // Images: 5 parallel Gemini calls
      (async () => {
        console.log(`🖼️ [Parallel] Generating 5 cinematic images...`);
        const result = await generateVideoImages({
          socialPostId,
          scenes: script.scenes,
          industry: post.industry || "Business",
          companyName: post.companyName!, // Already validated above
          platform,
          landingPageUrl: post.landingPageUrl || undefined, // CRITICAL: Pass URL to enforce exact URL in Scene 5
        });
        console.log(`  ✅ ${result.length} images generated`);
        return result;
      })(),
      
      // TTS: 1 OpenAI call
      (async () => {
        console.log(`🎙️ [Parallel] Generating voiceover with OpenAI TTS...`);
        const result = await generateVideoTTS({
          socialPostId,
          scenes: script.scenes,
          tone: post.tone || "Professional",
          companyName: post.companyName!, // Already validated above
        });
        console.log(`  ✅ Voiceover generated (~${result.duration}s, voice: ${result.voice})`);
        return result;
      })(),
    ]);

    markTime("parallel_complete");
    console.log(`\n🎉 Parallel generation complete! Images and audio ready.`);

    // Update progress - assets ready
    await db
      .update(socialPosts)
      .set({ 
        videoProgress: 65,
        videoStage: "assets_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    // Save images to database
    for (const image of images) {
      const scene = script.scenes.find((s) => s.sceneNumber === image.sceneNumber);
      await db.insert(socialPostAssets).values({
        socialPostId,
        platform,
        assetType: "image",
        promptUsed: scene?.visualDescription || "Video scene image",
        storageUrl: image.storageUrl,
        altText: `Scene ${image.sceneNumber}: ${scene?.caption || ""}`,
        aspectRatio: image.aspectRatio,
        fileFormat: "png",
      });
    }

    // Step 5: Compose final video + Generate SEO metadata IN PARALLEL
    console.log(`\n🎬 Step 5/5: Composing video + generating SEO metadata in parallel...`);
    markTime("ffmpeg_start");

    // Download logo if provided (fast, non-blocking)
    let companyLogoPath: string | undefined;
    if (post.companyLogoUrl) {
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const tempDir = `/tmp/video-${socialPostId}`;
        await fs.mkdir(tempDir, { recursive: true });

        // If logo is from object storage, fetch it
        if (post.companyLogoUrl.startsWith("/api/public-objects/")) {
          const logoFileName = post.companyLogoUrl.split("/").pop();
          const logoPath = path.join(tempDir, `logo-${logoFileName}`);

          // Read from object storage
          const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
          const { objectStorageClient } = await import("./storage");
          const bucket = objectStorageClient.bucket(BUCKET_ID);
          const objectPath = post.companyLogoUrl.replace("/api/public-objects/", "public/");
          const file = bucket.file(objectPath);

          const [buffer] = await file.download();
          await fs.writeFile(logoPath, buffer);
          companyLogoPath = logoPath;
        }
      } catch (logoError) {
        console.warn("⚠️ Could not load company logo:", logoError);
        // Continue without logo
      }
    }

    // Run FFmpeg composition AND SEO metadata generation in parallel
    // They don't depend on each other, so this saves ~5-10 seconds
    const [video, seoMetadata] = await Promise.all([
      // FFmpeg video composition
      (async () => {
        const result = await composeVideo({
          socialPostId,
          images,
          audio,
          scenes: script.scenes,
          companyLogoPath,
          companyName: post.companyName!, // Already validated above
          platform,
          landingPageUrl: post.landingPageUrl || undefined,
        });
        console.log(`  ✅ Video composed: ${result.resolution}, ${result.duration}s, ${(result.fileSize / 1024 / 1024).toFixed(2)}MB`);
        return result;
      })(),
      
      // SEO metadata generation with GPT-4 (runs while FFmpeg works)
      (async () => {
        console.log(`🏷️ [Parallel] Generating SEO metadata with GPT-4...`);
        const result = await generateVideoSEOMetadata({
          topic: post.topic,
          title: script.title,
          location: post.location,
          companyName: post.companyName!,
          industry: post.industry || "Business",
          scriptHashtags: script.hashtags,
          landingPageUrl: post.landingPageUrl,
        });
        console.log(`  ✅ SEO metadata ready`);
        return result;
      })(),
    ]);

    markTime("ffmpeg_complete");
    const { videoTitle, videoDescription, videoTags } = seoMetadata;

    // Update progress
    await db
      .update(socialPosts)
      .set({ 
        videoProgress: 90,
        videoStage: "composition_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    // Step 7: Update database with final video
    // Check if user cancelled while we were generating — don't overwrite their cancellation
    const [currentStatus] = await db
      .select({ videoStatus: socialPosts.videoStatus })
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId))
      .limit(1);

    if (currentStatus?.videoStatus === "FAILED") {
      console.log(`🛑 Social post ${socialPostId} was cancelled by user — skipping READY update`);
      await cleanupTempFiles(socialPostId);
      return {
        videoUrl: video.videoUrl,
        duration: video.duration,
        resolution: video.resolution,
        fileSize: video.fileSize,
        scriptSummary: { title: script.title, scenes: script.scenes.length, hashtags: script.hashtags },
      };
    }

    console.log(`\n💾 Saving video to database...`);
    await db
      .update(socialPosts)
      .set({
        videoUrl: video.videoUrl,
        videoStatus: "READY",
        videoProgress: 100,
        videoStage: "complete",
        videoDuration: video.duration,
        videoGeneratedAt: new Date(),
        videoTitle,
        videoDescription,
        videoTagsJson: videoTags as any,
      })
      .where(eq(socialPosts.id, socialPostId));

    // Save video asset record
    await db.insert(socialPostAssets).values({
      socialPostId,
      platform,
      assetType: "video",
      promptUsed: `60-second video: ${script.title}`,
      storageUrl: video.videoUrl,
      altText: script.title,
      aspectRatio: video.resolution,
      fileFormat: "mp4",
      videoDuration: video.duration,
      videoResolution: video.resolution,
    });

    // Cleanup temporary files
    await cleanupTempFiles(socialPostId);

    markTime("complete");
    console.log(`\n✅ Video generation complete!`);
    console.log(`📹 Video URL: ${video.videoUrl}`);
    console.log(`⏱️ Duration: ${video.duration}s`);
    console.log(`📐 Resolution: ${video.resolution}`);
    console.log(`📦 File size: ${(video.fileSize / 1024 / 1024).toFixed(2)}MB`);
    console.log(`\n📊 TIMING SUMMARY:`);
    console.log(`  Script generation: ${(timings.script_complete! - timings.script_start!) / 1000}s`);
    console.log(`  Images + TTS (parallel): ${(timings.parallel_complete! - timings.parallel_start!) / 1000}s`);
    console.log(`  FFmpeg + SEO (parallel): ${(timings.ffmpeg_complete! - timings.ffmpeg_start!) / 1000}s`);
    console.log(`  TOTAL: ${timings.complete! / 1000}s\n`);

    return {
      videoUrl: video.videoUrl,
      duration: video.duration,
      resolution: video.resolution,
      fileSize: video.fileSize,
      scriptSummary: {
        title: script.title,
        scenes: script.scenes.length,
        hashtags: script.hashtags,
      },
    };
  } catch (error) {
    console.error(`\n❌ Video generation failed for Social Post ${socialPostId}:`, error);

    // Update status to FAILED
    await db
      .update(socialPosts)
      .set({
        videoStatus: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(socialPosts.id, socialPostId));

    // Cleanup temp files on failure
    await cleanupTempFiles(socialPostId);

    throw error;
  }
}
