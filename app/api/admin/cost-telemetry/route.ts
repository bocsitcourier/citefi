import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { costTelemetry } from "@/shared/schema";
import { sql, gte, and, eq } from "drizzle-orm";
import { validateCreditAnchor, microusdToUsd, CREDIT_ANCHORS } from "@/lib/cost-telemetry";

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
          p95CostMicrousd:  sql<number>`coalesce(percentile_cont(0.95) within group (order by cost_microusd), 0)::int`,
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
          callCount:        sql<number>`count(*)::int`,
          totalCostMicrousd:sql<number>`coalesce(sum(cost_microusd), 0)::bigint`,
          avgCostMicrousd:  sql<number>`coalesce(avg(cost_microusd), 0)::int`,
        })
        .from(costTelemetry)
        .where(and(gte(costTelemetry.createdAt, since), eq(costTelemetry.success, 1)))
        .groupBy(costTelemetry.provider, costTelemetry.model)
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

    // Build a map of operationType → avg cost (microUSD) from observed data.
    const opAvgCosts: Record<string, number> = {};
    for (const row of byOperation) {
      opAvgCosts[row.operationType] = Number(row.avgCostMicrousd);
    }

    // Compute weighted product cost using PRODUCT_COMPOSITION.
    const creditAnchorHealth = Object.entries(CREDIT_ANCHORS).map(([product]) => {
      const composition = PRODUCT_COMPOSITION[product] ?? [];
      const missingOps = composition.filter(({ op }) => opAvgCosts[op] == null).map(({ op }) => op);
      const totalCostMicrousd = composition.reduce((sum, { op, weight }) => {
        return sum + (opAvgCosts[op] ?? 0) * weight;
      }, 0);
      const avgCostUsd = microusdToUsd(totalCostMicrousd);
      return {
        ...validateCreditAnchor(product, avgCostUsd),
        hasAllData: missingOps.length === 0,
        missingOperations: missingOps,
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
        p95CostUsd:     microusdToUsd(Number(r.p95CostMicrousd)),
        totalTokens:    Number(r.totalTokens),
        avgInputTokens: r.avgInputTokens,
        avgOutputTokens:r.avgOutputTokens,
      })),
      byModel: byModel.map((r) => ({
        provider:     r.provider,
        model:        r.model,
        callCount:    r.callCount,
        totalCostUsd: microusdToUsd(Number(r.totalCostMicrousd)),
        avgCostUsd:   microusdToUsd(Number(r.avgCostMicrousd)),
      })),
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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
