import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffprobePath from "@ffprobe-installer/ffprobe";

const SCRIPT_WORDS_PER_MINUTE = 150;
const SCRIPT_WORD_BUDGET_SAFETY_FACTOR = 0.75;

export interface PodcastDurationRange {
  label: string;
  minSeconds: number;
  maxSeconds: number;
  maxWords: number;
}

export interface PodcastScriptForDuration {
  segments: Array<{ text: string }>;
}

const SUPPORTED_RANGES: ReadonlyArray<Omit<PodcastDurationRange, "maxWords">> = [
  { label: "1-2 minutes", minSeconds: 60, maxSeconds: 120 },
  { label: "3-4 minutes", minSeconds: 180, maxSeconds: 240 },
  { label: "5-7 minutes", minSeconds: 300, maxSeconds: 420 },
];

function withWordBudget(
  range: Omit<PodcastDurationRange, "maxWords">,
): PodcastDurationRange {
  return {
    ...range,
    maxWords: Math.max(
      1,
      Math.floor(
        (range.maxSeconds / 60) *
          SCRIPT_WORDS_PER_MINUTE *
          SCRIPT_WORD_BUDGET_SAFETY_FACTOR,
      ),
    ),
  };
}

function normalizeDurationInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Parse the duration choices accepted by the podcast API and worker.
 *
 * The numeric aliases are retained for older queued jobs (`"120"` means the
 * 1-2 minute choice). Other arbitrary values are rejected so a prompt typo
 * cannot silently bypass the duration contract.
 */
export function parsePodcastDuration(
  value: string | number | null | undefined,
): PodcastDurationRange | null {
  if (value == null || String(value).trim() === "") {
    return null;
  }

  const normalized = normalizeDurationInput(String(value));
  const numericAliases: Record<string, string> = {
    "120": "1-2 minutes",
    "240": "3-4 minutes",
    "420": "5-7 minutes",
  };
  const canonicalAlias = numericAliases[normalized];
  if (canonicalAlias) {
    const range = SUPPORTED_RANGES.find((candidate) => candidate.label === canonicalAlias);
    return range ? withWordBudget(range) : null;
  }

  const match = normalized.match(
    /^(\d+)\s*-\s*(\d+)\s*(minutes?|mins?|m|seconds?|secs?|s)$/,
  );
  if (!match) {
    return null;
  }

  const lower = Number(match[1]);
  const upper = Number(match[2]);
  const unit = match[3]!;
  const multiplier = /^(minutes?|mins?|m)$/.test(unit) ? 60 : 1;
  const minSeconds = lower * multiplier;
  const maxSeconds = upper * multiplier;
  const range = SUPPORTED_RANGES.find(
    (candidate) =>
      candidate.minSeconds === minSeconds && candidate.maxSeconds === maxSeconds,
  );
  return range ? withWordBudget(range) : null;
}

export function countPodcastWords(text: string): number {
  return (
    text.match(/\b[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*\b/gu)?.length ?? 0
  );
}

export function countPodcastScriptWords(script: PodcastScriptForDuration): number {
  return script.segments.reduce(
    (total, segment) => total + countPodcastWords(segment.text),
    0,
  );
}

/**
 * Validate the complete script immediately before TTS.
 *
 * This intentionally rejects rather than truncates. Truncation can remove a
 * conclusion, split a sentence, or leave a two-host script with unusable
 * narration. Callers should run this once after script generation and again
 * after any review/repair that can change segment text.
 */
export function assertPodcastScriptWithinWordBudget(
  script: PodcastScriptForDuration,
  range: PodcastDurationRange,
  stage: string,
): number {
  if (!script.segments.length) {
    throw new Error(`Podcast script has no segments after ${stage}`);
  }

  const emptySegment = script.segments.findIndex(
    (segment) => !segment.text.trim(),
  );
  if (emptySegment !== -1) {
    throw new Error(
      `Podcast script contains an empty segment (${emptySegment + 1}) after ${stage}`,
    );
  }

  const wordCount = countPodcastScriptWords(script);
  if (wordCount > range.maxWords) {
    throw new Error(
      `Podcast script exceeds the ${range.label} conservative word budget after ${stage}: ` +
        `${wordCount} words/${range.maxWords} words`,
    );
  }
  return wordCount;
}

export function isPodcastAudioDurationWithinRange(
  durationSeconds: number,
  range: PodcastDurationRange,
): boolean {
  return (
    Number.isFinite(durationSeconds) &&
    durationSeconds >= range.minSeconds &&
    durationSeconds <= range.maxSeconds
  );
}

export function formatPodcastDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Podcast duration must be a finite, non-negative number");
  }
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes === 0) {
    return `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
  }
  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} ${remainingSeconds} seconds`;
}

/**
 * Probe the finished MP3 itself. A non-zero/invalid result is an error: a
 * missing probe must never turn into an estimated duration or a ready asset.
 */
export async function probePodcastAudioDuration(audio: Buffer): Promise<number> {
  if (!ffprobePath?.path) {
    throw new Error("Podcast audio duration probe is unavailable");
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "podcast-duration-"));
  const temporaryAudioPath = join(temporaryDirectory, "audio.mp3");
  try {
    await writeFile(temporaryAudioPath, audio);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return new Promise((resolve, reject) => {
    const ffprobe = spawn(ffprobePath.path, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      temporaryAudioPath,
    ]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      void rm(temporaryDirectory, { recursive: true, force: true }).finally(() =>
        reject(error),
      );
    };

    ffprobe.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    ffprobe.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    ffprobe.on("error", (error) => {
      fail(new Error(`Podcast audio duration probe failed: ${error.message}`));
    });
    ffprobe.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(
          new Error(
            `Podcast audio duration probe exited with code ${code}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      const duration = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        fail(new Error("Podcast audio duration probe returned no valid duration"));
        return;
      }
      settled = true;
      void rm(temporaryDirectory, { recursive: true }).finally(() =>
        resolve(duration),
      );
    });
  });
}