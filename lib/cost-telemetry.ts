import { BILLING_PLANS } from "@/lib/billing/plans";
import { CREDIT_MENU } from "@/lib/credit-menu";

import { db } from "./db";
import { costTelemetry } from "@/shared/schema";
import { getDatabaseExecutionContext } from "./tenant-context";
import { recordProviderUsage } from "./provider-usage-ledger";
import { redactProviderError } from "./provider-diagnostics";
import {
  captureProviderSdkResponse,
  currentProviderAttempt,
  markCurrentProviderAttemptAccountingFailed,
  reconcileCurrentProviderAttempt,
  reconcileProviderAttempt,
  providerAttemptUsageFromTelemetry,
  providerAttemptSourceEventIdForResponse,
  isProviderAttemptTerminalError,
  ProviderAttemptUsageUnavailableError,
} from "./provider-attempt-receipts";

// ----------------------------------------------------------------------------
// PRICING MAP — cost per million tokens (or per unit) in USD
// Stored as microUSD internally to avoid floating-point drift.
// 1 USD = 1,000,000 microUSD
// ----------------------------------------------------------------------------

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
  | "competitive_intelligence"
  | "brand_intelligence"
  | "expert_discovery"
  | "campaign_ads"
  | "other";

export interface TelemetryContext {
  operationType: OperationType;
  provider: "gemini" | "openai" | "brave";
  model: string;
  teamId?: number | null;
  userId?: number | null;
  batchId?: number | null;
  articleId?: number | null;
  jobId?: string | null;
  /**
   * Optional campaign association. When omitted it is derived from the batch or
   * article row (scoped to the resolved tenant) so telemetry rolls up per
   * campaign without weakening tenant attribution.
   */
  campaignId?: number | null;
  /** Provider request identifier, used as the durable ledger idempotency anchor. */
  providerRequestId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  runId?: string | null;
  resourceType?: string | null;
  resourceId?: string | number | null;
  attempt?: number | null;
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
      throw new ProviderAttemptUsageUnavailableError(
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
  /** False means the provider SDK omitted its usage block. */
  known?: boolean;
  /** Internal idempotency bridge for post-call telemetry after receipt context. */
  providerAttemptSourceEventId?: string;
}

export interface CharacterUsage {
  characters: number;
  known?: boolean;
  providerAttemptSourceEventId?: string;
}

export interface ImageUsage {
  imageCount: number;
  known?: boolean;
  providerAttemptSourceEventId?: string;
}

export interface VideoUsage {
  videoSeconds: number;
  known?: boolean;
  providerAttemptSourceEventId?: string;
}

export interface RequestUsage {
  requestCount: number;
  known?: boolean;
  providerAttemptSourceEventId?: string;
}

export interface CostTelemetryOptions {
  /** Record only operational telemetry; never write provider usage ledger. */
  skipLedger?: boolean;
  /** Receipt already contains exact provider usage; do not replace it. */
  skipCapture?: boolean;
}

const SAFE_UNCORRELATED_PROVIDER_METADATA_KEYS = new Set([
  "providerRequestId",
  "operationId",
  "actualModel",
  "finishReason",
]);

function safeUncorrelatedProviderMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_UNCORRELATED_PROVIDER_METADATA_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    const bounded = value.trim();
    if (bounded && bounded.length <= 255) safe[key] = bounded;
  }
  return Object.keys(safe).length ? safe : null;
}

/**
 * Accounting is part of the provider boundary, not observability.  This error
 * is deliberately distinguishable from a provider error so retry loops never
 * submit a second physical request when the immutable ledger is unavailable.
 */
export class ProviderAccountingError extends Error {
  readonly code = "PROVIDER_ACCOUNTING_FAILED";
  readonly accountingError: unknown;

  constructor(message: string, accountingError: unknown, providerError?: unknown) {
    super(message, providerError === undefined ? { cause: accountingError } : { cause: providerError });
    this.name = "ProviderAccountingError";
    this.accountingError = accountingError;
  }
}

export function isProviderAccountingError(error: unknown): error is ProviderAccountingError | import("./provider-attempt-receipts").ProviderAttemptTerminalError {
  // Legacy optional-provider fallbacks already use this guard. Receipt
  // failures belong to the same no-replay boundary, including missing usage.
  return isProviderAttemptTerminalError(error) || error instanceof ProviderAccountingError ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "PROVIDER_ACCOUNTING_FAILED"
    );
}

