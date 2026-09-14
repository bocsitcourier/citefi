const ACTIVE_BATCH_STATUSES = new Set([
  "SUBMITTING",
  "QUEUED",
  "PROCESSING",
  "RUNNING",
  "IN_PROGRESS",
]);

export function getBatchProgressPollInterval(input: {
  status?: string;
  pending?: number;
  inProgress?: number;
  runningElapsedMs?: number;
}): number | false {
  const status = input.status;
  if (!status) return false;

  // The batch and its articles are written separately. Keep polling when a
  // terminal batch response still contains stale non-terminal child rows.
  if (!ACTIVE_BATCH_STATUSES.has(status)) {
    return (input.pending ?? 0) + (input.inProgress ?? 0) > 0 ? 1500 : false;
  }

  if (status !== "RUNNING") return 3000;
  const elapsedMs = input.runningElapsedMs ?? 0;
  if (elapsedMs < 60_000) return 3000;
  if (elapsedMs < 300_000) return 5000;
  return 10_000;
}

export function firstBatchFailureReason(
  articles: Array<{ articleStatus: string; errorMessage: string | null }>,
): string | null {
  return articles.find(
    (article) =>
      ["FAILED", "REFORMAT_FAILED"].includes(article.articleStatus) &&
      Boolean(article.errorMessage?.trim()),
  )?.errorMessage?.trim() ?? null;
}