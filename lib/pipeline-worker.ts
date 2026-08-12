/**
 * createPipelineWorker — the single registration point for every BullMQ worker.
 *
 * Policy that used to be copy-pasted (and drift apart) per worker now lives
 * here exactly once:
 *   1. Run attribution: enterRunContext(runId) so all cost telemetry inside the
 *      processor is attributable to the run (cost_telemetry.jobId).
 *      NOTE: the assertRunBudget() cost-ceiling gate stays INSIDE processors
 *      (within their try blocks) so a BUDGET_EXCEEDED failure flows through the
 *      processor's own catch for domain cleanup (status writes, batch
 *      completion) before this wrapper applies release/UnrecoverableError.
 *   2. Error taxonomy: classifyError() on every failure; fatal dispositions
 *      throw UnrecoverableError so BullMQ skips remaining retries.
 *   3. Credit settlement on failure: releaseReservation() exactly once, on the
 *      FINAL attempt only (fatal, or last retry) — never on a transient retry
 *      (a successful retry must still be able to debit the same reservation),
 *      and never on DEBIT_FAILED (content succeeded; only the debit retries).
 *
 * Success-path debits stay inside processors: each content type has
 *  conditional debit points (resume paths, terminal skips) that are part of
 * its domain logic, not cross-cutting policy.
 *
 * Domain cleanup on failure (status writes, notifications, error logs) also
 * stays in the processor's own catch — which must RETHROW so this wrapper can
 * apply policy.
 *
 * Lint enforcement: `new Worker(` outside this file is flagged by eslint
 * (no-restricted-syntax). Register through createPipelineWorker instead.
 */
import { Worker, UnrecoverableError, type Job } from "bullmq";
import { classifyError, type PipelineError } from "./errors";
import type { ContentType } from "./cost-ceilings";
import * as queue from "./queue";

// Indirection keeps the queue import tree-shakeable for handler-only unit tests.
function queueModule() {
  return queue;
}

export interface PipelineBilling {
  teamId?: number | null;
  runId?: string | null;
  userId?: number;
  /** Optional partial-release amount (defaults to the full reservation) */
  amount?: number;
  /** Optional idempotency key for the release */
  releaseKey?: string;
  reason?: string;
}

export interface PipelineWorkerOptions<T> {
  /** classifyError stage: "text_gen" | "image_gen" | "video_gen" | "upload" | "publish" | "enqueue" | "scheduler" | ... */
  stage: string;
  /** BullMQ concurrency (default 1) */
  concurrency?: number;
  /**
   * Run attribution. getRunId extracts the run identifier from job data; when
   * present, telemetry inside the processor is attributed to that run.
   * The assertRunBudget() gate itself belongs INSIDE the processor's try block
   * so budget failures get domain cleanup before wrapper policy applies.
   */
  budget?: {
    contentType: ContentType;
    getRunId: (job: Job<T>) => string | undefined | null;
  };
  /**
   * Credit reservation to release on FINAL failure. Return null/undefined (or
   * missing teamId/runId) when the job carries no reservation.
   */
  getBilling?: (job: Job<T>) => PipelineBilling | null | undefined | Promise<PipelineBilling | null | undefined>;
  /** Test injection points — do not use in production code. */
  _deps?: {
    releaseReservation?: (args: { teamId: number; runId: string; userId?: number; amount?: number; releaseKey?: string; reason: string }) => Promise<unknown>;
  };
}

export type PipelineProcessor<T> = (job: Job<T>) => Promise<unknown>;

/**
 * Builds the job handler (exported separately so unit tests can exercise the
 * policy without Redis or a real Worker).
 */
export function createPipelineHandler<T>(
  queueName: string,
  processor: PipelineProcessor<T>,
  opts: PipelineWorkerOptions<T>
) {
  return async (job: Job<T>): Promise<unknown> => {
    try {
      const runId = opts.budget?.getRunId(job);
      if (runId) {
        const { enterRunContext } = await import("./run-context");
        enterRunContext(runId);
      }
      return await processor(job);
    } catch (err) {
      const pe: PipelineError = classifyError(err, opts.stage);
      const attemptsAllowed = job.opts?.attempts ?? 1;
      const isFinal =
        pe.disposition === "fatal" ||
        (job.attemptsMade ?? 0) + 1 >= attemptsAllowed;
      console.error(
        `❌ [${queueName}:${String(job.id)}] ${pe.code} (${pe.disposition})${isFinal ? " — final attempt" : ""}`
      );

      // DEBIT_FAILED means the content was generated successfully and only the
      // debit needs retrying — releasing would refund a delivered product.
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isDebitFailure = rawMsg.includes("DEBIT_FAILED");

      if (isFinal && !isDebitFailure && opts.getBilling) {
        try {
          const billing = await opts.getBilling(job);
          if (billing?.teamId && billing?.runId) {
            const release =
              opts._deps?.releaseReservation ??
              (await import("./billing")).releaseReservation;
            await release({
              teamId: billing.teamId,
              runId: billing.runId,
              userId: billing.userId,
              amount: billing.amount,
              releaseKey: billing.releaseKey,
              reason:
                billing.reason ??
                `${queueName} job ${String(job.id)} failed (${pe.code})`,
            });
          }
        } catch (releaseErr) {
          console.warn(
            `[billing] releaseReservation failed for ${queueName} job ${String(job.id)}:`,
            releaseErr
          );
        }
      }

      if (pe.disposition === "fatal") {
        throw new UnrecoverableError(`[${pe.code}] ${pe.message}`);
      }
      throw err;
    }
  };
}

export function createPipelineWorker<T>(
  queueName: string,
  processor: PipelineProcessor<T>,
  opts: PipelineWorkerOptions<T>
): Worker<T> {
  const { getRedisConnection } = queueModule();
  return new Worker<T>(queueName, createPipelineHandler(queueName, processor, opts) as any, {
    connection: getRedisConnection(),
    concurrency: opts.concurrency ?? 1,
  });
}
