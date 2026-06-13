import { db } from "./db";
import { costTelemetry } from "@/shared/schema";

// ============================================================================
// PRICING MAP — cost per million tokens (or per unit) in USD
// Stored as microUSD internally to avoid floating-point drift.
// 1 USD = 1,000,000 microUSD
// ============================================================================

const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Gemini 2.5 family
  "gemini-2.5-flash":               { input: 0.30,  output: 2.50  },
  "gemini-2.5-flash-preview":       { input: 0.15,  output: 3.50  },
  "gemini-2.5-flash-preview-04-17": { input: 0.15,  output: 3.50  },
  "gemini-2.5-pro":                 { input: 1.25,  output: 10.00 },
  // Gemini 2.0 family
  "gemini-2.0-flash":               { input: 0.10,  output: 0.40  },
  "gemini-2.0-flash-exp":           { input: 0.10,  output: 0.40  },
  // App-internal model aliases (may differ from API names)
  "gemini-3.5-flash":               { input: 0.30,  output: 2.50  },
  "gemini-3.5-flash-image":         { input: 0.30,  output: 2.50  },
  "gemini-3.5-flash-lite":          { input: 0.10,  output: 0.40  },
  "gemini-3.5-pro":                 { input: 1.25,  output: 10.00 },
  // OpenAI text models
  "gpt-4o-mini":                    { input: 0.15,  output: 0.60  },
  "gpt-4o-mini-tts":                { input: 0.00,  output: 0.00  }, // TTS billed by chars
  "chatgpt-4o-latest":              { input: 5.00,  output: 15.00 },
  "gpt-4o":                         { input: 5.00,  output: 15.00 },
  "gpt-4":                          { input: 30.00, output: 60.00 },
  "gpt-4-turbo":                    { input: 10.00, output: 30.00 },
  // App-internal OpenAI aliases
  "gpt-5.4-mini":                   { input: 0.15,  output: 0.60  },
  "gpt-5.4":                        { input: 5.00,  output: 15.00 },
};

// TTS: $15 per 1M characters
const TTS_PRICE_PER_MILLION_CHARS = 15.00;

// Image generation: flat rate per image (DALL-E 3 standard 1024×1024)
const IMAGE_PRICE_USD = 0.04;

export type OperationType =
  | "article_title_pool"
  | "article_generation"
  | "article_review"
  | "article_hyperlink"
  | "article_critique"
  | "social_post"
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

// ============================================================================
// COST CALCULATION
// ============================================================================

export function calculateTokenCostMicrousd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const normalizedModel = model.toLowerCase().replace(/-\d{8}$/, "");
  const prices =
    (PRICE_PER_MILLION as Record<string, { input: number; output: number }>)[normalizedModel] ??
    (PRICE_PER_MILLION as Record<string, { input: number; output: number }>)[model] ??
    null;

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

export function microusdToUsd(microusd: number): number {
  return microusd / 1_000_000;
}

// ============================================================================
// CREDIT ANCHOR VALIDATION
// Validates that assigned credit costs cover actual API costs at each plan's
// credit rate. Returns a health status for each operation type.
// ============================================================================

export const CREDIT_ANCHORS: Record<string, number> = {
  article: 10,
  video: 15,
  podcast: 8,
  social: 4,
};

// Plan credit-to-USD conversion rates (credit value in USD)
export const PLAN_CREDIT_VALUE_USD: Record<string, number> = {
  free: 0,
  starter: 29 / 50,   // $0.58/credit
  growth: 89 / 200,   // $0.445/credit
  agency: 249 / 500,  // $0.498/credit (pooled, approximate)
};

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
  const revenueUsd = credits * PLAN_CREDIT_VALUE_USD[planKey];
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
  usage: TokenUsage | CharacterUsage | ImageUsage,
  latencyMs: number,
  success = true,
  errorMessage?: string
): Promise<void> {
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
  }

  await db.insert(costTelemetry).values({
    teamId: ctx.teamId ?? null,
    userId: ctx.userId ?? null,
    batchId: ctx.batchId ?? null,
    articleId: ctx.articleId ?? null,
    jobId: ctx.jobId ?? null,
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
  usage: TokenUsage | CharacterUsage | ImageUsage,
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
