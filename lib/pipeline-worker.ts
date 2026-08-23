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
import {
  runWithTenantContext,
  runWithSystemContext,
  getDatabaseExecutionContext,
} from "./tenant-context";

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

/**
 * Explicit database-execution contract for a worker.
 *
 * Every worker must declare whether its jobs run inside a single tenant's
 * database context or as a system/cross-tenant maintenance task:
 *
 *  - `{ scope: "tenant", getTeamId }` — resolves a positive teamId from the job
 *    and runs the processor inside runWithTenantContext, so every DB query the
 *    processor issues is scoped (SET LOCAL ROLE citefi_tenant + team_id) to that
 *    single tenant. A missing/invalid teamId is a fatal, unrecoverable error:
 *    the wrapper never guesses a tenant and never lets one tenant's job touch
 *    another tenant's rows.
 *
 *  - `{ scope: "system", reason }` — runs the processor inside
 *    runWithSystemContext(reason). Reserved for cross-tenant maintenance and
 *    scheduler sweeps that legitimately read/write many teams' rows. `reason`
 *    must be a non-empty audit string.
 *
 * getTeamId may be async (some tenant jobs must resolve the owning team from a
 * durable row rather than the payload) and may return null/undefined; a
 * non-positive result is treated as an unresolved tenant and fails the job
 * fatally.
 */
export type PipelineExecution<T> =
  | {
      scope: "tenant";
      /**
       * Resolve the owning teamId for the job. Return a positive integer for a
       * resolved tenant; null/undefined/non-positive means "tenant unresolved"
       * and the job fails fatally (never runs in another tenant's context).
       */
      getTeamId: (job: Job<T>) => number | null | undefined | Promise<number | null | undefined>;
      /**
       * Optional audited system scope used only while resolving a legacy
       * payload's owner from its durable row. Processing and failure cleanup
       * still run in the resolved tenant context.
       */
      systemTeamResolutionReason?: string;
      /** Optional actor role recorded in the DB session (defaults to "system_worker"). */
      role?: string;
      /** Optional userId to attribute the tenant session to (defaults to null). */
      getUserId?: (job: Job<T>) => number | null | undefined;
    }
  | {
      scope: "system";
      /** Non-empty audit reason for the cross-tenant/system execution. */
      reason: string;
    };

/**
 * Raised when a tenant worker cannot resolve a positive teamId for its job.
 * Fatal: the wrapper converts it to UnrecoverableError and never releases or
 * debits a reservation (there is no trustworthy tenant to bill).
 */
export class TenantContextRequiredError extends Error {
  readonly code = "TENANT_CONTEXT_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "TenantContextRequiredError";
  }
}

export function isTenantContextRequiredError(
  error: unknown
): error is TenantContextRequiredError {
  return (
    error instanceof TenantContextRequiredError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "TENANT_CONTEXT_REQUIRED")
  );
}

/**
 * Raised when an ID-driven processor discovers that the entity it is about to
 * act on belongs to a different team than the job claims. Fatal by design: the
 * job must never release/debit against the wrong tenant, so this error is
 * excluded from the generic release path (like DEBIT_FAILED / lease conflicts).
 */
export class TenantMismatchError extends Error {
  readonly code = "TENANT_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "TenantMismatchError";
  }
}

export function isTenantMismatchError(
  error: unknown
): error is TenantMismatchError {
  return (
    error instanceof TenantMismatchError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "TENANT_MISMATCH")
  );
}

/**
 * Authoritative entity/team cross-check for ID-driven processors.
 *
 * Call at processor entry once the owning team has been read from the durable
 * row: `assertEntityTeam({ entity, entityId, jobTeamId, entityTeamId })`.
 *
 *  - A null/undefined entityTeamId means the entity row was not found for the
 *    claimed team; that is a mismatch (never proceed on an ambiguous owner).
 *  - A mismatch throws TenantMismatchError (fatal, never releases another
 *    tenant's credits).
 *
 * `jobTeamId` must be a positive integer (the tenant the job runs as).
 */
export function assertEntityTeam(args: {
  entity: string;
  entityId: number | string;
  jobTeamId: number;
  entityTeamId: number | null | undefined;
}): void {
  const { entity, entityId, jobTeamId, entityTeamId } = args;
  if (!Number.isInteger(jobTeamId) || jobTeamId <= 0) {
    throw new TenantContextRequiredError(
      `${entity} ${entityId}: job team context is not a positive teamId (got ${String(jobTeamId)})`
    );
  }
  if (entityTeamId == null) {
    throw new TenantMismatchError(
      `${entity} ${entityId}: no row found for team ${jobTeamId} (owner unknown) — refusing to proceed`
    );
  }
  if (entityTeamId !== jobTeamId) {
    throw new TenantMismatchError(
      `${entity} ${entityId}: belongs to team ${entityTeamId} but job runs as team ${jobTeamId} — refusing to proceed`
    );
  }
}

/**
 * Read the positive teamId of the current tenant execution context. Intended
 * for use inside a tenant-scoped processor to feed assertEntityTeam without
 * re-threading the teamId through function arguments. Throws
 * TenantContextRequiredError when called outside a tenant context.
 */
export function currentTenantTeamId(): number {
  const ctx = getDatabaseExecutionContext();
  if (!ctx || ctx.scope !== "tenant" || !Number.isInteger(ctx.teamId) || ctx.teamId <= 0) {
    throw new TenantContextRequiredError(
      "currentTenantTeamId() called outside a positive tenant execution context"
    );
  }
  return ctx.teamId;
}

