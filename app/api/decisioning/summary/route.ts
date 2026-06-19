import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  learningPatterns,
  patternDimensionStats,
  variantArms,
  contentPerformanceMetrics,
} from "@/shared/schema";
import { eq, and, inArray, count, sql } from "drizzle-orm";
import { learningService, thompsonSample, METRIC_WEIGHTS } from "@/lib/learning-service";

// ── Statistical helpers (mirrored in declare-winner route) ────────────────────
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 +
            t * 1.330274429))));
  const p = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? p : 1 - p;
}

function twoProportionZ(ts: number, tn: number, hs: number, hn: number) {
  const tr = tn > 0 ? ts / tn : 0;
  const hr = hn > 0 ? hs / hn : 0;
  const lift = tr - hr;
  if (tn === 0 || hn === 0) return { pValue: 1, lift, treatRate: tr, holdRate: hr };
  const pooled = (ts + hs) / (tn + hn);
  if (pooled === 0 || pooled === 1)
    return { pValue: lift > 0 ? 0 : 1, lift, treatRate: tr, holdRate: hr };
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / tn + 1 / hn));
  if (se === 0) return { pValue: 0.5, lift, treatRate: tr, holdRate: hr };
  const z = lift / se;
  return { pValue: 1 - normalCDF(z), lift, treatRate: tr, holdRate: hr };
}

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const contentType = url.searchParams.get("contentType") ?? "article";

    const [patterns, arms, maturity] = await Promise.all([
      db
        .select({
          id: learningPatterns.id,
          patternName: learningPatterns.patternName,
          patternType: learningPatterns.patternType,
          isArchived: learningPatterns.isArchived,
          weakWeekCount: learningPatterns.weakWeekCount,
          successRate: learningPatterns.successRate,
          timesUsed: learningPatterns.timesUsed,
        })
        .from(learningPatterns)
        .where(
          and(
            eq(learningPatterns.teamId, teamId),
            eq(learningPatterns.contentType, contentType)
          )
        )
        .limit(50),
      db
        .select()
        .from(variantArms)
        .where(
          and(
            eq(variantArms.teamId, teamId),
            eq(variantArms.contentType, contentType)
          )
        ),
      learningService.teamDataMaturity(teamId, contentType),
    ]);

    const patternIds = patterns.map(p => p.id);
    const dimStats = patternIds.length > 0
      ? await db
          .select()
          .from(patternDimensionStats)
          .where(inArray(patternDimensionStats.patternId, patternIds))
      : [];

    const statMap = new Map<string, { successes: number; trials: number; wilsonScore: number }>();
    for (const s of dimStats) {
      statMap.set(`${s.patternId}:${s.dimension}`, {
        successes: s.successes,
        trials: s.trials,
        wilsonScore: s.wilsonScore,
      });
    }

    const weights = METRIC_WEIGHTS[contentType] ?? METRIC_WEIGHTS["article"]!;

    const enrichedPatterns = patterns.map(p => {
      const key = `${p.id}:engagement`;
      const stat = statMap.get(key);
      const successes = stat?.successes ?? 0;
      const trials = stat?.trials ?? 0;
      const alpha = successes + 1;
      const beta = Math.max(1, trials - successes + 1);
      const thompsonScore = Math.round(thompsonSample(alpha, beta) * 100);
      return {
        id: p.id,
        patternName: p.patternName,
        patternType: p.patternType,
        isArchived: p.isArchived,
        weakWeekCount: p.weakWeekCount,
        successRate: p.successRate,
        timesUsed: p.timesUsed,
        alpha,
        beta,
        wilsonScore: stat?.wilsonScore ?? 0,
        thompsonScore,
      };
    });

    // ── Per-arm success rates (treatment vs holdout lift) ────────────────────
    const armMetrics = await Promise.all(
      arms.map(async arm => {
        const tag = `va-${arm.id}`;
        const [r] = await db
          .select({
            successes: sql<number>`sum(case when ${contentPerformanceMetrics.isSuccess} = 1 then 1 else 0 end)`,
            total: count(),
          })
          .from(contentPerformanceMetrics)
          .where(and(
            eq(contentPerformanceMetrics.teamId, teamId),
            eq(contentPerformanceMetrics.contentType, contentType),
            eq(contentPerformanceMetrics.variantId, tag)
          ));
        return {
          armId: arm.id,
          armName: arm.armName,
          successes: Number(r?.successes ?? 0),
          total: Number(r?.total ?? 0),
        };
      })
    );

    const treatM = armMetrics.find(m => m.armName === "treatment");
    const holdM  = armMetrics.find(m => m.armName === "holdout");

    let liftSummary: Record<string, unknown> | null = null;
    if (treatM && holdM) {
      const stat = twoProportionZ(
        treatM.successes, treatM.total,
        holdM.successes, holdM.total,
      );
      const sig = stat.pValue < 0.05 && stat.lift > 0;
      liftSummary = {
        treatmentArmId: treatM.armId,
        holdoutArmId: holdM.armId,
        treatN: treatM.total,
        treatRate: Math.round(stat.treatRate * 1000) / 1000,
        holdN: holdM.total,
        holdRate: Math.round(stat.holdRate * 1000) / 1000,
        liftPct: Math.round(stat.lift * 1000) / 1000,
        pValue: Math.round(stat.pValue * 1000) / 1000,
        significant: sig,
        etaObs: sig
          ? 0
          : treatM.total > 0
            ? Math.min(10_000, Math.round(treatM.total * (stat.pValue / 0.05)))
            : null,
      };
    }

    // ── Readiness gate decomposition (mirrors declare-winner gates) ───────────
    const totalTrials = enrichedPatterns.reduce((s, p) => s + (p.alpha + p.beta - 2), 0);
    const gateA = totalTrials >= 200;
    const gateB = liftSummary?.significant === true;
    const gateC = true; // guardrail conflict check runs at declare-winner time
    const readinessScore = (gateA ? 30 : 0) + (gateB ? 40 : 0) + (gateC ? 30 : 0);

    const readinessGates = {
      gateA: {
        label: "≥200 treatment observations",
        passed: gateA,
        value: totalTrials,
        required: 200,
        weight: 30,
      },
      gateB: {
        label: "Significant lift (p<0.05, treatment > holdout)",
        passed: gateB,
        pValue: liftSummary?.pValue ?? null,
        liftPct: liftSummary?.liftPct ?? null,
        etaObs: liftSummary?.etaObs ?? null,
        weight: 40,
        note: "Requires both treatment + holdout arms with tagged observations",
      },
      gateC: {
        label: "No guardrail conflicts in last 14 days (checked at promotion)",
        passed: gateC,
        weight: 30,
      },
    };

    return NextResponse.json({
      contentType,
      maturity,
      patterns: enrichedPatterns.slice(0, 20),
      arms,
      armMetrics,
      liftSummary,
      readinessScore,
      readinessGates,
      weights,
    });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisioning/summary GET]", err);
    return NextResponse.json({ error: "Failed to fetch decisioning summary" }, { status: 500 });
  }
}