/**
 * The request may have reached a paid provider, but no provider operation/result
 * identifier was returned. Replaying the same request can create a second paid
 * operation, so this is terminal and requires explicit operator reconciliation.
 */
export class ProviderSubmissionUncertainError extends Error {
  readonly code = "PROVIDER_SUBMISSION_UNCERTAIN";

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderSubmissionUncertainError";
  }
}

export function isProviderSubmissionUncertainError(
  error: unknown
): error is ProviderSubmissionUncertainError {
  return error instanceof ProviderSubmissionUncertainError ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "PROVIDER_SUBMISSION_UNCERTAIN"
    );
}

/**
 * A paid provider returned a result (or durable operation ID), but a later
 * download/storage/composition step failed. Queue replay must not submit the
 * provider request again. Where no durable checkpoint exists, manual recovery
 * is safer than silently multiplying provider spend.
 */
export class ProviderResultNotDurableError extends Error {
  readonly code = "PROVIDER_RESULT_NOT_DURABLE";
  readonly providerRequestId?: string;

  constructor(message: string, providerRequestId?: string | null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderResultNotDurableError";
    this.providerRequestId = providerRequestId ?? undefined;
  }
}

export function isProviderResultNotDurableError(
  error: unknown
): error is ProviderResultNotDurableError {
  return error instanceof ProviderResultNotDurableError ||
    (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "PROVIDER_RESULT_NOT_DURABLE"
    );
}

export function isNonReplayableProviderError(error: unknown): boolean {
  return isProviderAccountingError(error) ||
    isProviderSubmissionUncertainError(error) ||
    isProviderResultNotDurableError(error) ||
    isProviderAttemptTerminalError(error);
}

/**
 * Optional provider work may fall back for ordinary content/provider failures,
 * but immutable-accounting failures are never optional.
 */
