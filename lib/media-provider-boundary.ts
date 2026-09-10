import {
  isNonReplayableProviderError,
  ProviderResultNotDurableError,
  ProviderSubmissionUncertainError,
} from "./cost-telemetry";

export interface PaidMediaBoundaryDependencies<TProviderResult, TDurableResult> {
  mediaKind: "image" | "video" | "audio";
  submit: () => Promise<TProviderResult>;
  persist: (result: TProviderResult) => Promise<TDurableResult>;
  providerRequestId?: (result: TProviderResult) => string | null | undefined;
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
    providerResult = await dependencies.submit();
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