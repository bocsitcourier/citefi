/**
 * Gemini's adapter for the durable provider-attempt boundary.
 *
 * The receipt table, spool and ledger reconciliation belong to
 * provider-attempt-receipts.ts.  This file is intentionally limited to
 * translating Gemini's request/response shape into that core contract.
 */

import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import {
  runWithProviderAttempt,
  registerProviderAttemptResponse,
  type KnownProviderUsage,
  type ProviderAttemptContext,
  type ProviderAttemptReceiptDependencies,
  type SafeProviderRequest,
} from "./provider-attempt-receipts";
import { allocateProviderAttemptIdentity } from "./provider-invocation-identity";

export const GEMINI_PROVIDER = "gemini" as const;

export type GeminiAttemptUsage = {
  [key: string]: number | undefined;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
};

export type GeminiRequestLimits = {
  maxOutputTokens?: number;
  maxInputTokens?: number;
  candidateCount?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  seed?: number;
  responseMimeType?: string;
  responseModalities?: string[];
  imageAspectRatio?: string;
  imageSize?: string;
  thinkingBudget?: number;
  thinkingLevel?: string;
};

export type GeminiAttemptReceiptContext = Omit<
  ProviderAttemptContext,
  "provider" | "model" | "operationType"
> & {
  operationType?: string | null;
  /** Legacy Gemini caller aliases normalized to the core context below. */
  articleId?: number | null;
  batchId?: number | null;
  /** A resolved model is required and is supplied by the request. */
};

export type GeminiGenerateRequest = GenerateContentParameters;

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : undefined;
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Extract bounded request limits only. Never serialize contents, tools,
 * response schemas, system instructions, or arbitrary config values.
 */
export function extractGeminiRequestLimits(
  config: GenerateContentParameters["config"] | undefined,
): GeminiRequestLimits {
  if (!config) return {};
  const limits: GeminiRequestLimits = {};
  const maxOutputTokens = safeNonNegativeInteger(config.maxOutputTokens);
  const maxInputTokens = safeNonNegativeInteger(
    (config as unknown as { maxInputTokens?: unknown }).maxInputTokens,
  );
  const candidateCount = safeNonNegativeInteger(config.candidateCount);
  const temperature = safeNonNegativeNumber(config.temperature);
  const topP = safeNonNegativeNumber(config.topP);
  const topK = safeNonNegativeInteger(config.topK);
  const seed = safeNonNegativeInteger(config.seed);
  const responseMimeType = safeString(config.responseMimeType);
  const responseModalities = Array.isArray(config.responseModalities)
    ? config.responseModalities
      .filter((value): value is string => typeof value === "string")
      .slice(0, 8)
    : undefined;
  const imageConfig = config.imageConfig as
    | { aspectRatio?: unknown; imageSize?: unknown }
    | undefined;
  const imageAspectRatio = safeString(imageConfig?.aspectRatio);
  const imageSize = safeString(imageConfig?.imageSize);
  const thinkingConfig = (config as unknown as { thinkingConfig?: unknown }).thinkingConfig as
    | { thinkingBudget?: unknown; thinkingLevel?: unknown }
    | undefined;
  const thinkingBudget = safeNonNegativeInteger(thinkingConfig?.thinkingBudget);
  const thinkingLevel = safeString(thinkingConfig?.thinkingLevel);

  if (maxOutputTokens !== undefined) limits.maxOutputTokens = maxOutputTokens;
  if (maxInputTokens !== undefined) limits.maxInputTokens = maxInputTokens;
  if (candidateCount !== undefined) limits.candidateCount = candidateCount;
  if (temperature !== undefined) limits.temperature = temperature;
  if (topP !== undefined) limits.topP = topP;
  if (topK !== undefined) limits.topK = topK;
  if (seed !== undefined) limits.seed = seed;
  if (responseMimeType !== undefined) limits.responseMimeType = responseMimeType;
  if (responseModalities?.length) limits.responseModalities = responseModalities;
  if (imageAspectRatio !== undefined) limits.imageAspectRatio = imageAspectRatio;
  if (imageSize !== undefined) limits.imageSize = imageSize;
  if (thinkingBudget !== undefined) limits.thinkingBudget = thinkingBudget;
  if (thinkingLevel !== undefined) limits.thinkingLevel = thinkingLevel;
  return limits;
}

function numericUsageValue(value: unknown): number | undefined {
  return safeNonNegativeInteger(value);
}