/**
 * Resolve the job's owning teamId for an entity/team cross-check.
 *
 * Prefers the active tenant execution context (the team the handler entered),
 * falling back to a caller-supplied value (job payload teamId) when the
 * processor is invoked outside a handler context — e.g. direct unit tests, or
 * transitional call sites. Throws TenantContextRequiredError when neither
 * yields a positive teamId, so an ID-driven processor can never proceed
 * without a trustworthy tenant identity.
 */
export function resolveJobTeamId(
  fallback?: number | null | undefined
): number {
  const ctx = getDatabaseExecutionContext();
  if (ctx?.scope === "tenant" && Number.isInteger(ctx.teamId) && ctx.teamId > 0) {
    return ctx.teamId;
  }
  if (Number.isInteger(fallback as number) && (fallback as number) > 0) {
    return fallback as number;
  }
  throw new TenantContextRequiredError(
    "resolveJobTeamId(): no positive tenant context and no positive fallback teamId"
  );
}

export interface PipelineWorkerOptions<T> {
  /** classifyError stage: "text_gen" | "image_gen" | "video_gen" | "upload" | "publish" | "enqueue" | "scheduler" | ... */
  stage: string;
  /**
   * Database-execution contract (tenant vs system). Required so every worker
   * declares its tenant scope explicitly. See PipelineExecution.
   */
  execution: PipelineExecution<T>;
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
  const execution = opts.execution;
  return async (job: Job<T>): Promise<unknown> => {
    let tenantFailureContext:
      | {
          actorType: "worker";
          userId: number | null;
          teamId: number;
          role: string;
        }
      | undefined;
    let systemFailureReason: string | undefined;
    try {
      const runId = opts.budget?.getRunId(job);
      if (runId) {
        const { enterRunContext } = await import("./run-context");
        enterRunContext(runId);
      }

      // Resolve and enter the declared execution context BEFORE the processor
      // runs so every DB query it issues is scoped to the right tenant (or the
      // audited system context). Tenant resolution failures are fatal and must
      // never fall through into another tenant's context.
      //
      // execution is required for all production registrations; when absent
      // (handler-only unit tests that exercise pure error/billing policy) the
      // processor runs without a context wrapper.
      if (!execution) {
        return await processor(job);
      }
      if (execution.scope === "tenant") {
        let resolvedTeamId: number | null | undefined;
        try {
          resolvedTeamId = execution.systemTeamResolutionReason
            ? await runWithSystemContext(
                execution.systemTeamResolutionReason,
                () => execution.getTeamId(job)
              )
            : await execution.getTeamId(job);
        } catch (cause) {
          throw new TenantContextRequiredError(
            `[${queueName}:${String(job.id)}] tenant owner resolution failed; ` +
              `refusing to run without a validated team (${cause instanceof Error ? cause.message : String(cause)})`
          );
        }
        if (!Number.isInteger(resolvedTeamId as number) || (resolvedTeamId as number) <= 0) {
          throw new TenantContextRequiredError(
            `[${queueName}:${String(job.id)}] tenant worker could not resolve a positive teamId ` +
              `(got ${String(resolvedTeamId)}); refusing to run without a tenant context`
          );
        }
        const teamId = resolvedTeamId as number;
        const userId = execution.getUserId?.(job) ?? null;
        tenantFailureContext = {
          actorType: "worker",
          userId: Number.isInteger(userId as number) && (userId as number) > 0 ? (userId as number) : null,
          teamId,
          role: execution.role ?? "system_worker",
        };
        return await runWithTenantContext(
          tenantFailureContext,
          () => processor(job)
        );
      }

      systemFailureReason = execution.reason;
      return await runWithSystemContext(execution.reason, () => processor(job));
    } catch (err) {
      const handleFailure = async (): Promise<never> => {
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
      // A tenant-context/mismatch failure must NEVER release or debit: the
      // reservation (if any) belongs to a tenant we could not trust for this
      // job, so touching billing could refund/charge the wrong team.
      const isTenantFault =
        isTenantContextRequiredError(err) || isTenantMismatchError(err);

      if (isFinal && !isDebitFailure && !isLeaseConflict && !isTenantFault && opts.getBilling) {
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

      // Tenant faults are always unrecoverable — retrying cannot make an
      // entity belong to the claimed team, and each retry risks touching
      // another tenant's data.
      if (isTenantFault) {
        throw new UnrecoverableError(
          `[${(err as { code?: string }).code ?? pe.code}] ${
            err instanceof Error ? err.message : pe.message
          }`
        );
      }

      if (isFinal && (!canRetry || pe.disposition === "fatal")) {
        throw new UnrecoverableError(`[${pe.code}] ${pe.message}`);
      }
        throw err;
      };

      // AsyncLocalStorage restores the caller's context when the processor's
      // scoped callback rejects. Re-enter the already validated context so
      // final-failure billing lookup/release cannot fall through to unscoped
      // access (and can never touch a different tenant).
      if (tenantFailureContext) {
        return await runWithTenantContext(tenantFailureContext, handleFailure);
      }
      if (systemFailureReason) {
        return await runWithSystemContext(systemFailureReason, handleFailure);
      }
      return await handleFailure();
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
