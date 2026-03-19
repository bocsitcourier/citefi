import { db } from "./db";
import { socialPosts, socialPostAssets } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { generateVeoScript } from "./veo-script-generator";
import { generateVeoClip, stitchVeoClips, uploadVeoVideo, cleanupVeoTempFiles, VeoClip } from "./veo-video-generator";
import { generateVeoTTS } from "./veo-video-tts-generator";
import { generateVideoSEOMetadata } from "./video-seo-optimizer";
import { generateVideoImages } from "./social-video-image-generator";
import { composeVideo, cleanupTempFiles as cleanupSlideshowTempFiles } from "./social-video-compositor";

const VEO_STYLE_CONSTANTS = {
  quality: "hyper-realistic, photorealistic, 8K ultra HD, cinematic, shallow depth of field, lifelike textures, film grain",
  safetyExclusions: "No text of any kind, no letters, no numbers, no captions, no logos, no watermarks, no signs, no billboards, no brand marks, no subtitles anywhere in the frame",
  lighting: {
    hook: "golden hour, warm cinematic tones, natural lighting",
    solution: "bright professional interior lighting, realistic ambient light",
    cta: "soft natural light, peaceful atmosphere, lifelike environment"
  }
};

function optimizeVeoPrompt(prompt: string, sceneType: "hook" | "solution" | "cta"): string {
  let optimized = prompt;
  
  if (!optimized.toLowerCase().includes("cinematic")) {
    optimized = `${VEO_STYLE_CONSTANTS.quality}. ${optimized}`;
  }
  
  // Always strip and re-append the full anti-text footer to ensure it's always at the end and complete
  optimized = optimized
    .replace(/\.\s*No text[^.]*\./gi, "")
    .replace(/\.\s*No text[^.]*/gi, "")
    .trim();
  optimized = `${optimized}. ${VEO_STYLE_CONSTANTS.safetyExclusions}`;
  
  const sensitiveTerms = [
    // Age-related terms that may trigger content policy
    { pattern: /\b(elderly|senior citizens?|old people)\b/gi, replacement: "adults" },
    // Medical content
    { pattern: /\b(hospital|medical equipment|medication|surgery)\b/gi, replacement: "" },
    { pattern: /\b(wheelchair|walker|crutches)\b/gi, replacement: "" },
    { pattern: /\b(blood|injury|wound|scar)\b/gi, replacement: "" },
    // Death/violence
    { pattern: /\b(funeral|death|cemetery)\b/gi, replacement: "" },
    { pattern: /\b(weapon|gun|knife|violence)\b/gi, replacement: "" },
    // Emotional distress terms that trigger content policy
    { pattern: /\byelling\s+furiously\b/gi, replacement: "speaking firmly" },
    { pattern: /\b(yelling|screaming|shrieking)\b/gi, replacement: "speaking loudly" },
    { pattern: /\b(furious|enraged|livid|irate)\b/gi, replacement: "frustrated" },
    { pattern: /\b(crying|sobbing|weeping)\b/gi, replacement: "emotional" },
    { pattern: /\b(angry|angered)\b/gi, replacement: "concerned" },
    { pattern: /\b(distressed|anguished)\b/gi, replacement: "thoughtful" },
    // Cinematography terms Veo doesn't understand well
    { pattern: /\bSMASH CUT\b/gi, replacement: "Cut" },
    { pattern: /\bshaky camera\b/gi, replacement: "handheld camera" },
    { pattern: /\bcamera shakes violently\b/gi, replacement: "subtle camera movement" },
  ];
  
  for (const term of sensitiveTerms) {
    optimized = optimized.replace(term.pattern, term.replacement);
  }
  
  optimized = optimized.replace(/\s+/g, " ").replace(/\.\s*\./g, ".").trim();
  
  return optimized;
}

export interface GenerateVeoVideoRequest {
  socialPostId: number;
  platform?: string;
}

export interface GenerateVeoVideoResult {
  videoUrl: string;
  duration: number;
  resolution: string;
  fileSize: number;
  scriptSummary: {
    title: string;
    clips: number;
  };
}

