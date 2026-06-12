import { db } from "./db";
import { eq, and, gte, lt, desc, sql, inArray } from "drizzle-orm";
import {
  learningPatterns,
  patternDimensionStats,
  contentReviews,
  contentPerformanceMetrics,
  aiLearningLedger,
} from "../shared/schema";
import type { Dimension } from "./content-review-service";

const ALL_DIMS: Dimension[] = ["completeness", "factuality", "structure", "humanness", "engagement"];
const DRIFT_WARN_POINTS = 6;
const MIN_WINDOW_SAMPLES = 10;

export class LearningMonitorService {
  private static instance: LearningMonitorService;
  static getInstance() {
    if (!this.instance) this.instance = new LearningMonitorService();
    return this.instance;
  }

  async dimensionLeaderboard(
    teamId: number,
    dimension: Dimension,
    opts: { minTrials?: number; limit?: number } = {}
  ) {
    const minTrials = opts.minTrials ?? 5;
    const limit = opts.limit ?? 10;

    const rows = await db
      .select({
        patternId: learningPatterns.id,
        name: learningPatterns.patternName,
        type: learningPatterns.patternType,
        wilson: patternDimensionStats.wilsonScore,
        successes: patternDimensionStats.successes,
        trials: patternDimensionStats.trials,
      })
      .from(patternDimensionStats)
      .innerJoin(learningPatterns, eq(learningPatterns.id, patternDimensionStats.patternId))
      .where(and(
        eq(learningPatterns.teamId, teamId),
        eq(patternDimensionStats.dimension, dimension),
        gte(patternDimensionStats.trials, minTrials)
      ))
      .orderBy(desc(patternDimensionStats.wilsonScore));

    return {
      dimension,
      best: rows.slice(0, limit),
      worst: rows.slice(-limit).reverse(),
      proven: rows.length,
    };
  }

  async dimensionDrift(
    teamId: number,
    opts: { contentType?: string; recentDays?: number; baselineDays?: number } = {}
  ) {
    const recentDays = opts.recentDays ?? 7;
    const baselineDays = opts.baselineDays ?? 28;

    const out = [];
    for (const dim of ALL_DIMS) {
      const recentCutoff = new Date(Date.now() - recentDays * 86400_000);
      const baselineCutoff = new Date(Date.now() - baselineDays * 86400_000);

      const recentRows = await db
        .select({ scores: contentReviews.dimensionScoresJson })
        .from(contentReviews)
        .where(and(
          eq(contentReviews.teamId, teamId),
          opts.contentType ? eq(contentReviews.contentType, opts.contentType) : undefined,
          gte(contentReviews.reviewedAt, recentCutoff)
        ));

      const baselineRows = await db
        .select({ scores: contentReviews.dimensionScoresJson })
        .from(contentReviews)
        .where(and(
          eq(contentReviews.teamId, teamId),
          opts.contentType ? eq(contentReviews.contentType, opts.contentType) : undefined,
          gte(contentReviews.reviewedAt, baselineCutoff),
          lt(contentReviews.reviewedAt, recentCutoff)
        ));

      const avg = (rows: typeof recentRows) => {
        if (rows.length === 0) return 0;
        const sum = rows.reduce((acc, r) => acc + ((r.scores as any)?.[dim] ?? 0), 0);
        return sum / rows.length;
      };

      const recentAvg = Math.round(avg(recentRows));
      const baselineAvg = Math.round(avg(baselineRows));
      const delta = recentAvg - baselineAvg;
      const enoughData = recentRows.length >= MIN_WINDOW_SAMPLES;

      out.push({
        dimension: dim,
        recentAvg,
        baselineAvg,
        delta,
        recentSamples: recentRows.length,
        drifting: enoughData && delta <= -DRIFT_WARN_POINTS,
        note: !enoughData ? "insufficient recent data" : undefined,
      });
    }
    return out;
  }

  async topDefects(teamId: number, opts: { contentType?: string; limit?: number } = {}) {
    const limit = opts.limit ?? 10;
    const rows = await db
      .select()
      .from(aiLearningLedger)
      .where(and(
        eq(aiLearningLedger.teamId, teamId),
        opts.contentType ? eq(aiLearningLedger.contentType, opts.contentType) : undefined
      ))
      .orderBy(desc(aiLearningLedger.count))
      .limit(limit);

    const now = Date.now();
    return rows.map(r => ({
      defect: r.errorType,
      contentType: r.contentType,
      count: r.count,
      lastSeen: r.lastOccurrence,
      status: now - new Date(r.lastOccurrence).getTime() < 7 * 86400_000 ? "active" : "stale",
    }));
  }

