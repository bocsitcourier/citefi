import { spawn } from "child_process";
import { objectStorageClient } from "./storage";
import type { VideoScene } from "./gemini-video-script-generator";
import type { VideoImageResult } from "./social-video-image-generator";
import type { TTSResult } from "./social-video-tts-generator";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "@ffprobe-installer/ffprobe";

// Safe FFmpeg execution using bundled static binary
async function execFFmpeg(args: string[], passLabel?: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("FFmpeg binary not found. Please ensure ffmpeg-static is installed.");
  }

  const binaryPath: string = ffmpegPath;
  const label = passLabel || 'FFmpeg';

  return new Promise((resolve, reject) => {
    const fullArgs = ['-hide_banner', ...args];
    console.log(`  🎬 Executing FFmpeg [${label}]: ${binaryPath} ${fullArgs.slice(0, 6).join(' ')}...`);
    const ffmpeg = spawn(binaryPath, fullArgs);
    
    // Keep last 3000 chars of stderr to diagnose errors without OOM from buffering
    let stderrBuf = '';
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      stderrBuf = (stderrBuf + data.toString()).slice(-3000);
    });
    
    ffmpeg.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      // Classify failure reason for actionable error messages
      let reason: string;
      if (signal === 'SIGKILL' || code === 137 || code === 9) {
        reason = `OOM_KILLED [${label}]: The server ran out of RAM and killed FFmpeg (code=${code}, signal=${signal}).`;
        console.error(`💀 ${reason}`);
      } else if (stderrBuf.includes('No space left on device') || stderrBuf.includes('ENOSPC')) {
        reason = `DISK_FULL [${label}]: /tmp ran out of space while FFmpeg was writing (code=${code}).`;
        console.error(`💾 ${reason}`);
      } else {
        // Surface the real error past FFmpeg's version header
        const errorIdx = stderrBuf.search(/\b(Error|No such file|Invalid|Conversion failed|Unable|Cannot|failed|moov atom)/i);
        const snippet = errorIdx !== -1 ? stderrBuf.slice(errorIdx, errorIdx + 1500) : stderrBuf.slice(-1500);
        reason = `FFmpeg [${label}] failed with code=${code} signal=${signal}: ${snippet}`;
        console.error(`❌ FFmpeg [${label}] failed — code=${code} signal=${signal}`);
        console.error(`❌ Stderr: ${snippet}`);
      }

      reject(new Error(reason));
    });
    
    ffmpeg.on('error', (err: Error) => {
      console.error(`❌ FFmpeg process error [${label}]:`, err);
      reject(new Error(`FFmpeg process error [${label}]: ${err.message}`));
    });
  });
}

// Get FFmpeg binary path for health checks
export function getFFmpegPath(): string | null {
  return ffmpegPath;
}

