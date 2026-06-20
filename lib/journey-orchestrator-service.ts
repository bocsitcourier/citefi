/**
 * T018 — Journey Orchestrator
 * Ties decisioning, cohort intelligence, and content together:
 * - getOrCreateActivePolicy: self-bootstraps a policy+arms for a team if none exist
 * - getNextContent: selectArm + record impression atomically
 * - recordConversion: idempotent conversion via bayesian state machine
 * - getJourneyStats: team-level funnel + top cohort recommendations
 */

import { createHash } from "crypto";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { db, getTxDb } from "./db";
import {
  decisionPolicies,
  decisionArms,
  holdoutAssignments,
  articles,
  socialPosts,
  type DecisionPolicy,
} from "../shared/schema";
import {
  selectArm,
  recordOutcome,
} from "./bayesian-decision-service";
import { getCohortStrategy, type CohortGroup } from "./cohort-strategy-service";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Must match the implementation in bayesian-decision-service.ts */
function hashVisitor(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 64);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JourneyContext {
  teamId: number;
  visitorId: string;
  contentType?: "article" | "social" | "social_post" | "podcast" | "video";
  /** City / region string for article locale matching */
  locale?: string;
  personaId?: number;
  /** Platform for social matching */
  channel?: string;
}

export interface JourneyNextResult {
  policyId: number;
  armId: number;
  isHoldout: boolean;
  contentType: string;
  content: {
    id: number;
    title: string;
    slug?: string | null;
    url?: string | null;
  } | null;
  recommendationSource: "bayesian" | "holdout";
}

export interface JourneyConvertResult {
  policyId: number;
  armId: number | null;
  recorded: boolean;
  message: string;
}

export interface JourneyFunnel {
  impressions: number;
  conversions: number;
  conversionRate: number;
}

export interface JourneyStats {
  totalVisitors: number;
  totalImpressions: number;
  totalConversions: number;
  conversionRate: number;
  treatment: JourneyFunnel;
  holdout: JourneyFunnel;
  liftVsHoldout: number | null;
  topCohorts: Array<{
    cohortKey: string;
    contentType: string;
    winnerArmId: number | null;
    arms: number;
  }>;
  recommendations: Array<{
    cohortKey: string;
    winningArmId: number;
    action: string;
    confidence: "low" | "medium" | "high";
    liftVsHoldout: number;
  }>;
}

// ---------------------------------------------------------------------------
// Content type numeric key for pg advisory lock
// ---------------------------------------------------------------------------
const CONTENT_TYPE_KEY: Record<string, number> = {
  article: 1,
  social_post: 2,
  social: 2,
  podcast: 3,
  video: 4,
};

// ---------------------------------------------------------------------------
// Internal: find active policy
// ---------------------------------------------------------------------------

