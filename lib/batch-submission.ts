const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,200}$/;

export interface BatchSubmissionAttempt {
  batchId: number;
  idempotencyKey: string;
}

export type BatchSubmissionReplay =
  | { outcome: "not_match" }
  | { outcome: "terminal" }
  | { outcome: "pending"; jobId: string }
  | { outcome: "accepted"; jobId: string };

export function inspectBatchSubmissionReplay(input: {
  batchId: number;
  status: string;
  generationParams: unknown;
  idempotencyKey: string;
}): BatchSubmissionReplay {
  const params = input.generationParams && typeof input.generationParams === "object"
    ? input.generationParams as Record<string, unknown>
    : {};
  const submission = params.submission && typeof params.submission === "object"
    ? params.submission as Record<string, unknown>
    : undefined;
  if (submission?.idempotencyKey !== input.idempotencyKey) {
    return { outcome: "not_match" };
  }
  if (["FAILED", "CANCELLED"].includes(input.status)) {
    return { outcome: "terminal" };
  }
  const jobId = typeof submission.jobId === "string"
    ? submission.jobId
    : `batch:${input.batchId}`;
  return submission.state === "ACCEPTED" ||
    ["QUEUED", "RUNNING", "PARTIAL_COMPLETE", "COMPLETE"].includes(input.status)
    ? { outcome: "accepted", jobId }
    : { outcome: "pending", jobId };
}

export function validateBatchSubmissionKey(value: string): string {
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error("Invalid batch submission idempotency key");
  }
  return key;
}

export function createBatchSubmissionKey(
  batchId: number,
  uuid: () => string = () => crypto.randomUUID(),
): string {
  if (!Number.isInteger(batchId) || batchId <= 0) {
    throw new Error("Batch submission requires a positive batch ID");
  }
  return validateBatchSubmissionKey(`batch-submit:${batchId}:${uuid()}`);
}

/**
 * Synchronous client-side latch. React's isPending flag updates on the next
 * render, so it cannot by itself stop two click events in the same render.
 * Failed/precondition attempts retain their key so an explicit retry has the
 * same server-side operation identity.
 */
export class BatchSubmissionLatch {
  private attempt: BatchSubmissionAttempt | null = null;
  private inFlight = false;

  begin(batchId: number): BatchSubmissionAttempt | null {
    if (this.inFlight) return null;
    if (!this.attempt || this.attempt.batchId !== batchId) {
      this.attempt = {
        batchId,
        idempotencyKey: createBatchSubmissionKey(batchId),
      };
    }
    this.inFlight = true;
    return this.attempt;
  }

  finish(attempt: BatchSubmissionAttempt, retainIdentity = true): void {
    if (this.attempt?.idempotencyKey === attempt.idempotencyKey) {
      this.inFlight = false;
      if (!retainIdentity) this.attempt = null;
    }
  }

  reset(): void {
    this.attempt = null;
    this.inFlight = false;
  }
}

export interface EnqueueFailureCompensation {
  creditsReleased: boolean;
  capReleased: boolean;
  retryEnabled: boolean;
}

/**
 * A failed credit release must not make the batch retryable: doing so could
 * create another reservation while the first hold is still outstanding.
 */
export async function compensateBatchEnqueueFailure(deps: {
  releaseCredits: () => Promise<void>;
  releaseCap: () => Promise<void>;
  markRetryable: () => Promise<void>;
}): Promise<EnqueueFailureCompensation> {
  let creditsReleased = false;
  let capReleased = false;

  try {
    await deps.releaseCredits();
    creditsReleased = true;
  } catch {
    // Keep FAILED_ENQUEUE/SUBMITTING non-retryable until reconciliation.
  }

  try {
    await deps.releaseCap();
    capReleased = true;
  } catch {
    // Cap holds expire independently; this must not hide the credit result.
  }

  if (creditsReleased) {
    await deps.markRetryable();
  }

  return {
    creditsReleased,
    capReleased,
    retryEnabled: creditsReleased,
  };
}