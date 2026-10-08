import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ffmpegPath from "ffmpeg-static";
import { mergeMp3Buffers } from "../lib/merge-mp3-segments";

const exec = promisify(execFile);
test("multiple MP3 containers merge into a fully decodable duration-correct file", async () => {
  const root = await mkdtemp(join(tmpdir(), "merge-mp3-test-"));
  try {
    const first = join(root, "first.mp3");
    await exec(ffmpegPath!, ["-v", "error", "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=44100", "-t", "1", "-c:a", "libmp3lame",
      "-metadata", "title=Standalone TTS segment", first]);
    const bytes = await readFile(first);
    const combined = await mergeMp3Buffers([bytes, bytes]);
    const output = join(root, "combined.mp3");
    await writeFile(output, combined);
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries",
      "format=duration", "-of", "json", output]);
    const duration = Number(JSON.parse(stdout).format.duration);
    assert.ok(duration >= 2 && duration <= 2.2);
    const { stderr } = await exec(ffmpegPath!, ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
    assert.equal(stderr, "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("single MP3 remains byte-identical; invalid input is rejected before FFmpeg", async () => {
  const bytes = Buffer.from("single segment");
  assert.equal(await mergeMp3Buffers([bytes]), bytes);
  await assert.rejects(mergeMp3Buffers([]), /1-40/);
  await assert.rejects(mergeMp3Buffers([Buffer.alloc(0)]), /nonempty/);
  await assert.rejects(mergeMp3Buffers(Array(41).fill(bytes)), /1-40/);
});