// Get actual duration of a media file using ffprobe
async function getMediaDuration(filePath: string): Promise<number> {
  if (!ffprobePath?.path) {
    console.warn('⚠️ ffprobe not available, using estimated duration');
    return 0;
  }

  return new Promise((resolve, reject) => {
    const ffprobe = spawn(ffprobePath.path, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    let stdout = '';
    ffprobe.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    ffprobe.on('close', (code: number | null) => {
      if (code === 0) {
        const duration = parseFloat(stdout.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        resolve(0);
      }
    });

    ffprobe.on('error', () => resolve(0));
  });
}

// Intelligent audio/video sync handling with drift correction
// Uses FFmpeg tpad (freeze last frame) or apad (silence padding) to handle mismatches
async function syncAudioVideoDurations(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  targetDuration: number
): Promise<{ outputPath: string; finalDuration: number }> {
  const audioDuration = await getMediaDuration(audioPath);
  const videoDuration = await getMediaDuration(videoPath);

  console.log(`  📊 Duration analysis:`);
  console.log(`     Target: ${targetDuration}s, Video: ${videoDuration.toFixed(2)}s, Audio: ${audioDuration.toFixed(2)}s`);

  const durationDiff = Math.abs(audioDuration - videoDuration);
  
  if (durationDiff < 0.5) {
    // Durations are close enough - no special handling needed
    console.log(`  ✅ Durations aligned (within 0.5s tolerance)`);
    await execFFmpeg([
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-shortest',
      outputPath
    ]);
    return { outputPath, finalDuration: Math.min(videoDuration, audioDuration) };
  }

  if (audioDuration > videoDuration) {
    // Audio is longer than video - extend video by freezing last frame
    const extendBy = audioDuration - videoDuration;
    console.log(`  ⚠️ Audio overflow by ${extendBy.toFixed(2)}s - extending video with freeze frame`);
    
    await execFFmpeg([
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${extendBy.toFixed(3)}[v_extended]`,
      '-map', '[v_extended]',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'aac',
      outputPath
    ]);
    return { outputPath, finalDuration: audioDuration };
  } else {
    // Video is longer than audio - pad audio with silence
    const padBy = videoDuration - audioDuration;
    console.log(`  ⚠️ Video overflow by ${padBy.toFixed(2)}s - padding audio with silence`);
    
    await execFFmpeg([
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-filter_complex', `[1:a]apad=pad_dur=${padBy.toFixed(3)}[a_padded]`,
      '-map', '0:v:0',
      '-map', '[a_padded]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outputPath
    ]);
    return { outputPath, finalDuration: videoDuration };
  }
}

// ─── CAPTION SANITIZER ──────────────────────────────────────────────────────
// Runs before writing caption text to .txt files — catches AI artifacts that
// make overlays look unprofessional without breaking the textfile= pipeline.
const BRAND_CORRECTIONS: Record<string, string> = {
  "Replit": "Replit",
  "Postgresql": "PostgreSQL",
  "Neondb": "Neon",
  "Openai": "OpenAI",
  "Chatgpt": "ChatGPT",
  "Llm": "LLM",
  "Api": "API",
  "Saas": "SaaS",
  "Ai": "AI",
};

export function sanitizeCaptionText(text: string): string {
  let s = text.trim();

  // Remove AI "thinking" prefix patterns (e.g. "Scene 3:", "Caption:", "Narration:")
  s = s.replace(/^(scene\s*\d+\s*:|caption\s*:|narration\s*:|text\s*:)\s*/i, '');

  // Strip surrounding quotes (single, double, curly)
  s = s.replace(/^["'""\u201C\u201D]+|["'""\u201C\u201D]+$/g, '');

  // Fix known brand name casings
  Object.entries(BRAND_CORRECTIONS).forEach(([wrong, right]) => {
    const re = new RegExp(`\\b${wrong}\\b`, 'gi');
    s = s.replace(re, right);
  });

  // Collapse multiple spaces/newlines into single space
  s = s.replace(/\s+/g, ' ').trim();

  // Enforce max length — very long captions overflow the frame
  if (s.length > 120) {
    s = s.slice(0, 117) + '...';
  }

  return s;
}

export interface VideoCompositorRequest {
  socialPostId: number;
  images: VideoImageResult[]; // 4 images (one per scene)
  audio: TTSResult; // Voiceover audio
  scenes: VideoScene[]; // Script with captions
  companyLogoPath?: string; // Optional logo overlay
  companyName: string;
  platform: string; // Determines output format
  landingPageUrl?: string; // URL to display on Scene 5
}

export interface VideoCompositorResult {
  videoUrl: string; // Permanent storage URL
  localPath: string; // Temporary local path
  duration: number; // Actual video duration in seconds
  fileSize: number; // File size in bytes
  resolution: string; // e.g., "1080x1920"
}

const PLATFORM_RESOLUTIONS: Record<string, { width: number; height: number }> = {
  instagram: { width: 1920, height: 1080 }, // 16:9 horizontal
  facebook: { width: 1920, height: 1080 }, // 16:9 horizontal
  linkedin: { width: 1920, height: 1080 }, // 16:9 horizontal
  x: { width: 1920, height: 1080 }, // 16:9 horizontal
  twitter: { width: 1920, height: 1080 }, // 16:9 horizontal
  pinterest: { width: 1920, height: 1080 }, // 16:9 horizontal
  default: { width: 1920, height: 1080 }, // Landscape 16:9
};

export async function composeVideo(
  request: VideoCompositorRequest
): Promise<VideoCompositorResult> {
  const { socialPostId, images, audio, scenes, companyLogoPath, companyName, platform, landingPageUrl } = request;

  console.log(`🎬 Composing 60-second video with FFmpeg`);

  const resolution = (PLATFORM_RESOLUTIONS[platform] ?? PLATFORM_RESOLUTIONS['default'])!;
  const { width, height } = resolution;

  const fs = await import("fs/promises");
  const path = await import("path");
  const tempDir = `/tmp/video-${socialPostId}`;

  try {
    // Preflight: check /tmp free space — need at least 500MB for a 60s 1080p encode
    try {
      const { execSync } = await import("child_process");
      const dfOut = execSync(`df -m /tmp 2>/dev/null | tail -1`).toString().trim();
      const available = parseInt(dfOut.split(/\s+/)[3] ?? '0', 10);
      console.log(`  💾 /tmp free space: ${available}MB`);
      if (available < 500) {
        throw new Error(`DISK_FULL: /tmp has only ${available}MB free — need ≥500MB for video composition`);
      }
    } catch (dfErr: unknown) {
      if (dfErr instanceof Error && dfErr.message.startsWith('DISK_FULL')) throw dfErr;
      console.warn(`  ⚠️ Could not check disk space: ${dfErr}`);
    }

    // Prepare temp directory
    await fs.mkdir(tempDir, { recursive: true });

    // Sort images by scene number
    const sortedImages = [...images].sort((a, b) => a.sceneNumber - b.sceneNumber);

    // CRITICAL: Validate and fix image dimensions before FFmpeg processing
    console.log(`  🔍 Validating image dimensions...`);
    const sharp = (await import("sharp")).default;
    for (const img of sortedImages) {
      const metadata = await sharp(img.localPath).metadata();
      console.log(`    Scene ${img.sceneNumber}: ${metadata.width}x${metadata.height} (expected: ${width}x${height})`);
      
      if (metadata.width !== width || metadata.height !== height) {
        console.warn(`    ⚠️ Scene ${img.sceneNumber}: DIMENSION MISMATCH! Emergency resize required.`);
        // Emergency resize to exact target dimensions
        const fixedPath = img.localPath.replace('.jpg', '-fixed.jpg');
        await sharp(img.localPath)
          .resize(width, height, {
            fit: "cover",
            position: "centre"
          })
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
          .toFile(fixedPath);
        
        // Update the path to use fixed image
        img.localPath = fixedPath;
        console.log(`    ✅ Scene ${img.sceneNumber}: Emergency resize complete → ${width}x${height}`);
      }
    }
    console.log(`  ✅ All images validated and dimensionally correct`);

    // Get durations from scene metadata
    const totalScenes = scenes.length;
    const sceneDurations = scenes.map(scene => scene.targetDuration || 12); // Fallback to 12s
    
    // Validate scene count
    if (totalScenes !== 5 || sortedImages.length !== 5) {
      console.warn(`⚠️ Expected 5 scenes, got ${totalScenes} scenes and ${sortedImages.length} images.`);
    }

    // ── MASTER DURATION: probe the actual audio file, then lock video to it ──
    // TTS estimated durations are unreliable (±20%). Probing the file is the
    // only way to guarantee voice and video end at exactly the same moment.
    const actualAudioDuration = await getMediaDuration(audio.localPath);
    const targetTotalDuration = actualAudioDuration > 5 ? actualAudioDuration : 60;
    console.log(`  🎙️ Audio duration: ${targetTotalDuration.toFixed(2)}s (TTS estimate was: ${audio.duration}s)`);

    // Normalize scene durations to match ACTUAL audio duration (not hardcoded 60s)
    const totalDuration = sceneDurations.reduce((sum, d) => sum + d, 0);
    let normalizedDurations: number[];
    
    if (totalDuration > 0) {
      const preciseValues = sceneDurations.map(d => (d / totalDuration) * targetTotalDuration);
      normalizedDurations = preciseValues.map(v => Math.round(v));
      const currentTotal = normalizedDurations.reduce((a, b) => a + b, 0);
      const delta = Math.round(targetTotalDuration) - currentTotal;
      if (delta !== 0) {
        normalizedDurations[normalizedDurations.length - 1]! += delta;
      }
    } else {
      normalizedDurations = [10, 12, 12, 12, Math.round(targetTotalDuration) - 46]; // Fallback
    }
    
    console.log(`  ⏱️ Scene durations: ${normalizedDurations.join('s, ')}s (total: ${normalizedDurations.reduce((a,b)=>a+b,0)}s = audio)`);

    // Create a concat file for FFmpeg with dynamic timing per scene
    // IMPORTANT: Last image must be specified twice - once with duration, once without
    // This ensures the final scene plays completely instead of cutting off
    const concatFilePath = path.join(tempDir, "concat.txt");
    const concatLines: string[] = [];
    
    sortedImages.forEach((img, idx) => {
      const duration = normalizedDurations[idx] || 12;
      concatLines.push(`file '${img.localPath}'`);
      concatLines.push(`duration ${duration}`);
    });
    
    // Add final image again without duration to ensure it displays fully
    const lastImage = sortedImages[sortedImages.length - 1]!;
    concatLines.push(`file '${lastImage.localPath}'`);
    
    const concatContent = concatLines.join("\n");
    await fs.writeFile(concatFilePath, concatContent);

    // Output video path
    const outputVideoPath = path.join(tempDir, `output-${socialPostId}.mp4`);

    // Scale+crop geometry filter — images are pre-validated to exact dimensions,
    // so this corrects only minor rounding artifacts. No cropdetect probe needed.
    const aspectRatio = width / height; // 1.777... for 16:9
    const scaleFilter = `scale='if(gt(a,${aspectRatio}),-2,${width})':'if(gt(a,${aspectRatio}),${height},-2)'`;
    const geoCropFilter = `crop=${width}:${height}`;
    
    console.log(`  📐 Scale+crop: ${scaleFilter},${geoCropFilter}`);
    
    // ─── FONT RESOLUTION ───────────────────────────────────────────────────────
    const BUNDLED_FONT = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf');
    const SYSTEM_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    let fontPath = BUNDLED_FONT;
    try {
      await fs.stat(BUNDLED_FONT);
      console.log(`  🔤 Using bundled font`);
    } catch {
      console.warn(`  ⚠️ Bundled font missing, falling back to system font`);
      fontPath = SYSTEM_FONT;
    }

    // ─── CAPTION TEXT FILES ─────────────────────────────────────────────────────
    // Write each scene caption to a .txt file — bypasses ALL FFmpeg filter-graph
    // escaping issues (apostrophes, colons, commas, %, emoji, AI artifacts).
    let currentTime = 0;
    const sceneTimings = scenes.map((_, idx) => {
      const duration = normalizedDurations[idx] || 12;
      const startTime = currentTime;
      const endTime = currentTime + duration;
      currentTime = endTime;
      return { startTime, endTime };
    });

    await Promise.all(scenes.map(async (scene, idx) => {
      const captionFile = path.join(tempDir, `caption-${idx}.txt`);
      const sanitized = sanitizeCaptionText(scene.caption);
      if (sanitized !== scene.caption.trim()) {
        console.log(`  ✏️ Caption ${idx + 1} sanitized: "${scene.caption.trim().slice(0, 40)}" → "${sanitized.slice(0, 40)}"`);
      }
      await fs.writeFile(captionFile, sanitized, 'utf8');
    }));

    // Non-overlapping time windows (gte*lt avoids double-caption at scene boundaries)
    const captionFilters = scenes.map((_, idx) => {
      const { startTime, endTime } = sceneTimings[idx]!;
      const captionFile = path.join(tempDir, `caption-${idx}.txt`);
      const fontSize = idx === 4 ? 72 : 64;
      return `drawtext=textfile='${captionFile}':fontfile='${fontPath}':expansion=none:fontsize=${fontSize}:fontcolor=white:borderw=3:bordercolor=black:box=1:boxcolor=black@0.85:boxborderw=25:x=(w-text_w)/2:y=(h-text_h)*0.86:enable='gte(t\\,${startTime})*lt(t\\,${endTime})'`;
    });

    // URL overlay for Scene 5
    let urlDrawtext = '';
    if (landingPageUrl) {
      const scene5Start = normalizedDurations.slice(0, 4).reduce((sum, d) => sum + d, 0);
      const scene5End = scene5Start + normalizedDurations[4]!;
      let displayUrl = landingPageUrl;
      try {
        const urlObj = new URL(landingPageUrl.startsWith('http') ? landingPageUrl : `https://${landingPageUrl}`);
        displayUrl = urlObj.hostname;
      } catch {
        displayUrl = landingPageUrl.replace(/^https?:\/\//, '').split('/')[0]!;
      }
      const urlFile = path.join(tempDir, 'url-overlay.txt');
      await fs.writeFile(urlFile, displayUrl, 'utf8');
      console.log(`  🔗 URL overlay Scene 5 (${scene5Start}s-${scene5End}s): ${displayUrl}`);
      urlDrawtext = `,drawtext=textfile='${urlFile}':fontfile='${fontPath}':expansion=none:fontsize=56:fontcolor=white:borderw=2:bordercolor=black:box=1:boxcolor=black@0.85:boxborderw=18:x=(w-text_w)/2:y=(h-text_h)*0.94:enable='gte(t\\,${scene5Start})*lt(t\\,${scene5End})'`;
    }

    const allCaptionDrawtext = captionFilters.join(',') + urlDrawtext;

    // ─── SINGLE-PASS FFMPEG ─────────────────────────────────────────────────────
    // Combines: concat images → scale/crop/fps → [logo] → captions → audio mux
    // Eliminates 3 separate encode passes + cropdetect probe + 2 intermediate files.
    console.log(`  🎬 Single-pass: concat→scale/crop→captions+audio${companyLogoPath ? '+logo' : ''}`);

    const commonEncodeArgs = [
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-threads', '2',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      '-metadata', `title=${companyName} - Social Video`,
      '-metadata', 'description=Generated by ApexContent Engine',
    ];

    if (companyLogoPath) {
      console.log(`  🏷️ Logo overlay: ${companyLogoPath}`);
      // [0]=concat video  [1]=audio  [2]=logo
      // scale=200:-1 → 200px wide, auto height, preserves aspect ratio
      // format=auto on overlay handles PNG alpha transparency correctly
      // Placed top-right (W-w-20:20) so it's above caption text (bottom 14%)
      const filterComplex = [
        `[0:v]${scaleFilter},${geoCropFilter},fps=30[base]`,
        `[2:v]scale=200:-1[logo]`,
        `[base][logo]overlay=W-w-20:20:format=auto[withlogo]`,
        `[withlogo]${allCaptionDrawtext}[final]`,
      ].join(';');

      await execFFmpeg([
        '-y',
        '-f', 'concat', '-safe', '0', '-i', concatFilePath,
        '-i', audio.localPath,
        '-i', companyLogoPath,
        '-filter_complex', filterComplex,
        '-map', '[final]',
        '-map', '1:a:0',
        ...commonEncodeArgs,
        outputVideoPath,
      ], 'single-pass-logo');
      console.log(`  ✅ Video + audio + logo + captions composed`);
    } else {
      // [0]=concat video  [1]=audio
      const filterComplex = [
        `[0:v]${scaleFilter},${geoCropFilter},fps=30[base]`,
        `[base]${allCaptionDrawtext}[final]`,
      ].join(';');

      await execFFmpeg([
        '-y',
        '-f', 'concat', '-safe', '0', '-i', concatFilePath,
        '-i', audio.localPath,
        '-filter_complex', filterComplex,
        '-map', '[final]',
        '-map', '1:a:0',
        ...commonEncodeArgs,
        outputVideoPath,
      ], 'single-pass');
      console.log(`  ✅ Video + audio + captions composed`);
    }

    const optimizedPath = outputVideoPath;

    // Get file stats
    const stats = await fs.stat(optimizedPath);
    const fileSize = stats.size;

    // Get actual duration using ffprobe (bundled static binary)
    const duration = await new Promise<number>((resolve, reject) => {
      if (!ffprobePath.path) {
        reject(new Error("ffprobe binary not found. Please ensure @ffprobe-installer/ffprobe is installed."));
        return;
      }

      const probeBinaryPath: string = ffprobePath.path;
      console.log(`  🔍 Running ffprobe to get video duration...`);
      const ffprobe = spawn(probeBinaryPath, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        optimizedPath
      ]);

      let stdout = '';
      let stderr = '';
      
      ffprobe.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ffprobe.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffprobe.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(Math.ceil(parseFloat(stdout.trim())));
        } else {
          console.error(`❌ ffprobe failed with code ${code}`);
          console.error(`❌ ffprobe stderr: ${stderr}`);
          reject(new Error(`ffprobe failed with code ${code}: ${stderr}`));
        }
      });

      ffprobe.on('error', (err: Error) => {
        console.error(`❌ ffprobe process error:`, err);
        reject(new Error(`ffprobe process error: ${err.message}`));
      });
    });

    console.log(`  ✅ Final video: ${width}x${height}, ${duration}s, ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

    // Upload to Replit Object Storage
    console.log(`  ☁️ Uploading to permanent storage...`);
    const videoBuffer = await fs.readFile(optimizedPath);

    const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    const timestamp = Date.now();
    const fileName = `social-video-${socialPostId}-${timestamp}.mp4`;
    const objectPath = `public/social-videos/${fileName}`;

    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectPath);

    await file.save(videoBuffer, {
      contentType: "video/mp4",
      metadata: {
        cacheControl: "public, max-age=31536000",
        companyName,
        platform,
        duration: duration.toString(),
      },
    });

    const videoUrl = `/api/public-objects/social-videos/${fileName}`;

    console.log(`✅ Video uploaded to permanent storage`);

    return {
      videoUrl,
      localPath: optimizedPath,
      duration,
      fileSize,
      resolution: `${width}x${height}`,
    };
  } catch (error) {
    console.error("❌ Video composition failed:", error);
    throw new Error(`FFmpeg composition failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // PLATINUM RULE: Always clean up /tmp workspace — even on failure.
    // Leaving raw video files in /tmp will exhaust disk space and crash future generations.
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up temp workspace: ${tempDir}`);
    } catch (cleanupErr) {
      console.warn(`⚠️ Could not clean up ${tempDir}:`, cleanupErr);
    }
  }
}

// Cleanup function to remove temporary files after video generation
export async function cleanupTempFiles(socialPostId: number): Promise<void> {
  try {
    const fs = await import("fs/promises");
    const tempDir = `/tmp/video-${socialPostId}`;
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up temp files for video ${socialPostId}`);
  } catch (error) {
    console.warn("⚠️ Cleanup warning:", error);
  }
}
