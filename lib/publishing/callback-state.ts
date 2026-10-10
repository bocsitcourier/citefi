export type CallbackStatus = "success" | "failure" | "partial" | "retryable";

/** A negative receipt does not prove absence of external effects. Reconcile,
 * never automatically resubmit a physical operation. Delivered is terminal. */
export function callbackStateUpdate(
  job: { status: string; attempts: number; maxAttempts: number },
  status: CallbackStatus,
  error?: string,
  now = new Date(),
) {
  if (!["processing", "sent", "outcome_unknown"].includes(job.status)) return null;
  if (status === "success") return {
    status: "delivered", publishedAt: now, nextRetryAt: null, lastError: null, updatedAt: now,
  };
  return {
    status: "outcome_unknown",
    lastError: error ?? `Provider reported ${status}`,
    nextRetryAt: null,
    updatedAt: now,
  };
}
