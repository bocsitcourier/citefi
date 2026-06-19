import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  variantArms,
  learningPatterns,
  patternDimensionStats,
  contentPerformanceMetrics,
  cohortInsights,
} from "@/shared/schema";
import { eq, and, gte, lt, count, sql } from "drizzle-orm";
import { thompsonSample } from "@/lib/learning-service";

// ── Statistical helpers ────────────────────────────────────────────────────────

/** Abramowitz & Stegun normal CDF approximation (error < 7.5e-8). */
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

/**
 * One-tailed two-proportion z-test: H₁ = treatmentRate > holdoutRate.
 * Returns z-score, one-tailed p-value, and absolute lift.
 */
function twoProportionZ(
  treatSucc: number, treatN: number,
  holdSucc: number, holdN: number,
): { z: number; pValue: number; lift: number; treatRate: number; holdRate: number } {
  const treatRate = treatN > 0 ? treatSucc / treatN : 0;
  const holdRate  = holdN  > 0 ? holdSucc  / holdN  : 0;
  const lift = treatRate - holdRate;
  if (treatN === 0 || holdN === 0) return { z: 0, pValue: 1, lift, treatRate, holdRate };
  const pooled = (treatSucc + holdSucc) / (treatN + holdN);
  if (pooled === 0 || pooled === 1) return { z: 0, pValue: lift > 0 ? 0 : 1, lift, treatRate, holdRate };
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / treatN + 1 / holdN));
  if (se === 0) return { z: 0, pValue: 0.5, lift, treatRate, holdRate };
  const z = lift / se;
  return { z, pValue: 1 - normalCDF(z), lift, treatRate, holdRate };
}