async function findActivePolicy(
  teamId: number,
  contentType: string
): Promise<DecisionPolicy | null> {
  const rows = await db
    .select()
    .from(decisionPolicies)
    .where(
      and(
        eq(decisionPolicies.teamId, teamId),
        eq(decisionPolicies.contentType, contentType),
        eq(decisionPolicies.active, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function countActiveArms(policyId: number): Promise<number> {
  const rows = await db
    .select({ cnt: sql<string>`count(*)` })
    .from(decisionArms)
    .where(and(eq(decisionArms.policyId, policyId), eq(decisionArms.active, true)));
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Bootstrap: getOrCreateActivePolicy
// Advisory lock prevents concurrent duplicate bootstraps.
// All inserts run inside the transaction for atomicity.
// ---------------------------------------------------------------------------

export async function getOrCreateActivePolicy(
  teamId: number,
  contentType: string
): Promise<{ policy: DecisionPolicy; armCount: number }> {
  // Fast path: policy with active arms already exists
  const existing = await findActivePolicy(teamId, contentType);
  if (existing) {
    const armCount = await countActiveArms(existing.id);
    if (armCount > 0) return { policy: existing, armCount };
  }

  // Slow path: bootstrap inside a transaction with advisory lock
  const txDb = getTxDb();
  return txDb.transaction(async (tx) => {
    const lockKey = CONTENT_TYPE_KEY[contentType] ?? 99;
    // Lock scoped to (teamId, contentTypeKey) for the duration of this transaction
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${teamId}::int, ${lockKey}::int)`
    );

    // Re-check after lock acquisition
    const afterLock = await tx
      .select()
      .from(decisionPolicies)
      .where(
        and(
          eq(decisionPolicies.teamId, teamId),
          eq(decisionPolicies.contentType, contentType),
          eq(decisionPolicies.active, true)
        )
      )
      .limit(1);

    if (afterLock[0]) {
      const armRows = await tx
        .select({ cnt: sql<string>`count(*)` })
        .from(decisionArms)
        .where(
          and(eq(decisionArms.policyId, afterLock[0].id), eq(decisionArms.active, true))
        );
      const count = parseInt(armRows[0]?.cnt ?? "0", 10);
      if (count > 0) return { policy: afterLock[0], armCount: count };
    }

    // Select eligible content items
    type EligibleItem = { id: number; label: string; type: string };
    let eligibleItems: EligibleItem[] = [];

    if (contentType === "article") {
      const arts = await tx
        .select({ id: articles.id, title: articles.chosenTitle })
        .from(articles)
        .where(
          and(
            eq(articles.teamId, teamId),
            inArray(articles.articleStatus, ["COMPLETE", "GPT4_ENHANCED"])
          )
        )
        .orderBy(desc(articles.id))
        .limit(3);
      eligibleItems = arts.map((a) => ({
        id: a.id,
        label: a.title.slice(0, 80),
        type: "article",
      }));
    } else {
      // social / social_post / podcast / video — all fall back to social posts for now
      const posts = await tx
        .select({ id: socialPosts.id, title: socialPosts.title })
        .from(socialPosts)
        .where(and(eq(socialPosts.teamId, teamId), eq(socialPosts.status, "READY")))
        .orderBy(desc(socialPosts.id))
        .limit(3);
      eligibleItems = posts.map((p) => ({
        id: p.id,
        label: p.title.slice(0, 80),
        type: "social",
      }));
    }

    if (eligibleItems.length === 0) {
      throw Object.assign(
        new Error(
          `No eligible ${contentType} content found for team ${teamId}. ` +
            `Publish at least one article (status COMPLETE) or social post (status READY) first.`
        ),
        { status: 422 }
      );
    }

    // If a no-arm policy exists, deactivate it before creating a fresh one
    if (afterLock[0]) {
      await tx
        .update(decisionPolicies)
        .set({ active: false })
        .where(eq(decisionPolicies.id, afterLock[0].id));
    }

    // Create policy (inline — avoids calling the global-db helper inside tx)
    const [policy] = await tx
      .insert(decisionPolicies)
      .values({
        teamId,
        contentType,
        objective: "maximize_conversions",
        explorationRate: 0.1,
        holdoutPercent: 0.1,
        active: true,
      })
      .returning();

    // Create arms linked to each eligible content item
    for (const item of eligibleItems) {
      await tx.insert(decisionArms).values({
        policyId: policy.id,
        teamId,
        contentType: item.type,
        articleId: item.type === "article" ? item.id : null,
        socialPostId: (item.type === "social" || item.type === "social_post") ? item.id : null,
        label: item.label,
        priorAlpha: 1.0,
        priorBeta: 1.0,
        posteriorAlpha: 1.0,
        posteriorBeta: 1.0,
        impressions: 0,
        conversions: 0,
        active: true,
      });
    }

    return { policy, armCount: eligibleItems.length };
  });
}

// ---------------------------------------------------------------------------
// getNextContent: select arm + record impression
// ---------------------------------------------------------------------------

export async function getNextContent(ctx: JourneyContext): Promise<JourneyNextResult> {
  const contentType = ctx.contentType ?? "article";
  const { policy } = await getOrCreateActivePolicy(ctx.teamId, contentType);

  const selected = await selectArm(policy.id, ctx.visitorId);

  // Record impression (idempotent via state machine — noop if already recorded)
  await recordOutcome(policy.id, ctx.visitorId, "impression");

  // Resolve content metadata for the assigned arm
  let content: JourneyNextResult["content"] = null;
  if (!selected.isHoldout && selected.armId != null) {
    const armRows = await db
      .select()
      .from(decisionArms)
      .where(eq(decisionArms.id, selected.armId))
      .limit(1);
    const arm = armRows[0];

    if (arm?.articleId) {
      const artRows = await db
        .select({ id: articles.id, title: articles.chosenTitle, slug: articles.slug })
        .from(articles)
        .where(eq(articles.id, arm.articleId))
        .limit(1);
      if (artRows[0]) {
        content = {
          id: artRows[0].id,
          title: artRows[0].title,
          slug: artRows[0].slug,
          url: artRows[0].slug ? `/articles/${artRows[0].slug}` : null,
        };
      }
    } else if (arm?.socialPostId) {
      const postRows = await db
        .select({ id: socialPosts.id, title: socialPosts.title })
        .from(socialPosts)
        .where(eq(socialPosts.id, arm.socialPostId))
        .limit(1);
      if (postRows[0]) {
        content = { id: postRows[0].id, title: postRows[0].title, slug: null, url: null };
      }
    }
  }

  return {
    policyId: policy.id,
    armId: selected.armId ?? -1,
    isHoldout: selected.isHoldout,
    contentType,
    content,
    recommendationSource: selected.isHoldout ? "holdout" : "bayesian",
  };
}

// ---------------------------------------------------------------------------
// recordConversion: idempotent via T016 state machine
// Verifies the policyId belongs to the given teamId before mutating.
// ---------------------------------------------------------------------------

export async function recordConversion(
  policyId: number,
  teamId: number,
  visitorId: string
): Promise<JourneyConvertResult> {
  // Ownership check — prevent cross-team mutation
  const policyRows = await db
    .select({ id: decisionPolicies.id })
    .from(decisionPolicies)
    .where(and(eq(decisionPolicies.id, policyId), eq(decisionPolicies.teamId, teamId)))
    .limit(1);

  if (!policyRows[0]) {
    throw Object.assign(new Error("Policy not found or access denied"), { status: 404 });
  }

  // Check if an assignment exists — skip gracefully if no impression was recorded
  const visitorHash = hashVisitor(visitorId);
  const assignmentRows = await db
    .select({ armId: holdoutAssignments.armId, outcome: holdoutAssignments.outcome })
    .from(holdoutAssignments)
    .where(
      and(
        eq(holdoutAssignments.policyId, policyId),
        eq(holdoutAssignments.visitorHash, visitorHash)
      )
    )
    .limit(1);

  const assignment = assignmentRows[0];
  if (!assignment) {
    return {
      policyId,
      armId: null,
      recorded: false,
      message: "No impression recorded for this visitor — conversion skipped",
    };
  }

  if (assignment.outcome === "conversion") {
    return {
      policyId,
      armId: assignment.armId ?? null,
      recorded: false,
      message: "Already converted",
    };
  }

  try {
    await recordOutcome(policyId, visitorId, "conversion");
    return {
      policyId,
      armId: assignment.armId ?? null,
      recorded: true,
      message: "Conversion recorded",
    };
  } catch (err: any) {
    return {
      policyId,
      armId: assignment.armId ?? null,
      recorded: false,
      message: err?.message ?? "Could not record conversion",
    };
  }
}

// ---------------------------------------------------------------------------
// getJourneyStats: team-level funnel aggregation
// ---------------------------------------------------------------------------

export async function getJourneyStats(teamId: number): Promise<JourneyStats> {
  const funnelResult = await db.execute(sql`
    SELECT
      COUNT(DISTINCT ha.visitor_hash)::int                                                        AS total_visitors,
      COUNT(*) FILTER (WHERE ha.outcome IN ('impression','conversion'))::int                      AS impressions,
      COUNT(*) FILTER (WHERE ha.outcome = 'conversion')::int                                     AS conversions,
      COUNT(*) FILTER (WHERE ha.is_holdout = false AND ha.outcome IN ('impression','conversion'))::int AS treat_impressions,
      COUNT(*) FILTER (WHERE ha.is_holdout = false AND ha.outcome = 'conversion')::int            AS treat_conversions,
      COUNT(*) FILTER (WHERE ha.is_holdout = true  AND ha.outcome IN ('impression','conversion'))::int AS hold_impressions,
      COUNT(*) FILTER (WHERE ha.is_holdout = true  AND ha.outcome = 'conversion')::int            AS hold_conversions
    FROM holdout_assignments ha
    JOIN decision_policies dp ON dp.id = ha.policy_id
    WHERE dp.team_id = ${teamId}
  `);

  // Neon HTTP driver returns { rows: [...] }; plain pg Pool returns an array
  const row = ((funnelResult as any).rows ?? funnelResult as any[])[0] ?? {};
  const totalVisitors = Number(row.total_visitors ?? 0);
  const totalImpressions = Number(row.impressions ?? 0);
  const totalConversions = Number(row.conversions ?? 0);
  const treatImpressions = Number(row.treat_impressions ?? 0);
  const treatConversions = Number(row.treat_conversions ?? 0);
  const holdImpressions = Number(row.hold_impressions ?? 0);
  const holdConversions = Number(row.hold_conversions ?? 0);

  const conversionRate = totalImpressions > 0 ? totalConversions / totalImpressions : 0;
  const treatRate = treatImpressions > 0 ? treatConversions / treatImpressions : 0;
  const holdRate = holdImpressions > 0 ? holdConversions / holdImpressions : 0;
  const liftVsHoldout = holdRate > 0 ? (treatRate - holdRate) / holdRate : null;

  // Top cohorts from T017 (non-fatal)
  let topCohorts: JourneyStats["topCohorts"] = [];
  let recommendations: JourneyStats["recommendations"] = [];
  try {
    const cohortResult = await getCohortStrategy(teamId);
    topCohorts = cohortResult.cohorts.slice(0, 5).map((c: CohortGroup) => ({
      cohortKey: c.cohortKey,
      contentType: c.contentType,
      winnerArmId: c.winnerArmId,
      arms: c.arms.length,
    }));
    recommendations = cohortResult.recommendations.slice(0, 5).map((r) => ({
      cohortKey: r.cohortKey,
      winningArmId: r.winningArmId,
      action: r.action,
      confidence: r.confidence,
      liftVsHoldout: r.liftVsHoldout,
    }));
  } catch {
    // Non-fatal — stats still useful without cohort data
  }

  return {
    totalVisitors,
    totalImpressions,
    totalConversions,
    conversionRate,
    treatment: { impressions: treatImpressions, conversions: treatConversions, conversionRate: treatRate },
    holdout: { impressions: holdImpressions, conversions: holdConversions, conversionRate: holdRate },
    liftVsHoldout,
    topCohorts,
    recommendations,
  };
}
