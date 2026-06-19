import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  learningPatterns,
  patternDimensionStats,
  variantArms,
} from "@/shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { learningService, thompsonSample, METRIC_WEIGHTS } from "@/lib/learning-service";

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
      const dim = "engagement";
      const key = `${p.id}:${dim}`;
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
        successRate: p.successRate,
        timesUsed: p.timesUsed,
        alpha,
        beta,
        wilsonScore: stat?.wilsonScore ?? 0,
        thompsonScore,
      };
    });

    const totalTrials = enrichedPatterns.reduce((s, p) => s + (p.alpha + p.beta - 2), 0);
    const readinessScore = computeReadiness(totalTrials, arms);

    return NextResponse.json({
      contentType,
      maturity,
      patterns: enrichedPatterns.slice(0, 20),
      arms,
      readinessScore,
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

function computeReadiness(totalTrials: number, arms: any[]): number {
  let score = 0;
  if (totalTrials >= 200) score += 30;
  else if (totalTrials >= 100) score += 15;
  const hasMultipleArms = arms.length >= 2;
  if (hasMultipleArms) score += 40;
  if (totalTrials >= 50) score += 30;
  return Math.min(100, score);
}
