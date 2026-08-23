/**
 * ============================================================================
 * CAMPAIGN SERVICE — Task #151 URL-to-Campaign Orchestration
 * ============================================================================
 *
 * First-class Campaign model that joins the entire URL → research → content →
 * export workflow into a single tenant-scoped object. This is the orchestration
 * layer only — the DB schema (campaigns, campaignExports and the optional
 * campaignId columns on jobBatches/articles/socialPosts/videoIdeas/
 * publishingJobs/costTelemetry/usageEvents/contentPerformanceMetrics/
 * contentEvents) is owned by shared/schema.ts.
 *
 * All reads/writes are tenant-safe: every query is predicated on teamId in
 * addition to the campaign identity. This module never trusts a caller-supplied
 * teamId over the authenticated one.
 * ============================================================================
 */

import { db } from "./db";
import {
  campaigns,
  campaignExports,
  clientBrandProfiles,
  jobBatches,
  articles,
  socialPosts,
  videoIdeas,
  publishingJobs,
  costTelemetry,
  usageEvents,
  contentEvents,
} from "@/shared/schema";
import { and, desc, eq, isNull, sql, inArray, ne, or } from "drizzle-orm";
import { getEffectiveCreditCost, getCreditCost } from "./credit-menu";

// ============================================================================
// STATE MACHINES
// ============================================================================

