import { BILLING_PLANS } from "@/lib/billing/plans";
import { CREDIT_MENU } from "@/lib/credit-menu";

import { db } from "./db";
import { costTelemetry } from "@/shared/schema";
import { getDatabaseExecutionContext } from "./tenant-context";

// ============================================================================
// PRICING MAP — cost per million tokens (or per unit) in USD
// Stored as microUSD internally to avoid floating-point drift.
// 1 USD = 1,000,000 microUSD
// ============================================================================

const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  // ── Gemini 3.x family (verified in ListModels 2026-08) ───────────────────
  "gemini-3.6-flash":               { input: 0.30,  output: 2.50  },
  "gemini-3.5-flash":               { input: 0.30,  output: 2.50  },
  "gemini-3.5-flash-lite":          { input: 0.10,  output: 0.40  },
  "gemini-3.1-pro-preview":         { input: 1.25,  output: 10.00 },
  "gemini-3.1-flash-lite":          { input: 0.10,  output: 0.40  },
  "gemini-3-flash-preview":         { input: 0.30,  output: 2.50  },
  // ── Gemini image models ──────────────────────────────────────────────────
  "gemini-3.1-flash-image":         { input: 0.30,  output: 2.50  },
  "gemini-3.1-flash-lite-image":    { input: 0.10,  output: 0.40  },
  "gemini-3-pro-image":             { input: 1.25,  output: 10.00 },
  "gemini-2.5-flash-image":         { input: 0.30,  output: 2.50  },
  // ── Gemini 2.5 family ────────────────────────────────────────────────────
  "gemini-2.5-flash":               { input: 0.30,  output: 2.50  },
  "gemini-2.5-flash-preview":       { input: 0.15,  output: 3.50  },
  "gemini-2.5-flash-preview-04-17": { input: 0.15,  output: 3.50  },
  "gemini-2.5-flash-lite":          { input: 0.10,  output: 0.40  },
  "gemini-2.5-pro":                 { input: 1.25,  output: 10.00 },
  // ── Veo video models ─────────────────────────────────────────────────────
  "veo-3.1-generate-preview":       { input: 0.00,  output: 0.35  }, // per second of video
  "veo-3.1-fast-generate-preview":  { input: 0.00,  output: 0.18  },
  "veo-3.1-lite-generate-preview":  { input: 0.00,  output: 0.09  },
  // ── OpenAI models (verified in /v1/models 2026-08) ───────────────────────
  "gpt-4.1-mini":                   { input: 0.40,  output: 1.60  }, // current cost-effective tier
  "gpt-4.1-mini-2025-04-14":        { input: 0.40,  output: 1.60  },
  "gpt-4.1":                        { input: 2.00,  output: 8.00  }, // current standard tier
  "gpt-4.1-2025-04-14":             { input: 2.00,  output: 8.00  },
  "gpt-4o-mini":                    { input: 0.15,  output: 0.60  }, // kept for legacy telemetry rows
  "gpt-4o-mini-tts":                { input: 0.00,  output: 0.00  }, // TTS billed by chars
  "gpt-4o":                         { input: 5.00,  output: 15.00 },
  "chatgpt-4o-latest":              { input: 5.00,  output: 15.00 },
  "gpt-4":                          { input: 30.00, output: 60.00 },
  "gpt-4-turbo":                    { input: 10.00, output: 30.00 },
};

// TTS: $15 per 1M characters
const TTS_PRICE_PER_MILLION_CHARS = 15.00;

// Image generation: flat rate per image (DALL-E 3 standard 1024×1024)
const IMAGE_PRICE_USD = 0.04;
export const PROVIDER_RATE_CARD_VERSION = "2026-08-22";

export type OperationType =
  | "article_title_pool"
  | "article_generation"
  | "article_review"
  | "article_hyperlink"
  | "article_critique"
  | "social_post"
  | "veo_clip"
  | "video_script"
  | "video_idea"
  | "podcast_script"
  | "podcast_tts"
  | "video_tts"
  | "image_generation"
  | "topic_research"
  | "seo_analysis"
  | "other";

export interface TelemetryContext {
  operationType: OperationType;
  provider: "gemini" | "openai";
  model: string;
  teamId?: number | null;
  userId?: number | null;
  batchId?: number | null;
  articleId?: number | null;
  jobId?: string | null;
}

