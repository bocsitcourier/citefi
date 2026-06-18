/**
 * Cohort Strategy Intelligence Service — T017
 *
 * Aggregates Bayesian arm performance by cohort dimensions (contentType, locale,
 * persona, channel) and produces per-cohort winner recommendations with
 * confidence thresholds.
 *
 * No new DB table: uses decision_policies, decision_arms, holdout_assignments,
 * articles, job_batches, locales, and social_posts via raw SQL aggregation.
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CohortThresholds {
  minImpressions: number;      // default 30
  minLift: number;             // default 0.05 (5%)
  minProbabilityBeatsHoldout: number; // default 0.80
}

export interface ArmMetrics {
  policyId: number;
  armId: number;
  label: string | null;
  contentTitle: string | null;
  impressions: number;
  conversions: number;
  conversionRate: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  posteriorMean: number;
  credibleInterval95: { lower: number; upper: number };
  holdoutMean: number;      // policy-level holdout baseline
  holdoutScope: "policy";   // exact per-cohort holdout not possible (policies are cohort-agnostic)
  liftVsHoldout: number;    // (posteriorMean - holdoutMean) / max(holdoutMean, 0.001)
  probabilityBeatsHoldout: number; // P(arm > holdout) via normal approximation of Beta difference
  confidence: "low" | "medium" | "high";
  isWinner: boolean;
}

export interface CohortGroup {
  cohortKey: string;
  policyId: number;
  contentType: string;
  locale: string | null;
  personaId: number | null;
  personaName?: string | null;
  channel: string | null;
  arms: ArmMetrics[];
  winnerArmId: number | null;
}

export interface CohortRecommendation {
  cohortKey: string;
  winningArmId: number;
  action: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  liftVsHoldout: number;
}

export interface CohortStrategyResponse {
  cohorts: CohortGroup[];
  recommendations: CohortRecommendation[];
  count: number;
  generatedAt: string;
  thresholds: CohortThresholds;
}

// ─── Beta statistics helpers ────────────────────────────────────────────────

function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

function betaVariance(alpha: number, beta: number): number {
  const sum = alpha + beta;
  return (alpha * beta) / (sum * sum * (sum + 1));
}

function betaCI95(alpha: number, beta: number): { lower: number; upper: number } {
  const mean = betaMean(alpha, beta);
  const sd = Math.sqrt(betaVariance(alpha, beta));
  return {
    lower: Math.max(0, mean - 1.96 * sd),
    upper: Math.min(1, mean + 1.96 * sd),
  };
}

// Standard normal CDF approximation (Abramowitz & Stegun 26.2.17, max error 7.5e-8)
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

/**
 * P(arm > holdout) using normal approximation of the difference of two Beta
 * posterior distributions.
 */
function probabilityBeatsBaseline(
  armAlpha: number,
  armBeta: number,
  holdoutAlpha: number,
  holdoutBeta: number
): number {
  const armMean = betaMean(armAlpha, armBeta);
  const holdoutMean = betaMean(holdoutAlpha, holdoutBeta);
  const combinedSd = Math.sqrt(
    betaVariance(armAlpha, armBeta) + betaVariance(holdoutAlpha, holdoutBeta)
  );
  if (combinedSd < 1e-10) return armMean > holdoutMean ? 1 : 0;
  return normalCdf((armMean - holdoutMean) / combinedSd);
}

function computeConfidence(
  impressions: number,
  probabilityBeatsHoldout: number,
  thresholds: CohortThresholds
): "low" | "medium" | "high" {
  if (impressions >= 100 && probabilityBeatsHoldout >= 0.95) return "high";
  if (impressions >= thresholds.minImpressions && probabilityBeatsHoldout >= thresholds.minProbabilityBeatsHoldout) {
    return "medium";
  }
  return "low";
}

// ─── Holdout baseline query ─────────────────────────────────────────────────

interface HoldoutRow {
  policy_id: number;
  holdout_impressions: number;
  holdout_conversions: number;
}

