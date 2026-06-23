import { GoogleGenAI } from "@google/genai";
import { spawn } from "child_process";
import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import ffmpegStatic from "ffmpeg-static";
import ffprobePath from "@ffprobe-installer/ffprobe";
import { GEMINI_FLASH_MODEL } from "./ai-config";
import { validateExternalUrl } from "./url-validation";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for video style analysis");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VideoAnalysisResult {
  duration: number;
  resolution: { width: number; height: number };
  fps: number;
  hasAudio: boolean;
  audioInfo: {
    codec: string;
    sampleRate: number;
    channels: number;
  } | null;
  sceneCount: number;
  avgShotDuration: number;
  pacing: "slow" | "medium" | "fast" | "very_fast";
  framesPaths: string[];
  styleDescription: string;
  stylePrompt: string;
  colorPalette: string;
  cameraWork: string;
  mood: string;
  editingStyle: string;
}


// ── Platform detection ──────────────────────────────────────────────────────

/** Returns the YouTube video ID or null if this URL is not a YouTube URL. */
function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    // youtu.be/VIDEO_ID
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null;
    // youtube.com/watch?v=VIDEO_ID
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      // /shorts/VIDEO_ID or /embed/VIDEO_ID or /v/VIDEO_ID
      const m = u.pathname.match(/\/(?:shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      return m?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns the Vimeo video ID or null. */
function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("vimeo.com")) {
      const m = u.pathname.match(/\/(\d+)/);
      return m?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns true if the URL looks like a direct video file. */
function isDirectVideoUrl(url: string): boolean {
  const lower = url.toLowerCase().split("?")[0]!;
  return /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/.test(lower);
}

// ── Thumbnail-based analysis (YouTube / Vimeo) ──────────────────────────────

async function downloadImageToFile(imageUrl: string, outputPath: string): Promise<boolean> {
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CitefiEngine/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("image")) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return false; // skip placeholder/empty images
    await fs.writeFile(outputPath, buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * For YouTube videos: download the publicly-available thumbnail frames.
 * YouTube provides 4 scene thumbnails (0–3) plus a max-res default.
 * Returns the paths of successfully downloaded images.
 */
async function getYouTubeThumbnailFrames(videoId: string, outputDir: string): Promise<{ framePaths: string[]; estimatedDuration: number }> {
  const framesDir = path.join(outputDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  const candidates = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/0.jpg`,
    `https://img.youtube.com/vi/${videoId}/1.jpg`,
    `https://img.youtube.com/vi/${videoId}/2.jpg`,
    `https://img.youtube.com/vi/${videoId}/3.jpg`,
  ];

  const framePaths: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const destPath = path.join(framesDir, `frame_${String(i).padStart(3, "0")}.jpg`);
    const ok = await downloadImageToFile(candidates[i]!, destPath);
    if (ok) framePaths.push(destPath);
    if (framePaths.length >= 6) break;
  }

  if (framePaths.length === 0) {
    throw new Error(`Could not fetch any thumbnails for YouTube video ${videoId}. The video may be private or unavailable.`);
  }

  console.log(`✅ Downloaded ${framePaths.length} YouTube thumbnail frames for vid=${videoId}`);
  return { framePaths, estimatedDuration: 60 };
}

/**
 * For Vimeo videos: fetch the thumbnail via Vimeo's oembed API.
 */
async function getVimeoThumbnailFrames(videoId: string, outputDir: string): Promise<{ framePaths: string[]; estimatedDuration: number }> {
  const framesDir = path.join(outputDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  const oembedUrl = `https://vimeo.com/api/v2/video/${videoId}.json`;
  const res = await fetch(oembedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CitefiEngine/1.0)" },
  });

  if (!res.ok) throw new Error(`Vimeo API returned ${res.status} for video ${videoId}`);

  const data = await res.json() as any[];
  const info = data[0];
  const thumbnailUrl: string = info?.thumbnail_large || info?.thumbnail_medium || info?.thumbnail_small;
  const duration: number = info?.duration || 60;

  if (!thumbnailUrl) throw new Error(`No thumbnail URL in Vimeo API response for video ${videoId}`);

  const destPath = path.join(framesDir, "frame_000.jpg");
  const ok = await downloadImageToFile(thumbnailUrl, destPath);
  if (!ok) throw new Error(`Failed to download Vimeo thumbnail for video ${videoId}`);

  console.log(`✅ Downloaded Vimeo thumbnail for vid=${videoId}`);
  return { framePaths: [destPath], estimatedDuration: duration };
}

// ── Original direct-download path (for .mp4 / direct links) ─────────────────

async function downloadVideo(url: string, outputDir: string): Promise<string> {
  validateExternalUrl(url);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "reference.mp4");

  console.log(`📥 Downloading reference video from: ${url.slice(0, 80)}...`);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CitefiEngine/1.0)",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to download video: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html") || contentType.includes("text/plain")) {
    throw new Error(
      `The URL returned an HTML page, not a video file. ` +
      `For YouTube, TikTok, or social media videos, the URL is automatically handled. ` +
      `For direct video analysis, please use a direct .mp4 link.`
    );
  }

  if (!contentType.includes("video") && !contentType.includes("octet-stream") && !contentType.includes("application/")) {
    throw new Error(`Unexpected content type "${contentType}". Expected a video file (mp4/webm/mov).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const MAX_SIZE = 100 * 1024 * 1024;
  if (buffer.length > MAX_SIZE) {
    throw new Error(`Video too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max 100MB.`);
  }

  await fs.writeFile(outputPath, buffer);
  console.log(`✅ Video downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);

  return outputPath;
}