/** Lifecycle states for a campaign (matches campaigns.status). */
export const CAMPAIGN_STATUSES = [
  "draft",
  "researching",
  "planning",
  "ready",
  "active",
  "completed",
  "failed",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Brand research (Brand Intelligence) states (matches campaigns.brandStatus). */
export const CAMPAIGN_BRAND_STATUSES = [
  "pending",
  "researching",
  "ready",
  "confirmed",
  "failed",
] as const;
export type CampaignBrandStatus = (typeof CAMPAIGN_BRAND_STATUSES)[number];

/** Public research-state descriptor surfaced by the API. */
export type CampaignResearchStatus =
  | "not_started"
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "confirmed";

// ============================================================================
// GOAL / LOCATION / ASSET-BUNDLE CONTRACTS
// ============================================================================

/** Supported campaign goals. Drives recommended asset bundles. */
export const CAMPAIGN_GOALS = [
  "lead_generation",
  "brand_awareness",
  "local_seo",
  "thought_leadership",
  "product_launch",
] as const;
export type CampaignGoal = (typeof CAMPAIGN_GOALS)[number];

export interface CampaignLocation {
  /** Free-form label, e.g. "Phoenix, AZ" or "Greater London". */
  label: string;
  region?: string;
  country?: string;
}

/** Quantities of each content type a campaign will produce. */
export interface AssetBundle {
  articles: number;
  socialPosts: number;
  videos: number;
}

export interface CampaignGoalsInput {
  goals: CampaignGoal[];
  notes?: string;
}

// ============================================================================
// RECOMMENDED BUNDLES + CREDIT ESTIMATES
// ============================================================================

const RECOMMENDED_BUNDLE_BY_GOAL: Record<CampaignGoal, AssetBundle> = {
  lead_generation: { articles: 8, socialPosts: 12, videos: 1 },
  brand_awareness: { articles: 4, socialPosts: 20, videos: 3 },
  local_seo: { articles: 12, socialPosts: 8, videos: 1 },
  thought_leadership: { articles: 10, socialPosts: 6, videos: 2 },
  product_launch: { articles: 6, socialPosts: 16, videos: 4 },
};

const EMPTY_BUNDLE: AssetBundle = { articles: 0, socialPosts: 0, videos: 0 };

/**
 * Compute a recommended asset bundle from goals + location count. The union of
 * per-goal recommendations is taken (max per content type), then scaled by the
 * number of locations (min 1).
 */
export function getRecommendedBundle(
  goals: CampaignGoal[],
  locationCount: number
): AssetBundle {
  const scale = Math.max(1, locationCount || 1);
  const merged = goals.reduce<AssetBundle>((acc, goal) => {
    const rec = RECOMMENDED_BUNDLE_BY_GOAL[goal];
    if (!rec) return acc;
    return {
      articles: Math.max(acc.articles, rec.articles),
      socialPosts: Math.max(acc.socialPosts, rec.socialPosts),
      videos: Math.max(acc.videos, rec.videos),
    };
  }, { ...EMPTY_BUNDLE });

  return {
    articles: merged.articles * scale,
    socialPosts: merged.socialPosts * scale,
    videos: merged.videos * scale,
  };
}

export interface CampaignCreditEstimate {
  articleCredits: number;
  socialCredits: number;
  videoCredits: number;
  researchCredits: number;
  totalCredits: number;
  perUnit: { article: number; social: number; video: number; research: number };
}

/**
 * Estimate the credit cost of producing a bundle. Honours per-team DB overrides
 * via getEffectiveCreditCost, falling back to the static credit menu.
 */
export async function estimateCampaignCredits(
  bundle: AssetBundle,
  teamId: number,
  includeResearch = false
): Promise<CampaignCreditEstimate> {
  const [articleUnit, socialUnit, videoUnit, researchUnit] = await Promise.all([
    resolveUnitCost("article", teamId),
    resolveUnitCost("social_batch", teamId),
    resolveUnitCost("video", teamId),
    resolveUnitCost("deep_research", teamId),
  ]);

  const articleCredits = bundle.articles * articleUnit;
  const socialCredits = bundle.socialPosts * socialUnit;
  const videoCredits = bundle.videos * videoUnit;
  const researchCredits = includeResearch ? researchUnit : 0;

  return {
    articleCredits,
    socialCredits,
    videoCredits,
    researchCredits,
    totalCredits: articleCredits + socialCredits + videoCredits + researchCredits,
    perUnit: {
      article: articleUnit,
      social: socialUnit,
      video: videoUnit,
      research: researchUnit,
    },
  };
}

async function resolveUnitCost(operation: string, teamId: number): Promise<number> {
  return (
    (await getEffectiveCreditCost(operation, teamId)) ??
    getCreditCost(operation) ??
    0
  );
}

// ============================================================================
// INPUT CONTRACTS
// ============================================================================

export interface CreateCampaignInput {
  /** Idempotency key — stable per logical create request per team. */
  requestId: string;
  name: string;
  businessUrl: string;
  companyName: string;
  goals: CampaignGoal[];
  locations: CampaignLocation[];
  /** Optional explicit bundle; when omitted a recommended bundle is derived. */
  assetBundle?: AssetBundle;
}

export interface CampaignPlanUpdate {
  name?: string;
  goals?: CampaignGoal[];
  locations?: CampaignLocation[];
  assetBundle?: AssetBundle;
  status?: CampaignStatus;
}

// ============================================================================
// TENANT-SAFE PREDICATES
// ============================================================================

/** Predicate: campaign row belongs to this team and is not soft-deleted. */
function teamCampaignPredicate(teamId: number) {
  return and(eq(campaigns.teamId, teamId), isNull(campaigns.deletedAt));
}

/** Map campaigns.brandStatus onto the public research-status descriptor. */
export function toResearchStatus(
  brandStatus: string | null | undefined
): CampaignResearchStatus {
  switch (brandStatus) {
    case "pending":
      return "pending";
    case "researching":
      return "running";
    case "ready":
      return "complete";
    case "confirmed":
      return "confirmed";
    case "failed":
      return "failed";
    default:
      return "not_started";
  }
}

/** Map a clientBrandProfiles.status string onto a campaign brandStatus. */
export function profileStatusToBrandStatus(
  raw: string | null | undefined
): CampaignBrandStatus | null {
  switch (raw) {
    case "pending":
      return "pending";
    case "running":
      return "researching";
    case "complete":
      return "ready";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

// ============================================================================
// CREATE / REUSE (idempotent by team + requestId)
// ============================================================================

export interface CampaignResearchState {
  status: CampaignResearchStatus;
  jobId: string | null;
  /** True when a fresh research job was queued by this call. */
  queued: boolean;
}

/**
 * Idempotently create (or reuse) a campaign for a team. Reuse is keyed on
 * (teamId, idempotencyKey).
 */
export async function createOrReuseCampaign(
  teamId: number,
  userId: number,
  input: CreateCampaignInput
): Promise<{ campaign: typeof campaigns.$inferSelect; reused: boolean }> {
  const [existing] = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.teamId, teamId),
        eq(campaigns.idempotencyKey, input.requestId),
        isNull(campaigns.deletedAt)
      )
    )
    .limit(1);

  if (existing) {
    return { campaign: existing, reused: true };
  }

  const locations = input.locations ?? [];
  const goals = input.goals ?? [];
  const recommended = getRecommendedBundle(goals, locations.length);
  const bundle = input.assetBundle ?? recommended;
  const creditEstimate = await estimateCampaignCredits(bundle, teamId, false);

  const inserted = await db
    .insert(campaigns)
    .values({
      teamId,
      createdBy: userId,
      idempotencyKey: input.requestId,
      name: input.name,
      businessUrl: input.businessUrl,
      companyName: input.companyName,
      status: "draft",
      goals: goals as any,
      locations: locations as any,
      recommendedAssetBundle: recommended as any,
      assetBundle: bundle as any,
      creditEstimate: creditEstimate as any,
    })
    .onConflictDoNothing({
      target: [campaigns.teamId, campaigns.idempotencyKey],
    })
    .returning();

  if (inserted[0]) {
    return { campaign: inserted[0], reused: false };
  }

  // Lost the race — re-read the winning row.
  const [row] = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.teamId, teamId),
        eq(campaigns.idempotencyKey, input.requestId),
        isNull(campaigns.deletedAt)
      )
    )
    .limit(1);

  if (!row) {
    throw new Error(
      `Campaign create/reuse failed for team ${teamId} requestId ${input.requestId}`
    );
  }
  return { campaign: row, reused: true };
}

