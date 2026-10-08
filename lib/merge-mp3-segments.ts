import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const exec = promisify(execFile);

/** Join independent MP3 containers without leaving mid-stream ID3 headers. */
export async function mergeMp3Buffers(parts: Buffer[]): Promise<Buffer> {
  if (!parts.length || parts.length > 40 ||
      parts.some(part => !Buffer.isBuffer(part) || !part.length)) {
    throw new Error("MP3 merge requires 1-40 nonempty buffers");
  }
  if (parts.reduce((sum, part) => sum + part.length, 0) > 128 * 1024 * 1024) {
    throw new Error("MP3 merge exceeded its input byte limit");
  }
  if (parts.length === 1) return parts[0]!;
  if (!ffmpegPath) throw new Error("MP3 merge requires FFmpeg");
  const directory = await mkdtemp(join(tmpdir(), "podcast-mp3-merge-"));
  try {
    for (const [i, part] of parts.entries()) {
      await writeFile(join(directory, `part-${i}.mp3`), part, { mode: 0o600, flag: "wx" });
    }
    await writeFile(join(directory, "parts.txt"),
      parts.map((_, i) => `file 'part-${i}.mp3'`).join("\n"),
      { mode: 0o600, flag: "wx" });
    const output = join(directory, "merged.mp3");
    await exec(ffmpegPath, ["-v", "error", "-xerror", "-protocol_whitelist", "file,pipe",
      "-f", "concat", "-safe", "1", "-i", join(directory, "parts.txt"),
      "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "128k", output],
    { timeout: 120000, maxBuffer: 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
