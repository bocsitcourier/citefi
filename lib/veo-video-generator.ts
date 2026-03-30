import { GoogleGenAI, createPartFromUri } from "@google/genai";
import { objectStorageClient } from "./storage";
import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { VEO_VIDEO_MODEL } from "./ai-config";
import { sanitizeVeoPrompt } from "@/types/video-schema";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for Veo video generation");
}

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { apiVersion: "v1" },
});

export interface VeoClip {
  sceneNumber: number;
  prompt: string;
  targetDuration: number;
  localPath: string;
  storageUrl?: string;
}

export interface VeoVideoScript {
  title: string;
  clips: VeoClipPrompt[];
  totalDuration: number;
  companyName: string;
  location: string;
}

export interface VeoClipPrompt {
  sceneNumber: number;
  prompt: string;
  targetDuration: number;
  narration: string;
  geoReference: string;
}

interface GenerateVeoClipRequest {
  socialPostId: number;
  sceneNumber: number;
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  duration?: 4 | 6 | 8;
}

export async function generateVeoClip(
  request: GenerateVeoClipRequest
): Promise<VeoClip> {
  const { socialPostId, sceneNumber, prompt, aspectRatio = "16:9", duration = 8 } = request;

  // Sanitize prompt to avoid content policy rejections
  const sanitizedPrompt = sanitizeVeoPrompt(prompt);
  
  console.log(`🎬 Generating Veo clip ${sceneNumber} for post ${socialPostId}`);
  console.log(`  📝 Original prompt: ${prompt.slice(0, 80)}...`);
  if (sanitizedPrompt !== prompt) {
    console.log(`  🧹 Sanitized prompt: ${sanitizedPrompt.slice(0, 80)}...`);
  }

  try {
    const operation = await genAI.models.generateVideos({
      model: VEO_VIDEO_MODEL,
      prompt: sanitizedPrompt,
      config: {
        aspectRatio: aspectRatio,
        durationSeconds: duration,
        numberOfVideos: 1,
      },
    });

    console.log(`  ⏳ Veo operation started: ${operation.name}`);
    console.log(`  📋 Initial operation state - done: ${operation.done}`);

    let currentOperation = operation;
    let pollCount = 0;
    // Veo 2 clips (5-8s each) typically complete in 10-30 min.
    // Allow up to 360 polls × 10s = 60 min to handle slow generations.
    const maxPolls = 360;

    // Poll using operation object (SDK expects { operation: operationObject })
    while (!currentOperation.done && pollCount < maxPolls) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      pollCount++;
      
      // Guard against undefined operation name
      if (!currentOperation || !currentOperation.name) {
        console.log(`  ❌ Invalid operation state - operation or name is undefined`);
        throw new Error("Veo operation state is invalid - cannot poll");
      }
      
      console.log(`  ⏳ Polling Veo (${pollCount}/${maxPolls}) for operation: ${currentOperation.name}...`);
      
      try {
        const pollResult = await genAI.operations.getVideosOperation({
          operation: currentOperation,
        });
        
        // Guard against undefined poll result
        if (!pollResult) {
          console.log(`  ⚠️ Poll returned undefined, retrying...`);
          continue;
        }
        
        currentOperation = pollResult;
        console.log(`  📋 Poll ${pollCount} - done: ${currentOperation.done}`);
      } catch (pollError: any) {
        console.log(`  ⚠️ Poll error (attempt ${pollCount}): ${pollError.message}`);
        // Continue polling on transient errors
        if (pollCount >= maxPolls) {
          throw new Error(`Veo polling failed: ${pollError.message}`);
        }
      }
    }

    if (!currentOperation.done) {
      throw new Error(`Veo video generation timed out after ${maxPolls * 10 / 60} minutes for scene ${sceneNumber}`);
    }

    // Log full operation response for debugging
    console.log(`  📋 Veo operation complete after ${pollCount} polls`);
    console.log(`  📋 Operation keys:`, Object.keys(currentOperation));
    console.log(`  📋 Response keys:`, Object.keys(currentOperation.response || {}));
    
    // Check for operation-level error
    if (currentOperation.error) {
      console.log(`  ❌ Veo operation.error:`, JSON.stringify(currentOperation.error, null, 2));
      throw new Error(`Veo operation failed: ${currentOperation.error.message || JSON.stringify(currentOperation.error)}`);
    }
    
    // Check for response-level error
    const responseError = (currentOperation.response as any)?.error;
    if (responseError) {
      console.log(`  ❌ Veo response.error:`, JSON.stringify(responseError, null, 2));
      throw new Error(`Veo response error: ${responseError.message || JSON.stringify(responseError)}`);
    }

    // Try both response.generatedVideos and result.generatedVideos
    let generatedVideos = currentOperation.response?.generatedVideos;
    if (!generatedVideos || generatedVideos.length === 0) {
      const result = (currentOperation as any).result;
      if (result?.generatedVideos) {
        console.log(`  📋 Found videos in result field instead of response`);
        generatedVideos = result.generatedVideos;
      }
    }
    
    console.log(`  📋 Generated videos count:`, generatedVideos?.length || 0);
    if (generatedVideos && generatedVideos.length > 0) {
      console.log(`  📋 First video keys:`, Object.keys(generatedVideos[0] || {}));
    }
    
    if (!generatedVideos || generatedVideos.length === 0) {
      // Check for RAI filtering in multiple locations
      const raiFilteredReasons = (currentOperation.response as any)?.raiMediaFilteredReasons;
      const raiFilteredCount = (currentOperation.response as any)?.raiMediaFilteredCount;
      const raiFilteredReason = (currentOperation.response as any)?.raiFilteredReason 
        || (currentOperation as any).raiFilteredReason
        || (currentOperation as any).result?.raiFilteredReason;
      
      if (raiFilteredReasons && raiFilteredReasons.length > 0) {
        console.log(`  ❌ Veo content blocked by RAI filter (${raiFilteredCount} media filtered)`);
        throw new Error(`Veo content blocked: ${raiFilteredReasons.join('; ')}`);
      }
      
      if (raiFilteredReason) {
        throw new Error(`Veo content blocked by safety filter: ${raiFilteredReason}`);
      }
      
      // Log full response for debugging
      console.log(`  ❌ Full operation response:`, JSON.stringify(currentOperation, null, 2).slice(0, 2000));
      throw new Error("No video generated from Veo - response was empty");
    }

    const videoFile = generatedVideos[0]!.video;
    if (!videoFile) {
      throw new Error("No video file in Veo response");
    }

    const tempDir = `/tmp/veo-clips/${socialPostId}`;
    await fs.mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `scene-${sceneNumber}.mp4`);

    // Try multiple methods to get video data
    let videoData: Buffer | null = null;
    const apiKey = process.env.GEMINI_API_KEY!;
    
    // Method 1: Check if videoBytes is already populated
    if (videoFile.videoBytes) {
      console.log(`  📦 Using videoBytes directly from response`);
      videoData = Buffer.from(videoFile.videoBytes);
    }
    
    // Method 2: Fetch directly from URI with API key authentication
    if (!videoData && videoFile.uri) {
      console.log(`  🌐 Fetching video from URI with API key auth...`);
      try {
        // Try with X-Goog-Api-Key header
        let response = await fetch(videoFile.uri, {
          headers: {
            'X-Goog-Api-Key': apiKey,
          },
        });
        
        if (!response.ok) {
          console.log(`  ⚠️ Header auth failed (${response.status}), trying query param...`);
          // Fallback: append key as query parameter
          const urlWithKey = videoFile.uri.includes('?') 
            ? `${videoFile.uri}&key=${apiKey}`
            : `${videoFile.uri}?key=${apiKey}`;
          response = await fetch(urlWithKey);
        }
        
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          videoData = Buffer.from(arrayBuffer);
          console.log(`  ✅ Downloaded ${videoData.length} bytes via authenticated fetch`);
        } else {
          console.warn(`  ⚠️ Authenticated fetch failed: ${response.status} ${response.statusText}`);
          const errorText = await response.text().catch(() => 'Could not read error body');
          console.warn(`  ⚠️ Error body: ${errorText.slice(0, 500)}`);
        }
      } catch (fetchError) {
        console.warn(`  ⚠️ Direct fetch failed:`, fetchError);
      }
    }
    
    if (!videoData) {
      console.error(`  ❌ Video file object:`, JSON.stringify(videoFile, null, 2));
      throw new Error("Could not extract video data from Veo response - all download methods failed");
    }
    
    console.log(`  💾 Writing ${videoData.length} bytes to ${localPath}`);
    await fs.writeFile(localPath, videoData);

    console.log(`  ✅ Veo clip ${sceneNumber} saved to ${localPath}`);

    return {
      sceneNumber,
      prompt,
      targetDuration: duration,
      localPath,
    };
  } catch (error) {
    console.error(`❌ Veo clip ${sceneNumber} generation failed:`, error);
    throw new Error(`Veo generation failed for scene ${sceneNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function generateAllVeoClips(
  socialPostId: number,
  clips: VeoClipPrompt[],
  aspectRatio: "16:9" | "9:16" = "16:9"
): Promise<VeoClip[]> {
  console.log(`🎬 Generating ${clips.length} Veo clips for post ${socialPostId}`);

  const generatedClips: VeoClip[] = [];

  for (const clip of clips) {
    const generated = await generateVeoClip({
      socialPostId,
      sceneNumber: clip.sceneNumber,
      prompt: clip.prompt,
      aspectRatio,
      duration: Math.min(8, Math.max(4, clip.targetDuration)) as 4 | 6 | 8,
    });
    generatedClips.push(generated);
  }

  console.log(`✅ All ${clips.length} Veo clips generated`);
  return generatedClips;
}

export async function stitchVeoClips(
  socialPostId: number,
  clips: VeoClip[],
  audioPath?: string,
  logoPath?: string,
  aspectRatio: "16:9" | "9:16" = "9:16"
): Promise<string> {
  const ffmpegPath = ffmpegStatic;
  
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary not found - ffmpeg-static returned null");
  }

  console.log(`🔗 Stitching ${clips.length} Veo clips with crossfade transitions`);

  const tempDir = `/tmp/veo-output/${socialPostId}`;
  await fs.mkdir(tempDir, { recursive: true });

  const sortedClips = clips.sort((a, b) => a.sceneNumber - b.sceneNumber);
  const stitchedPath = path.join(tempDir, "stitched.mp4");
  
  // Target resolution based on aspect ratio — force full-frame fill, no black bars
  const W = aspectRatio === "16:9" ? 1920 : 1080;
  const H = aspectRatio === "16:9" ? 1080 : 1920;
  // Scale to fill (increase), then crop to exact target — guarantees zero black bars
  const scaleCrop = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;

  const CROSSFADE_DURATION = 0.5;
  
  if (sortedClips.length === 1) {
    // Single clip — normalize resolution
    const normCmd = `${ffmpegPath} -y -i "${sortedClips[0]!.localPath}" -vf "${scaleCrop}" -c:v libx264 -preset fast -crf 23 -movflags +faststart "${stitchedPath}"`;
    execSync(normCmd, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
  } else if (sortedClips.length === 2) {
    // Two clips — normalize then crossfade
    const scaleParts = `[0:v]${scaleCrop}[s0];[1:v]${scaleCrop}[s1]`;
    const filterComplex = `${scaleParts};[s0][s1]xfade=transition=fade:duration=${CROSSFADE_DURATION}:offset=5.5[outv]`;
    const ffmpegCmd = `${ffmpegPath} -y -i "${sortedClips[0]!.localPath}" -i "${sortedClips[1]!.localPath}" -filter_complex "${filterComplex}" -map "[outv]" -c:v libx264 -preset fast -crf 23 -movflags +faststart "${stitchedPath}"`;
    
    console.log(`  🎬 Applying crossfade transition...`);
    execSync(ffmpegCmd, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
  } else {
    // 3+ clips — normalize all, then chain crossfades
    const inputs = sortedClips.map((clip) => `-i "${clip.localPath}"`).join(" ");
    
    // First normalize each clip to target resolution
    const scaleParts = sortedClips.map((_, i) => `[${i}:v]${scaleCrop}[s${i}]`);
    
    // Then chain crossfades on normalized streams
    let filterParts: string[] = [];
    let lastOutput = "s0";
    
    for (let i = 1; i < sortedClips.length; i++) {
      const offset = (6 - CROSSFADE_DURATION) * i;
      const outputLabel = i === sortedClips.length - 1 ? "outv" : `v${i}`;
      filterParts.push(`[${lastOutput}][s${i}]xfade=transition=fade:duration=${CROSSFADE_DURATION}:offset=${offset}[${outputLabel}]`);
      lastOutput = outputLabel;
    }
    
    const filterComplex = [...scaleParts, ...filterParts].join(";");
    const ffmpegCmd = `${ffmpegPath} -y ${inputs} -filter_complex "${filterComplex}" -map "[outv]" -c:v libx264 -preset fast -crf 23 -movflags +faststart "${stitchedPath}"`;
    
    console.log(`  🎬 Normalizing to ${W}x${H} and applying ${sortedClips.length - 1} crossfade transitions...`);
    execSync(ffmpegCmd, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });
  }
  
  console.log(`  ✅ Crossfade stitching complete`);

  let finalPath = stitchedPath;

  if (audioPath) {
    console.log(`  🎵 Adding voiceover audio...`);
    const withAudioPath = path.join(tempDir, "with-audio.mp4");
    
    // Use -shortest to end video when the shorter stream (video) ends
    // This prevents video from freezing on last frame if audio is longer
    const audioCmd = `${ffmpegPath} -y -i "${stitchedPath}" -i "${audioPath}" -map 0:v -map 1:a -c:v copy -c:a aac -shortest -movflags +faststart "${withAudioPath}"`;
    execSync(audioCmd, { stdio: "pipe" });
    finalPath = withAudioPath;
  }

  if (logoPath) {
    console.log(`  🏷️ Adding logo overlay...`);
    const withLogoPath = path.join(tempDir, "final.mp4");
    
    // scale=200:-1 → 200px wide, auto height. format=auto handles PNG alpha.
    // Top-right (W-w-20:20) keeps logo above caption text area.
    const logoCmd = `${ffmpegPath} -y -i "${finalPath}" -i "${logoPath}" -filter_complex "[1:v]scale=200:-1[logo];[0:v][logo]overlay=W-w-20:20:format=auto" -c:a copy -movflags +faststart "${withLogoPath}"`;
    execSync(logoCmd, { stdio: "pipe" });
    finalPath = withLogoPath;
  }

  console.log(`✅ Final video created with smooth transitions: ${finalPath}`);
  return finalPath;
}

export async function uploadVeoVideo(
  localPath: string,
  socialPostId: number
): Promise<string> {
  console.log(`☁️ Uploading Veo video to storage...`);

  const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
  const timestamp = Date.now();
  const fileName = `veo-video-${socialPostId}-${timestamp}.mp4`;
  const objectPath = `public/social-videos/${fileName}`;

  const videoBuffer = await fs.readFile(localPath);

  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const file = bucket.file(objectPath);

  await file.save(videoBuffer, {
    contentType: "video/mp4",
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });

  const publicUrl = `/api/public-objects/social-videos/${fileName}`;
  console.log(`✅ Veo video uploaded: ${publicUrl}`);

  return publicUrl;
}

export async function cleanupVeoTempFiles(socialPostId: number): Promise<void> {
  try {
    const clipsDir = `/tmp/veo-clips/${socialPostId}`;
    const outputDir = `/tmp/veo-output/${socialPostId}`;
    
    await fs.rm(clipsDir, { recursive: true, force: true });
    await fs.rm(outputDir, { recursive: true, force: true });
    
    console.log(`🧹 Cleaned up Veo temp files for post ${socialPostId}`);
  } catch (error) {
    console.warn(`⚠️ Could not clean up Veo temp files:`, error);
  }
}
