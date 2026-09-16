import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffprobePath from "@ffprobe-installer/ffprobe";

/**
 * This is an editorial planning assumption, not a measured provider result.
 * There is intentionally no voice/locale calibration in this release: the
 * provider has not supplied supporting evidence for one, and paid calibration
 * is not permitted.  ffprobe remains authoritative after rendering.
 */
export const PODCAST_PLANNING_RATE_WPM = 150;
export const PODCAST_PLANNING_RATE_SOURCE =
  "explicit editorial planning rate; estimate only; calibration missing";

export interface PodcastDurationRange {
  label: string;
  minSeconds: number;
  maxSeconds: number;
  minWords: number;
  maxWords: number;
  planningRateWpm: number;
  planningRateSource: string;
}

export interface PodcastScriptForDuration {
  segments: Array<{ text: string; voice?: string }>;
}

const SUPPORTED_RANGES: ReadonlyArray<{
  label: string;
  minSeconds: number;
  maxSeconds: number;
}> = [
  { label: "1-2 minutes", minSeconds: 60, maxSeconds: 120 },
  { label: "3-4 minutes", minSeconds: 180, maxSeconds: 240 },
  { label: "5-7 minutes", minSeconds: 300, maxSeconds: 420 },
];

function withWordBudget(
  range: (typeof SUPPORTED_RANGES)[number],
): PodcastDurationRange {
  return {
    ...range,
    minWords: Math.ceil(
      (range.minSeconds / 60) * PODCAST_PLANNING_RATE_WPM,
    ),
    maxWords: Math.floor(
      (range.maxSeconds / 60) * PODCAST_PLANNING_RATE_WPM,
    ),
    planningRateWpm: PODCAST_PLANNING_RATE_WPM,
    planningRateSource: PODCAST_PLANNING_RATE_SOURCE,
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

export interface PodcastSegmentDurationEstimate {
  segmentIndex: number;
  voice: string | null;
  words: number;
  estimatedSeconds: number;
  estimateLabel: "estimate";
}

export interface PodcastDurationPreflight {
  totalWords: number;
  estimatedSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  minWords: number;
  maxWords: number;
  planningRateWpm: number;
  planningRateSource: string;
  calibrationStatus: "missing";
  estimateLabel: "estimate";
  segments: PodcastSegmentDurationEstimate[];
}

export interface PodcastMeasuredDurationMetadata {
  duration: string;
  requestedDuration: string;
  audioDurationSeconds: number;
  durationSource: "ffprobe";
  measuredDurationSeconds: number;
  measuredDurationSource: "ffprobe";
  planningDurationSeconds: number;
  planningDurationLabel: "estimate";
  planningRateWpm: number;
  planningRateSource: string;
  calibrationStatus: "missing";
}

export function createPodcastMeasuredDurationMetadata(
  actualDuration: number,
  range: PodcastDurationRange,
  plan: PodcastDurationPreflight,
): PodcastMeasuredDurationMetadata {
  if (!isPodcastAudioDurationWithinRange(actualDuration, range)) {
    throw new Error("Cannot persist podcast duration metadata outside the hard range");
  }
  return {
    duration: formatPodcastDuration(actualDuration),
    requestedDuration: range.label,
    audioDurationSeconds: actualDuration,
    durationSource: "ffprobe",
    measuredDurationSeconds: actualDuration,
    measuredDurationSource: "ffprobe",
    planningDurationSeconds: plan.estimatedSeconds,
    planningDurationLabel: "estimate",
    planningRateWpm: plan.planningRateWpm,
    planningRateSource: plan.planningRateSource,
    calibrationStatus: plan.calibrationStatus,
  };
}

/**
 * Compute an honest planning estimate for every segment and enforce both
 * sides of the advertised range before the first TTS request.  This does not
 * claim that any voice or locale speaks at this rate; it is only a bounded
 * editorial plan.  A rendered file must still pass the hard ffprobe check.
 */
export function preflightPodcastScriptDuration(
  script: PodcastScriptForDuration,
  range: PodcastDurationRange,
  stage: string,
): PodcastDurationPreflight {
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

  const segments = script.segments.map((segment, index) => {
    const words = countPodcastWords(segment.text);
    return {
      segmentIndex: index,
      voice: segment.voice ?? null,
      words,
      estimatedSeconds: (words / range.planningRateWpm) * 60,
      estimateLabel: "estimate" as const,
    };
  });
  const totalWords = segments.reduce((sum, segment) => sum + segment.words, 0);
  const estimatedSeconds = (totalWords / range.planningRateWpm) * 60;

  if (totalWords < range.minWords || totalWords > range.maxWords) {
    throw new Error(
      `Podcast script planning estimate is outside the ${range.label} hard ` +
        `pre-TTS plan after ${stage}: ${totalWords} words/${range.minWords}-${range.maxWords} ` +
        `words at ${range.planningRateWpm} words per minute (estimate; calibration missing)`,
    );
  }

  return {
    totalWords,
    estimatedSeconds,
    minSeconds: range.minSeconds,
    maxSeconds: range.maxSeconds,
    minWords: range.minWords,
    maxWords: range.maxWords,
    planningRateWpm: range.planningRateWpm,
    planningRateSource: range.planningRateSource,
    calibrationStatus: "missing",
    estimateLabel: "estimate",
    segments,
  };
}

/**
 * Testable boundary used by the worker: the TTS implementation is injected
 * only after the complete script passes the duration preflight. This keeps a
 * short/long script from reaching even the first provider segment.
 */
export async function renderPodcastSegmentsAfterPreflight<T>(
  script: PodcastScriptForDuration,
  range: PodcastDurationRange,
  stage: string,
  render: (segments: Array<{ text: string; voice?: string }>) => Promise<T>,
): Promise<T> {
  preflightPodcastScriptDuration(script, range, stage);
  return render(script.segments);
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