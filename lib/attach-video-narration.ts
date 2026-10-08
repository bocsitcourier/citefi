import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function duration(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe",
    "-show_entries", "format=duration", "-of", "json", file],
  { timeout: 30000, maxBuffer: 1024 * 1024 });
  const value = Number(JSON.parse(stdout).format?.duration);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid media duration");
  return value;
}

/** Preserve all visual frames and the complete narration, never shortest-stream trim. */
export async function attachVideoNarration(
  ffmpeg: string, video: string, audio: string, output: string,
): Promise<void> {
  const [videoDuration, audioDuration] = await Promise.all([duration(video), duration(audio)]);
  const tempo = Math.max(1, audioDuration / videoDuration);
  if (tempo > 1.5) throw new Error("Narration cannot fit video without excessive speech acceleration");
  await exec(ffmpeg, ["-y", "-v", "error", "-xerror",
    "-protocol_whitelist", "file,pipe", "-i", video,
    "-protocol_whitelist", "file,pipe", "-i", audio,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
    "-af", `atempo=${tempo.toFixed(8)},apad`, "-t", String(videoDuration),
    "-movflags", "+faststart", output],
  { timeout: 180000, maxBuffer: 1024 * 1024 });
}