/** Estimate additional treatment observations to reach p < 0.05 given current data. */
function etaObs(currentN: number, pValue: number): number | null {
  if (pValue < 0.05) return 0;
  if (currentN === 0) return null;
  return Math.min(10_000, Math.round(currentN * (pValue / 0.05)));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const { id } = await params;
    const armId = parseInt(id);
    if (isNaN(armId)) {
      return NextResponse.json({ error: "Invalid arm id" }, { status: 400 });
    }

    const [arm] = await db
      .select()
      .from(variantArms)
      .where(and(eq(variantArms.id, armId), eq(variantArms.teamId, teamId)))
      .limit(1);

    if (!arm) {
      return NextResponse.json({ error: "Variant arm not found" }, { status: 404 });
    }

    // ── Resolve treatment and holdout arms for this contentType ───────────────
    const sibling = await db
      .select()
      .from(variantArms)
      .where(and(
        eq(variantArms.teamId, teamId),
        eq(variantArms.contentType, arm.contentType),
        eq(variantArms.isActive, true)
      ));
    const treatmentArm = sibling.find(a => a.armName === "treatment") ?? arm;
    const holdoutArm   = sibling.find(a => a.armName === "holdout");
    const treatTag = `va-${treatmentArm.id}`;
    const holdTag  = holdoutArm ? `va-${holdoutArm.id}` : null;

    const cpm = contentPerformanceMetrics;
    const now = Date.now();

    // ── Gate A: Minimum 200 treatment-tagged observations ─────────────────────
    const [obsResult] = await db
      .select({ n: count() })
      .from(cpm)
      .where(and(
        eq(cpm.teamId, teamId),
        eq(cpm.contentType, arm.contentType),
        eq(cpm.variantId, treatTag)
      ));
    const treatObsTotal = Number(obsResult?.n ?? 0);
    const gateA = treatObsTotal >= 200;

    // ── Gate B: Two non-overlapping 14-day windows — z-test p<0.05 each ───────
    // Window 1: [now-28d, now-14d)   Window 2: [now-14d, now)
    const w1Gte = new Date(now - 28 * 86_400_000);
    const w1Lt  = new Date(now - 14 * 86_400_000);
    const w2Gte = new Date(now - 14 * 86_400_000);

    const windowObs = async (gte_: Date, lt_: Date | null, variantTag: string) => {
      const cond = lt_
        ? and(eq(cpm.teamId, teamId), eq(cpm.contentType, arm.contentType),
               eq(cpm.variantId, variantTag), gte(cpm.createdAt, gte_), lt(cpm.createdAt, lt_))
        : and(eq(cpm.teamId, teamId), eq(cpm.contentType, arm.contentType),
               eq(cpm.variantId, variantTag), gte(cpm.createdAt, gte_));
      const [r] = await db
        .select({
          successes: sql<number>`sum(case when ${cpm.isSuccess} = 1 then 1 else 0 end)`,
          total: count(),
        })
        .from(cpm)
        .where(cond);
      return { successes: Number(r?.successes ?? 0), total: Number(r?.total ?? 0) };
    };

    const [w1T, w1H, w2T, w2H] = await Promise.all([
      windowObs(w1Gte, w1Lt, treatTag),
      holdTag ? windowObs(w1Gte, w1Lt, holdTag) : Promise.resolve({ successes: 0, total: 0 }),
      windowObs(w2Gte, null, treatTag),
      holdTag ? windowObs(w2Gte, null, holdTag) : Promise.resolve({ successes: 0, total: 0 }),
    ]);

    const w1Stat = twoProportionZ(w1T.successes, w1T.total, w1H.successes, w1H.total);
    const w2Stat = twoProportionZ(w2T.successes, w2T.total, w2H.successes, w2H.total);

    const w1Sig = w1Stat.pValue < 0.05 && w1Stat.lift > 0;
    const w2Sig = w2Stat.pValue < 0.05 && w2Stat.lift > 0;
    const gateB = w1Sig && w2Sig;

    // ── Gate C: No guardrail_conflict cohort insights in last 14 days ─────────
    const [conflictRes] = await db
      .select({ n: count() })
      .from(cohortInsights)
      .where(and(
        eq(cohortInsights.teamId, teamId),
        eq(cohortInsights.insightType, "guardrail_conflict"),
        gte(cohortInsights.computedAt, new Date(now - 14 * 86_400_000))
      ));
    const recentConflicts = Number(conflictRes?.n ?? 0);
    const gateC = recentConflicts === 0;

    // ── Readiness score: A=30, B=40, C=30 ────────────────────────────────────
    const readinessScore = (gateA ? 30 : 0) + (gateB ? 40 : 0) + (gateC ? 30 : 0);

    const gateDetails = {
      gateA: {
        label: "≥200 treatment observations",
        passed: gateA,
        value: treatObsTotal,
        required: 200,
        etaObs: etaObs(treatObsTotal, gateA ? 0 : 1),
      },
      gateB: {
        label: "Both non-overlapping 14-day windows significant (p<0.05, treatment > holdout)",
        passed: gateB,
        w1: {
          window: "28d–14d ago",
          treatN: w1T.total,
          holdN: w1H.total,
          treatRate: Math.round(w1Stat.treatRate * 1000) / 1000,
          holdRate: Math.round(w1Stat.holdRate * 1000) / 1000,
          lift: Math.round(w1Stat.lift * 1000) / 1000,
          pValue: Math.round(w1Stat.pValue * 1000) / 1000,
          significant: w1Sig,
          eta: etaObs(w1T.total, w1Stat.pValue),
        },
        w2: {
          window: "14d–now",
          treatN: w2T.total,
          holdN: w2H.total,
          treatRate: Math.round(w2Stat.treatRate * 1000) / 1000,
          holdRate: Math.round(w2Stat.holdRate * 1000) / 1000,
          lift: Math.round(w2Stat.lift * 1000) / 1000,
          pValue: Math.round(w2Stat.pValue * 1000) / 1000,
          significant: w2Sig,
          eta: etaObs(w2T.total, w2Stat.pValue),
        },
      },
      gateC: {
        label: "No guardrail conflicts in last 14 days",
        passed: gateC,
        recentConflicts,
      },
    };

    if (readinessScore < 100) {
      return NextResponse.json(
        {
          error: "PREMATURE_PROMOTION",
          message: "Not all promotion gates satisfied. Continue collecting data.",
          readinessScore,
          gateDetails,
        },
        { status: 422 }
      );
    }

    // ── All gates passed: commit top Thompson-sampled patterns as baseline ─────
    const topPatterns = await db
      .select({
        patternId: learningPatterns.id,
        successes: sql<number>`coalesce(sum(${patternDimensionStats.successes}), 0)`,
        trials: sql<number>`coalesce(sum(${patternDimensionStats.trials}), 0)`,
      })
      .from(learningPatterns)
      .leftJoin(patternDimensionStats, eq(patternDimensionStats.patternId, learningPatterns.id))
      .where(and(
        eq(learningPatterns.teamId, teamId),
        eq(learningPatterns.contentType, arm.contentType),
        eq(learningPatterns.isArchived, false)
      ))
      .groupBy(learningPatterns.id)
      .limit(50);

    const scored = topPatterns.map(p => {
      const s = Number(p.successes);
      const t = Number(p.trials);
      return { id: p.patternId, score: thompsonSample(s + 1, Math.max(1, t - s + 1)) };
    });
    const winner = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(p => p.id);

    const [updated] = await db
      .update(variantArms)
      .set({ baselinePatternIds: winner, isActive: true })
      .where(and(eq(variantArms.id, armId), eq(variantArms.teamId, teamId)))
      .returning();

    console.log(
      `[WINNER_DECLARED] teamId=${teamId} armId=${armId} contentType=${arm.contentType} ` +
      `patterns=${JSON.stringify(winner)} readiness=${readinessScore}`
    );

    return NextResponse.json({
      message: "Winner declared",
      arm: updated,
      baselinePatternIds: winner,
      readinessScore,
      gateDetails,
    });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[declare-winner POST]", err);
    return NextResponse.json({ error: "Failed to declare winner" }, { status: 500 });
  }
}
