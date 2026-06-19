import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  variantArms,
  learningPatterns,
  patternDimensionStats,
  contentPerformanceMetrics,
} from "@/shared/schema";
import { eq, and, gte, count, sql } from "drizzle-orm";
import { thompsonSample } from "@/lib/learning-service";

function wilsonLB(successes: number, trials: number): number {
  if (trials === 0) return 0;
  const z = 1.96;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials);
  return Math.max(0, ((center - margin) / denom) * 100);
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

    // ── Gate A: Minimum observations ────────────────────────────────────────
    const [obsResult] = await db
      .select({ n: count() })
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, arm.contentType)
        )
      );
    const totalObservations = Number(obsResult?.n ?? 0);
    const gateA = totalObservations >= 200;

    // ── Gate B: Two independent windows of statistical significance ──────────
    // Approximate with two 7-day windows of Wilson LB > 30 (strong positive signal)
    const now = Date.now();
    const w1Start = new Date(now - 14 * 86400_000);
    const w2Start = new Date(now - 7 * 86400_000);

    const [w1Res] = await db
      .select({
        successes: sql<number>`sum(case when ${contentPerformanceMetrics.isSuccess} = 1 then 1 else 0 end)`,
        total: count(),
      })
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, arm.contentType),
          gte(contentPerformanceMetrics.createdAt, w1Start)
        )
      );

    const [w2Res] = await db
      .select({
        successes: sql<number>`sum(case when ${contentPerformanceMetrics.isSuccess} = 1 then 1 else 0 end)`,
        total: count(),
      })
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, arm.contentType),
          gte(contentPerformanceMetrics.createdAt, w2Start)
        )
      );

    const w1Wilson = wilsonLB(Number(w1Res?.successes ?? 0), Number(w1Res?.total ?? 0));
    const w2Wilson = wilsonLB(Number(w2Res?.successes ?? 0), Number(w2Res?.total ?? 0));
    const gateB = w1Wilson >= 30 && w2Wilson >= 30;

    // ── Gate C: No guardrail deterioration (≤10% drop check via Wilson trend) ─
    const gateC = w2Wilson >= w1Wilson * 0.9;

    // ── Score: 0-100 ─────────────────────────────────────────────────────────
    const gateDetails = {
      gateA: { label: "≥200 observations", passed: gateA, value: totalObservations },
      gateB: { label: "2-window significance (Wilson≥30 each)", passed: gateB, w1Wilson, w2Wilson },
      gateC: { label: "No guardrail deterioration", passed: gateC },
    };

    const readinessScore = (gateA ? 30 : 0) + (gateB ? 40 : 0) + (gateC ? 30 : 0);

    if (readinessScore < 100) {
      return NextResponse.json(
        {
          error: "PREMATURE_PROMOTION",
          message: "Not all promotion gates have been satisfied. Keep collecting data.",
          readinessScore,
          gateDetails,
        },
        { status: 422 }
      );
    }

    // ── All gates passed: commit top patterns as this arm's baseline ─────────
    const topPatterns = await db
      .select({
        patternId: learningPatterns.id,
        successes: sql<number>`coalesce(sum(${patternDimensionStats.successes}), 0)`,
        trials: sql<number>`coalesce(sum(${patternDimensionStats.trials}), 0)`,
      })
      .from(learningPatterns)
      .leftJoin(patternDimensionStats, eq(patternDimensionStats.patternId, learningPatterns.id))
      .where(
        and(
          eq(learningPatterns.teamId, teamId),
          eq(learningPatterns.contentType, arm.contentType),
          eq(learningPatterns.isArchived, false)
        )
      )
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