// ============================================================================
// BRAND INTELLIGENCE LINKING + RESEARCH SYNC
// ============================================================================

export function sameCampaignBusinessUrl(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) return false;
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.protocol.toLowerCase()}//${host}${url.port ? `:${url.port}` : ""}${path}`;
    };
    return normalize(left) === normalize(right);
  } catch {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }
}

/**
 * Link the current team's Brand Intelligence (clientBrandProfiles) row to a
 * campaign by syncing brandStatus. Returns the campaign research state so
 * callers can decide whether a fresh run is needed. Tenant-safe.
 */
export async function linkBrandIntelligence(
  teamId: number,
  campaignId: number
): Promise<{ profileId: number | null; status: CampaignResearchStatus; matched: boolean }> {
  const [campaign] = await db
    .select({
      businessUrl: campaigns.businessUrl,
      brandStatus: campaigns.brandStatus,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)))
    .limit(1);
  if (campaign?.brandStatus === "confirmed") {
    return { profileId: null, status: "confirmed", matched: true };
  }
  const [profile] = await db
    .select({
      id: clientBrandProfiles.id,
      status: clientBrandProfiles.status,
      websiteUrl: clientBrandProfiles.websiteUrl,
      profileJson: clientBrandProfiles.profileJson,
    })
    .from(clientBrandProfiles)
    .where(eq(clientBrandProfiles.teamId, teamId))
    .limit(1);

  const matched = sameCampaignBusinessUrl(campaign?.businessUrl, profile?.websiteUrl);
  const brandStatus = matched
    ? profileStatusToBrandStatus(profile?.status)
    : "pending";

  if (campaign && brandStatus) {
    await db
      .update(campaigns)
      .set({
        brandStatus,
        ...(matched && profile?.status === "complete" && profile.profileJson
          ? { brandProfileSnapshot: profile.profileJson as any }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)));
  }

  return {
    profileId: matched ? profile?.id ?? null : null,
    status: toResearchStatus(brandStatus),
    matched,
  };
}

/**
 * Record a research queued transition onto a campaign (brandStatus →
 * researching, status → researching). Tenant-safe. jobId is accepted for API
 * symmetry but not persisted (the campaign schema has no research-job column).
 */