export type NormalizedGeminiTokenUsage = {
  inputUnits?: number;
  outputUnits?: number;
  unitCount?: number;
  known: boolean;
};

/**
 * Prefer Gemini's internally consistent aggregate (total minus prompt), which
 * already includes thinking. Without that aggregate, require a complete valid
 * prompt/candidate/thinking split before accounting the response.
 */
export function normalizeGeminiTokenUsage(
  metadata: Record<string, unknown> | null | undefined,
): NormalizedGeminiTokenUsage {
  if (!metadata) return { known: false };
  const hasPrompt = Object.prototype.hasOwnProperty.call(metadata, "promptTokenCount");
  const hasTotal = Object.prototype.hasOwnProperty.call(metadata, "totalTokenCount");
  const hasCandidates = Object.prototype.hasOwnProperty.call(metadata, "candidatesTokenCount");
  const hasThoughts = Object.prototype.hasOwnProperty.call(metadata, "thoughtsTokenCount");
  const candidates = numericUsageValue(metadata?.candidatesTokenCount);
  const thoughts = numericUsageValue(metadata?.thoughtsTokenCount);
  const prompt = numericUsageValue(metadata?.promptTokenCount);
  const total = numericUsageValue(metadata?.totalTokenCount);

  // A supplied-but-invalid aggregate or prompt cannot be replaced with a
  // guessed split. A total without its input count is not billable evidence.
  if ((hasPrompt && prompt === undefined) || (hasTotal && total === undefined)) {
    return { known: false };
  }
  if (hasTotal) {
    if (prompt === undefined || total === undefined || total < prompt) {
      return { known: false };
    }
    const outputUnits = total - prompt;
    if (
      (candidates !== undefined && candidates > outputUnits) ||
      (thoughts !== undefined && thoughts > outputUnits)
    ) {
      return { known: false };
    }
    return { inputUnits: prompt, outputUnits, unitCount: total, known: true };
  }

  // In the absence of Gemini's aggregate, only use an explicit, complete
  // native split. Missing/invalid thinking is not equivalent to zero.
  if (
    !hasPrompt ||
    !hasCandidates ||
    !hasThoughts ||
    prompt === undefined ||
    candidates === undefined ||
    thoughts === undefined
  ) {
    return { known: false };
  }
  const outputUnits = candidates + thoughts;
  const unitCount = prompt + outputUnits;
  if (!Number.isSafeInteger(outputUnits) || !Number.isSafeInteger(unitCount)) {
    return { known: false };
  }
  return { inputUnits: prompt, outputUnits, unitCount, known: true };
}

/**
 * Preserve every numeric Gemini usage field without filling omitted fields
 * with zero. The raw object is stored in the receipt JSON by core.
 */
export function extractRawGeminiUsage(
  response: Pick<GenerateContentResponse, "usageMetadata"> | null | undefined,
): { usage: GeminiAttemptUsage; usageKnown: boolean } {
  const metadata = response?.usageMetadata as
    | Record<string, unknown>
    | undefined;
  if (!metadata) return { usage: {}, usageKnown: false };

  const usage: GeminiAttemptUsage = {};
  for (const [name, rawValue] of Object.entries(metadata)) {
    const value = numericUsageValue(rawValue);
    if (value !== undefined) usage[name] = value;
  }
  // Partial or inconsistent blocks remain persisted as raw evidence but are
  // not reconciled as billable usage.
  return {
    usage,
    usageKnown: normalizeGeminiTokenUsage(metadata).known,
  };
}

function toKnownProviderUsage(
  extracted: ReturnType<typeof extractRawGeminiUsage>,
  response: GenerateContentResponse,
  limits: GeminiRequestLimits,
): KnownProviderUsage {
  const { usage, usageKnown } = extracted;
  const normalized = normalizeGeminiTokenUsage(
    response.usageMetadata as Record<string, unknown> | undefined,
  );
  const imageRequested = limits.responseModalities?.some(
    (value) => value.toLowerCase() === "image",
  ) === true;
  const imageCount = imageRequested
    ? (((response as unknown as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: unknown } }> } }>;
      }).candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => typeof part.inlineData?.data === "string" && part.inlineData.data.length > 0)
      .length)
    : 0;
  return {
    unitType: imageRequested ? "images" : "tokens",
    unitCount: imageRequested ? imageCount : normalized.unitCount ?? null,
    inputUnits: imageRequested ? usage.promptTokenCount ?? null : normalized.inputUnits ?? null,
    outputUnits: imageRequested ? usage.candidatesTokenCount ?? null : normalized.outputUnits ?? null,
    known: imageRequested ? true : usageKnown && normalized.known,
    raw: Object.fromEntries(
      Object.entries(usage).filter(([, value]) => value !== undefined),
    ) as Record<string, number>,
  };
}