export function throwIfProviderAccountingFailed(
  results: readonly PromiseSettledResult<unknown>[]
): void {
  for (const result of results) {
    if (result.status === "rejected" && isProviderAccountingError(result.reason)) {
      throw result.reason;
    }
  }
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

// ----------------------------------------------------------------------------
// COST CALCULATION
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// CREDIT ANCHOR VALIDATION
// Validates that assigned credit costs cover actual API costs at each plan's
// credit rate. Returns a health status for each operation type.
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// LOGGING
// ----------------------------------------------------------------------------

export async function logCostTelemetry(
  ctx: TelemetryContext,
  usage: TokenUsage | CharacterUsage | ImageUsage | VideoUsage | RequestUsage,
  latencyMs: number,
  success = true,
  errorMessage?: string,
  options: CostTelemetryOptions = {},
): Promise<void> {
  try {
    await writeCostTelemetry(ctx, usage, latencyMs, success, errorMessage, options);
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    // Attribution can fail before the ledger insertion block. This function
    // runs after submission, so that failure must never trigger generation.
    throw new ProviderAccountingError(
      "Provider accounting attribution or persistence failed; automatic replay is blocked",
      error,
    );
  }
}

async function writeCostTelemetry(
  ctx: TelemetryContext,
  usage: TokenUsage | CharacterUsage | ImageUsage | VideoUsage | RequestUsage,
  latencyMs: number,
  success = true,
  errorMessage?: string,
  options: CostTelemetryOptions = {},
): Promise<void> {
  // Provider helpers deep in the call graph often omit teamId. The validated
  // database execution context is authoritative: inherit it for tenant work
  // and reject any caller-supplied cross-tenant mismatch before the insert.
  const effectiveTeamId = resolveTelemetryTeamId(ctx.teamId);

  // Resolve the campaign association. Explicit attribution must have a tenant
  // context and must name a campaign owned by that tenant; inferred attribution
  // remains best-effort for legacy callers.
  let effectiveCampaignId: number | null = ctx.campaignId ?? null;
  if (effectiveCampaignId != null) {
    if (effectiveTeamId == null) {
      throw new ProviderAttemptUsageUnavailableError(
        "Cost telemetry campaignId requires an attributable tenant context"
      );
    }
    const { campaigns } = await import("@/shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const [ownedCampaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, effectiveCampaignId),
          eq(campaigns.teamId, effectiveTeamId)
        )
      )
      .limit(1);
    if (!ownedCampaign) {
      throw new Error(
        `Cost telemetry campaign ${effectiveCampaignId} does not belong to team ${effectiveTeamId}`
      );
    }
  }
  if (effectiveCampaignId == null && (ctx.batchId != null || ctx.articleId != null)) {
    try {
      const { eq, and } = await import("drizzle-orm");
      if (ctx.batchId != null) {
        const { jobBatches } = await import("@/shared/schema");
        const conds = [eq(jobBatches.id, ctx.batchId)];
        if (effectiveTeamId != null) conds.push(eq(jobBatches.teamId, effectiveTeamId));
        const [row] = await db
          .select({ campaignId: jobBatches.campaignId })
          .from(jobBatches)
          .where(conds.length === 1 ? conds[0] : and(...conds))
          .limit(1);
        effectiveCampaignId = row?.campaignId ?? null;
      }
      if (effectiveCampaignId == null && ctx.articleId != null) {
        const { articles } = await import("@/shared/schema");
        const conds = [eq(articles.id, ctx.articleId)];
        if (effectiveTeamId != null) conds.push(eq(articles.teamId, effectiveTeamId));
        const [row] = await db
          .select({ campaignId: articles.campaignId })
          .from(articles)
          .where(conds.length === 1 ? conds[0] : and(...conds))
          .limit(1);
        effectiveCampaignId = row?.campaignId ?? null;
      }
    } catch (err) {
      // Derivation failure is non-fatal — persist telemetry with null campaign.
      console.warn("[CostTelemetry] campaignId derivation failed:", (err as Error)?.message ?? err);
      effectiveCampaignId = ctx.campaignId ?? null;
    }
  }

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let totalTokens: number | undefined;
  let unitType = "tokens";
  let unitCount: number | undefined;
  let costMicrousd = 0;

  if ("requestCount" in usage) {
    const u = usage as RequestUsage;
    unitType = "requests";
    unitCount = u.requestCount;
    costMicrousd = u.requestCount * 5_000;
  } else if ("inputTokens" in usage || "outputTokens" in usage || "totalTokens" in usage) {
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

  const effectiveRunId = ctx.runId ?? (await import("./run-context")).currentRunId() ?? null;

  // If a wrapper is inside runWithProviderAttempt, capture the normalized
  // provider-returned usage before attempting the immutable ledger insert.
  // This AsyncLocalStorage bridge lets existing post-call telemetry become a
  // receipt response checkpoint without passing a receipt through every SDK
  // helper.  Unknown SDK usage is terminal; it is never converted into a
  // fabricated zero-usage receipt.
  const activeAttempt = currentProviderAttempt();
  if (!options.skipLedger && activeAttempt) {
    if (
      activeAttempt.receipt.teamId !== effectiveTeamId ||
      activeAttempt.receipt.provider !== ctx.provider ||
      activeAttempt.receipt.model !== ctx.model
    ) {
      throw new Error("cost telemetry context does not match active provider attempt receipt");
    }
    if (!options.skipCapture) {
      await captureProviderSdkResponse({
        usage: providerAttemptUsageFromTelemetry(usage),
        providerRequestId: ctx.providerRequestId ?? null,
      });
    }
    if (
      activeAttempt.receipt.responseUsage?.known !== true ||
      activeAttempt.receipt.responseUsage.unitCount == null
    ) {
      throw new Error(
        "provider response usage is partial or unknown; immutable ledger insertion is blocked",
      );
    }
  }

  // The immutable ledger is the COGS source of truth. cost_telemetry remains a
  // best-effort operational observability stream and must never be used to
  // mutate credit balances.
  const usageSourceEventId = "providerAttemptSourceEventId" in usage
    ? (usage as TokenUsage).providerAttemptSourceEventId
    : undefined;
  const correlatedSourceEventId = activeAttempt?.receipt.sourceEventId ?? usageSourceEventId;
  if (!options.skipLedger) try {
    if (activeAttempt) {
      // Reconcile the receipt's canonical persisted usage. Never rebuild a
      // ledger payload from post-call context, which may differ on retries.
      await reconcileCurrentProviderAttempt();
    } else if (correlatedSourceEventId) {
      // A response-correlated source ID is a typed WeakMap bridge. The
      // receipt, not caller-supplied telemetry, owns immutable attribution.
      await reconcileProviderAttempt({ sourceEventId: correlatedSourceEventId });
    } else {
      await recordProviderUsage({
        teamId: effectiveTeamId,
        campaignId: effectiveCampaignId,
        runId: effectiveRunId,
        jobId: ctx.jobId ?? null,
        contentId: ctx.articleId ?? null,
        resourceType: ctx.resourceType ?? (ctx.articleId != null ? "article" : ctx.batchId != null ? "batch" : null),
        resourceId: ctx.resourceId ?? ctx.articleId ?? ctx.batchId ?? null,
        operationType: ctx.operationType,
        provider: ctx.provider,
        model: ctx.model,
        unitType,
        inputUnits: inputTokens ?? null,
        outputUnits: outputTokens ?? null,
        unitCount: unitCount ?? 0,
        costMicrousd,
        providerRequestId: ctx.providerRequestId ?? null,
        providerMetadata: safeUncorrelatedProviderMetadata(ctx.providerMetadata),
        attempt: ctx.attempt ?? null,
      });
    }
  } catch (error) {
    if (activeAttempt) {
      try {
        await markCurrentProviderAttemptAccountingFailed();
      } catch (statusError) {
        throw new ProviderAccountingError(
          `Provider attempt receipt status failed after ${ctx.provider}/${ctx.model} accounting failure`,
          statusError,
          error,
        );
      }
    }
    throw new ProviderAccountingError(
      `Immutable provider accounting failed for ${ctx.provider}/${ctx.model}`,
      error
    );
  }

  try {
    await db.insert(costTelemetry).values({
    teamId: effectiveTeamId,
    campaignId: effectiveCampaignId,
    userId: ctx.userId ?? null,
    batchId: ctx.batchId ?? null,
    articleId: ctx.articleId ?? null,
    // Fall back to the ambient run context so worker-side telemetry is
    // attributable per run without threading runId through every signature.
    jobId: ctx.jobId ?? effectiveRunId,
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
  } catch (err) {
    // The usage ledger write above already succeeded. Operational telemetry is
    // intentionally non-authoritative and should not turn a provider success
    // into a failed content operation.
    console.warn("[CostTelemetry] operational telemetry insert failed:", (err as Error)?.message ?? err);
  }
}

/**
 * Record a failed physical provider attempt. If immutable accounting fails,
 * surface that failure while retaining the original provider error as cause.
 */
export async function logFailedProviderAttempt(
  ctx: TelemetryContext,
  usage: TokenUsage | CharacterUsage | ImageUsage | VideoUsage | RequestUsage,
  latencyMs: number,
  providerError: unknown
): Promise<void> {
  const activeAttempt = currentProviderAttempt();
  const usageSourceEventId = "providerAttemptSourceEventId" in usage
    ? (usage as TokenUsage).providerAttemptSourceEventId
    : undefined;
  const hasExactCapturedUsage =
    activeAttempt?.receipt.responseUsage?.known === true &&
    activeAttempt.receipt.responseUsage.unitCount != null;
  const skipLedger = !hasExactCapturedUsage && !usageSourceEventId;
  const safeFailureDiagnostic = redactProviderError(
    providerError,
    undefined,
    `${ctx.operationType}:provider_failure`,
  );
  try {
    await logCostTelemetry(
      ctx,
      usage,
      latencyMs,
      false,
      safeFailureDiagnostic,
      { skipLedger, skipCapture: hasExactCapturedUsage },
    );
  } catch (accountingError) {
    throw new ProviderAccountingError(
      `Immutable provider accounting failed after ${ctx.provider}/${ctx.model} request failed`,
      accountingError,
      providerError
    );
  }
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
    known:
      meta.promptTokenCount != null ||
      meta.candidatesTokenCount != null ||
      meta.totalTokenCount != null,
    providerAttemptSourceEventId: providerAttemptSourceEventIdForResponse(result),
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
    known:
      u.prompt_tokens != null ||
      u.completion_tokens != null ||
      u.total_tokens != null,
    providerAttemptSourceEventId: providerAttemptSourceEventIdForResponse(result),
  };
}
