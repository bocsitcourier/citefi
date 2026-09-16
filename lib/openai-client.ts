import OpenAI from 'openai';
import Bottleneck from 'bottleneck';
import {
  isProviderAccountingError,
  ProviderSubmissionUncertainError,
  resolveTelemetryTeamId,
} from "./cost-telemetry";
import type {
  CharacterUsage,
  ImageUsage,
  OperationType,
  RequestUsage,
  TelemetryContext,
  TokenUsage,
  VideoUsage,
} from "./cost-telemetry";
import {
  currentProviderAttempt,
  isProviderAttemptTerminalError,
  providerAttemptUsageFromTelemetry,
  runWithProviderAttempt,
} from "./provider-attempt-receipts";
import type {
  ProviderAttemptReceiptDependencies,
  SafeProviderRequest,
} from "./provider-attempt-receipts";
import { allocateProviderAttemptIdentity } from "./provider-invocation-identity";

const OPENAI_CONCURRENCY = parseInt(process.env.OPENAI_CONCURRENCY || "15");
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 60000; // 60 seconds - fail faster

if (OPENAI_CONCURRENCY > 50) {
  console.warn(`⚠️  OPENAI_CONCURRENCY=${OPENAI_CONCURRENCY} exceeds safe limit (50). OpenAI may return 429 errors. Recommended: 25-35`);
}

// Bottleneck rate limiter for OpenAI with concurrent request limiting
export const openaiLimiter = new Bottleneck({
  maxConcurrent: OPENAI_CONCURRENCY, // Max concurrent requests
  minTime: 50, // Minimum 50ms between requests to prevent burst
});

// Retry ownership lives in callOpenAI below. Bottleneck is concurrency/rate
// scheduling only; a failed-listener retry here would multiply each manual
// attempt into four physical submissions.

console.log(`🔧 OpenAI rate limiter initialized: ${OPENAI_CONCURRENCY} concurrent requests with Bottleneck`);

let totalCalls = 0;
let totalRetries = 0;
let totalFailures = 0;

export function getOpenAIStats() {
  const counts = openaiLimiter.counts();
  return {
    totalCalls,
    totalRetries,
    totalFailures,
    queueSize: counts.QUEUED || 0,
    activeCount: counts.RUNNING || 0,
  };
}

/**
 * Accounting data for an OpenAI invocation.  Supplying this is optional for
 * legacy callers, but all requests are accounted for by callOpenAI itself so
 * callers must not additionally log a completion.
 */
export type OpenAICallTelemetry = Omit<
  TelemetryContext,
  "operationType" | "provider" | "model" | "providerRequestId" | "attempt"
> & {
  /** Stable logical invocation supplied by a queue/job idempotency boundary. */
  invocationKey?: string | null;
  operationType?: OperationType;
  model?: string;
  usage?: TokenUsage | CharacterUsage | ImageUsage | VideoUsage | RequestUsage;
  /**
   * The exact bounded request controls sent to the SDK.  This is deliberately
   * separate from providerMetadata: receipt preparation happens before the SDK
   * callback is invoked and must not infer limits from a response or a cost
   * estimate.
   */
  request?: Omit<SafeProviderRequest, "model" | "timeoutMs"> & {
    model: string;
  };
};

type OpenAIResponseWithUsage = {
  id?: string;
  _request_id?: string;
  headers?: Pick<Headers, "get">;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      audio_tokens?: number;
    } | null;
    completion_tokens_details?: {
      reasoning_tokens?: number;
      audio_tokens?: number;
      accepted_prediction_tokens?: number;
      rejected_prediction_tokens?: number;
    } | null;
  } | null;
  choices?: Array<{ finish_reason?: string | null }>;
};

/**
 * The SDK response usage is the only token usage source accepted for OpenAI
 * text requests.  A missing usage block is represented explicitly as unknown;
 * null counts are retained as unknown and are never sent to the ledger because
 * `known` is false.
 */
