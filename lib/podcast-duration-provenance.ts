/**
 * Resolve podcast duration without conflating historical integer metadata
 * with a post-render measurement. This module is browser-safe so the same
 * provenance rule can be used by the content UI and server responses.
 */
export type PodcastDurationSource =
  | "ffprobe"
  | "historical-ffprobe"
  | "legacy"
  | "unknown";

export interface PodcastDurationProvenance {
  seconds: number | null;
  source: PodcastDurationSource;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Current metadata is authoritative only when its measured value is finite
 * and explicitly tied to ffprobe. Older ready rows may have only
 * durationSource/audioDurationSeconds; preserve that historical provenance
 * separately. The integer article column is a legacy/unknown value and must
 * never be labeled measured.
 */
export function resolvePodcastDurationProvenance(
  metadata: unknown,
  legacyDuration: unknown,
): PodcastDurationProvenance {
  const record = asRecord(metadata);
  const measuredDuration = record?.measuredDurationSeconds;
  const measuredSource = record?.measuredDurationSource;
  const durationSource = record?.durationSource;

  if (
    finiteNonNegative(measuredDuration) &&
    (measuredSource === "ffprobe" ||
      (measuredSource == null && durationSource === "ffprobe"))
  ) {
    return { seconds: measuredDuration, source: "ffprobe" };
  }

  const historicalDuration = record?.audioDurationSeconds;
  if (durationSource === "ffprobe" && finiteNonNegative(historicalDuration)) {
    return { seconds: historicalDuration, source: "historical-ffprobe" };
  }

  if (
    typeof legacyDuration === "number" &&
    Number.isInteger(legacyDuration) &&
    Number.isFinite(legacyDuration) &&
    legacyDuration >= 0
  ) {
    return { seconds: legacyDuration, source: "legacy" };
  }

  return { seconds: null, source: "unknown" };
}