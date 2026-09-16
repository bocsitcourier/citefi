/**
 * Brave Search adapter for the durable provider-attempt boundary.
 *
 * Brave does not return token usage.  Its billing unit for this integration is
 * one successful search request, so this adapter captures exactly one request
 * on a successful response.  The query, API key, and query-bearing URL stay
 * inside the submit callback and are never part of receipt request metadata.
 */

import {
  isProviderAttemptTerminalError,
  runWithProviderAttempt,
  type ProviderAttemptContext,
  type ProviderAttemptReceiptDependencies,
  type SafeProviderRequest,
} from "./provider-attempt-receipts";
import { allocateProviderAttemptIdentity } from "./provider-invocation-identity";

export const BRAVE_PROVIDER = "brave" as const;
export const BRAVE_SEARCH_MODEL = "brave-search";

export type BraveAttemptReceiptContext = Omit<
  ProviderAttemptContext,
  "provider" | "model" | "operationType"
> & {
  operationType?: string | null;
};

export interface BraveSearchResponse {
  web?: {
    results?: Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

export type BraveFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface SubmitBraveSearchOptions<TResponse extends BraveSearchResponse = BraveSearchResponse> {
  query: string;
  apiKey: string;
  context: BraveAttemptReceiptContext;
  /** Brave's result count parameter. It is sent to Brave, never persisted. */
  count?: number;
  safesearch?: "off" | "moderate" | "strict";
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: BraveFetch;
  _deps?: ProviderAttemptReceiptDependencies;
}

function safePositiveInteger(value: number | undefined, fallback: number, label: string): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return candidate;
}

function safeTimeout(value: number | undefined): number | undefined {
  if (value == null) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Brave Search timeoutMs must be a positive safe integer");
  }
  return value;
}

function headerValue(response: Response): string | null {
  for (const name of ["x-request-id", "x-brave-request-id", "request-id"]) {
    const value = response.headers.get(name)?.trim();
    if (value) return value;
  }
  return null;
}

function linkedSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (callerSignal == null && timeoutMs == null) {
    return { signal: undefined, cleanup: () => undefined };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  if (callerSignal) {
    onAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) {
      onAbort();
    } else {
      callerSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  if (timeoutMs != null) {
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      if (onAbort && callerSignal) callerSignal.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Search through a single receipt-gated physical Brave request.
 *
 * `_deps` is intentionally exposed for offline adapter tests. Production
 * callers use the durable database/spool implementations selected by the core.
 */
export async function submitBraveSearchWithReceipt<
  TResponse extends BraveSearchResponse = BraveSearchResponse,
>(
  options: SubmitBraveSearchOptions<TResponse>,
): Promise<TResponse> {
  if (!options.query.trim()) throw new Error("Brave Search query is required");
  if (!options.apiKey.trim()) throw new Error("Brave Search API key is required");

  const count = safePositiveInteger(options.count, 10, "Brave Search count");
  if (count > 20) throw new Error("Brave Search count cannot exceed 20");
  const timeoutMs = safeTimeout(options.timeoutMs);
  const operationType = options.context.operationType?.trim();
  if (!operationType) throw new Error("Brave attempt receipt requires an operationType");
  if (!Number.isSafeInteger(options.context.teamId) || options.context.teamId <= 0) {
    throw new Error("Brave attempt receipt requires a validated positive teamId");
  }

  const params = new URLSearchParams({
    q: options.query,
    count: String(count),
  });
  if (options.safesearch) params.set("safesearch", options.safesearch);

  const request: SafeProviderRequest & { maxRequests: number } = {
    model: BRAVE_SEARCH_MODEL,
    maxRequests: 1,
    ...(timeoutMs == null ? {} : { timeoutMs }),
  };
  // Resolve the logical provider-call slot before submitting.  Queue callers
  // get the ambient durable identity, while a direct caller without one gets
  // the core's explicitly non-replayable identity exactly once.
  const providerIdentity = allocateProviderAttemptIdentity({
    invocationKey: options.context.invocationKey,
    attemptKey: options.context.attemptKey,
    provider: BRAVE_PROVIDER,
    operationType,
    model: BRAVE_SEARCH_MODEL,
  });
  const fetchImpl = options.fetchImpl ?? fetch;

  return runWithProviderAttempt<TResponse>({
    context: {
      ...options.context,
      invocationKey: providerIdentity.invocationKey,
      attemptKey: providerIdentity.attemptKey,
      operationType,
      provider: BRAVE_PROVIDER,
      model: BRAVE_SEARCH_MODEL,
    },
    request,
    submit: async ({ captureResponse }) => {
      const startedAt = Date.now();
      const linked = linkedSignal(options.signal, timeoutMs);
      let response: Response | undefined;
      try {
        response = await fetchImpl(
          `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
          {
            headers: {
              Accept: "application/json",
              "X-Subscription-Token": options.apiKey,
            },
            ...(linked.signal ? { signal: linked.signal } : {}),
          },
        );
        const providerRequestId = headerValue(response);
        const metadata = {
          providerRequestId,
          httpStatus: response.status,
          latencyMs: Date.now() - startedAt,
        };
        if (!response.ok) {
          // Keep a safe provider identity even when the response is not a
          // billable success. Usage remains unknown rather than becoming fake
          // token/request usage.
          if (providerRequestId) {
            await captureResponse({
              providerRequestId,
              metadata,
              usage: { unitType: "requests", unitCount: null, known: false },
            });
          }
          throw new Error(`Brave API error: ${response.status}`);
        }

        // A successful HTTP submission is the Brave billing unit even if
        // decoding the response body fails afterward.
        await captureResponse({
          providerRequestId,
          metadata,
          usage: {
            unitType: "requests",
            unitCount: 1,
            known: true,
            raw: { requestCount: 1 },
          },
        });
        return await response.json() as TResponse;
      } catch (error) {
        // Preserve terminal receipt/accounting errors exactly. In particular,
        // never turn an accounting failure into a second physical request.
        if (isProviderAttemptTerminalError(error)) throw error;
        throw error;
      } finally {
        linked.cleanup();
      }
    },
    _deps: options._deps,
  });
}