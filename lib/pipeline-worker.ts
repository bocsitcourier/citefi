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
import {
  Worker,
  DelayedError,
  UnrecoverableError,
  type Job,
  type WorkerOptions,
} from "bullmq";
import {
  classifyError,
  type ErrorDisposition,
  type PipelineError,
} from "./errors";
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
  /**
   * Allow a queue to use its configured retry budget even when the shared
   * taxonomy classifies the error as fatal. This is intentionally opt-in:
   * most pipelines should skip retries for auth/config/model-not-found errors,
   * while health canaries must retry those exact failures to distinguish a
   * brief control-plane issue from a durable model deprecation.
   */
  retryFatalErrors?: boolean;
  /**
   * Nonfatal dispositions that may consume the queue's retry budget. Defaults
   * to all nonfatal dispositions for backward compatibility. Workers that do
   * not implement fallback/degrade strategies should opt into ["retry"] only.
   */
  retryDispositions?: readonly ErrorDisposition[];
  /** Test injection points — do not use in production code. */
  _deps?: {
    releaseReservation?: (args: { teamId: number; runId: string; userId?: number; amount?: number; releaseKey?: string; reason: string }) => Promise<unknown>;
    recordProviderFailure?: (queueName: string, error: PipelineError) => Promise<unknown>;
  };
  /** Worker-level test controls for deterministic lock/stall integration tests. */
  _workerOptions?: Omit<WorkerOptions, "concurrency">;
}

export type PipelineProcessor<T> = (job: Job<T>) => Promise<unknown>;

const DEFAULT_RETRY_DISPOSITIONS: readonly ErrorDisposition[] = [
  "retry",
  "fallback",
  "degrade",
];

export function isPipelineErrorRetryable(
  error: Pick<PipelineError, "disposition">,
  retryFatalErrors = false,
  retryDispositions: readonly ErrorDisposition[] = DEFAULT_RETRY_DISPOSITIONS
): boolean {
  if (error.disposition === "fatal") return retryFatalErrors;
  return retryDispositions.includes(error.disposition);
}

export function isFinalPipelineAttempt(
  job: { attemptsMade?: number; opts?: { attempts?: number } },
  error: Pick<PipelineError, "disposition">,
  retryFatalErrors = false,
  retryDispositions: readonly ErrorDisposition[] = DEFAULT_RETRY_DISPOSITIONS
): boolean {
  const attemptsAllowed = job.opts?.attempts ?? 1;
  const attemptsUsed = (job.attemptsMade ?? 0) + 1;
  return !isPipelineErrorRetryable(
    error,
    retryFatalErrors,
    retryDispositions
  ) || attemptsUsed >= attemptsAllowed;
}

/**
 * Content is durable, but the reservation still needs to become a debit.
 * This structured error is intentionally excluded from generic release policy.
 */
export class BillingSettlementError extends Error {
  readonly code = "DEBIT_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "BillingSettlementError";
  }
}

export function isBillingSettlementError(error: unknown): error is BillingSettlementError {
  return error instanceof BillingSettlementError ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "DEBIT_FAILED"
    );
}

/**
 * A delivery could not acquire its durable run lease. This must never release
 * billing: BullMQ or the expired-run monitor will retry the same run.
 */
export class ArticleRunLeaseConflictError extends Error {
  readonly code = "RUN_LEASE_HELD";

  constructor(message: string) {
    super(message);
    this.name = "ArticleRunLeaseConflictError";
  }
}

export function isArticleRunLeaseConflictError(
  error: unknown
): error is ArticleRunLeaseConflictError {
  return error instanceof ArticleRunLeaseConflictError ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "RUN_LEASE_HELD"
    );
}

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
      // The processor already moved this active job to BullMQ's delayed set.
      // Treating it as a normal failure would consume attempts and could release
      // the reservation even though the same durable run is still in progress.
      if (err instanceof DelayedError || (err instanceof Error && err.name === "DelayedError")) {
        throw err;
      }
      const pe: PipelineError = classifyError(err, opts.stage);
      // A provider-side 429/5xx is systemic. Count it once in Redis before this
      // job consumes another retry; the breaker pauses affected queues at 5/2min.
      const recordFailure =
        opts._deps?.recordProviderFailure ??
        ((name: string, error: PipelineError) =>
          import("./provider-circuit-breaker").then(({ recordProviderFailure }) => recordProviderFailure(name, error)));
      await recordFailure(queueName, pe)
        .catch((circuitErr) => console.warn("[provider-circuit] failure recording failed:", circuitErr));
      const retryFatalErrors = opts.retryFatalErrors === true;
      const canRetry = isPipelineErrorRetryable(
        pe,
        retryFatalErrors,
        opts.retryDispositions
      );
      const isFinal = isFinalPipelineAttempt(
        job,
        pe,
        retryFatalErrors,
        opts.retryDispositions
      );
      console.error(
        `❌ [${queueName}:${String(job.id)}] ${pe.code} (${pe.disposition})${isFinal ? " — final attempt" : ""}`
      );

      // DEBIT_FAILED means the content was generated successfully and only the
      // debit needs retrying — releasing would refund a delivered product.
      const isDebitFailure = isBillingSettlementError(err);
      const isLeaseConflict = isArticleRunLeaseConflictError(err);

      if (isFinal && !isDebitFailure && !isLeaseConflict && opts.getBilling) {
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

      if (isFinal && (!canRetry || pe.disposition === "fatal")) {
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
  const workerOptions = opts._workerOptions ?? {
    connection: getRedisConnection(),
  };
  const worker = new Worker<T>(queueName, createPipelineHandler(queueName, processor, opts) as any, {
    ...workerOptions,
    concurrency: opts.concurrency ?? 1,
  });
  registeredWorkers.add(worker as Worker<unknown>);
  worker.on("closed", () => {
    registeredWorkers.delete(worker as Worker<unknown>);
  });
  return worker;
}

const registeredWorkers = new Set<Worker<unknown>>();

export interface WorkerDrainResult {
  drained: number;
  forced: number;
  timedOut: boolean;
}

export interface CloseableWorker {
  close(force?: boolean): Promise<void>;
}

export async function drainWorkers(
  workers: CloseableWorker[],
  timeoutMs: number
): Promise<WorkerDrainResult> {
  if (workers.length === 0) {
    return { drained: 0, forced: 0, timedOut: false };
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  const graceful = Promise.allSettled(workers.map((worker) => worker.close(false)));
  const deadline = new Promise<"timeout">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const outcome = await Promise.race([
    graceful.then(() => "drained" as const),
    deadline,
  ]);
  if (timeoutHandle) clearTimeout(timeoutHandle);

  if (outcome === "drained") {
    return { drained: workers.length, forced: 0, timedOut: false };
  }

  await Promise.allSettled(workers.map((worker) => worker.close(true)));
  return { drained: 0, forced: workers.length, timedOut: true };
}

/**
 * Stop intake and wait for active processors. BullMQ close(true) cannot cancel
 * an already-issued provider request, so it is reserved for the process-wide
 * shutdown deadline after the graceful drain has been given a chance.
 */
export async function closePipelineWorkers(
  timeoutMs = 30_000
): Promise<WorkerDrainResult> {
  const workers = [...registeredWorkers];
  const result = await drainWorkers(workers, timeoutMs);
  if (result.timedOut) {
    console.error(
      `⚠️ Worker drain exceeded ${timeoutMs}ms; force-closed ${result.forced} worker connection(s)`
    );
  }
  return result;
}