export function resolveTelemetryTeamId(
  requestedTeamId?: number | null
): number | null {
  const execution = getDatabaseExecutionContext();
  if (execution?.scope === "tenant") {
    if (
      requestedTeamId != null &&
      requestedTeamId !== execution.teamId
    ) {
      throw new Error(
        `Cost telemetry teamId ${requestedTeamId} does not match the validated tenant ${execution.teamId}`
      );
    }
    return execution.teamId;
  }

  if (requestedTeamId == null) return null;
  if (!Number.isInteger(requestedTeamId) || requestedTeamId <= 0) {
    throw new Error("Cost telemetry teamId must be a positive integer");
  }
  return requestedTeamId;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface CharacterUsage {
  characters: number;
}

export interface ImageUsage {
  imageCount: number;
}

export interface VideoUsage {
  videoSeconds: number;
}

const FIXED_PRICE_OPERATIONS = new Set<OperationType>([
  "podcast_tts",
  "video_tts",
  "image_generation",
]);

function lookupModelPrice(model: string): { input: number; output: number } | null {
  const normalizedModel = model.toLowerCase().replace(/-\d{8}$/, "");
  return PRICE_PER_MILLION[normalizedModel] ?? PRICE_PER_MILLION[model] ?? null;
}

/**
 * Returns whether a telemetry event can be valued by the locked rate card.
 * Unknown models may still be logged with a zero placeholder, but they must
 * block margin certification rather than being treated as free.
 */
export function hasKnownProviderRate(operationType: string, model: string): boolean {
  if (FIXED_PRICE_OPERATIONS.has(operationType as OperationType)) return true;
  return lookupModelPrice(model) !== null;
}

export interface MarginCertificationInput {
  composition: ReadonlyArray<{ op: string; weight: number }>;
  p90CostMicrousdByOperation: Readonly<Record<string, number>>;
  successfulSamplesByOperation: Readonly<Record<string, number>>;
  unpricedModelsByOperation: Readonly<Record<string, readonly string[]>>;
  minimumSuccessfulSamples: number;
  invoiceReconciliationRecorded: boolean;
}

export interface MarginCertificationEvaluation {
  p90CostMicrousd: number;
  missingOperations: string[];
  insufficientSampleOperations: string[];
  unpricedModels: string[];
  blockers: string[];
  certificationReady: boolean;
}

export function evaluateMarginCertification(
  input: MarginCertificationInput
): MarginCertificationEvaluation {
  const missingOperations = input.composition
    .filter(({ op }) => input.p90CostMicrousdByOperation[op] == null)
    .map(({ op }) => op);
  const insufficientSampleOperations = input.composition
    .filter(({ op }) => (input.successfulSamplesByOperation[op] ?? 0) < input.minimumSuccessfulSamples)
    .map(({ op }) => op);
  const unpricedModels = input.composition.flatMap(
    ({ op }) => input.unpricedModelsByOperation[op] ?? []
  );
  const p90CostMicrousd = input.composition.reduce(
    (sum, { op, weight }) => sum + (input.p90CostMicrousdByOperation[op] ?? 0) * weight,
    0
  );
  const blockers = [
    ...missingOperations.map((op) => `missing:${op}`),
    ...insufficientSampleOperations.map((op) => `insufficient_samples:${op}`),
    ...unpricedModels.map((model) => `unpriced:${model}`),
    ...(!input.invoiceReconciliationRecorded ? ["invoice_reconciliation_not_recorded"] : []),
  ];

  return {
    p90CostMicrousd,
    missingOperations,
    insufficientSampleOperations,
    unpricedModels,
    blockers,
    certificationReady: blockers.length === 0,
  };
}

// ============================================================================
// COST CALCULATION
// ============================================================================

export function calculateTokenCostMicrousd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const prices = lookupModelPrice(model);

  if (!prices) {
    return 0;
  }

  const costUsd =
    (inputTokens / 1_000_000) * prices.input +
    (outputTokens / 1_000_000) * prices.output;

  return Math.round(costUsd * 1_000_000);
}

export function calculateTtsCostMicrousd(characters: number): number {
  const costUsd = (characters / 1_000_000) * TTS_PRICE_PER_MILLION_CHARS;
  return Math.round(costUsd * 1_000_000);
}

export function calculateImageCostMicrousd(imageCount: number): number {
  return Math.round(imageCount * IMAGE_PRICE_USD * 1_000_000);
}

/** Veo pricing is per second of generated video (stored in `output`). */
export function calculateVideoCostMicrousd(model: string, videoSeconds: number): number {
  const prices = lookupModelPrice(model);
  if (!prices) return 0;
  return Math.round(videoSeconds * prices.output * 1_000_000);
}

export function microusdToUsd(microusd: number): number {
  return microusd / 1_000_000;
}

// ============================================================================
// CREDIT ANCHOR VALIDATION
// Validates that assigned credit costs cover actual API costs at each plan's
// credit rate. Returns a health status for each operation type.
// ============================================================================

export const CREDIT_ANCHORS: Record<string, number> = {
  article: CREDIT_MENU.article,
  video: CREDIT_MENU.video,
  podcast: CREDIT_MENU.podcast,
  social: CREDIT_MENU.social_batch,
};

// Plan credit-to-USD conversion rates (credit value in USD)
export const PLAN_CREDIT_VALUE_USD: Record<string, number> = Object.fromEntries(
  Object.values(BILLING_PLANS).map((plan) => [
    plan.id,
    plan.monthlyCredits > 0 ? plan.priceUsd / plan.monthlyCredits : 0,
  ])
);