  async cohortReadiness(teamId: number, dimension: Dimension = "engagement") {
    const statsRows = await db
      .select({ trials: patternDimensionStats.trials })
      .from(patternDimensionStats)
      .innerJoin(learningPatterns, eq(learningPatterns.id, patternDimensionStats.patternId))
      .where(and(
        eq(learningPatterns.teamId, teamId),
        eq(patternDimensionStats.dimension, dimension)
      ));

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(learningPatterns)
      .where(eq(learningPatterns.teamId, teamId));

    const exploring = statsRows.filter(r => r.trials >= 1 && r.trials < 5).length;
    const proven = statsRows.filter(r => r.trials >= 5).length;
    const untouched = Number(total) - statsRows.length;

    return { dimension, untouched, exploring, proven, total: Number(total) };
  }

  async enginePatternDrift(teamId: number, opts: { recentDays?: number; minRecent?: number } = {}) {
    const recentDays = opts.recentDays ?? 14;
    const minRecent = opts.minRecent ?? 4;
    const since = new Date(Date.now() - recentDays * 86400_000);

    const recent = await db
      .select({
        patternsUsedJson: contentPerformanceMetrics.patternsUsedJson,
        isSuccess: contentPerformanceMetrics.isSuccess,
      })
      .from(contentPerformanceMetrics)
      .where(and(
        eq(contentPerformanceMetrics.teamId, teamId),
        gte(contentPerformanceMetrics.updatedAt, since)
      ));

    const tally = new Map<number, { s: number; n: number }>();
    for (const m of recent) {
      if (m.isSuccess === null) continue;
      const ids = (m.patternsUsedJson as number[]) || [];
      for (const id of ids) {
        const t = tally.get(id) ?? { s: 0, n: 0 };
        t.s += m.isSuccess === 1 ? 1 : 0;
        t.n += 1;
        tally.set(id, t);
      }
    }

    const ids = [...tally.keys()].filter(id => (tally.get(id)!.n) >= minRecent);
    if (ids.length === 0) return [];

    const lifetime = await db
      .select({
        patternId: patternDimensionStats.patternId,
        wilson: patternDimensionStats.wilsonScore,
        name: learningPatterns.patternName,
      })
      .from(patternDimensionStats)
      .innerJoin(learningPatterns, eq(learningPatterns.id, patternDimensionStats.patternId))
      .where(and(
        eq(patternDimensionStats.dimension, "engagement"),
        inArray(patternDimensionStats.patternId, ids)
      ));

    return lifetime
      .map(l => {
        const t = tally.get(l.patternId)!;
        const recentRate = Math.round((t.s / t.n) * 100);
        return {
          patternId: l.patternId,
          name: l.name,
          lifetimeWilson: l.wilson,
          recentRate,
          recentSamples: t.n,
          gap: recentRate - l.wilson,
          drifting: recentRate - l.wilson <= -15,
        };
      })
      .sort((a, b) => a.gap - b.gap);
  }

  async snapshot(teamId: number, contentType?: string) {
    const [drift, defects, readiness, engineDrift, ...boards] = await Promise.all([
      this.dimensionDrift(teamId, { contentType }),
      this.topDefects(teamId, { contentType }),
      this.cohortReadiness(teamId),
      this.enginePatternDrift(teamId),
      ...ALL_DIMS.map(d => this.dimensionLeaderboard(teamId, d, { limit: 5 })),
    ]);

    const alerts: string[] = [];
    drift!.filter(d => d.drifting).forEach(d =>
      alerts.push(`${d.dimension} drifting ${d.delta} pts (${d.recentAvg} vs ${d.baselineAvg} baseline)`)
    );
    engineDrift!.filter(p => p.drifting).forEach(p =>
      alerts.push(`Pattern "${p.name}" engagement dropped ${p.gap} pts vs lifetime`)
    );
    if (readiness!.untouched > 0 && readiness!.exploring === 0)
      alerts.push(`${readiness!.untouched} patterns never tried — exploration may be off`);

    return { alerts, drift, leaderboards: boards, topDefects: defects, readiness, engineDrift };
  }
}

export const learningMonitorService = LearningMonitorService.getInstance();
