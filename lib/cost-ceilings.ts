/**
 * lib/cost-ceilings.ts — Per-run cost ceilings and provider cost governance.
 *
 * IMPORTANT: These defaults are conservative placeholders.
 * Set final values from your actual cost-telemetry: query
 *   SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY cost_microusd / 1e6)
 *   FROM cost_telemetry WHERE operation_type = '<type>' AND success = 1
 * then multiply by ~2 to allow for transient retries before tripping the ceiling.
 *
 * Ceilings are checked in the worker wrapper before each attempt.
 * BUDGET_EXCEEDED is a fatal PipelineError → UnrecoverableError → credits released.
 */

export type ContentType = "article" | "social_post" | "podcast" | "video" | "image" | "reformat";

/** Cost ceilings in USD (floating point for readability; compare against microUSD / 1e6) */
export const COST_CEILINGS_USD: Record<ContentType, number> = {
  article:     0.15,  // p95 ~$0.06 × 2; 5 retries of a 5¢ article = $0.25 would exceed
  social_post: 0.05,  // p95 ~$0.02 × 2
  podcast:     0.20,  // p95 ~$0.08 × 2 (TTS + script)
  video:       3.00,  // p95 ~$1.20 × 2; Veo is the most expensive per attempt
  image:       0.04,  // p95 ~$0.015 × 2
  reformat:    0.05,  // p95 ~$0.02 × 2
};

/** Concurrency caps per user by content type (max simultaneous in-flight jobs) */
export const CONCURRENCY_CAPS: Record<ContentType, { free: number; pro: number; enterprise: number }> = {
  video:       { free: 1, pro: 2,  enterprise: 5  },
  podcast:     { free: 1, pro: 3,  enterprise: 10 },
  article:     { free: 3, pro: 10, enterprise: 50 },
  social_post: { free: 3, pro: 10, enterprise: 50 },
  image:       { free: 3, pro: 10, enterprise: 50 },
  reformat:    { free: 5, pro: 20, enterprise: 100 },
};

/** Daily quotas per user by content type */
export const DAILY_QUOTAS: Record<ContentType, { free: number; pro: number; enterprise: number }> = {
  video:       { free: 1,   pro: 5,   enterprise: 30  },
  podcast:     { free: 2,   pro: 10,  enterprise: 50  },
  article:     { free: 10,  pro: 50,  enterprise: 500 },
  social_post: { free: 20,  pro: 100, enterprise: 1000 },
  image:       { free: 10,  pro: 50,  enterprise: 500 },
  reformat:    { free: 20,  pro: 100, enterprise: 1000 },
};

/**
 * Get the accumulated provider spend for a run from cost_telemetry.
 * Keyed by BullMQ jobId (= runId after the jobId dedup change in queue.ts).
 * Returns USD.
 */
export async function getRunSpend(runId: string): Promise<number> {
  try {
    const { db } = await import("./db");
    const { costTelemetry } = await import("@/shared/schema");
    const { eq, sum } = await import("drizzle-orm");

    const [row] = await db
      .select({ total: sum(costTelemetry.costMicrousd) })
      .from(costTelemetry)
      .where(eq(costTelemetry.jobId, runId));

    const microusd = Number(row?.total ?? 0);
    return microusd / 1_000_000;
  } catch {
    return 0; // telemetry failures must never block generation
  }
}

/**
 * Throw a BUDGET_EXCEEDED PipelineError if accumulated spend for this run
 * has reached the ceiling for the given content type.
 *
 * Call this in the worker wrapper before each attempt:
 *   await assertRunBudget(job.data.runId, job.data.contentType, currentStage);
 */
export async function assertRunBudget(
  runId: string,
  contentType: ContentType,
  stage: string
): Promise<void> {
  const { PipelineError } = await import("./errors");
  const ceiling = COST_CEILINGS_USD[contentType] ?? COST_CEILINGS_USD.article;
  const spent = await getRunSpend(runId);
  if (spent >= ceiling) {
    throw new PipelineError(
      `Run ${runId} exceeded cost ceiling ($${spent.toFixed(4)} >= $${ceiling}) for ${contentType}. ` +
      `Credits were returned. Retry with a shorter prompt or contact support.`,
      "BUDGET_EXCEEDED",
      "fatal",
      stage
    );
  }
}
