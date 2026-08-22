import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { costTelemetry } from "@/shared/schema";
import { sql, gte, and, eq } from "drizzle-orm";
import {
  validateCreditAnchor,
  microusdToUsd,
  CREDIT_ANCHORS,
  evaluateMarginCertification,
  hasKnownProviderRate,
  PROVIDER_RATE_CARD_VERSION,
} from "@/lib/cost-telemetry";
import { COMMERCIAL_LAUNCH_DEFAULTS } from "@/lib/launch-governance";

// How each product deliverable is composed of individual AI operations.
// Weight = how many of that operation go into one product unit.
const PRODUCT_COMPOSITION: Record<string, { op: string; weight: number }[]> = {
  article: [
    { op: "article_generation",  weight: 1.00 }, // 1 generation per article
    { op: "article_review",      weight: 1.00 }, // 1 GPT review per article
    { op: "article_hyperlink",   weight: 1.00 }, // 1 hyperlink pass per article
    { op: "article_title_pool",  weight: 0.02 }, // 1 pool per ~50 articles
    { op: "image_generation",    weight: 3.00 }, // ~3 images per article
  ],
  podcast: [
    { op: "podcast_script",      weight: 1.00 },
    { op: "podcast_tts",         weight: 2.00 }, // 2 TTS voices
  ],
  video: [
    { op: "video_script",        weight: 1.00 },
    { op: "video_idea",          weight: 0.50 },
    { op: "image_generation",    weight: 5.00 }, // ~5 images per video
    { op: "video_tts",           weight: 1.00 }, // narration TTS
  ],
  social: [
    { op: "social_post",         weight: 1.00 },
  ],
};

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const daysRaw = parseInt(url.searchParams.get("days") ?? "7");
    const days = Math.max(1, Math.min(daysRaw, 365)); // clamp to 1–365
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [summary, byOperation, byModel, recentRows] = await Promise.all([
      db
        .select({
          totalRows:         sql<number>`count(*)::int`,
          totalCostMicrousd: sql<number>`coalesce(sum(cost_microusd), 0)::bigint`,
          totalTokens:       sql<number>`coalesce(sum(total_tokens), 0)::bigint`,
          successCount:      sql<number>`count(*) filter (where success = 1)::int`,
          failureCount:      sql<number>`count(*) filter (where success = 0)::int`,
        })
        .from(costTelemetry)
        .where(gte(costTelemetry.createdAt, since)),

      db
        .select({
          operationType:    costTelemetry.operationType,
          callCount:        sql<number>`count(*)::int`,
          totalCostMicrousd:sql<number>`coalesce(sum(cost_microusd), 0)::bigint`,
          avgCostMicrousd:  sql<number>`coalesce(avg(cost_microusd), 0)::int`,
          p90CostMicrousd:  sql<number>`coalesce(percentile_cont(0.90) within group (order by cost_microusd), 0)::int`,
          totalTokens:      sql<number>`coalesce(sum(total_tokens), 0)::bigint`,
          avgInputTokens:   sql<number>`coalesce(avg(input_tokens), 0)::int`,
          avgOutputTokens:  sql<number>`coalesce(avg(output_tokens), 0)::int`,
        })
        .from(costTelemetry)
        .where(and(gte(costTelemetry.createdAt, since), eq(costTelemetry.success, 1)))
        .groupBy(costTelemetry.operationType)
        .orderBy(sql`sum(cost_microusd) desc`),

      db
        .select({
          provider:         costTelemetry.provider,
          model:            costTelemetry.model,
          operationType:    costTelemetry.operationType,
          callCount:        sql<number>`count(*)::int`,
          totalCostMicrousd:sql<number>`coalesce(sum(cost_microusd), 0)::bigint`,
          avgCostMicrousd:  sql<number>`coalesce(avg(cost_microusd), 0)::int`,
        })
        .from(costTelemetry)
        .where(gte(costTelemetry.createdAt, since))
        .groupBy(costTelemetry.provider, costTelemetry.model, costTelemetry.operationType)
        .orderBy(sql`sum(cost_microusd) desc`),

      db
        .select({
          id:            costTelemetry.id,
          operationType: costTelemetry.operationType,
          provider:      costTelemetry.provider,
          model:         costTelemetry.model,
          costMicrousd:  costTelemetry.costMicrousd,
          totalTokens:   costTelemetry.totalTokens,
          latencyMs:     costTelemetry.latencyMs,
          success:       costTelemetry.success,
          createdAt:     costTelemetry.createdAt,
        })
        .from(costTelemetry)
        .where(gte(costTelemetry.createdAt, since))
        .orderBy(sql`created_at desc`)
        .limit(50),
    ]);

    const summaryRow = summary[0];

    const minimumSamples =
      COMMERCIAL_LAUNCH_DEFAULTS.marginPolicy.minimumSuccessfulSamplesPerOperation;
    const opP90Costs: Record<string, number> = {};
    const opSampleCounts: Record<string, number> = {};
    for (const row of byOperation) {
      opP90Costs[row.operationType] = Number(row.p90CostMicrousd);
      opSampleCounts[row.operationType] = Number(row.callCount);
    }

    const unpricedByOperation: Record<string, string[]> = {};
    for (const row of byModel) {
      if (!hasKnownProviderRate(row.operationType, row.model)) {
        const models = unpricedByOperation[row.operationType] ?? [];
        models.push(`${row.provider}/${row.model}`);
        unpricedByOperation[row.operationType] = models;
      }
    }

    // No invoice-reconciliation record exists yet, so this endpoint can expose
    // p90 estimates but must not represent them as certified margin.
    const invoiceReconciliationRecorded = false;
    const creditAnchorHealth = Object.entries(CREDIT_ANCHORS).map(([product]) => {
      const composition = PRODUCT_COMPOSITION[product] ?? [];
      const certification = evaluateMarginCertification({
        composition,
        p90CostMicrousdByOperation: opP90Costs,
        successfulSamplesByOperation: opSampleCounts,
        unpricedModelsByOperation: unpricedByOperation,
        minimumSuccessfulSamples: minimumSamples,
        invoiceReconciliationRecorded,
      });
      const p90CostUsd = microusdToUsd(certification.p90CostMicrousd);
      const estimate = validateCreditAnchor(product, p90CostUsd);
      return {
        ...estimate,
        p90CostUsd,
        costBasis: "p90",
        status: certification.certificationReady ? estimate.status : "not_measured",
        certificationReady: certification.certificationReady,
        certificationBlockers: certification.blockers,
        hasAllData: certification.missingOperations.length === 0,
        missingOperations: certification.missingOperations,
        insufficientSampleOperations: certification.insufficientSampleOperations,
        unpricedModels: certification.unpricedModels,
      };
    });

    return NextResponse.json({
      periodDays: days,
      since: since.toISOString(),
      summary: {
        totalCalls:   summaryRow?.totalRows ?? 0,
        totalCostUsd: microusdToUsd(Number(summaryRow?.totalCostMicrousd ?? 0)),
        totalTokens:  Number(summaryRow?.totalTokens ?? 0),
        successCount: summaryRow?.successCount ?? 0,
        failureCount: summaryRow?.failureCount ?? 0,
      },
      byOperation: byOperation.map((r) => ({
        operationType:  r.operationType,
        callCount:      r.callCount,
        totalCostUsd:   microusdToUsd(Number(r.totalCostMicrousd)),
        avgCostUsd:     microusdToUsd(Number(r.avgCostMicrousd)),
        p90CostUsd:     microusdToUsd(Number(r.p90CostMicrousd)),
        totalTokens:    Number(r.totalTokens),
        avgInputTokens: r.avgInputTokens,
        avgOutputTokens:r.avgOutputTokens,
      })),
      byModel: byModel.map((r) => ({
        provider:     r.provider,
        model:        r.model,
        operationType:r.operationType,
        callCount:    r.callCount,
        totalCostUsd: microusdToUsd(Number(r.totalCostMicrousd)),
        avgCostUsd:   microusdToUsd(Number(r.avgCostMicrousd)),
        rateKnown:    hasKnownProviderRate(r.operationType, r.model),
      })),
      marginCertification: {
        status: "not_certified",
        rateCardVersion: PROVIDER_RATE_CARD_VERSION,
        costBasis: "p90",
        minimumSuccessfulSamplesPerOperation: minimumSamples,
        invoiceReconciliationRecorded,
        blockers: [
          "invoice_reconciliation_not_recorded",
          ...Object.values(unpricedByOperation).flat().map((model) => `unpriced:${model}`),
        ],
      },
      creditAnchorHealth,
      recentEvents: recentRows.map((r) => ({
        id:            r.id,
        operationType: r.operationType,
        provider:      r.provider,
        model:         r.model,
        costUsd:       microusdToUsd(r.costMicrousd),
        totalTokens:   r.totalTokens,
        latencyMs:     r.latencyMs,
        success:       r.success === 1,
        rateKnown:     hasKnownProviderRate(r.operationType, r.model),
        createdAt:     r.createdAt,
      })),
    });
  } catch (error: any) {
    const msg: string = error?.message ?? "";
    if (
      msg.includes("Authentication required") ||
      msg.includes("Admin access required") ||
      msg.includes("Unauthorized") ||
      msg.includes("Forbidden")
    ) {
      const status = msg.includes("Admin access required") || msg.includes("Forbidden") ? 403 : 401;
      return NextResponse.json({ error: msg || "Access denied" }, { status });
    }
    console.error("Cost telemetry route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: error?.statusCode || 500 });
  }
}
