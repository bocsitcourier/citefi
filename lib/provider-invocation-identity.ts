/**
 * Stable identity for one logical worker invocation.
 *
 * BullMQ may deliver one job more than once, including after a worker process
 * crashes.  The queue job identity is therefore the durable invocation
 * identity; attemptsMade is deliberately not part of it.  Provider adapters
 * use the AsyncLocalStorage scope to turn their local stage/attempt metadata
 * into a receipt key that is stable on redelivery but distinct for separate
 * jobs.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const MAX_IDENTITY_LENGTH = 255;

export interface ProviderInvocationIdentity {
  /** Stable across BullMQ redelivery and worker process restart. */
  readonly invocationKey: string;
  /** Number of provider-attempt boundaries entered in this invocation. */
  callSequence: number;
  /** Counters are isolated by provider/operation/model/stage. */
  readonly callCounters?: Map<string, number>;
  /** True when the identity came from a durable worker/direct caller key. */
  readonly replayable: boolean;
}

export interface ProviderAttemptIdentityAllocation {
  /** Stable logical invocation slot, reused for every retry of the call. */
  readonly invocationKey: string;
  /** Caller-provided stage label, not a process-global receipt identity. */
  readonly attemptKey: string;
}

const identityStorage = new AsyncLocalStorage<ProviderInvocationIdentity>();

function boundedIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required for provider invocation identity`);
  if (normalized.length > MAX_IDENTITY_LENGTH) {
    throw new Error(`${label} exceeds the provider invocation identity limit`);
  }
  return normalized;
}

/**
 * Enter an identity scope. A fresh object is used for each scope so nested
 * logical invocations do not consume the parent's provider call sequence.
 */
export function runWithProviderInvocationIdentity<T>(
  identity: ProviderInvocationIdentity | string,
  callback: () => T,
): T {
  const value: ProviderInvocationIdentity = typeof identity === "string"
    ? {
        invocationKey: boundedIdentity(identity, "provider invocationKey"),
        callSequence: 0,
        callCounters: new Map(),
        replayable: true,
      }
    : {
        invocationKey: boundedIdentity(identity.invocationKey, "provider invocationKey"),
        callSequence: 0,
        callCounters: new Map(),
        replayable: identity.replayable !== false,
      };
  return identityStorage.run(value, callback);
}

export function currentProviderInvocationIdentity(): ProviderInvocationIdentity | undefined {
  return identityStorage.getStore();
}

export interface ProviderAttemptIdentityOptions {
  invocationKey?: string | null;
  attemptKey?: string | null;
  provider?: string | null;
  operationType?: string | null;
  model?: string | null;
}

/**
 * Allocate one logical provider-call slot. Adapters must call this before
 * entering a limiter/retry loop, then reuse the returned pair for every
 * physical attempt. Consequently the receipt source identity changes only
 * with the explicit attempt number, never because a retry happened to resume
 * in a new async callback.
 */
export function allocateProviderAttemptIdentity(
  options: ProviderAttemptIdentityOptions = {},
): ProviderAttemptIdentityAllocation {
  const provider = boundedIdentity(options.provider ?? "provider", "provider");
  const operationType = boundedIdentity(options.operationType ?? "operation", "operationType");
  const model = boundedIdentity(options.model ?? "model", "provider model");
  const stageKey = boundedIdentity(options.attemptKey?.trim() || "provider-call", "provider attempt key");
  let invocationKey = options.invocationKey?.trim() || undefined;
  const current = identityStorage.getStore();
  if (!invocationKey && current) {
    const counterKey = [provider, operationType, model, stageKey].join(":");
    const callCounters = current.callCounters ?? new Map<string, number>();
    const sequence = callCounters.get(counterKey) ?? 0;
    callCounters.set(counterKey, sequence + 1);
    current.callSequence++;
    invocationKey = `${current.invocationKey}:call:${sequence}`;
  }
  if (!invocationKey) {
    // This is intentionally the only adapter-facing UUID fallback: a direct
    // call outside a worker/route idempotency scope is genuinely new.
    invocationKey = `direct:${randomUUID()}`;
  }
  return {
    invocationKey: boundedIdentity(invocationKey, "provider invocationKey"),
    attemptKey: stageKey,
  };
}

/**
 * Queue workers must always provide a stable job identity. In particular,
 * never fall back to random UUIDs here: a missing id would make a redelivery
 * indistinguishable from a new paid invocation.
 */
export function providerInvocationIdentityForJob(
  queueName: string,
  job: { id?: string | number | null; data?: unknown },
): ProviderInvocationIdentity {
  const data = job.data && typeof job.data === "object"
    ? job.data as Record<string, unknown>
    : {};
  const explicit = data.invocationKey;
  const jobId = job.id;
  if (
    explicit != null &&
    (typeof explicit !== "string" || !explicit.trim())
  ) {
    throw new Error(`queue ${queueName} job has an invalid invocationKey`);
  }
  const stableJobId =
    typeof jobId === "string" || typeof jobId === "number"
      ? String(jobId)
      : "";
  if (!stableJobId && explicit == null) {
    throw new Error(
      `queue ${queueName} job is missing a stable id; refusing provider invocation scope`,
    );
  }
  const key = explicit == null
    ? `queue:${boundedIdentity(queueName, "queue name")}:job:${boundedIdentity(stableJobId, "job id")}`
    : `queue:${boundedIdentity(queueName, "queue name")}:invocation:${boundedIdentity(String(explicit), "invocationKey")}`;
  return {
    invocationKey: boundedIdentity(key, "provider invocationKey"),
    callSequence: 0,
    replayable: true,
  };
}

/**
 * Scope a caller's stage key with the current invocation. Explicit resource
 * keys are useful stage labels, not durable global identities.
 *
 * Outside a worker identity scope, an explicit key remains a deliberate
 * direct-call key for backwards-compatible tests and route callers. A missing
 * key gets a random non-replayable identity only for that genuinely new direct
 * invocation.
 */
export function providerAttemptInvocationKey(
  explicitKey: string | null | undefined,
  stage: string,
  attempt: number | null | undefined,
  provider = "provider",
  model = "model",
  absoluteInvocationKey?: string | null,
): string {
  const current = identityStorage.getStore();
  const explicitInvocation = absoluteInvocationKey?.trim();
  const normalizedStage = boundedIdentity(stage, "provider attempt stage");
  const normalizedProvider = boundedIdentity(provider, "provider");
  const normalizedModel = boundedIdentity(model, "provider model");
  const normalizedAttempt = attempt == null ? 1 : attempt;
  if (!Number.isSafeInteger(normalizedAttempt) || normalizedAttempt <= 0) {
    throw new Error("provider attempt attempt must be a positive safe integer");
  }
  const counterKey = [
    normalizedProvider,
    normalizedModel,
    normalizedStage,
    explicitKey?.trim() || "provider-call",
  ].join(":");
  const localSequence = current
    ? (current.callCounters?.get(counterKey) ?? 0)
    : 0;
  if (explicitInvocation) {
    return [
      boundedIdentity(explicitInvocation, "provider invocationKey"),
      "stage",
      normalizedStage,
      "attempt",
      normalizedAttempt,
      "key",
      boundedIdentity(explicitKey?.trim() || "provider-call", "provider attempt key"),
    ].join(":");
  }
  if (current) {
    current.callCounters?.set(counterKey, localSequence + 1);
    current.callSequence++;
    const localKey = explicitKey?.trim() || "provider-call";
    return [
      current.invocationKey,
      "stage",
      normalizedStage,
      "call",
      localSequence,
      "attempt",
      normalizedAttempt,
      "key",
      boundedIdentity(localKey, "provider attempt key"),
    ].join(":");
  }
  // A standalone explicit key is a legacy direct-call contract and remains
  // deterministic. Adapter wrappers that need a fresh logical call allocate
  // an invocationKey once via allocateProviderAttemptIdentity.
  if (explicitKey?.trim()) return explicitKey.trim();
  return `direct:${randomUUID()}:stage:${normalizedStage}:call:${localSequence}:attempt:${normalizedAttempt}`;
}