export async function markCampaignResearchQueued(
  teamId: number,
  campaignId: number,
  _jobId: string | null
): Promise<void> {
  await db
    .update(campaigns)
    .set({
      brandStatus: "researching",
      status: sql`CASE WHEN ${campaigns.status} IN ('draft') THEN 'researching' ELSE ${campaigns.status} END`,
      updatedAt: new Date(),
    })
      .where(
        and(
          eq(campaigns.id, campaignId),
          teamCampaignPredicate(teamId),
          or(
            isNull(campaigns.brandStatus),
            ne(campaigns.brandStatus, "confirmed")
          )
        )
      );
}

/**
 * Sync research completion/failure onto campaigns linked to a team's Brand
 * Intelligence. When research completes, the brand snapshot is refreshed from
 * the profile and campaigns still in the researching state advance to planning.
 */
export async function syncCampaignResearchCompletion(
  teamId: number,
  outcome: "complete" | "failed",
  opts: {
    campaignId?: number | null;
    websiteUrl?: string | null;
    snapshot?: unknown;
  } = {}
): Promise<void> {
  if (outcome === "failed" && opts.campaignId == null) {
    return;
  }
  const brandStatus: CampaignBrandStatus =
    outcome === "complete" ? "ready" : "failed";

  let snapshot: unknown = opts.snapshot ?? null;
  if (outcome === "complete") {
    const [profile] = await db
      .select({
        profileJson: clientBrandProfiles.profileJson,
        websiteUrl: clientBrandProfiles.websiteUrl,
      })
      .from(clientBrandProfiles)
      .where(eq(clientBrandProfiles.teamId, teamId))
      .limit(1);
    snapshot = snapshot ?? profile?.profileJson ?? null;
    opts.websiteUrl = opts.websiteUrl ?? profile?.websiteUrl ?? null;
  }

  const candidates = await db
    .select({
      id: campaigns.id,
      businessUrl: campaigns.businessUrl,
      brandStatus: campaigns.brandStatus,
    })
    .from(campaigns)
    .where(teamCampaignPredicate(teamId));
  const campaignIds =
    outcome === "complete" && opts.websiteUrl
      ? candidates
          .filter(
            (row) =>
              row.brandStatus !== "confirmed" &&
              sameCampaignBusinessUrl(row.businessUrl, opts.websiteUrl)
          )
          .map((row) => row.id)
      : opts.campaignId != null
        ? candidates
            .filter(
              (row) =>
                row.id === opts.campaignId &&
                row.brandStatus !== "confirmed"
            )
            .map((row) => row.id)
        : [];
  if (campaignIds.length === 0) return;

  await db
    .update(campaigns)
    .set({
      brandStatus,
      status:
        outcome === "complete"
          ? sql`CASE WHEN ${campaigns.status} = 'researching' THEN 'planning' ELSE ${campaigns.status} END`
          : sql`CASE WHEN ${campaigns.status} = 'researching' THEN 'failed' ELSE ${campaigns.status} END`,
      ...(outcome === "complete" && snapshot != null
        ? { brandProfileSnapshot: snapshot as any }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        teamCampaignPredicate(teamId),
        inArray(campaigns.id, campaignIds),
        or(
          isNull(campaigns.brandStatus),
          ne(campaigns.brandStatus, "confirmed")
        )
      )
    );
}

// ============================================================================
// CONFIRM BRAND INTELLIGENCE SNAPSHOT
// ============================================================================

/**
 * Confirm the current Brand Intelligence snapshot for a campaign, freezing the
 * profileJson onto the campaign. Requires the profile to be complete.
 * Tenant-safe.
 */
export async function confirmBrandSnapshot(
  teamId: number,
  campaignId: number
): Promise<{ ok: boolean; reason?: string }> {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      businessUrl: campaigns.businessUrl,
      brandProfileSnapshot: campaigns.brandProfileSnapshot,
      brandStatus: campaigns.brandStatus,
    })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)))
    .limit(1);
  if (!campaign) return { ok: false, reason: "not_found" };

  const candidateSnapshot = campaign.brandProfileSnapshot;
  const [profile] = await db
    .select({
      status: clientBrandProfiles.status,
      profileJson: clientBrandProfiles.profileJson,
      websiteUrl: clientBrandProfiles.websiteUrl,
    })
    .from(clientBrandProfiles)
    .where(eq(clientBrandProfiles.teamId, teamId))
    .limit(1);

  const matchingCurrentProfile =
    profile?.status === "complete" &&
    profile.profileJson &&
    sameCampaignBusinessUrl(campaign.businessUrl, profile.websiteUrl)
      ? profile.profileJson
      : null;
  const snapshot = candidateSnapshot ?? matchingCurrentProfile;
  if (!snapshot || !["ready", "confirmed"].includes(campaign.brandStatus ?? "")) {
    return { ok: false, reason: "research_incomplete" };
  }

  await db
    .update(campaigns)
    .set({
      brandProfileSnapshot: snapshot as any,
      brandConfirmedAt: new Date(),
      brandStatus: "confirmed",
      status: sql`CASE WHEN ${campaigns.status} IN ('draft', 'researching', 'planning') THEN 'ready' ELSE ${campaigns.status} END`,
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)));

  return { ok: true };
}