export async function generateVeoSocialVideo(
  request: GenerateVeoVideoRequest
): Promise<GenerateVeoVideoResult> {
  const { socialPostId, platform = "facebook" } = request;
  const aspectRatio = platform === "tiktok" || platform === "instagram_reels" ? "9:16" : "16:9";

  console.log(`\n🎬 Starting Veo AI video generation for Social Post ${socialPostId}`);
  console.log(`Platform: ${platform}, Aspect Ratio: ${aspectRatio}`);

  try {
    console.log(`\n📊 Step 1/6: Fetching social post data...`);
    const [post] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId))
      .limit(1);

    if (!post) {
      throw new Error(`Social post ${socialPostId} not found`);
    }

    if (!post.companyName) {
      await db
        .update(socialPosts)
        .set({ videoStatus: "FAILED" })
        .where(eq(socialPosts.id, socialPostId));
      
      throw new Error("Company name is required for video generation.");
    }

    await db
      .update(socialPosts)
      .set({ 
        videoStatus: "GENERATING",
        videoProgress: 5,
        videoStage: "initializing",
      })
      .where(eq(socialPosts.id, socialPostId));

    let articleContent: string | undefined;
    if (post.articleId) {
      const { articles } = await import("@/shared/schema");
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, post.articleId))
        .limit(1);
      
      if (article?.finalHtmlContent) {
        articleContent = article.finalHtmlContent.replace(/<[^>]*>/g, " ").slice(0, 2000);
      }
    }

    console.log(`\n📝 Step 2/6: Generating Veo video script with Gemini...`);
    const script = await generateVeoScript({
      topic: post.topic,
      title: post.title,
      location: post.location,
      tone: post.tone || "Professional",
      mood: post.mood || "Informative",
      industry: post.industry || "Business",
      companyName: post.companyName,
      articleContent,
    });

    console.log(`  ✅ Script generated: ${script.clips.length} clips`);

    await db
      .update(socialPosts)
      .set({ 
        videoScriptJson: script as any,
        videoProgress: 15,
        videoStage: "script_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    console.log(`\n🎙️ Step 3/6: Generating voiceover with OpenAI TTS HD...`);
    const audio = await generateVeoTTS({
      socialPostId,
      clips: script.clips,
      tone: post.tone || "Professional",
      companyName: post.companyName,
    });

    console.log(`  ✅ Voiceover generated (~${audio.duration}s, voice: ${audio.voice})`);

    await db
      .update(socialPosts)
      .set({ 
        videoProgress: 25,
        videoStage: "audio_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    console.log(`\n🎬 Step 4/6: Generating ${script.clips.length} Veo video clips (${script.clips.length * 6} seconds total)...`);
    console.log(`  ⏱️ Estimated time: ~2-3 minutes (parallel generation)`);
    console.log(`  🚀 All clips generated in parallel for maximum speed`);

    const MAX_RETRIES = 3;
    
    const getSceneType = (sceneNumber: number): "hook" | "solution" | "cta" => {
      if (sceneNumber <= 3) return "hook";
      if (sceneNumber <= 7) return "solution";
      return "cta";
    };
    
    const preparePromptForRetry = (prompt: string, retryLevel: number, sceneType: "hook" | "solution" | "cta"): string => {
      if (retryLevel === 0) return prompt;
      
      let sanitized = prompt
        .replace(/\b(elderly|senior|aging)\b/gi, 'adult')
        .replace(/\b(medication|medicine|hospital|clinic)\b/gi, '')
        .replace(/\b(concerned|worried|anxious|stressed)\b/gi, 'thoughtful')
        .replace(/\b(caregiver|nurse|doctor|patient)\b/gi, 'professional')
        .replace(/\b(wheelchair|walker|cane)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (retryLevel >= 2) {
        const lighting = VEO_STYLE_CONSTANTS.lighting[sceneType];
        sanitized = `${VEO_STYLE_CONSTANTS.quality}. Beautiful ${sceneType} scene with ${lighting}. ${sanitized.slice(0, 60)}. ${VEO_STYLE_CONSTANTS.safetyExclusions}`;
      }
      
      return sanitized;
    };

    const completedCount = { value: 0 };

    const generateClipWithRetry = async (clip: typeof script.clips[0], index: number): Promise<VeoClip> => {
      const sceneType = getSceneType(clip.sceneNumber);
      console.log(`\n  🎬 [Parallel] Starting clip ${index + 1}/${script.clips.length} (${sceneType})...`);
      const optimizedBasePrompt = optimizeVeoPrompt(clip.prompt, sceneType);
      let lastError: Error | null = null;

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          if (retry > 0) {
            console.log(`  🔄 Retry ${retry}/${MAX_RETRIES - 1} for clip ${index + 1} (simplified prompt)...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          const promptToUse = preparePromptForRetry(optimizedBasePrompt, retry, sceneType);
          const generated = await generateVeoClip({
            socialPostId,
            sceneNumber: clip.sceneNumber,
            prompt: promptToUse,
            aspectRatio,
            duration: 6,
          });
          completedCount.value++;
          const progress = 25 + Math.round(completedCount.value / script.clips.length * 50);
          await db.update(socialPosts).set({
            videoProgress: progress,
            videoStage: `clip_${completedCount.value}_complete`,
          }).where(eq(socialPosts.id, socialPostId));
          console.log(`  ✅ Clip ${index + 1} done (${completedCount.value}/${script.clips.length} complete)`);
          return generated;
        } catch (clipError) {
          lastError = clipError as Error;
          console.log(`  ❌ Clip ${index + 1} attempt ${retry + 1} failed: ${lastError.message}`);
        }
      }
      throw new Error(`Veo generation failed for scene ${index + 1} after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`);
    };

    const clipResults = await Promise.allSettled(
      script.clips.map((clip, i) => generateClipWithRetry(clip, i))
    );

    const failures = clipResults.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      const firstFailure = failures[0] as PromiseRejectedResult;
      throw new Error(firstFailure.reason?.message || 'One or more Veo clips failed to generate');
    }

    const generatedClips: VeoClip[] = clipResults
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<VeoClip>).value);

    console.log(`\n  ✅ All ${generatedClips.length} Veo clips generated`);

    await db
      .update(socialPosts)
      .set({ 
        videoProgress: 80,
        videoStage: "clips_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    console.log(`\n🔗 Step 5/6: Stitching clips and adding audio...`);

    let logoPath: string | undefined;
    if (post.companyLogoUrl?.startsWith("/api/public-objects/")) {
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
        const { objectStorageClient } = await import("./storage");
        
        const logoFileName = post.companyLogoUrl.split("/").pop();
        const tempDir = `/tmp/veo-output/${socialPostId}`;
        await fs.mkdir(tempDir, { recursive: true });
        logoPath = path.join(tempDir, `logo-${logoFileName}`);
        
        const bucket = objectStorageClient.bucket(BUCKET_ID);
        const objectPath = post.companyLogoUrl.replace("/api/public-objects/", "public/");
        const file = bucket.file(objectPath);
        const [buffer] = await file.download();
        await fs.writeFile(logoPath, buffer);
      } catch (logoError) {
        console.warn("⚠️ Could not load company logo:", logoError);
      }
    }

    const finalVideoPath = await stitchVeoClips(
      socialPostId,
      generatedClips,
      audio.localPath,
      logoPath,
      aspectRatio
    );

    const videoUrl = await uploadVeoVideo(finalVideoPath, socialPostId);

    const fs = await import("fs/promises");
    const stats = await fs.stat(finalVideoPath);
    const fileSize = stats.size;

    const ffprobeInstaller = await import("@ffprobe-installer/ffprobe");
    const { execSync } = await import("child_process");
    const durationOutput = execSync(
      `${ffprobeInstaller.path} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalVideoPath}"`
    ).toString().trim();
    const duration = Math.round(parseFloat(durationOutput));

    await db
      .update(socialPosts)
      .set({ 
        videoProgress: 90,
        videoStage: "composition_complete",
      })
      .where(eq(socialPosts.id, socialPostId));

    console.log(`\n🏷️ Step 6/6: Generating AI-powered SEO metadata...`);
    
    const seoMetadata = await generateVideoSEOMetadata({
      topic: post.topic,
      title: script.title,
      location: post.location,
      companyName: post.companyName,
      industry: post.industry || "Business",
      scriptHashtags: [],
      landingPageUrl: post.landingPageUrl,
    });
    
    const { videoTitle, videoDescription, videoTags } = seoMetadata;
    
    console.log(`  ✅ AI-optimized video title: ${videoTitle}`);
    console.log(`  ✅ AI-generated ${videoTags.length} SEO/GEO tags`);

    await db
      .update(socialPosts)
      .set({
        videoUrl,
        videoStatus: "READY",
        videoProgress: 100,
        videoStage: "complete",
        videoDuration: duration,
        videoGeneratedAt: new Date(),
        videoTitle,
        videoDescription,
        videoTagsJson: videoTags as any,
      })
      .where(eq(socialPosts.id, socialPostId));

    await db.insert(socialPostAssets).values({
      socialPostId,
      platform,
      assetType: "video",
      promptUsed: `Veo AI video: ${script.title}`,
      storageUrl: videoUrl,
      altText: script.title,
      aspectRatio: aspectRatio === "16:9" ? "1920x1080" : "1080x1920",
      fileFormat: "mp4",
      videoDuration: duration,
      videoResolution: aspectRatio === "16:9" ? "1920x1080" : "1080x1920",
    });

    await cleanupVeoTempFiles(socialPostId);

    console.log(`\n✅ Veo video generation complete!`);
    console.log(`📹 Video URL: ${videoUrl}`);
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`📐 Resolution: ${aspectRatio === "16:9" ? "1920x1080" : "1080x1920"}`);
    console.log(`📦 File size: ${(fileSize / 1024 / 1024).toFixed(2)}MB\n`);

    return {
      videoUrl,
      duration,
      resolution: aspectRatio === "16:9" ? "1920x1080" : "1080x1920",
      fileSize,
      scriptSummary: {
        title: script.title,
        clips: script.clips.length,
      },
    };
  } catch (error) {
    console.error(`\n❌ Veo video generation failed for Social Post ${socialPostId}:`, error);

    await db
      .update(socialPosts)
      .set({
        videoStatus: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      .where(eq(socialPosts.id, socialPostId));

    await cleanupVeoTempFiles(socialPostId);

    throw error;
  }
}

// Standalone video generation for Idea to Video (no social post required)
export interface GenerateVideoFromScriptRequest {
  videoIdeaId: number;
  title: string;
  companyName: string;
  location?: string;
  tone: string;
  companyLogoUrl?: string;
  website?: string;
  script: {
    title: string;
    totalDuration: number;
    companyName: string;
    clips: Array<{
      sceneNumber: number;
      targetDuration: number;
      prompt: string;
      narration: string;
    }>;
  };
  onProgress?: (progress: { stage: string; progress: number; message: string }) => Promise<void>;
}

export async function generateVideoFromScript(
  request: GenerateVideoFromScriptRequest
): Promise<{ videoUrl: string; audioUrl?: string }> {
  const { videoIdeaId, title, companyName, location, tone, companyLogoUrl, website, script, onProgress } = request;
  const aspectRatio = "16:9";

  console.log(`\n🎬 Starting standalone Veo AI video generation for Video Idea ${videoIdeaId}`);
  console.log(`Title: ${title}, Clips: ${script.clips.length}`);

  try {
    // Step 1: Generate TTS with natural speech and website pronunciation
    console.log(`\n🎙️ Step 1/4: Generating natural voiceover with OpenAI TTS HD...`);
    if (onProgress) {
      await onProgress({ stage: "tts", progress: 5, message: "Generating natural voiceover..." });
    }

    const audio = await generateVeoTTS({
      socialPostId: videoIdeaId, // Use videoIdeaId for temp file naming
      clips: script.clips.map(clip => ({
        sceneNumber: clip.sceneNumber,
        targetDuration: clip.targetDuration,
        prompt: clip.prompt,
        narration: clip.narration,
        geoReference: ""
      })),
      tone: tone || "Professional",
      companyName,
      website,
    });

    console.log(`  ✅ Voiceover generated (~${audio.duration}s, voice: ${audio.voice})`);
    if (onProgress) {
      await onProgress({ stage: "tts", progress: 15, message: "Voiceover complete" });
    }

    // Step 2: Generate Veo clips in parallel
    console.log(`\n🎬 Step 2/4: Generating ${script.clips.length} Veo video clips in parallel...`);
    console.log(`  🚀 All clips generated simultaneously for maximum speed`);
    
    const MAX_RETRIES = 3;
    
    const getSceneType = (sceneNumber: number): "hook" | "solution" | "cta" => {
      if (sceneNumber <= 3) return "hook";
      if (sceneNumber <= 7) return "solution";
      return "cta";
    };

    const ideaCompletedCount = { value: 0 };

    const generateIdeaClipWithRetry = async (clip: typeof script.clips[0], index: number): Promise<VeoClip> => {
      const sceneType = getSceneType(clip.sceneNumber);
      console.log(`\n  🎬 [Parallel] Starting clip ${index + 1}/${script.clips.length} (${sceneType})...`);
      const optimizedPrompt = optimizeVeoPrompt(clip.prompt, sceneType);
      let lastError: Error | null = null;

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          if (retry > 0) {
            console.log(`  🔄 Retry ${retry}/${MAX_RETRIES - 1} for clip ${index + 1}...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          const generated = await generateVeoClip({
            socialPostId: videoIdeaId,
            sceneNumber: clip.sceneNumber,
            prompt: optimizedPrompt,
            aspectRatio,
            duration: 6,
          });
          ideaCompletedCount.value++;
          const clipProgress = 15 + Math.round(ideaCompletedCount.value / script.clips.length * 60);
          if (onProgress) {
            await onProgress({
              stage: "clips",
              progress: clipProgress,
              message: `Generated clip ${ideaCompletedCount.value}/${script.clips.length}`,
            });
          }
          console.log(`  ✅ Clip ${index + 1} done (${ideaCompletedCount.value}/${script.clips.length} complete)`);
          return generated;
        } catch (clipError) {
          lastError = clipError as Error;
          console.log(`  ❌ Clip ${index + 1} attempt ${retry + 1} failed: ${lastError.message}`);
        }
      }
      throw new Error(`Veo generation failed for scene ${index + 1} after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`);
    };

    const ideaClipResults = await Promise.allSettled(
      script.clips.map((clip, i) => generateIdeaClipWithRetry(clip, i))
    );

    const ideaFailures = ideaClipResults.filter(r => r.status === 'rejected');
    const generatedClips: VeoClip[] = ideaClipResults
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<VeoClip>).value);

    if (ideaFailures.length > 0) {
      const isQuotaFailure = ideaFailures.some(r => {
        const msg = (r as PromiseRejectedResult).reason?.message || '';
        return msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429') || msg.includes('quota');
      });

      if (generatedClips.length === 0) {
        // No clips succeeded at all — escalate with quota label so orchestrator can fall back
        const firstFailure = ideaFailures[0] as PromiseRejectedResult;
        const baseMsg = firstFailure.reason?.message || 'All Veo clips failed';
        throw new Error(isQuotaFailure ? `RESOURCE_EXHAUSTED: ${baseMsg}` : baseMsg);
      }

      if (isQuotaFailure) {
        console.warn(`⚠️ ${ideaFailures.length}/${script.clips.length} clips failed due to Veo quota — proceeding with ${generatedClips.length} successful clips`);
      } else {
        console.warn(`⚠️ ${ideaFailures.length}/${script.clips.length} clips failed — proceeding with ${generatedClips.length} successful clips`);
      }
    }

    console.log(`\n  ✅ ${generatedClips.length}/${script.clips.length} Veo clips generated`);

    // Step 3: Download logo if provided
    let logoPath: string | undefined;
    if (companyLogoUrl?.startsWith("/api/public-objects/")) {
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
        const { objectStorageClient } = await import("./storage");
        
        const logoFileName = companyLogoUrl.split("/").pop();
        const tempDir = `/tmp/veo-output/${videoIdeaId}`;
        await fs.mkdir(tempDir, { recursive: true });
        logoPath = path.join(tempDir, `logo-${logoFileName}`);
        
        const bucket = objectStorageClient.bucket(BUCKET_ID);
        const objectPath = companyLogoUrl.replace("/api/public-objects/", "public/");
        const file = bucket.file(objectPath);
        const [buffer] = await file.download();
        await fs.writeFile(logoPath, buffer);
        console.log(`  ✅ Logo loaded for overlay`);
      } catch (logoError) {
        console.warn("⚠️ Could not load company logo:", logoError);
      }
    }

    // Step 4: Stitch clips
    console.log(`\n🔗 Step 3/4: Stitching clips and adding audio...`);
    if (onProgress) {
      await onProgress({ stage: "stitch", progress: 80, message: "Stitching video..." });
    }

    const finalVideoPath = await stitchVeoClips(
      videoIdeaId,
      generatedClips,
      audio.localPath,
      logoPath,
      aspectRatio
    );

    // Step 5: Upload
    console.log(`\n📤 Step 4/4: Uploading final video...`);
    if (onProgress) {
      await onProgress({ stage: "upload", progress: 95, message: "Uploading video..." });
    }

    const videoUrl = await uploadVeoVideo(finalVideoPath, videoIdeaId);

    await cleanupVeoTempFiles(videoIdeaId);

    console.log(`\n✅ Standalone video generation complete!`);
    console.log(`📹 Video URL: ${videoUrl}`);

    if (onProgress) {
      await onProgress({ stage: "complete", progress: 100, message: "Video complete!" });
    }

    return { videoUrl, audioUrl: audio.localPath };

  } catch (error) {
    console.error(`\n❌ Standalone video generation failed for Video Idea ${videoIdeaId}:`, error);
    await cleanupVeoTempFiles(videoIdeaId);
    throw error;
  }
}

/**
 * Slideshow fallback for Video Idea generation when Veo quota is exhausted.
 * Uses DALL-E/Gemini images + TTS audio instead of Veo clips.
 */
export async function generateIdeaVideoSlideshow(
  request: GenerateVideoFromScriptRequest
): Promise<{ videoUrl: string }> {
  const { videoIdeaId, title, companyName, location, tone, companyLogoUrl, website, script, onProgress } = request;

  console.log(`\n🖼️ Starting image-based slideshow fallback for Video Idea ${videoIdeaId} (Veo quota exceeded)`);

  try {
    // Step 1: Generate TTS voiceover
    if (onProgress) await onProgress({ stage: "tts", progress: 5, message: "Generating voiceover..." });

    const audio = await generateVeoTTS({
      socialPostId: videoIdeaId,
      clips: script.clips.map(clip => ({
        sceneNumber: clip.sceneNumber,
        targetDuration: clip.targetDuration,
        prompt: clip.prompt,
        narration: clip.narration,
        geoReference: location || "",
      })),
      tone: tone || "Professional",
      companyName,
      website,
    });
    console.log(`  ✅ Voiceover generated (~${audio.duration}s)`);
    if (onProgress) await onProgress({ stage: "tts", progress: 20, message: "Voiceover complete" });

    // Step 2: Map idea clips → VideoScene format for image generation
    let cumulativeTime = 0;
    const scenes = script.clips.map(clip => {
      const start = cumulativeTime;
      cumulativeTime += clip.targetDuration;
      return {
        sceneNumber: clip.sceneNumber,
        timeRange: `${start}-${cumulativeTime}s`,
        targetDuration: clip.targetDuration,
        narration: clip.narration,
        visualDescription: clip.prompt,
        caption: clip.narration.substring(0, 60),
        geoReference: location || "",
        seoKeywords: [] as string[],
      };
    });

    // Step 3: Generate DALL-E images in parallel
    if (onProgress) await onProgress({ stage: "clips", progress: 25, message: "Generating scene images..." });

    const images = await generateVideoImages({
      socialPostId: videoIdeaId,
      scenes,
      industry: "business",
      companyName: companyName || title,
      platform: "default",
      landingPageUrl: website,
    });
    console.log(`  ✅ ${images.length} scene images generated`);
    if (onProgress) await onProgress({ stage: "clips", progress: 65, message: `${images.length} images ready` });

    // Step 4: Download logo if provided
    let companyLogoPath: string | undefined;
    if (companyLogoUrl?.startsWith("/api/public-objects/")) {
      try {
        const fs = await import("fs/promises");
        const path = await import("path");
        const { objectStorageClient } = await import("./storage");
        const bucket = objectStorageClient.bucket();
        const objectPath = companyLogoUrl.replace("/api/public-objects/", "");
        const logoDir = `/tmp/video-${videoIdeaId}`;
        await fs.mkdir(logoDir, { recursive: true });
        companyLogoPath = path.join(logoDir, `logo-idea-${videoIdeaId}.png`);
        const file = bucket.file(objectPath);
        const [buffer] = await file.download();
        await fs.writeFile(companyLogoPath, buffer);
        console.log(`  ✅ Logo loaded for overlay`);
      } catch (logoError) {
        console.warn("⚠️ Could not load company logo (continuing without):", logoError);
      }
    }

    // Step 5: Compose video using slideshow compositor
    if (onProgress) await onProgress({ stage: "stitch", progress: 70, message: "Composing video..." });

    const composed = await composeVideo({
      socialPostId: videoIdeaId,
      images,
      audio,
      scenes,
      companyLogoPath,
      companyName: companyName || title,
      platform: "default",
      landingPageUrl: website,
    });

    // Cleanup
    await cleanupSlideshowTempFiles(videoIdeaId);
    await cleanupVeoTempFiles(videoIdeaId);

    console.log(`\n✅ Idea slideshow fallback complete: ${composed.videoUrl}`);
    if (onProgress) await onProgress({ stage: "complete", progress: 100, message: "Video complete!" });

    return { videoUrl: composed.videoUrl };

  } catch (error) {
    console.error(`\n❌ Idea slideshow fallback failed for Video Idea ${videoIdeaId}:`, error);
    await cleanupSlideshowTempFiles(videoIdeaId).catch(() => {});
    await cleanupVeoTempFiles(videoIdeaId).catch(() => {});
    throw error;
  }
}
