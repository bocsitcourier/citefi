import { db } from "./db";
import { eq, and, lte, isNull, inArray } from "drizzle-orm";
import {
  contentPerformanceMetrics,
  patternDimensionStats,
  learningPatterns,
  ContentType,
} from "../shared/schema";
import { wilsonLowerBound } from "./content-review-service";

const MATURITY_HOURS: Record<string, number> = {
  [ContentType.SOCIAL]: 72,
  [ContentType.VIDEO]: 168,
  [ContentType.PODCAST]: 336,
  [ContentType.ARTICLE]: 336,
};

const MIN_REACH: Record<string, number> = {
  [ContentType.SOCIAL]: 500,
  [ContentType.VIDEO]: 200,
  [ContentType.PODCAST]: 100,
  [ContentType.ARTICLE]: 100,
};

type Weights = { engagementRate: number; dwell: number; bounce: number; shareRate: number };
const CHANNEL_WEIGHTS: Record<string, Weights> = {
  [ContentType.ARTICLE]: { engagementRate: 0.20, dwell: 0.40, bounce: 0.25, shareRate: 0.15 },
  [ContentType.SOCIAL]:  { engagementRate: 0.45, dwell: 0.00, bounce: 0.00, shareRate: 0.55 },
  [ContentType.VIDEO]:   { engagementRate: 0.30, dwell: 0.45, bounce: 0.05, shareRate: 0.20 },
  [ContentType.PODCAST]: { engagementRate: 0.30, dwell: 0.55, bounce: 0.00, shareRate: 0.15 },
};

const SUCCESS_CUTOFF = 0.62;
const FAIL_CUTOFF = 0.35;
const MIN_COHORT = 8;

function toPercentiles(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const pct = new Array(n).fill(0);
  order.forEach((item, rank) => { pct[item.i] = rank / (n - 1); });
  return pct;
}

interface MetricRow {
  id: number;
  views: number | null;
  clicks: number | null;
  shares: number | null;
  likes: number | null;
  comments: number | null;
  timeOnPage: number | null;
  bounceRate: number | null;
  patternsUsedJson: unknown;
  createdAt: Date;
}

export class EngagementScoringService {
  private static instance: EngagementScoringService;
  static getInstance() {
    if (!this.instance) this.instance = new EngagementScoringService();
    return this.instance;
  }