function captureOpenAIResponse(
  result: unknown,
  providedUsage: OpenAICallTelemetry["usage"],
  latencyMs: number,
) {
  const response = result as OpenAIResponseWithUsage;
  const usage = response.usage;
  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;
  const totalTokens = usage?.total_tokens;
  const hasNumericUsage =
    typeof promptTokens === "number" &&
    Number.isSafeInteger(promptTokens) &&
    promptTokens >= 0 &&
    typeof completionTokens === "number" &&
    Number.isSafeInteger(completionTokens) &&
    completionTokens >= 0 &&
    typeof totalTokens === "number" &&
    Number.isSafeInteger(totalTokens) &&
    totalTokens >= 0;
  const numericUsage = hasNumericUsage
    ? {
        unitType: "tokens",
        unitCount: totalTokens as number,
        inputUnits: promptTokens as number,
        outputUnits: completionTokens as number,
        known: true as const,
        raw: {
          // Receipt-core keeps raw usage scalar-only; these prefixed keys retain
          // the provider's nested token-detail fields without persisting payload.
          prompt_tokens: promptTokens as number,
          completion_tokens: completionTokens as number,
          total_tokens: totalTokens as number,
          ...(safeUsageNumber(usage?.prompt_tokens_details?.cached_tokens)
            ? { prompt_cached_tokens: usage.prompt_tokens_details!.cached_tokens as number }
            : {}),
          ...(safeUsageNumber(usage?.prompt_tokens_details?.audio_tokens)
            ? { prompt_audio_tokens: usage.prompt_tokens_details!.audio_tokens as number }
            : {}),
          ...(safeUsageNumber(usage?.completion_tokens_details?.reasoning_tokens)
            ? { completion_reasoning_tokens: usage.completion_tokens_details!.reasoning_tokens as number }
            : {}),
          ...(safeUsageNumber(usage?.completion_tokens_details?.audio_tokens)
            ? { completion_audio_tokens: usage.completion_tokens_details!.audio_tokens as number }
            : {}),
          ...(safeUsageNumber(usage?.completion_tokens_details?.accepted_prediction_tokens)
            ? { completion_accepted_prediction_tokens: usage.completion_tokens_details!.accepted_prediction_tokens as number }
            : {}),
          ...(safeUsageNumber(usage?.completion_tokens_details?.rejected_prediction_tokens)
            ? { completion_rejected_prediction_tokens: usage.completion_tokens_details!.rejected_prediction_tokens as number }
            : {}),
        },
      }
    : null;

  // TTS has no token usage object. Its character count is an exact request
  // billing unit supplied by the TTS callsite, not a token/cost estimate.
  // Other missing SDK usage remains explicitly unknown.
  const responseUsage = numericUsage ??
    (providedUsage && "characters" in providedUsage
      ? providerAttemptUsageFromTelemetry(providedUsage)
      : {
          unitType: "tokens",
          unitCount: null,
          inputUnits: null,
          outputUnits: null,
          known: false,
        });
  const providerRequestId = response._request_id ??
    response.headers?.get("x-request-id") ?? response.id ?? null;

  return {
    providerRequestId,
    usage: responseUsage,
    metadata: {
      providerRequestId,
      actualModel: response.model ?? null,
      finishReason: response.choices?.[0]?.finish_reason ?? null,
      latencyMs,
    },
  };
}

function safeUsageNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isReceiptTerminalError(error: unknown): boolean {
  return isProviderAttemptTerminalError(error);
}

function requestMetadataMismatch(message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = "OPENAI_REQUEST_METADATA_MISMATCH";
  return error;
}

function isRequestMetadataMismatch(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth++) {
    if (
      current &&
      typeof current === "object" &&
      (current as { code?: unknown }).code === "OPENAI_REQUEST_METADATA_MISMATCH"
    ) {
      return true;
    }
    current = current && typeof current === "object"
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return false;
}

/**
 * Validate the actual JSON sent by the OpenAI SDK against the request receipt
 * prepared before submission. Only allow-listed scalar fields are inspected;
 * prompt/content fields are never copied, logged, or persisted here.
 */