async function getVideoMetadata(videoPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  audioCodec: string;
  audioSampleRate: number;
  audioChannels: number;
}> {
  return new Promise((resolve, reject) => {
    const probe = spawn(ffprobePath.path, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      videoPath,
    ]);

    let stdout = "";
    probe.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    let stderr = "";
    probe.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    probe.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }

      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
        const audioStream = info.streams?.find((s: any) => s.codec_type === "audio");

        const duration = parseFloat(info.format?.duration || "0");
        const width = videoStream?.width || 1920;
        const height = videoStream?.height || 1080;

        let fps = 30;
        if (videoStream?.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split("/");
          fps = parts.length === 2 ? parseInt(parts[0]) / parseInt(parts[1]) : parseFloat(parts[0]);
        }

        resolve({
          duration,
          width,
          height,
          fps: Math.round(fps * 100) / 100,
          hasAudio: !!audioStream,
          audioCodec: audioStream?.codec_name || "",
          audioSampleRate: parseInt(audioStream?.sample_rate || "0"),
          audioChannels: audioStream?.channels || 0,
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err}`));
      }
    });

    probe.on("error", reject);
  });
}

async function extractKeyFrames(
  videoPath: string,
  outputDir: string,
  maxFrames: number = 8
): Promise<string[]> {
  const ffmpegPath = ffmpegStatic;
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary not found");
  }

  const framesDir = path.join(outputDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  const metadata = await getVideoMetadata(videoPath);
  const duration = metadata.duration;

  if (duration <= 0) {
    throw new Error("Could not determine video duration");
  }

  const interval = Math.max(duration / maxFrames, 0.5);

  console.log(`🎞️ Extracting ${maxFrames} key frames from ${duration.toFixed(1)}s video (every ${interval.toFixed(1)}s)`);

  const cmd = `${ffmpegPath} -y -i "${videoPath}" -vf "fps=1/${interval},scale=512:-1" -frames:v ${maxFrames} -q:v 2 "${framesDir}/frame_%03d.jpg"`;
  execSync(cmd, { stdio: "pipe", maxBuffer: 20 * 1024 * 1024 });

  const files = await fs.readdir(framesDir);
  const framePaths = files
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(framesDir, f));

  console.log(`✅ Extracted ${framePaths.length} frames`);
  return framePaths;
}

async function detectSceneChanges(videoPath: string): Promise<number> {
  const ffmpegPath = ffmpegStatic;
  if (!ffmpegPath) return 1;

  try {
    const cmd = `${ffmpegPath} -i "${videoPath}" -vf "select='gt(scene,0.3)',showinfo" -f null - 2>&1`;
    const output = execSync(cmd, { stdio: "pipe", maxBuffer: 20 * 1024 * 1024 }).toString();

    const sceneMatches = output.match(/\[Parsed_showinfo.*\]/g);
    const sceneCount = (sceneMatches?.length || 0) + 1;

    console.log(`🎬 Detected ${sceneCount} scenes`);
    return sceneCount;
  } catch {
    console.warn("⚠️ Scene detection failed, defaulting to 1");
    return 1;
  }
}

function classifyPacing(duration: number, sceneCount: number): "slow" | "medium" | "fast" | "very_fast" {
  const avgShotLength = duration / Math.max(sceneCount, 1);

  if (avgShotLength > 6) return "slow";
  if (avgShotLength > 3) return "medium";
  if (avgShotLength > 1.5) return "fast";
  return "very_fast";
}

async function analyzeStyleWithGemini(
  framePaths: string[],
  metadata: { duration: number; fps: number; sceneCount: number; pacing: string; hasAudio: boolean }
): Promise<{
  styleDescription: string;
  stylePrompt: string;
  colorPalette: string;
  cameraWork: string;
  mood: string;
  editingStyle: string;
}> {
  console.log(`🤖 Analyzing ${framePaths.length} frames with Gemini Vision...`);

  const frameContents = await Promise.all(
    framePaths.slice(0, 6).map(async (fp) => {
      const data = await fs.readFile(fp);
      return {
        inlineData: {
          mimeType: "image/jpeg" as const,
          data: data.toString("base64"),
        },
      };
    })
  );

  const prompt = `You are a professional video production analyst. Analyze these ${frameContents.length} frames extracted from a ${metadata.duration.toFixed(1)}-second video.

Video metadata:
- Duration: ${metadata.duration.toFixed(1)}s
- FPS: ${metadata.fps}
- Scene count: ${metadata.sceneCount}
- Pacing: ${metadata.pacing}
- Has audio: ${metadata.hasAudio}

Analyze the visual style and respond ONLY with valid JSON (no markdown):
{
  "colorPalette": "Describe the dominant colors, color grading/temperature, contrast level (e.g., 'warm golden tones with deep shadows, high contrast, amber-to-teal color grading')",
  "cameraWork": "Describe camera movements, angles, shot types (e.g., 'slow dolly-in, eye-level medium shots, occasional aerial establishing shots')",
  "mood": "One or two words for the overall mood (e.g., 'cinematic dramatic', 'upbeat energetic', 'serene contemplative')",
  "editingStyle": "Describe the editing style, transitions, visual effects (e.g., 'smooth crossfades, split-screen, text overlays with motion graphics')",
  "styleDescription": "A comprehensive 2-3 sentence description of the overall visual style, combining all elements above into a cohesive style description",
  "stylePrompt": "A concise Veo-ready video generation prompt (max 200 words) that would recreate this visual style. Focus on visual elements only: lighting, color grading, camera movement, composition, mood. Format as a direct instruction for an AI video generator. Do NOT include any brand names, specific people, or copyrighted content."
}`;

  const result = await genAI.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          ...frameContents,
          { text: prompt },
        ],
      },
    ],
  });

  const responseText = result.text || "";

  try {
    const cleaned = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      styleDescription: parsed.styleDescription || "Modern professional video style",
      stylePrompt: parsed.stylePrompt || "Professional cinematic video with smooth camera movements and warm lighting",
      colorPalette: parsed.colorPalette || "Neutral tones",
      cameraWork: parsed.cameraWork || "Standard tripod shots",
      mood: parsed.mood || "professional",
      editingStyle: parsed.editingStyle || "Standard cuts",
    };
  } catch (parseError) {
    console.warn("⚠️ Failed to parse Gemini response, using fallback extraction");

    return {
      styleDescription: responseText.slice(0, 500),
      stylePrompt: "Professional cinematic video with smooth camera movements, warm color grading, and clean compositions",
      colorPalette: "Neutral professional tones",
      cameraWork: "Standard professional shots",
      mood: "professional",
      editingStyle: "Clean cuts",
    };
  }
}

export async function analyzeVideoStyle(
  videoPathOrUrl: string,
  isUrl: boolean = true
): Promise<VideoAnalysisResult> {
  const workDir = `/tmp/video-analysis/${Date.now()}`;
  await fs.mkdir(workDir, { recursive: true });

  // ── Platform routing ────────────────────────────────────────────────────────
  // Social-platform URLs (YouTube, Vimeo, TikTok, Instagram…) cannot be
  // downloaded directly. For these we use the platform's publicly available
  // thumbnail images as visual proxies for style analysis. For direct .mp4
  // links or local file paths, we use the original FFmpeg-based pipeline.

  if (isUrl) {
    const youtubeId = extractYouTubeId(videoPathOrUrl);
    if (youtubeId) {
      console.log(`▶ YouTube video detected (id=${youtubeId}). Fetching thumbnail frames...`);
      const { framePaths, estimatedDuration } = await getYouTubeThumbnailFrames(youtubeId, workDir);

      const sceneCount = Math.max(framePaths.length, 1);
      const pacing = classifyPacing(estimatedDuration, sceneCount);
      const avgShotDuration = estimatedDuration / sceneCount;

      const styleAnalysis = await analyzeStyleWithGemini(framePaths, {
        duration: estimatedDuration,
        fps: 30,
        sceneCount,
        pacing,
        hasAudio: true,
      });

      const result: VideoAnalysisResult = {
        duration: estimatedDuration,
        resolution: { width: 1920, height: 1080 },
        fps: 30,
        hasAudio: true,
        audioInfo: { codec: "aac", sampleRate: 44100, channels: 2 },
        sceneCount,
        avgShotDuration: Math.round(avgShotDuration * 10) / 10,
        pacing,
        framesPaths: framePaths,
        ...styleAnalysis,
      };

      console.log(`✅ YouTube style analysis complete — style: ${result.mood}, pacing: ${result.pacing}`);
      return result;
    }

    const vimeoId = extractVimeoId(videoPathOrUrl);
    if (vimeoId) {
      console.log(`▶ Vimeo video detected (id=${vimeoId}). Fetching thumbnail frames...`);
      const { framePaths, estimatedDuration } = await getVimeoThumbnailFrames(vimeoId, workDir);

      const sceneCount = Math.max(framePaths.length, 1);
      const pacing = classifyPacing(estimatedDuration, sceneCount);
      const avgShotDuration = estimatedDuration / sceneCount;

      const styleAnalysis = await analyzeStyleWithGemini(framePaths, {
        duration: estimatedDuration,
        fps: 30,
        sceneCount,
        pacing,
        hasAudio: true,
      });

      const result: VideoAnalysisResult = {
        duration: estimatedDuration,
        resolution: { width: 1920, height: 1080 },
        fps: 30,
        hasAudio: true,
        audioInfo: { codec: "aac", sampleRate: 44100, channels: 2 },
        sceneCount,
        avgShotDuration: Math.round(avgShotDuration * 10) / 10,
        pacing,
        framesPaths: framePaths,
        ...styleAnalysis,
      };

      console.log(`✅ Vimeo style analysis complete — style: ${result.mood}, pacing: ${result.pacing}`);
      return result;
    }

    // For TikTok / Instagram / other social platforms that don't have a
    // clean thumbnail API, give the user a helpful error rather than silently
    // failing with an HTML-as-video download.
    if (!isDirectVideoUrl(videoPathOrUrl)) {
      const host = (() => { try { return new URL(videoPathOrUrl).hostname; } catch { return videoPathOrUrl; } })();
      throw new Error(
        `"${host}" videos cannot be downloaded directly for analysis. ` +
        `Supported platforms: YouTube (youtube.com, youtu.be), Vimeo (vimeo.com), or a direct .mp4 video link. ` +
        `Tip: Try right-clicking the video on the website and copying the direct video URL if available.`
      );
    }
  }

  // ── Original FFmpeg pipeline for direct video files / local paths ──────────
  let videoPath: string;
  if (isUrl) {
    videoPath = await downloadVideo(videoPathOrUrl, workDir);
  } else {
    videoPath = videoPathOrUrl;
    const exists = await fs.access(videoPath).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error(`Video file not found: ${videoPath}`);
    }
  }

  console.log(`🔍 Analyzing video style: ${videoPath}`);

  const metadata = await getVideoMetadata(videoPath);
  console.log(`📊 Video: ${metadata.width}x${metadata.height}, ${metadata.duration.toFixed(1)}s, ${metadata.fps}fps`);

  const [framePaths, sceneCount] = await Promise.all([
    extractKeyFrames(videoPath, workDir, 8),
    detectSceneChanges(videoPath),
  ]);

  const pacing = classifyPacing(metadata.duration, sceneCount);
  const avgShotDuration = metadata.duration / Math.max(sceneCount, 1);

  const styleAnalysis = await analyzeStyleWithGemini(framePaths, {
    duration: metadata.duration,
    fps: metadata.fps,
    sceneCount,
    pacing,
    hasAudio: metadata.hasAudio,
  });

  const result: VideoAnalysisResult = {
    duration: metadata.duration,
    resolution: { width: metadata.width, height: metadata.height },
    fps: metadata.fps,
    hasAudio: metadata.hasAudio,
    audioInfo: metadata.hasAudio
      ? {
          codec: metadata.audioCodec,
          sampleRate: metadata.audioSampleRate,
          channels: metadata.audioChannels,
        }
      : null,
    sceneCount,
    avgShotDuration: Math.round(avgShotDuration * 10) / 10,
    pacing,
    framesPaths: framePaths,
    ...styleAnalysis,
  };

  console.log(`✅ Video analysis complete:`);
  console.log(`   Style: ${result.mood}`);
  console.log(`   Pacing: ${result.pacing} (${result.avgShotDuration}s avg shot)`);
  console.log(`   Color: ${result.colorPalette.slice(0, 60)}...`);

  return result;
}

export async function cleanupAnalysis(workDir: string): Promise<void> {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up analysis temp files`);
  } catch {
    console.warn("⚠️ Could not clean up analysis temp files");
  }
}

export function buildVeoPromptFromAnalysis(
  analysis: VideoAnalysisResult,
  userTopic: string,
  companyName: string,
  callToAction: string
): string {
  return `Create a 60-second ${analysis.mood} video about "${userTopic}" for ${companyName}.

VISUAL STYLE (replicate this exactly):
${analysis.stylePrompt}

COLOR GRADING: ${analysis.colorPalette}
CAMERA: ${analysis.cameraWork}
EDITING: ${analysis.editingStyle}
PACING: ${analysis.pacing} pace with approximately ${analysis.avgShotDuration}s average shot duration

The video should end with a clear call-to-action: "${callToAction}"

Maintain the exact same visual style, color grading, and editing rhythm throughout.`;
}
