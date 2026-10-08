import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import ffmpeg from "ffmpeg-static";
import { attachVideoNarration } from "../lib/attach-video-narration";

const exec = promisify(execFile);
test("long narration retains its ending marker instead of being cut by shortest-stream muxing", async () => {
  const root = await mkdtemp(join(tmpdir(), "narration-fit-test-"));
  try {
    const video = join(root, "video.mp4");
    const audio = join(root, "audio.mp3");
    const output = join(root, "output.mp4");
    await exec(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i",
      "color=c=blue:size=80x80:rate=24", "-t", "2", "-c:v", "libx264", video]);
    await exec(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=2.5",
      "-f", "lavfi", "-i", "sine=frequency=2000:duration=0.3",
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]",
      "-map", "[out]", "-c:a", "libmp3lame", audio]);
    await attachVideoNarration(ffmpeg!, video, audio, output);
    const { stderr } = await exec(ffmpeg!, ["-v", "info", "-xerror", "-ss", "1.83",
      "-i", output, "-t", "0.12", "-vn", "-af", "bandpass=f=2000:w=200,volumedetect",
      "-f", "null", "-"]);
    const volume = Number(/mean_volume: ([-\d.]+) dB/.exec(stderr)?.[1]);
    assert.ok(Number.isFinite(volume) && volume > -35, "final narration marker must remain audible");
    await exec(ffmpeg!, ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", output]);
    const seconds = Number(JSON.parse(stdout).format.duration);
    assert.ok(seconds >= 1.95 && seconds <= 2.1);
    await assert.rejects(attachVideoNarration(ffmpeg!, video, audio.replace("audio", "missing"), output));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("short narration does not remove later video scenes; excessive acceleration fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "narration-short-test-"));
  try {
    const video = join(root, "video.mp4");
    const audio = join(root, "audio.mp3");
    const long = join(root, "long.mp3");
    const output = join(root, "output.mp4");
    await exec(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i",
      "color=c=blue:size=80x80:rate=24", "-t", "2", "-c:v", "libx264", video]);
    for (const [file, seconds] of [[audio, "0.5"], [long, "4"]]) {
      await exec(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i",
        `sine=frequency=440:duration=${seconds}`, "-c:a", "libmp3lame", file!]);
    }
    await attachVideoNarration(ffmpeg!, video, audio, output);
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", output]);
    assert.ok(Number(JSON.parse(stdout).format.duration) >= 1.95);
    await assert.rejects(attachVideoNarration(ffmpeg!, video, long, output), /excessive speech/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