// ============================================================================
// UPDATE PLAN
// ============================================================================

/**
 * Update a campaign's mutable plan fields. Recomputes the credit estimate when
 * goals/locations/bundle change. Tenant-safe. Returns the updated row or null.
 */
export async function updateCampaignPlan(
  teamId: number,
  campaignId: number,
  update: CampaignPlanUpdate
): Promise<typeof campaigns.$inferSelect | null> {
  const [existing] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)))
    .limit(1);
  if (!existing) return null;

  if (update.status && !CAMPAIGN_STATUSES.includes(update.status)) {
    throw new Error(`Invalid campaign status: ${update.status}`);
  }

  const nextGoals = (update.goals ?? existing.goals ?? []) as CampaignGoal[];
  const nextLocations = (update.locations ??
    existing.locations ??
    []) as CampaignLocation[];
  const nextBundle =
    update.assetBundle ??
    (existing.assetBundle as AssetBundle | null) ??
    getRecommendedBundle(nextGoals, nextLocations.length);

  const planChanged =
    update.goals !== undefined ||
    update.locations !== undefined ||
    update.assetBundle !== undefined;

  const creditEstimate = planChanged
    ? await estimateCampaignCredits(nextBundle, teamId, false)
    : (existing.creditEstimate as CampaignCreditEstimate | null);

  const [updated] = await db
    .update(campaigns)
    .set({
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.status !== undefined ? { status: update.status } : {}),
      ...(update.goals !== undefined ? { goals: nextGoals as any } : {}),
      ...(update.locations !== undefined
        ? { locations: nextLocations as any }
        : {}),
      ...(planChanged
        ? {
            assetBundle: nextBundle as any,
            creditEstimate: creditEstimate as any,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)))
    .returning();

  return updated ?? null;
}

/**
 * Advance a campaign's status only when the transition is bounded/forward. Used
 * by workers as work progresses. No-op when already at/beyond the target, or
 * archived/completed/failed. Tenant-safe.
 */
export async function advanceCampaignStatus(
  teamId: number,
  campaignId: number | null | undefined,
  target: CampaignStatus
): Promise<void> {
  if (campaignId == null) return;
  const order = CAMPAIGN_STATUSES.indexOf(target);
  if (order < 0) return;
  // Only advance from earlier lifecycle states; never regress and never touch
  // terminal states (completed/failed/archived).
  const TERMINAL: CampaignStatus[] = ["completed", "failed", "archived"];
  const forwardStatuses = CAMPAIGN_STATUSES.slice(0, order).filter(
    (s) => !TERMINAL.includes(s)
  );
  if (forwardStatuses.length === 0) return;

  await db
    .update(campaigns)
    .set({ status: target, updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.teamId, teamId),
        isNull(campaigns.deletedAt),
        inArray(campaigns.status, forwardStatuses as string[])
      )
    );
}

// ============================================================================
// LIST / DETAIL AGGREGATION (tenant-safe)
// ============================================================================

export interface CampaignSummary {
  campaign: typeof campaigns.$inferSelect;
  counts: { articles: number; socialPosts: number; videos: number; batches: number };
}