  async labelMaturedContent(
    teamId: number,
    contentType: string
  ): Promise<{
    cohort: number;
    labeledSuccess: number;
    labeledFail: number;
    skippedAmbiguous: number;
    skippedLowReach: number;
  }> {
    const maturityHrs = MATURITY_HOURS[contentType] ?? 168;
    const minReach = MIN_REACH[contentType] ?? 100;
    const weights = CHANNEL_WEIGHTS[contentType] ?? CHANNEL_WEIGHTS[ContentType.ARTICLE]!;
    const cutoff = new Date(Date.now() - maturityHrs * 3600_000);

    const rows = (await db
      .select()
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, contentType),
          isNull(contentPerformanceMetrics.isSuccess),
          lte(contentPerformanceMetrics.createdAt, cutoff)
        )
      )) as unknown as MetricRow[];

    const reachOf = (m: MetricRow) => m.views ?? 0;
    const distributed = rows.filter(m => reachOf(m) >= minReach);
    const lowReach = rows.filter(m => reachOf(m) < minReach);
    const skippedLowReach = lowReach.length;

    // Stamp low-reach items with successReason="insufficient_data" so the monitor
    // can distinguish "not yet labeled" from "known no-reach — not actionable".
    // isSuccess remains NULL — we intentionally do not label these.
    if (lowReach.length > 0) {
      const lowReachIds = lowReach.map(m => m.id);
      await db
        .update(contentPerformanceMetrics)
        .set({ successReason: "insufficient_data", updatedAt: new Date() })
        .where(inArray(contentPerformanceMetrics.id, lowReachIds));
      console.log(`📉 [Engagement] ${contentType}: ${lowReach.length} items stamped insufficient_data (views < ${minReach})`);
    }

    if (distributed.length < MIN_COHORT) {
      console.log(`📉 [Engagement] ${contentType}: only ${distributed.length} matured pieces with reach ≥ ${minReach} (need ${MIN_COHORT}) — waiting`);
      return { cohort: distributed.length, labeledSuccess: 0, labeledFail: 0, skippedAmbiguous: 0, skippedLowReach };
    }

    const comps = distributed.map(m => this.rawComponents(m));
    const pERate  = toPercentiles(comps.map(c => c.engagementRate));
    const pDwell  = toPercentiles(comps.map(c => c.dwell));
    const pBounce = toPercentiles(comps.map(c => c.bounceQuality));
    const pShare  = toPercentiles(comps.map(c => c.shareRate));

    let labeledSuccess = 0, labeledFail = 0, skippedAmbiguous = 0;

    for (let i = 0; i < distributed.length; i++) {
      const composite =
        weights.engagementRate * (pERate[i] ?? 0) +
        weights.dwell         * (pDwell[i] ?? 0) +
        weights.bounce        * (pBounce[i] ?? 0) +
        weights.shareRate     * (pShare[i] ?? 0);

      let success: boolean | null = null;
      if (composite >= SUCCESS_CUTOFF) success = true;
      else if (composite <= FAIL_CUTOFF) success = false;

      if (success === null) { skippedAmbiguous++; continue; }

      const m = distributed[i]!;
      const reason = `engagement composite ${composite.toFixed(2)} (reach ${reachOf(m)})`;

      await db
        .update(contentPerformanceMetrics)
        .set({ isSuccess: success ? 1 : 0, successReason: reason, updatedAt: new Date() })
        .where(eq(contentPerformanceMetrics.id, m.id));

      const patternIds = (m.patternsUsedJson as number[]) || [];
      await this.attributeEngagement(patternIds, success);

      if (success) labeledSuccess++; else labeledFail++;
    }

    console.log(`📊 [Engagement] ${contentType}: ${labeledSuccess} success / ${labeledFail} fail / ${skippedAmbiguous} ambiguous (cohort ${distributed.length})`);
    return { cohort: distributed.length, labeledSuccess, labeledFail, skippedAmbiguous, skippedLowReach };
  }

  private rawComponents(m: MetricRow) {
    const reach = Math.max(m.views ?? 0, 1);
    const active =
      (m.shares ?? 0) * 3 +
      (m.comments ?? 0) * 2 +
      (m.likes ?? 0) * 1 +
      (m.clicks ?? 0) * 1;
    return {
      engagementRate: active / reach,
      dwell: m.timeOnPage ?? 0,
      bounceQuality: 1 - Math.min((m.bounceRate ?? 0) > 1 ? (m.bounceRate ?? 0) / 100 : (m.bounceRate ?? 0), 1),
      shareRate: (m.shares ?? 0) / reach,
    };
  }

  // Maps pattern types to the review dimension they govern.
  // Must stay in sync with LearningService.PATTERN_DIMENSION.
  private readonly PATTERN_DIMENSION: Record<string, string> = {
    hook: "engagement", opening_style: "engagement", opening: "engagement",
    cta: "engagement", engagement: "engagement", pacing: "engagement",
    visual_style: "engagement", hashtag: "engagement",
    tone: "humanness",
    structure: "structure", format: "structure", composition: "structure",
    color: "structure", text: "structure",
    eeat_signal: "factuality",
  };

  private async attributeEngagement(patternIds: number[], success: boolean): Promise<void> {
    if (patternIds.length === 0) return;

    // Look up each pattern's type so we write Wilson data to its governing dimension
    // (eeat_signal → factuality, tone → humanness, etc.), not always "engagement".
    const patternRows = await db
      .select({ id: learningPatterns.id, patternType: learningPatterns.patternType })
      .from(learningPatterns)
      .where(inArray(learningPatterns.id, patternIds));
    const dimByPattern = new Map(
      patternRows.map(p => [p.id, this.PATTERN_DIMENSION[p.patternType] ?? "engagement"])
    );

    // Batch-fetch all existing dimension stats for these patterns in one query.
    const existing = await db
      .select()
      .from(patternDimensionStats)
      .where(inArray(patternDimensionStats.patternId, patternIds));
    const statKey = (pid: number, dim: string) => `${pid}:${dim}`;
    const byKey = new Map(existing.map(s => [statKey(s.patternId, s.dimension), s]));

    for (const pid of patternIds) {
      const dim = dimByPattern.get(pid) ?? "engagement";
      const stat = byKey.get(statKey(pid, dim));
      const successes = (stat?.successes ?? 0) + (success ? 1 : 0);
      const trials = (stat?.trials ?? 0) + 1;
      const wilson = wilsonLowerBound(successes, trials);

      if (stat) {
        await db.update(patternDimensionStats)
          .set({ successes, trials, wilsonScore: wilson, updatedAt: new Date() })
          .where(eq(patternDimensionStats.id, stat.id));
      } else {
        await db.insert(patternDimensionStats).values({
          patternId: pid, dimension: dim, successes, trials, wilsonScore: wilson,
        });
      }
    }
  }
}

export const engagementScoringService = EngagementScoringService.getInstance();
