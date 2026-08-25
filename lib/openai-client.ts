import OpenAI from 'openai';
import Bottleneck from 'bottleneck';
import { randomUUID } from "node:crypto";
import {
  extractOpenAIUsage,
  isProviderAccountingError,
  logFailedProviderAttempt,
  logCostTelemetry,
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

const OPENAI_CONCURRENCY = parseInt(process.env.OPENAI_CONCURRENCY || "15");
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 60000; // 60 seconds - fail faster

if (OPENAI_CONCURRENCY > 50) {
  console.warn(`⚠️  OPENAI_CONCURRENCY=${OPENAI_CONCURRENCY} exceeds safe limit (50). OpenAI may return 429 errors. Recommended: 25-35`);
}

export const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: TIMEOUT_MS,
  maxRetries: 0,
});

// Bottleneck rate limiter for OpenAI with concurrent request limiting
export const openaiLimiter = new Bottleneck({
  maxConcurrent: OPENAI_CONCURRENCY, // Max concurrent requests
  minTime: 50, // Minimum 50ms between requests to prevent burst
});

// Exponential backoff on 429 errors
openaiLimiter.on("failed", async (error, jobInfo) => {
  const isRateLimitError = error?.status === 429 || error?.code === 'rate_limit_exceeded';
  if (isRateLimitError && jobInfo.retryCount < 3) {
    const delay = Math.min(1000 * Math.pow(2, jobInfo.retryCount) + Math.random() * 1000, 10000);
    console.warn(`⚠️  OpenAI rate limit hit, retrying in ${delay}ms (attempt ${jobInfo.retryCount + 1}/3)`);
    return delay;
  }
  return undefined;
});

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
  operationType?: OperationType;
  model?: string;
  usage?: TokenUsage | CharacterUsage | ImageUsage | VideoUsage | RequestUsage;
};

type OpenAIResponseWithUsage = {
  id?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
};

export async function callOpenAI<T>(
  operation: (client: OpenAI) => Promise<T>,
  context: string,
  timeoutMs?: number, // Optional per-operation timeout override
  telemetry: OpenAICallTelemetry = {}
): Promise<T> {
  const effectiveTeamId = resolveTelemetryTeamId(telemetry.teamId);
  if (effectiveTeamId == null) {
    throw new Error("OpenAI request requires a validated teamId");
  }
  // Seam 3 guard: model calls belong in the worker process only.
  if (process.env.WORKER_PROCESS !== "true") {
    console.warn(
      `⚠️ [SEAM3] OpenAI call in web process (WORKER_PROCESS not set): ${context}. ` +
      `This should go through the BullMQ job queue.`
    );
  }
  // This is deliberately created before scheduling, rather than per retry:
  // failures use this stable invocation key plus their attempt number, while a
  // successful OpenAI response uses its provider request id when available.
  const invocationId = `openai-call:${randomUUID()}`;
  const { usage: providedUsage, ...rawTelemetryContext } = telemetry;
  const telemetryContext = { ...rawTelemetryContext, teamId: effectiveTeamId };
  return openaiLimiter.schedule(async () => {
    totalCalls++;
    const startTime = Date.now();
    let lastError: Error | null = null;
    
    // Create client with custom timeout if specified
    const effectiveTimeout = timeoutMs || TIMEOUT_MS;
    const client = timeoutMs && timeoutMs !== TIMEOUT_MS
      ? new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          timeout: timeoutMs,
          maxRetries: 0,
        })
      : openaiClient;
    
    // Log timeout configuration for visibility
    if (timeoutMs && timeoutMs !== TIMEOUT_MS) {
      console.log(`[OpenAI] 🕐 Using extended timeout: ${timeoutMs}ms for ${context}`);
    }
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        const result = await operation(client);
        const response = result as OpenAIResponseWithUsage;
        await logCostTelemetry(
            {
              ...telemetryContext,
              operationType: telemetryContext.operationType ?? "other",
              provider: "openai",
              model: response.model ?? telemetryContext.model ?? "unknown",
              providerRequestId: response.id ?? `${invocationId}:attempt:${attempt}`,
              providerMetadata: {
                ...(telemetryContext.providerMetadata ?? {}),
                context,
                invocationId,
              },
              attempt,
            },
            providedUsage ?? extractOpenAIUsage(response),
            Date.now() - attemptStartedAt,
            true
        );
        const duration = Date.now() - startTime;
        
        if (attempt > 1) {
          console.log(`[OpenAI] ✓ ${context} succeeded on attempt ${attempt} (${duration}ms)`);
        } else if (duration > 30000) {
          // Log slow operations (>30s) for performance monitoring
          console.log(`[OpenAI] ⏱️  ${context} completed in ${duration}ms`);
        }
        
        return result;
      } catch (error: any) {
        if (isProviderAccountingError(error)) throw error;
        lastError = error;
        // An API failure can still be billable.  Keep a separate stable source
        // id for every physical attempt so retry accounting never collapses.
        // Do not treat telemetry failures as provider failures: only wrap the
        // operation above in the retry path.
        await logFailedProviderAttempt(
            {
              ...telemetryContext,
              operationType: telemetryContext.operationType ?? "other",
              provider: "openai",
              model: telemetryContext.model ?? "unknown",
              providerRequestId: `${invocationId}:attempt:${attempt}`,
              providerMetadata: {
                ...(telemetryContext.providerMetadata ?? {}),
                context,
                invocationId,
                errorCode: error?.code ?? null,
              },
              attempt,
            },
            providedUsage && "characters" in providedUsage
              ? { characters: 0 }
              : providedUsage && "imageCount" in providedUsage
                ? { imageCount: 0 }
                : providedUsage && "videoSeconds" in providedUsage
                  ? { videoSeconds: 0 }
                  : providedUsage && "requestCount" in providedUsage
                    ? { requestCount: 0 }
                    : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            Date.now() - attemptStartedAt,
            error
          );
        const isRateLimit = error?.status === 429 || error?.code === 'rate_limit_exceeded';
        const isTimeout = error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout');
        
        if (attempt < MAX_RETRIES && (isRateLimit || isTimeout)) {
          totalRetries++;
          const jitter = Math.random() * 1000;
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + jitter;
          
          console.warn(
            `[OpenAI] ⚠️  ${context} failed (attempt ${attempt}/${MAX_RETRIES}): ${error?.message || error}. Retrying in ${Math.round(delay)}ms...`
          );
          
          if (attempt > 2) {
            console.warn(`[OpenAI] 🔔 High retry count for ${context} - investigate rate limits`);
          }
          
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
    
    totalFailures++;
    console.error(`[OpenAI] ❌ ${context} failed after ${MAX_RETRIES} attempts:`, lastError);
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