/** List a team's campaigns with per-campaign content counts. Tenant-safe. */
export async function listCampaigns(teamId: number): Promise<CampaignSummary[]> {
  const rows = await db
    .select()
    .from(campaigns)
    .where(teamCampaignPredicate(teamId))
    .orderBy(sql`${campaigns.createdAt} DESC`);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const counts = await aggregateCountsByCampaign(teamId, ids);

  return rows.map((campaign) => ({
    campaign,
    counts: counts.get(campaign.id) ?? {
      articles: 0,
      socialPosts: 0,
      videos: 0,
      batches: 0,
    },
  }));
}

export interface CampaignDetail {
  campaign: typeof campaigns.$inferSelect;
  counts: { articles: number; socialPosts: number; videos: number; batches: number };
  research: CampaignResearchState;
  brandProfile: unknown | null;
  batches: (typeof jobBatches.$inferSelect)[];
  articles: (typeof articles.$inferSelect)[];
  socialPosts: (typeof socialPosts.$inferSelect)[];
  videoIdeas: (typeof videoIdeas.$inferSelect)[];
  publishingJobs: (typeof publishingJobs.$inferSelect)[];
  exports: (typeof campaignExports.$inferSelect)[];
  stats: {
    approvals: { pending: number; approved: number; changesRequested: number };
    publishing: { queued: number; published: number; failed: number };
    costUsd: number;
    credits: number;
    conversions: number;
    conversionValue: number;
  };
}

/**
 * Fetch a single campaign by public UUID for a team, with aggregated content
 * counts and research state. Tenant-safe: null if the campaign is not the
 * team's.
 */