async function fetchHoldoutBaselines(teamId: number): Promise<Map<number, { alpha: number; beta: number; mean: number }>> {
  // Count only rows where outcome has been observed (not passive untracked assignments).
  // outcome IN ('impression','conversion') = visitor was exposed and tracked.
  const rows = await db.execute<HoldoutRow>(sql`
    SELECT
      policy_id,
      COUNT(*) FILTER (WHERE outcome IN ('impression','conversion')) AS holdout_impressions,
      COUNT(*) FILTER (WHERE outcome = 'conversion')                  AS holdout_conversions
    FROM holdout_assignments
    WHERE team_id = ${teamId}
      AND is_holdout = TRUE
    GROUP BY policy_id
  `);

  const map = new Map<number, { alpha: number; beta: number; mean: number }>();
  for (const row of rows.rows ?? rows as any[]) {
    const imps = Number(row.holdout_impressions) || 0;
    const convs = Number(row.holdout_conversions) || 0;
    const alpha = 1 + convs;
    const beta = 1 + Math.max(0, imps - convs);
    map.set(Number(row.policy_id), { alpha, beta, mean: betaMean(alpha, beta) });
  }
  return map;
}

// ─── Arm aggregation query ──────────────────────────────────────────────────

interface ArmRow {
  policy_id: number;
  arm_id: number;
  arm_content_type: string;
  label: string | null;
  posterior_alpha: number;
  posterior_beta: number;
  impressions: number;
  conversions: number;
  // Cohort dimensions
  article_title: string | null;
  social_title: string | null;
  locale_city: string | null;
  locale_region: string | null;
  persona_id: number | null;
  persona_name: string | null;
  social_location: string | null;
  first_platform: string | null;
}