function toSafeRequest(
  request: GenerateContentParameters,
  limits: GeminiRequestLimits,
): SafeProviderRequest {
  const safe: SafeProviderRequest = {
    model: request.model,
    adapterVersion: "google-genai@1.27.0",
  };
  if (limits.maxOutputTokens !== undefined) safe.maxOutputTokens = limits.maxOutputTokens;
  if (limits.maxInputTokens !== undefined) safe.maxInputTokens = limits.maxInputTokens;
  if (limits.candidateCount !== undefined) safe.candidateCount = limits.candidateCount;
  if (limits.temperature !== undefined) safe.temperature = limits.temperature;
  if (limits.topP !== undefined) safe.topP = limits.topP;
  if (limits.topK !== undefined) safe.topK = limits.topK;
  if (limits.seed !== undefined) safe.seed = limits.seed;
  if (limits.responseMimeType !== undefined) safe.responseMimeType = limits.responseMimeType;
  if (limits.responseModalities !== undefined) safe.responseModalities = limits.responseModalities;
  if (limits.imageAspectRatio !== undefined) safe.imageAspectRatio = limits.imageAspectRatio;
  if (limits.imageSize !== undefined) safe.imageSize = limits.imageSize;
  if (limits.thinkingBudget !== undefined) safe.thinkingBudget = limits.thinkingBudget;
  if (limits.thinkingLevel !== undefined) safe.thinkingLevel = limits.thinkingLevel;
  if (limits.responseModalities?.some((value) => value.toLowerCase() === "image")) {
    safe.maxImages = 1;
  }
  return safe;
}

export async function submitGeminiWithReceipt<TResponse extends GenerateContentResponse>(
  request: GenerateContentParameters,
  context: GeminiAttemptReceiptContext,
  call: () => Promise<TResponse>,
  _deps?: ProviderAttemptReceiptDependencies,
): Promise<TResponse> {
  if (!Number.isSafeInteger(context.teamId) || context.teamId <= 0) {
    throw new Error("Gemini attempt receipt requires a validated positive teamId");
  }
  if (!safeString(request.model)) {
    throw new Error("Gemini attempt receipt requires a resolved model");
  }
  const operationType = context.operationType?.trim();
  if (!operationType) {
    throw new Error("Gemini attempt receipt requires an operationType");
  }

  const limits = extractGeminiRequestLimits(request.config);
  // Allocate the logical call slot once.  In a worker this is derived from the
  // ambient queue invocation; outside a worker the identity helper creates a
  // deliberately non-replayable direct-call identity.  In either case the
  // returned pair must be reused by every physical attempt.
  const providerIdentity = allocateProviderAttemptIdentity({
    invocationKey: context.invocationKey,
    attemptKey: context.attemptKey,
    provider: GEMINI_PROVIDER,
    operationType,
    model: request.model,
  });
  return runWithProviderAttempt({
    context: {
      ...context,
      invocationKey: providerIdentity.invocationKey,
      attemptKey: providerIdentity.attemptKey,
      contentId: context.contentId ?? context.articleId ?? null,
      resourceType: context.resourceType ?? (
        context.articleId != null ? "article" :
          context.batchId != null ? "batch" : null
      ),
      resourceId: context.resourceId ?? context.articleId ?? context.batchId ?? null,
      operationType,
      provider: GEMINI_PROVIDER,
      model: request.model,
    },
    request: toSafeRequest(request, limits),
    submit: async ({ captureResponse, receipt }) => {
      const response = await call();
      const extracted = extractRawGeminiUsage(response);
      await captureResponse({
        providerRequestId: safeString(response.responseId) ?? null,
          usage: toKnownProviderUsage(extracted, response, limits),
        metadata: {
          providerRequestId: safeString(response.responseId) ?? null,
          actualModel: safeString(response.modelVersion) ?? null,
        },
      });
      registerProviderAttemptResponse(response, receipt.sourceEventId);
      return response;
    },
    _deps,
  });
}