export async function getCampaignDetailByPublicId(
  teamId: number,
  publicId: string
): Promise<CampaignDetail | null> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.publicId, publicId), teamCampaignPredicate(teamId)))
    .limit(1);
  if (!campaign) return null;

  const [
    countMap,
    profiles,
    batchRows,
    articleRows,
    socialRows,
    videoRows,
    publishingRows,
    exportRows,
    costRows,
    usageRows,
    conversionRows,
  ] = await Promise.all([
    aggregateCountsByCampaign(teamId, [campaign.id]),
    db
      .select({
        profileJson: clientBrandProfiles.profileJson,
        websiteUrl: clientBrandProfiles.websiteUrl,
      })
      .from(clientBrandProfiles)
      .where(eq(clientBrandProfiles.teamId, teamId))
      .limit(1),
    db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.teamId, teamId),
          eq(jobBatches.campaignId, campaign.id)
        )
      )
      .orderBy(desc(jobBatches.createdAt))
      .limit(100),
    db
      .select()
      .from(articles)
      .where(
        and(eq(articles.teamId, teamId), eq(articles.campaignId, campaign.id))
      )
      .orderBy(desc(articles.createdAt))
      .limit(250),
    db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.teamId, teamId),
          eq(socialPosts.campaignId, campaign.id)
        )
      )
      .orderBy(desc(socialPosts.createdAt))
      .limit(250),
    db
      .select()
      .from(videoIdeas)
      .where(
        and(
          eq(videoIdeas.teamId, teamId),
          eq(videoIdeas.campaignId, campaign.id)
        )
      )
      .orderBy(desc(videoIdeas.createdAt))
      .limit(250),
    db
      .select()
      .from(publishingJobs)
      .where(
        and(
          eq(publishingJobs.teamId, teamId),
          eq(publishingJobs.campaignId, campaign.id)
        )
      )
      .orderBy(desc(publishingJobs.createdAt))
      .limit(250),
    db
      .select()
      .from(campaignExports)
      .where(
        and(
          eq(campaignExports.teamId, teamId),
          eq(campaignExports.campaignId, campaign.id)
        )
      )
      .orderBy(desc(campaignExports.createdAt))
      .limit(100),
    db
      .select({
        costMicrousd: sql<number>`COALESCE(SUM(${costTelemetry.costMicrousd}), 0)::float8`,
      })
      .from(costTelemetry)
      .where(
        and(
          eq(costTelemetry.teamId, teamId),
          eq(costTelemetry.campaignId, campaign.id)
        )
      ),
    db
      .select({
        credits: sql<number>`COALESCE(SUM(${usageEvents.costEstimateCents}), 0)::float8`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.teamId, teamId),
          eq(usageEvents.campaignId, campaign.id),
          eq(usageEvents.status, "completed")
        )
      ),
    db
      .select({
        conversions: sql<number>`COUNT(*)::int`,
        value: sql<number>`COALESCE(SUM(${contentEvents.conversionValue}), 0)::float8`,
      })
      .from(contentEvents)
      .where(
        and(
          eq(contentEvents.teamId, teamId),
          eq(contentEvents.campaignId, campaign.id),
          eq(contentEvents.eventType, "conversion")
        )
      ),
  ]);

  const counts = countMap.get(campaign.id) ?? {
    articles: 0,
    socialPosts: 0,
    videos: 0,
    batches: 0,
  };
  const approvalCounts = articleRows.reduce(
    (acc, article) => {
      if (article.approvalStatus === "approved") acc.approved += 1;
      else if (article.approvalStatus === "changes_requested")
        acc.changesRequested += 1;
      else if (article.approvalStatus === "in_review") acc.pending += 1;
      return acc;
    },
    { pending: 0, approved: 0, changesRequested: 0 }
  );
  const publishingCounts = publishingRows.reduce(
    (acc, job) => {
      if (job.status === "delivered") acc.published += 1;
      else if (job.status === "failed") acc.failed += 1;
      else if (["pending", "queued", "processing"].includes(job.status))
        acc.queued += 1;
      return acc;
    },
    { queued: 0, published: 0, failed: 0 }
  );

  return {
    campaign,
    counts,
    research: {
      status: toResearchStatus(campaign.brandStatus),
      jobId: null,
      queued: false,
    },
    brandProfile:
      campaign.brandProfileSnapshot ??
      (sameCampaignBusinessUrl(campaign.businessUrl, profiles[0]?.websiteUrl)
        ? profiles[0]?.profileJson
        : null) ??
      null,
    batches: batchRows,
    articles: articleRows,
    socialPosts: socialRows,
    videoIdeas: videoRows,
    publishingJobs: publishingRows,
    exports: exportRows,
    stats: {
      approvals: approvalCounts,
      publishing: publishingCounts,
      costUsd: Number(costRows[0]?.costMicrousd ?? 0) / 1_000_000,
      credits: Number(usageRows[0]?.credits ?? 0),
      conversions: Number(conversionRows[0]?.conversions ?? 0),
      conversionValue: Number(conversionRows[0]?.value ?? 0),
    },
  };
}

/** Resolve a campaign row by public UUID scoped to a team. Tenant-safe. */
export async function getCampaignByPublicId(
  teamId: number,
  publicId: string
): Promise<typeof campaigns.$inferSelect | null> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.publicId, publicId), teamCampaignPredicate(teamId)))
    .limit(1);
  return campaign ?? null;
}

/**
 * Aggregate article/social/video/batch counts per campaign, all scoped to the
 * team so cross-tenant rows can never leak into a count.
 */
async function aggregateCountsByCampaign(
  teamId: number,
  campaignIds: number[]
): Promise<
  Map<
    number,
    { articles: number; socialPosts: number; videos: number; batches: number }
  >