export interface CreditAnchorHealth {
  operationType: string;
  credits: number;
  avgCostUsd: number;
  revenuePerCreditUsd: number;
  grossMarginPct: number;
  status: "healthy" | "warning" | "critical";
}

export function validateCreditAnchor(
  operationType: string,
  avgCostUsd: number,
  planKey: keyof typeof PLAN_CREDIT_VALUE_USD = "growth"
): CreditAnchorHealth {
  const credits = CREDIT_ANCHORS[operationType] ?? 10;
  const revenueUsd = credits * (PLAN_CREDIT_VALUE_USD[planKey] ?? 0);
  const marginPct = revenueUsd > 0 ? ((revenueUsd - avgCostUsd) / revenueUsd) * 100 : 100;

  let status: "healthy" | "warning" | "critical";
  if (marginPct >= 75) status = "healthy";
  else if (marginPct >= 50) status = "warning";
  else status = "critical";

  return {
    operationType,
    credits,
    avgCostUsd,
    revenuePerCreditUsd: revenueUsd,
    grossMarginPct: Math.round(marginPct * 10) / 10,
    status,
  };
}

// ============================================================================
// LOGGING
// ============================================================================

export async function logCostTelemetry(
  ctx: TelemetryContext,
  usage: TokenUsage | CharacterUsage | ImageUsage | VideoUsage,
  latencyMs: number,
  success = true,
  errorMessage?: string
): Promise<void> {
  // Provider helpers deep in the call graph often omit teamId. The validated
  // database execution context is authoritative: inherit it for tenant work
  // and reject any caller-supplied cross-tenant mismatch before the insert.
  const effectiveTeamId = resolveTelemetryTeamId(ctx.teamId);
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let totalTokens: number | undefined;
  let unitType = "tokens";
  let unitCount: number | undefined;
  let costMicrousd = 0;

  if ("inputTokens" in usage || "outputTokens" in usage || "totalTokens" in usage) {
    const u = usage as TokenUsage;
    inputTokens = u.inputTokens ?? 0;
    outputTokens = u.outputTokens ?? 0;
    totalTokens = u.totalTokens ?? (inputTokens + outputTokens);
    unitType = "tokens";
    unitCount = totalTokens;
    costMicrousd = calculateTokenCostMicrousd(ctx.model, inputTokens, outputTokens);
  } else if ("characters" in usage) {
    const u = usage as CharacterUsage;
    unitType = "characters";
    unitCount = u.characters;
    costMicrousd = calculateTtsCostMicrousd(u.characters);
  } else if ("imageCount" in usage) {
    const u = usage as ImageUsage;
    unitType = "images";
    unitCount = u.imageCount;
    costMicrousd = calculateImageCostMicrousd(u.imageCount);
  } else if ("videoSeconds" in usage) {
    const u = usage as VideoUsage;
    unitType = "seconds";
    unitCount = u.videoSeconds;
    costMicrousd = calculateVideoCostMicrousd(ctx.model, u.videoSeconds);
  }

  await db.insert(costTelemetry).values({
    teamId: effectiveTeamId,
    userId: ctx.userId ?? null,
    batchId: ctx.batchId ?? null,
    articleId: ctx.articleId ?? null,
    // Fall back to the ambient run context so worker-side telemetry is
    // attributable per run without threading runId through every signature.
    jobId: ctx.jobId ?? (await import("./run-context")).currentRunId() ?? null,
    operationType: ctx.operationType,
    provider: ctx.provider,
    model: ctx.model,
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    totalTokens: totalTokens ?? null,
    unitType,
    unitCount: unitCount ?? null,
    costMicrousd,
    success: success ? 1 : 0,
    latencyMs,
    errorMessage: errorMessage ?? null,
  });
}

/** Non-blocking fire-and-forget wrapper — never throws, so it can't break content generation. */
export function safeLogCostTelemetry(
  ctx: TelemetryContext,
  usage: TokenUsage | CharacterUsage | ImageUsage | VideoUsage,
  latencyMs: number,
  success = true,
  errorMessage?: string
): void {
  logCostTelemetry(ctx, usage, latencyMs, success, errorMessage).catch((err) => {
    console.warn("[CostTelemetry] Failed to log cost event:", err?.message ?? err);
  });
}

/** Extract token usage from a Gemini generateContent response. */
export function extractGeminiUsage(result: {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}): TokenUsage {
  const meta = result.usageMetadata ?? {};
  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: meta.candidatesTokenCount ?? 0,
    totalTokens: meta.totalTokenCount ?? 0,
  };
}

/** Extract token usage from an OpenAI chat completion response. */
export function extractOpenAIUsage(result: {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}): TokenUsage {
  const u = result.usage ?? {};
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}
