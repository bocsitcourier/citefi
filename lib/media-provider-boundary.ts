import {
  isNonReplayableProviderError,
  ProviderResultNotDurableError,
  ProviderSubmissionUncertainError,
} from "./cost-telemetry";
import {
  runWithProviderAttempt,
  type ProviderAttemptContext,
  type ProviderAttemptHandle,
  type ProviderAttemptReceiptDependencies,
  type ProviderResponseCapture,
  type SafeProviderRequest,
} from "./provider-attempt-receipts";

export interface PaidMediaBoundaryDependencies<TProviderResult, TDurableResult> {
  mediaKind: "image" | "video" | "audio";
  /**
   * Submit exactly one physical provider request.  The optional handle is
   * supplied when `receipt` is configured and can be used to capture provider
   * identity/usage immediately after the response arrives.
   */
  submit: (attempt?: ProviderAttemptHandle) => Promise<TProviderResult>;
  persist: (result: TProviderResult) => Promise<TDurableResult>;
  providerRequestId?: (result: TProviderResult) => string | null | undefined;
  /**
   * Receipt metadata is intentionally explicit.  A paid media boundary must
   * know the resolved model and bounded request limits before it is allowed
   * to submit.  Legacy callers may omit this until their provider-specific
   * adapter is migrated; production paid paths should always provide it.
   */
  receipt?: {
    context: ProviderAttemptContext;
    request: SafeProviderRequest;
    /**
     * Extract only numeric usage and non-secret provider identity from the
     * provider response.  If omitted, the provider adapter must capture
     * through logCostTelemetry while the attempt is active.
     */
    captureResponse?: (
      result: TProviderResult,
      attempt: ProviderAttemptHandle,
    ) => ProviderResponseCapture | Promise<ProviderResponseCapture>;
    _deps?: ProviderAttemptReceiptDependencies;
  };
}

function isAmbiguousSubmissionFailure(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code).toLowerCase()
      : "";
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed") ||
    code === "econnreset" ||
    code === "etimedout"
  );
}

/**
 * Cost-safety boundary for a single physical paid-media submission.
 *
 * submit is invoked exactly once. Once it returns, any persist failure is
 * terminal/non-replayable. An ambiguous submission failure is also terminal.
 * Explicit provider rejections remain ordinary errors so a single designated
 * queue/provider retry owner can apply bounded policy.
 */
export async function executePaidMediaBoundary<TProviderResult, TDurableResult>(
  dependencies: PaidMediaBoundaryDependencies<TProviderResult, TDurableResult>
): Promise<TDurableResult> {
  let providerResult: TProviderResult;
  try {
    if (!dependencies.receipt) {
      // Keep the small boundary usable by adapters that have not yet moved to
      // the receipt contract.  The provider-specific paid paths pass `receipt`
      // below; this branch retains the existing replay-safety behavior while
      // those callers are migrated independently.
      providerResult = await dependencies.submit();
    } else {
      providerResult = await runWithProviderAttempt({
        context: dependencies.receipt.context,
        request: dependencies.receipt.request,
        _deps: dependencies.receipt._deps,
        submit: async (attempt) => {
          const result = await dependencies.submit(attempt);
          if (dependencies.receipt?.captureResponse) {
            await attempt.captureResponse(
              await dependencies.receipt.captureResponse(result, attempt),
            );
          }
          return result;
        },
      });
    }
  } catch (error) {
    if (isNonReplayableProviderError(error)) throw error;
    if (isAmbiguousSubmissionFailure(error)) {
      throw new ProviderSubmissionUncertainError(
        `${dependencies.mediaKind} provider submission outcome is uncertain; refusing automatic replay`,
        error
      );
    }
    throw error;
  }

  try {
    return await dependencies.persist(providerResult);
  } catch (error) {
    if (isNonReplayableProviderError(error)) throw error;
    throw new ProviderResultNotDurableError(
      `${dependencies.mediaKind} provider returned successfully, but durable persistence failed; refusing automatic replay`,
      dependencies.providerRequestId?.(providerResult),
      error
    );
  }
}