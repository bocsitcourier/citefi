import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  learningPatterns,
  patternDimensionStats,
  variantArms,
  contentPerformanceMetrics,
} from "@/shared/schema";
import { eq, and, inArray, count, sql, gte, lt } from "drizzle-orm";
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

    // ── Readiness gate decomposition (mirrors declare-winner gates exactly) ────
    // Gate A: ≥200 treatment-tagged observations in content_performance_metrics.
    // Uses the same variantId query as declare-winner Gate A for consistent progress tracking.
    // Pattern-trial totals (alpha+beta) cannot be used here — they measure learning signal
    // volume, not the treatment-observation count that declare-winner actually gates on.
    let gateA = false;
    let treatObsTotal = 0;
    if (treatM) {
      const treatTagA = `va-${treatM.armId}`;
      const [obsResultA] = await db
        .select({ n: count() })
        .from(contentPerformanceMetrics)
        .where(and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, contentType),
          eq(contentPerformanceMetrics.variantId, treatTagA)
        ));
      treatObsTotal = Number(obsResultA?.n ?? 0);
      gateA = treatObsTotal >= 200;
    }
    // ── Gate B: Two non-overlapping 14-day windows — z-test p<0.05 each ─────
    // Mirrors declare-winner Gate B exactly so readiness score predicts promotion.
    const summaryNow = Date.now();
    let gateB = false;
    let gateBMeta: Record<string, unknown> = {};
    if (treatM && holdM) {
      const treatTagB = `va-${treatM.armId}`;
      const holdTagB  = `va-${holdM.armId}`;
      const w1Gte = new Date(summaryNow - 28 * 86_400_000);
      const w1Lt_ = new Date(summaryNow - 14 * 86_400_000);
      const w2Gte = new Date(summaryNow - 14 * 86_400_000);
      const winObs = async (gteD: Date, ltD: Date | null, tag: string) => {
        const cond = ltD
          ? and(
              eq(contentPerformanceMetrics.teamId, teamId), eq(contentPerformanceMetrics.contentType, contentType),
              eq(contentPerformanceMetrics.variantId, tag), gte(contentPerformanceMetrics.createdAt, gteD),
              lt(contentPerformanceMetrics.createdAt, ltD)
            )
          : and(
              eq(contentPerformanceMetrics.teamId, teamId), eq(contentPerformanceMetrics.contentType, contentType),
              eq(contentPerformanceMetrics.variantId, tag), gte(contentPerformanceMetrics.createdAt, gteD)
            );
        const [r] = await db.select({
          successes: sql<number>`sum(case when ${contentPerformanceMetrics.isSuccess} = 1 then 1 else 0 end)`,
          total: count(),
        }).from(contentPerformanceMetrics).where(cond);
        return { successes: Number(r?.successes ?? 0), total: Number(r?.total ?? 0) };
      };
      const [w1T, w1H, w2T, w2H] = await Promise.all([
        winObs(w1Gte, w1Lt_, treatTagB),
        winObs(w1Gte, w1Lt_, holdTagB),
        winObs(w2Gte, null,  treatTagB),
        winObs(w2Gte, null,  holdTagB),
      ]);
      const w1S = twoProportionZ(w1T.successes, w1T.total, w1H.successes, w1H.total);
      const w2S = twoProportionZ(w2T.successes, w2T.total, w2H.successes, w2H.total);
      const w1Sig = w1S.pValue < 0.05 && w1S.lift > 0;
      const w2Sig = w2S.pValue < 0.05 && w2S.lift > 0;
      gateB = w1Sig && w2Sig;
      gateBMeta = {
        w1: { significant: w1Sig, pValue: Math.round(w1S.pValue * 1e3) / 1e3, lift: Math.round(w1S.lift * 1e3) / 1e3, treatN: w1T.total, holdN: w1H.total },
        w2: { significant: w2Sig, pValue: Math.round(w2S.pValue * 1e3) / 1e3, lift: Math.round(w2S.lift * 1e3) / 1e3, treatN: w2T.total, holdN: w2H.total },
      };
    }
    // ── Gate C: No >10% counter-metric deterioration (bounce/read-complete, 14d) ──
    // bounce_rate (↑ bad) and read_complete_rate (↓ bad) are the required guardrails.
    // Mirrors declare-winner Gate C exactly.
    let gateC = true;
    let gateCMeta: Record<string, unknown> = {};
    if (treatM && holdM) {
      const fourteenDaysAgo = new Date(summaryNow - 14 * 86_400_000);
      const treatTag14 = `va-${treatM.armId}`;
      const holdTag14  = `va-${holdM.armId}`;
      type CtrRow = { avgBounce: number; avgReturn: number; n: number };
      const ctrQ = (tag: string) => db
        .select({
          avgBounce:  sql<number>`avg(${contentPerformanceMetrics.bounceRate})`,
          avgReturn:  sql<number>`avg(${contentPerformanceMetrics.sessionReturnRate})`,
          n: count(),
        })
        .from(contentPerformanceMetrics)
        .where(and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, contentType),
          eq(contentPerformanceMetrics.variantId, tag),
          gte(contentPerformanceMetrics.createdAt, fourteenDaysAgo)
        ));
      const [tCRows, hCRows] = await Promise.all([ctrQ(treatTag14), ctrQ(holdTag14)]);
      const tCtr = tCRows[0];
      const hCtr = hCRows[0];
      const treatAvgBounce  = Number(tCtr?.avgBounce  ?? 0);
      const treatAvgReturn  = Number(tCtr?.avgReturn  ?? 0);
      const holdAvgBounce   = Number(hCtr?.avgBounce  ?? 0);
      const holdAvgReturn   = Number(hCtr?.avgReturn  ?? 0);
      const holdQN          = Number(hCtr?.n          ?? 0);
      // bounce_rate: higher is worse — treatment must not exceed holdout × 1.1
      // session_return_rate: higher is better — treatment must not fall below holdout × 0.9
      const bounceOK = holdAvgBounce  === 0 || treatAvgBounce  <= holdAvgBounce  * 1.1;
      const returnOK = holdAvgReturn  === 0 || treatAvgReturn  >= holdAvgReturn  * 0.9;
      gateC = holdQN < 10 || (bounceOK && returnOK);
      gateCMeta = {
        treatAvgBounce: Math.round(treatAvgBounce * 10) / 10,
        holdAvgBounce: Math.round(holdAvgBounce * 10) / 10,
        treatAvgReturn: Math.round(treatAvgReturn * 10) / 10,
        holdAvgReturn: Math.round(holdAvgReturn * 10) / 10,
        holdQN,
        bounceOK,
        returnOK,
        note: holdQN < 10 ? "Insufficient holdout data — gate passes by default" : undefined,
      };
    }
    const readinessScore = (gateA ? 30 : 0) + (gateB ? 40 : 0) + (gateC ? 30 : 0);

    const readinessGates = {
      gateA: {
        label: "≥200 treatment-tagged observations (CPM variantId)",
        passed: gateA,
        value: treatObsTotal,
        required: 200,
        weight: 30,
      },
      gateB: {
        label: "Both non-overlapping 14-day windows significant (p<0.05, treatment > holdout)",
        passed: gateB,
        weight: 40,
        ...gateBMeta,
      },
      gateC: {
        label: "No >10% counter-metric deterioration vs holdout (bounce/session-return, 14d)",
        passed: gateC,
        weight: 30,
        ...gateCMeta,
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