const receiptAwareFetch: typeof fetch = async (input, init) => {
  const current = currentProviderAttempt();
  if (current && typeof init?.body === "string") {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      // The SDK will report malformed request bodies itself.
    }
    const expected = current.receipt.requestMetadata;
    if (body.model !== expected.model) {
      throw requestMetadataMismatch(
        "OpenAI SDK request model did not match prepared receipt metadata",
      );
    }
    const actualMaxOutput = body.max_tokens ?? body.max_completion_tokens;
    const expectedMaxOutput = expected.maxOutputTokens ?? null;
    if (
      (typeof actualMaxOutput === "number" ? actualMaxOutput : null) !==
      expectedMaxOutput
    ) {
      throw requestMetadataMismatch(
        "OpenAI SDK output limit did not match prepared receipt metadata",
      );
    }
    const expectedMaxCharacters = expected.maxCharacters ?? null;
    if (expectedMaxCharacters != null) {
      const actualInput = body.input;
      if (
        typeof actualInput !== "string" ||
        actualInput.length !== expectedMaxCharacters
      ) {
        throw requestMetadataMismatch(
          "OpenAI SDK TTS input length did not match prepared receipt metadata",
        );
      }
    }
  }
  return fetch(input, init);
};

export const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: TIMEOUT_MS,
  maxRetries: 0,
  fetch: receiptAwareFetch,
});

