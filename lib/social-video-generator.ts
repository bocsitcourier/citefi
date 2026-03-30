import { db, safeQuery } from "./db";
import { socialPosts, socialPostAssets } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { generateVideoScript } from "./gemini-video-script-generator";
import { generateVideoImages } from "./social-video-image-generator";
import { generateVideoTTS } from "./social-video-tts-generator";
import { composeVideo, cleanupTempFiles } from "./social-video-compositor";
import { generateVideoSEOMetadata } from "./video-seo-optimizer";

export interface GenerateSocialVideoRequest {
  socialPostId: number;
  platform?: string;
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

  const timings: Record<string, number> = {};
  const startTotal = Date.now();
  const markTime = (label: string) => {
    timings[label] = Date.now() - startTotal;
    console.log(`⏱️ [${label}] ${timings[label]}ms elapsed`);
  };

  console.log(`\n🎬 Starting 60-second video generation for Social Post ${socialPostId}`);
  console.log(`Platform: ${platform}`);

  try {
    // ─── Step 1: FAST FETCH — acquire connection briefly, then release it ────────
    // All data needed for the entire pipeline is loaded here.
    // No connections are held during the heavy external work below.
    console.log(`\n📊 Step 1/5: Fetching social post data...`);
    const post = await safeQuery(() =>
      db
        .select()
        .from(socialPosts)
        .where(eq(socialPosts.id, socialPostId))
        .limit(1)
        .then((rows) => rows[0])
    );

    if (!post) {
      throw new Error(`Social post ${socialPostId} not found`);
    }

    if (!post.companyName) {
      await safeQuery(() =>
        db
          .update(socialPosts)
          .set({ videoStatus: "FAILED" })
          .where(eq(socialPosts.id, socialPostId))
      );
      throw new Error(
        "Company name is required for video generation. Please edit this post to add your company name."
      );
    }

    // Fetch article content if linked — brief connection, then released
    let articleContent: string | undefined;
    if (post.articleId) {
      const { articles } = await import("@/shared/schema");
      const article = await safeQuery(() =>
        db
          .select()
          .from(articles)
          .where(eq(articles.id, post.articleId!))
          .limit(1)
          .then((rows) => rows[0])
      );
      if (article?.finalHtmlContent) {
        articleContent = article.finalHtmlContent.replace(/<[^>]*>/g, " ").slice(0, 2000);
      }
    }

    // Mark GENERATING — brief write, connection released immediately
    await safeQuery(() =>
      db
        .update(socialPosts)
        .set({ videoStatus: "GENERATING" })
        .where(eq(socialPosts.id, socialPostId))
    );

    // ─── Step 2: HEAVY WORK — no DB connections held from here ──────────────────
    // Script generation (Gemini call ~10-30s)
    console.log(`\n📝 Step 2/5: Generating video script with Gemini...`);
    markTime("script_start");
    const script = await generateVideoScript({
      topic: post.topic,
      title: post.title,
      location: post.location,
      tone: post.tone || "Professional",
      mood: post.mood || "Informative",
      industry: post.industry || "Business",
      companyName: post.companyName,
      articleContent,
      landingPageUrl: post.landingPageUrl || undefined,
    });
    markTime("script_complete");
    console.log(`  ✅ Script generated: ${script.scenes.length} scenes`);

    // Brief progress save — connection acquired and released immediately
    await safeQuery(() =>
      db
        .update(socialPosts)
        .set({ videoScriptJson: script as any, videoProgress: 20, videoStage: "script_complete" })
        .where(eq(socialPosts.id, socialPostId))
    );

    // ─── Step 3 & 4: PARALLEL — images + TTS, no DB connections held ────────────
    console.log(`\n🚀 Step 3-4/5: Generating images and voiceover in parallel...`);
    markTime("parallel_start");

    const [images, audio] = await Promise.all([
      (async () => {
        console.log(`🖼️ [Parallel] Generating 5 cinematic images...`);
        const result = await generateVideoImages({
          socialPostId,
          scenes: script.scenes,
          industry: post.industry || "Business",
          companyName: post.companyName!,
          platform,
          landingPageUrl: post.landingPageUrl || undefined,
        });
        console.log(`  ✅ ${result.length} images generated`);
        return result;
      })(),
      (async () => {
        console.log(`🎙️ [Parallel] Generating voiceover with OpenAI TTS...`);
        const result = await generateVideoTTS({
          socialPostId,
          scenes: script.scenes,
          tone: post.tone || "Professional",
          companyName: post.companyName!,
        });
        console.log(`  ✅ Voiceover generated (~${result.duration}s, voice: ${result.voice})`);
        return result;
      })(),
    ]);

    markTime("parallel_complete");
    console.log(`\n🎉 Parallel generation complete! Images and audio ready.`);

    // Brief progress save + batch image asset inserts in one round-trip ──────────
    await safeQuery(() =>
      db
        .update(socialPosts)
        .set({ videoProgress: 65, videoStage: "assets_complete" })
        .where(eq(socialPosts.id, socialPostId))
    );

    if (images.length > 0) {
      await safeQuery(() =>
        db.insert(socialPostAssets).values(
          images.map((image) => {
            const scene = script.scenes.find((s) => s.sceneNumber === image.sceneNumber);
            return {
              socialPostId,
              platform,
              assetType: "image" as const,
              promptUsed: scene?.visualDescription || "Video scene image",
              storageUrl: image.storageUrl,
              altText: `Scene ${image.sceneNumber}: ${scene?.caption || ""}`,
              aspectRatio: image.aspectRatio,
              fileFormat: "png",
            };
          })
        )
      );
    }

    // ─── Step 5: FFmpeg + SEO metadata in parallel — no DB connections held ─────
    console.log(`\n🎬 Step 5/5: Composing video + generating SEO metadata in parallel...`);
    markTime("ffmpeg_start");

    let companyLogoPath: string | undefined;
    if (post.companyLogoUrl) {
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const tempDir = `/tmp/video-${socialPostId}`;
        await fs.mkdir(tempDir, { recursive: true });

        if (post.companyLogoUrl.startsWith("/api/public-objects/")) {
          const logoFileName = post.companyLogoUrl.split("/").pop();
          const logoPath = path.join(tempDir, `logo-${logoFileName}`);
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
      }
    }

    const [video, seoMetadata] = await Promise.all([
      (async () => {
        const result = await composeVideo({
          socialPostId,
          images,
          audio,
          scenes: script.scenes,
          companyLogoPath,
          companyName: post.companyName!,
          platform,
          landingPageUrl: post.landingPageUrl || undefined,
        });
        console.log(
          `  ✅ Video composed: ${result.resolution}, ${result.duration}s, ${(result.fileSize / 1024 / 1024).toFixed(2)}MB`
        );
        return result;
      })(),
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

    // ─── Step 6: FAST SAVE — two brief writes, connections released immediately ──
    // Check if cancelled while we were generating
    const currentStatus = await safeQuery(() =>
      db
        .select({ videoStatus: socialPosts.videoStatus })
        .from(socialPosts)
        .where(eq(socialPosts.id, socialPostId))
        .limit(1)
        .then((rows) => rows[0])
    );

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
    await safeQuery(() =>
      db
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
        .where(eq(socialPosts.id, socialPostId))
    );

    await safeQuery(() =>
      db.insert(socialPostAssets).values({
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
      })
    );

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

    await safeQuery(() =>
      db
        .update(socialPosts)
        .set({
          videoStatus: "FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .where(eq(socialPosts.id, socialPostId))
    );

    await cleanupTempFiles(socialPostId);
    throw error;
  }
}