> {
  const result = new Map<
    number,
    { articles: number; socialPosts: number; videos: number; batches: number }
  >();
  for (const id of campaignIds) {
    result.set(id, { articles: 0, socialPosts: 0, videos: 0, batches: 0 });
  }
  if (campaignIds.length === 0) return result;

  const [articleRows, socialRows, videoRows, batchRows] = await Promise.all([
    db
      .select({
        campaignId: articles.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(articles)
      .where(
        and(eq(articles.teamId, teamId), inArray(articles.campaignId, campaignIds))
      )
      .groupBy(articles.campaignId),
    db
      .select({
        campaignId: socialPosts.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.teamId, teamId),
          inArray(socialPosts.campaignId, campaignIds)
        )
      )
      .groupBy(socialPosts.campaignId),
    db
      .select({
        campaignId: videoIdeas.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(videoIdeas)
      .where(
        and(
          eq(videoIdeas.teamId, teamId),
          inArray(videoIdeas.campaignId, campaignIds)
        )
      )
      .groupBy(videoIdeas.campaignId),
    db
      .select({
        campaignId: jobBatches.campaignId,
        count: sql<number>`count(*)::int`,
      })
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.teamId, teamId),
          inArray(jobBatches.campaignId, campaignIds)
        )
      )
      .groupBy(jobBatches.campaignId),
  ]);

  for (const r of articleRows) {
    if (r.campaignId != null) result.get(r.campaignId)!.articles = Number(r.count);
  }
  for (const r of socialRows) {
    if (r.campaignId != null)
      result.get(r.campaignId)!.socialPosts = Number(r.count);
  }
  for (const r of videoRows) {
    if (r.campaignId != null) result.get(r.campaignId)!.videos = Number(r.count);
  }
  for (const r of batchRows) {
    if (r.campaignId != null) result.get(r.campaignId)!.batches = Number(r.count);
  }

  return result;
}

// ============================================================================
// EXPORT CONTENT LOADING + IDEMPOTENT RECORDING
// ============================================================================

export interface CampaignExportContent {
  campaign: typeof campaigns.$inferSelect;
  articles: (typeof articles.$inferSelect)[];
  socialPosts: (typeof socialPosts.$inferSelect)[];
  videos: (typeof videoIdeas.$inferSelect)[];
}

/**
 * Load all content across a campaign (articles/social/video) for export. Every
 * query is scoped to both campaignId and teamId so an export can never include
 * another tenant's rows even if a campaignId collides. Tenant-safe.
 */
export async function loadCampaignExportContent(
  teamId: number,
  campaignId: number
): Promise<CampaignExportContent | null> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)))
    .limit(1);
  if (!campaign) return null;

  const [articleRows, socialRows, videoRows] = await Promise.all([
    db
      .select()
      .from(articles)
      .where(and(eq(articles.teamId, teamId), eq(articles.campaignId, campaignId))),
    db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.teamId, teamId),
          eq(socialPosts.campaignId, campaignId)
        )
      ),
    db
      .select()
      .from(videoIdeas)
      .where(
        and(
          eq(videoIdeas.teamId, teamId),
          eq(videoIdeas.campaignId, campaignId)
        )
      ),
  ]);

  return {
    campaign,
    articles: articleRows,
    socialPosts: socialRows,
    videos: videoRows,
  };
}

/**
 * Idempotently record a campaign export. Keyed on (teamId, requestKey) via the
 * campaignExports unique index so a retried download does not create duplicate
 * audit rows. Tenant-safe: the campaign is re-verified against the team.
 */
export async function recordCampaignExport(
  teamId: number,
  campaignId: number,
  data: {
    requestedBy: number;
    requestKey: string;
    kind: string;
    status?: string;
    filters?: unknown;
    objectUrl?: string | null;
  }
): Promise<typeof campaignExports.$inferSelect | null> {
  // Re-verify tenancy before writing the audit row.
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), teamCampaignPredicate(teamId)))
    .limit(1);
  if (!campaign) return null;

  const existing = await db
    .select()
    .from(campaignExports)
    .where(
      and(
        eq(campaignExports.teamId, teamId),
        eq(campaignExports.requestKey, data.requestKey)
      )
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(campaignExports)
    .values({
      teamId,
      campaignId,
      requestedBy: data.requestedBy,
      requestKey: data.requestKey,
      kind: data.kind,
      status: data.status ?? "ready",
      filters: (data.filters ?? null) as any,
      objectUrl: data.objectUrl ?? null,
    })
    .onConflictDoNothing({
      target: [campaignExports.teamId, campaignExports.requestKey],
    })
    .returning();

  if (inserted[0]) return inserted[0];

  // Lost an idempotency race — re-read the winning export row.
  const [row] = await db
    .select()
    .from(campaignExports)
    .where(
      and(
        eq(campaignExports.teamId, teamId),
        eq(campaignExports.requestKey, data.requestKey)
      )
    )
    .limit(1);
  return row ?? null;
}