export async function callOpenAI<T>(
  operation: (client: OpenAI) => Promise<T>,
  context: string,
  timeoutMs?: number, // Optional per-operation timeout override
  telemetry: OpenAICallTelemetry = {},
  _deps: {
    /**
     * Retained as a type-compatible test seam for older callers. Receipt-core
     * is now authoritative, so these legacy hooks are intentionally ignored.
     */
    logSuccess?: unknown;
    logFailure?: unknown;
    sleep?: (milliseconds: number) => Promise<void>;
    /**
     * Receipt dependencies are injectable for deterministic adapter tests.
     * Production uses the receipt-core database/spool defaults.
     */
    receipt?: ProviderAttemptReceiptDependencies;
  } = {}
): Promise<T> {
  const effectiveTeamId = resolveTelemetryTeamId(telemetry.teamId);
  if (effectiveTeamId == null) {
    throw new Error("OpenAI request requires a validated teamId");
  }
  // Seam 3 guard: model calls belong in the worker process only.
  if (process.env.WORKER_PROCESS !== "true") {
    console.warn(
      `⚠️ [SEAM3] OpenAI call in web process (WORKER_PROCESS not set); ` +
      `operation=${telemetry.operationType ?? "other"}.`
    );
  }
  // This is deliberately allocated before scheduling, rather than per retry:
  // failures reuse this logical slot while their explicit attempt number
  // distinguishes each physical 429 submission.
  const { usage: providedUsage, request: requestedMetadata, ...rawTelemetryContext } = telemetry;
  const telemetryContext = { ...rawTelemetryContext, teamId: effectiveTeamId };
  const effectiveTimeout = timeoutMs || TIMEOUT_MS;
  const requestMetadata = requestedMetadata;
  if (!requestMetadata) {
    throw new Error(
      "OpenAI request metadata is required before physical submission",
    );
  }
  const model = requestMetadata.model;
  const exactCharacterBound =
    providedUsage && "characters" in providedUsage
      ? providedUsage.characters
      : undefined;

  const providerIdentity = allocateProviderAttemptIdentity({
    invocationKey: telemetryContext.invocationKey,
    attemptKey: requestMetadata.requestKey,
    provider: "openai",
    operationType: telemetryContext.operationType ?? "other",
    model,
  });

  return openaiLimiter.schedule(async () => {
    totalCalls++;
    const startTime = Date.now();
    let lastError: Error | null = null;
    
    // Create client with custom timeout if specified
    const client = timeoutMs && timeoutMs !== TIMEOUT_MS
      ? new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          timeout: timeoutMs,
          maxRetries: 0,
          fetch: receiptAwareFetch,
        })
      : openaiClient;
    
    // Log timeout configuration for visibility
    if (timeoutMs && timeoutMs !== TIMEOUT_MS) {
      console.log(`[OpenAI] 🕐 Using extended timeout: ${timeoutMs}ms`);
    }
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        const result = await runWithProviderAttempt({
          context: {
            teamId: effectiveTeamId,
            userId: telemetryContext.userId,
            campaignId: telemetryContext.campaignId,
            runId: telemetryContext.runId,
            jobId: telemetryContext.jobId,
            resourceType: telemetryContext.resourceType,
            resourceId: telemetryContext.resourceId,
            contentId: telemetryContext.articleId,
            operationType: telemetryContext.operationType ?? "other",
            provider: "openai",
            model,
            attempt,
            invocationKey: providerIdentity.invocationKey,
            attemptKey: providerIdentity.attemptKey,
          },
          request: {
            ...requestMetadata,
            model,
            timeoutMs: effectiveTimeout,
            maxCharacters: requestMetadata.maxCharacters ?? exactCharacterBound ?? null,
            adapterVersion: requestMetadata.adapterVersion ?? "openai-client/receipt-v1",
          },
          submit: async ({ captureResponse }) => {
            const response = await operation(client);
            await captureResponse(
              captureOpenAIResponse(response, providedUsage, Date.now() - attemptStartedAt),
            );
            return response;
          },
          _deps: _deps.receipt,
        });
        const duration = Date.now() - startTime;
        
        if (attempt > 1) {
          console.log(`[OpenAI] ✓ request succeeded on attempt ${attempt} (${duration}ms)`);
        } else if (duration > 30000) {
          // Log slow operations (>30s) for performance monitoring
          console.log(`[OpenAI] ⏱️  request completed in ${duration}ms`);
        }
        
        return result;
      } catch (error: any) {
        // Receipt-core failures are terminal. In particular, a response that
        // was paid but could not be captured/accounted must never enter this
        // retry loop.
        if (
          isProviderAccountingError(error) ||
          isReceiptTerminalError(error) ||
          isRequestMetadataMismatch(error)
        ) {
          throw error;
        }
        lastError = error;
        const isRateLimit = error?.status === 429 || error?.code === 'rate_limit_exceeded';
        const isTimeout = error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout');
        
        // A timeout is ambiguous: OpenAI may have completed (and billed) the
        // request after our socket stopped waiting. Never physically resubmit
        // an ambiguous request. Explicit 429 responses are safe to retry.
        if (isTimeout) {
          throw new ProviderSubmissionUncertainError(
            "OpenAI submission outcome is uncertain; refusing automatic replay",
            error
          );
        }

        if (attempt < MAX_RETRIES && isRateLimit) {
          totalRetries++;
          const jitter = Math.random() * 1000;
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
          
          console.warn(
            `[OpenAI] ⚠️ request rejected (attempt ${attempt}/${MAX_RETRIES}, ` +
            `status=${error?.status ?? error?.code ?? "unknown"}). ` +
            `Retrying in ${Math.round(delay)}ms...`
          );
          
          if (attempt > 2) {
            console.warn(`[OpenAI] 🔔 High retry count for OpenAI request - investigate rate limits`);
          }
          
          await (_deps.sleep ?? ((milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))))(delay);
        } else {
          break;
        }
      }
    }
    
    totalFailures++;
    console.error(
      `[OpenAI] ❌ request failed after ${MAX_RETRIES} attempts ` +
      `(status=${(lastError as any)?.status ?? (lastError as any)?.code ?? "unknown"})`,
    );
    throw lastError;
  });
}

const openAIStatsTimer = setInterval(() => {
  if (totalCalls > 0) {
    const stats = getOpenAIStats();
    console.log(
      `[OpenAI Stats] Calls: ${totalCalls}, Retries: ${totalRetries}, Failures: ${totalFailures}, ` +
      `Queue: ${stats.queueSize}, Active: ${stats.activeCount}`
    );
  }
}, 60000);
openAIStatsTimer.unref();

/** Stop limiter-owned resources so test and worker processes can exit cleanly. */
export async function closeOpenAIClient(): Promise<void> {
  clearInterval(openAIStatsTimer);
  await openaiLimiter.stop({
    dropWaitingJobs: true,
    dropErrorMessage: "OpenAI rate limiter is shutting down",
  });
}