async function fetchArmRows(teamId: number, contentType?: string): Promise<ArmRow[]> {
  const ctFilter = contentType ? sql`AND da.content_type = ${contentType}` : sql``;

  const result = await db.execute<ArmRow>(sql`
    SELECT
      dp.id                                                    AS policy_id,
      da.id                                                    AS arm_id,
      da.content_type                                          AS arm_content_type,
      da.label,
      da.posterior_alpha,
      da.posterior_beta,
      da.impressions,
      da.conversions,
      -- Article metadata (when arm content_type = 'article')
      a.chosen_title                                           AS article_title,
      l.city                                                   AS locale_city,
      l.region                                                 AS locale_region,
      jb.persona_id,
      ap.name                                                  AS persona_name,
      -- Social post metadata (when arm content_type = 'social_post')
      sp.title                                                 AS social_title,
      sp.location                                              AS social_location,
      (sp.platforms_json ->> 0)                               AS first_platform
    FROM decision_policies dp
    JOIN decision_arms da ON da.policy_id = dp.id
    LEFT JOIN articles a     ON da.article_id    = a.id    AND da.content_type = 'article'
    LEFT JOIN job_batches jb ON a.batch_id        = jb.id
    LEFT JOIN locales l      ON a.locale_id       = l.id
    LEFT JOIN audience_personas ap ON jb.persona_id = ap.id
    LEFT JOIN social_posts sp ON da.social_post_id = sp.id   AND da.content_type = 'social_post'
    WHERE dp.team_id = ${teamId}
      AND da.active = TRUE
      AND dp.active = TRUE
      ${ctFilter}
    ORDER BY dp.id, da.id
  `);

  return result.rows ?? (result as any[]);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function getCohortStrategy(
  teamId: number,
  options: {
    contentType?: string;
    minImpressions?: number;
    minLift?: number;
    minProbabilityBeatsHoldout?: number;
  } = {}
): Promise<CohortStrategyResponse> {
  const thresholds: CohortThresholds = {
    minImpressions: options.minImpressions ?? 30,
    minLift: options.minLift ?? 0.05,
    minProbabilityBeatsHoldout: options.minProbabilityBeatsHoldout ?? 0.8,
  };

  const [armRows, holdoutMap] = await Promise.all([
    fetchArmRows(teamId, options.contentType),
    fetchHoldoutBaselines(teamId),
  ]);

  // Group arms by cohort key
  const cohortMap = new Map<string, {
    policyId: number;
    contentType: string;
    locale: string | null;
    personaId: number | null;
    personaName: string | null;
    channel: string | null;
    rawArms: ArmRow[];
  }>();

  for (const row of armRows) {
    const ct = row.arm_content_type;
    const locale =
      ct === "article"
        ? (row.locale_city ?? row.locale_region ?? null)
        : (row.social_location ?? null);
    const personaId = ct === "article" ? (row.persona_id ?? null) : null;
    const personaName = ct === "article" ? (row.persona_name ?? null) : null;
    const channel = ct === "social_post" ? (row.first_platform ?? null) : null;

    // policyId scopes the cohort so each arm uses its own holdout baseline
    const key = `${ct}|${Number(row.policy_id)}|${locale ?? ""}|${personaId ?? ""}|${channel ?? ""}`;

    if (!cohortMap.has(key)) {
      cohortMap.set(key, {
        policyId: Number(row.policy_id),
        contentType: ct,
        locale,
        personaId,
        personaName,
        channel,
        rawArms: [],
      });
    }
    cohortMap.get(key)!.rawArms.push(row);
  }

  // Compute metrics per cohort
  const cohorts: CohortGroup[] = [];
  const recommendations: CohortRecommendation[] = [];

  for (const [cohortKey, cohort] of cohortMap.entries()) {
    // Each cohort has exactly one policyId → use that policy's holdout baseline
    const holdoutBase = holdoutMap.get(cohort.policyId);
    const holdoutAlpha = holdoutBase?.alpha ?? 1;
    const holdoutBeta = holdoutBase?.beta ?? 1;
    const holdoutMean = holdoutBase?.mean ?? betaMean(1, 1);

    const arms: ArmMetrics[] = cohort.rawArms.map((row) => {
      const alpha = Number(row.posterior_alpha) || 1;
      const beta = Number(row.posterior_beta) || 1;
      const impressions = Number(row.impressions) || 0;
      const conversions = Number(row.conversions) || 0;
      const conversionRate = impressions > 0 ? conversions / impressions : 0;
      const posteriorMean = betaMean(alpha, beta);
      const ci = betaCI95(alpha, beta);
      const probBeats = probabilityBeatsBaseline(alpha, beta, holdoutAlpha, holdoutBeta);
      const liftVsHoldout = (posteriorMean - holdoutMean) / Math.max(holdoutMean, 0.001);
      const confidence = computeConfidence(impressions, probBeats, thresholds);

      return {
        policyId: Number(row.policy_id),
        armId: Number(row.arm_id),
        label: row.label,
        contentTitle: row.article_title ?? row.social_title ?? null,
        impressions,
        conversions,
        conversionRate,
        posteriorAlpha: alpha,
        posteriorBeta: beta,
        posteriorMean,
        credibleInterval95: ci,
        holdoutMean,
        holdoutScope: "policy",
        liftVsHoldout,
        probabilityBeatsHoldout: probBeats,
        confidence,
        isWinner: false, // set below
      };
    });

    // Identify winner: highest posteriorMean among arms meeting thresholds
    let winner: ArmMetrics | null = null;
    for (const arm of arms) {
      if (
        arm.impressions >= thresholds.minImpressions &&
        arm.liftVsHoldout >= thresholds.minLift &&
        arm.probabilityBeatsHoldout >= thresholds.minProbabilityBeatsHoldout
      ) {
        if (!winner || arm.posteriorMean > winner.posteriorMean) {
          winner = arm;
        }
      }
    }
    if (winner) {
      winner.isWinner = true;
      const reason = [
        `Conversion rate ${(winner.conversionRate * 100).toFixed(1)}%`,
        `lift +${(winner.liftVsHoldout * 100).toFixed(1)}% vs holdout`,
        `P(beats holdout) = ${(winner.probabilityBeatsHoldout * 100).toFixed(0)}%`,
        `(n=${winner.impressions})`,
      ].join(", ");

      recommendations.push({
        cohortKey,
        winningArmId: winner.armId,
        action: "deploy_winner",
        reason,
        confidence: winner.confidence,
        liftVsHoldout: winner.liftVsHoldout,
      });
    }

    cohorts.push({
      cohortKey,
      policyId: cohort.policyId,
      contentType: cohort.contentType,
      locale: cohort.locale,
      personaId: cohort.personaId,
      personaName: cohort.personaName,
      channel: cohort.channel,
      arms,
      winnerArmId: winner?.armId ?? null,
    });
  }

  return {
    cohorts,
    recommendations,
    count: cohorts.length,
    generatedAt: new Date().toISOString(),
    thresholds,
  };
}
