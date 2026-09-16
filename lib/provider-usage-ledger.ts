import { createHash } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getTxDb } from "./db";
import { getDatabaseExecutionContext } from "./tenant-context";
import {
  campaigns, providerInvoiceReconciliations, providerRates, providerRateVersions,
  providerUsageLedger, teams, teamMembers, articles, articleAssets, jobBatches,
  socialPosts, socialPostAssets, videoIdeas, clientBrandProfiles,
} from "@/shared/schema";

export type ProviderUsageEventType = "usage" | "correction" | "refund";

export interface ProviderUsageInput {
  sourceEventId?: string;
  teamId?: number | null;
  userId?: number | null;
  campaignId?: number | null;
  runId?: string | null;
  jobId?: string | null;
  contentId?: number | null;
  resourceType?: string | null;
  resourceId?: string | number | null;
  operationType: string;
  provider: string;
  model: string;
  unitType: string;
  inputUnits?: number | null;
  outputUnits?: number | null;
  unitCount: number;
  costMicrousd: number;
  providerRequestId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  occurredAt?: Date;
  attempt?: number | null;
}

function assertSafeMonetaryInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer microUSD amount`);
  }
}

function safeMonetaryResult(value: bigint, label: string): number {
  const result = Number(value);
  assertSafeMonetaryInteger(result, label);
  return result;
}

function assertSafeUnitInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

/**
 * These are the resource identities currently emitted by provider-attempt
 * receipt and cost-telemetry callers.  Keeping this allow-list here makes an
 * omitted ownership query fail closed when a new caller invents a resource
 * type without adding its ownership rule.
 *
 * Some entries are team-scoped operations without a durable resource row
 * (for example topic_research).  They are still listed deliberately so an
 * explicit resource type can never silently bypass this admission gate.
 */
export const PROVIDER_USAGE_RESOURCE_TYPES = [
  "article",
  "article_hero",
  "article_title_pool",
  "batch",
  "brand_profile",
  "canary",
  "campaign",
  "daily_brief",
  "fact_validation",
  "incident",
  "media_asset",
  "podcast",
  "reddit_intent",
  "seo_analysis",
  "social_post",
  "topic_research",
  "verified_content",
  "video",
  "video_idea",
  "video_scene",
] as const;

type ProviderUsageResourceType = typeof PROVIDER_USAGE_RESOURCE_TYPES[number];

const PROVIDER_USAGE_RESOURCE_TYPE_SET = new Set<string>(PROVIDER_USAGE_RESOURCE_TYPES);

function nullableEqual(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function normalizedResourceId(resourceId: string | number | null | undefined): string | null {
  return resourceId == null ? null : String(resourceId);
}

export function resolveProviderLedgerTeamId(requestedTeamId?: number | null): number {
  const context = getDatabaseExecutionContext();
  if (!context || context.scope === "blocked") throw new Error("Provider usage ledger requires a validated database context");
  if (context.scope === "tenant") {
    if (requestedTeamId != null && requestedTeamId !== context.teamId) throw new Error("Provider usage ledger teamId does not match validated tenant");
    return context.teamId;
  }
  if (!Number.isInteger(requestedTeamId) || (requestedTeamId ?? 0) <= 0) throw new Error("System provider usage ledger writes require a positive teamId");
  return requestedTeamId!;
}

/** Stable across retries; request IDs take precedence over a usage fingerprint. */
export function deterministicProviderUsageSourceEventId(input: ProviderUsageInput, teamId: number): string {
  const material = input.providerRequestId
    ? `request:${input.provider}:${input.providerRequestId}`
    : ["usage", teamId, input.runId ?? "", input.jobId ?? "", input.operationType, input.provider,
      input.model, input.attempt ?? 0, input.unitType, input.inputUnits ?? 0, input.outputUnits ?? 0,
      input.unitCount, input.costMicrousd].join("|");
  return `provider-usage:${createHash("sha256").update(material).digest("hex")}`;
}

export function validateAdjustmentCost(eventType: "correction" | "refund", costMicrousd: number): void {
  assertSafeMonetaryInteger(costMicrousd, "Provider adjustment cost");
  if (costMicrousd === 0) throw new Error("Provider adjustment cost must be a non-zero safe integer microUSD amount");
  if (eventType === "refund" && costMicrousd > 0) throw new Error("Provider refunds must have a negative cost");
}

export function lockedRateCostMicrousd(
  input: Pick<ProviderUsageInput, "inputUnits" | "outputUnits" | "unitCount" | "costMicrousd">,
  rate: { input?: number | null; output?: number | null; perUnit?: number | null } | null
): number {
  // Unmatched models remain explicitly unpriced. Mutable caller estimates are
  // kept only in operational cost_telemetry and never become actual ledger COGS.
  if (!rate) return 0;
  assertSafeUnitInteger(input.unitCount, "Provider usage unitCount");
  const inputUnits = input.inputUnits ?? 0;
  const outputUnits = input.outputUnits ?? 0;
  assertSafeUnitInteger(inputUnits, "Provider usage inputUnits");
  assertSafeUnitInteger(outputUnits, "Provider usage outputUnits");
  if (rate.perUnit != null) {
    assertSafeMonetaryInteger(rate.perUnit, "Provider per-unit rate");
    if (rate.perUnit < 0) throw new Error("Provider per-unit rate must be non-negative");
    return safeMonetaryResult(BigInt(input.unitCount) * BigInt(rate.perUnit), "Calculated provider usage cost");
  }
  const inputRate = rate.input ?? 0;
  const outputRate = rate.output ?? 0;
  assertSafeMonetaryInteger(inputRate, "Provider input rate");
  assertSafeMonetaryInteger(outputRate, "Provider output rate");
  if (inputRate < 0 || outputRate < 0) throw new Error("Provider token rates must be non-negative");
  const numerator = BigInt(inputUnits) * BigInt(inputRate) + BigInt(outputUnits) * BigInt(outputRate);
  return safeMonetaryResult((numerator + 500_000n) / 1_000_000n, "Calculated provider usage cost");
}

export function assertIdempotentUsageMatch(existing: any, input: ProviderUsageInput, teamId: number): void {
  const attributionMatches =
    nullableEqual(existing.campaignId, input.campaignId) &&
    nullableEqual(existing.runId, input.runId) &&
    nullableEqual(existing.jobId, input.jobId) &&
    nullableEqual(existing.contentId, input.contentId) &&
    nullableEqual(existing.resourceType, input.resourceType) &&
    nullableEqual(normalizedResourceId(existing.resourceId), normalizedResourceId(input.resourceId));
  const unitsMatch =
    existing.unitType === input.unitType &&
    nullableEqual(existing.inputUnits, input.inputUnits) &&
    nullableEqual(existing.outputUnits, input.outputUnits) &&
    existing.unitCount === input.unitCount;
  const sourcePayloadMatches =
    nullableEqual(existing.providerRequestId, input.providerRequestId) &&
    attributionMatches &&
    unitsMatch;

  if (
    existing.teamId !== teamId ||
    existing.eventType !== "usage" ||
    existing.provider !== input.provider ||
    existing.model !== input.model ||
    existing.operationType !== input.operationType ||
    !sourcePayloadMatches
  ) {
    throw new Error("Provider usage sourceEventId is already bound to a different accounting event");
  }
  // occurredAt intentionally is not part of the source payload comparison.
  // A retry may arrive with a new wall-clock timestamp, but the first
  // committed event remains the historical occurrence time.
}

async function ownedAgencySnapshot(tx: any, teamId: number): Promise<number | null> {
  const [team] = await tx.select({ parentTeamId: teams.parentTeamId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new Error(`Provider usage team ${teamId} does not exist`);
  return team.parentTeamId ?? null;
}

function numericResourceId(resourceType: string, resourceId: string | number): number {
  const parsed = typeof resourceId === "number" ? resourceId : Number(resourceId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Provider usage ${resourceType} resourceId must be a positive integer`);
  }
  return parsed;
}

async function assertOwnedRow(
  tx: any,
  table: any,
  tableName: string,
  id: number,
  teamId: number,
): Promise<void> {
  const [row] = await tx.select({ id: table.id }).from(table).where(and(
    eq(table.id, id),
    eq(table.teamId, teamId),
  )).limit(1);
  if (!row) throw new Error(`Provider usage ${tableName} ${id} does not belong to team ${teamId}`);
}

async function assertOwnedResource(
  tx: any,
  teamId: number,
  resourceType: ProviderUsageResourceType,
  resourceId: string | number,
): Promise<void> {
  switch (resourceType) {
    case "article":
    case "article_hero":
    case "podcast":
      await assertOwnedRow(tx, articles, resourceType, numericResourceId(resourceType, resourceId), teamId);
      return;
    case "batch":
      await assertOwnedRow(tx, jobBatches, "batch", numericResourceId(resourceType, resourceId), teamId);
      return;
    case "campaign":
      await assertOwnedRow(tx, campaigns, "campaign", numericResourceId(resourceType, resourceId), teamId);
      return;
    case "social_post":
      await assertOwnedRow(tx, socialPosts, "social post", numericResourceId(resourceType, resourceId), teamId);
      return;
    case "video":
    case "video_idea":
      await assertOwnedRow(tx, videoIdeas, resourceType, numericResourceId(resourceType, resourceId), teamId);
      return;
    case "brand_profile":
      await assertOwnedRow(tx, clientBrandProfiles, "brand profile", numericResourceId(resourceType, resourceId), teamId);
      return;
    case "media_asset": {
      const id = numericResourceId(resourceType, resourceId);
      // Article assets carry a team_id directly.  Social assets predate that
      // column, so their parent social post is the ownership boundary.
      const [articleAsset] = await tx.select({ id: articleAssets.id }).from(articleAssets).where(and(
        eq(articleAssets.id, id),
        eq(articleAssets.teamId, teamId),
      )).limit(1);
      if (articleAsset) return;
      const [socialAsset] = await tx.select({ id: socialPostAssets.id })
        .from(socialPostAssets)
        .innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
        .where(and(
          eq(socialPostAssets.id, id),
          eq(socialPosts.teamId, teamId),
        )).limit(1);
      if (socialAsset) return;
      throw new Error(`Provider usage media asset ${id} does not belong to team ${teamId}`);
    }
    case "canary":
      if (resourceId !== "text_generation" && resourceId !== "image_generation") {
        throw new Error(`Provider usage canary resourceId ${String(resourceId)} is not recognized`);
      }
      // Canary resources are ephemeral health-check stages.  Their validated
      // accountingTeamId is their ownership boundary; there is no tenant row
      // to query for the stage name itself.
      return;
    case "video_scene":
      // Scenes are ephemeral children of a team-owned video and currently
      // carry only their scene number.  Reject malformed IDs rather than
      // treating arbitrary strings as owned resources.
      numericResourceId(resourceType, resourceId);
      return;
    case "incident":
      // Telemetry incidents are global operational records and deliberately
      // have no team_id.  An explicit incident ID therefore cannot be proven
      // to belong to the accounting team; fail closed.  The current advisory
      // caller uses a team-scoped operation without an incident ID.
      throw new Error("Provider usage incident resource ownership cannot be validated");
    case "article_title_pool":
    case "daily_brief":
    case "fact_validation":
    case "reddit_intent":
    case "seo_analysis":
    case "topic_research":
    case "verified_content":
      throw new Error(`Provider usage ${resourceType} resource ownership cannot be validated`);
  }
}

/**
 * Validate every explicit attribution before a provider submission.  This is
 * exported for the attempt-receipt admission gate so a receipt cannot be
 * prepared (and a paid call cannot begin) for a cross-tenant target.
 */
export async function validateProviderUsageAttribution(
  tx: any,
  teamId: number,
  campaignId?: number | null,
  contentId?: number | null,
  resourceType?: string | null,
  resourceId?: string | number | null,
  userId?: number | null,
): Promise<void> {
  if (userId != null) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new Error("Provider usage userId must be a positive integer");
    }
    const [membership] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(and(
      eq(teamMembers.teamId, teamId),
      eq(teamMembers.userId, userId),
    )).limit(1);
    if (!membership) throw new Error(`Provider usage user ${userId} is not a member of team ${teamId}`);
  }

  if (resourceType != null && !PROVIDER_USAGE_RESOURCE_TYPE_SET.has(resourceType)) {
    throw new Error(`Provider usage resourceType ${resourceType} is not recognized`);
  }
  if (resourceId != null && resourceType == null) {
    throw new Error("Provider usage resourceId requires an explicit resourceType");
  }

  if (campaignId != null) {
    const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.teamId, teamId))).limit(1);
    if (!campaign) throw new Error(`Provider usage campaign ${campaignId} does not belong to team ${teamId}`);
  }
  if (contentId != null) {
    const articleId = numericResourceId("content", contentId);
    await assertOwnedRow(tx, articles, "article", articleId, teamId);
  }

  if (resourceType != null && resourceId != null) {
    await assertOwnedResource(
      tx,
      teamId,
      resourceType as ProviderUsageResourceType,
      resourceId,
    );
  }
}

/**
 * Run the same ledger attribution checks without inserting a usage event.
 * Receipt preparation uses this before the physical provider call.
 */
export async function validateProviderUsageOwnership(input: Pick<
  ProviderUsageInput,
  "teamId" | "userId" | "campaignId" | "contentId" | "resourceType" | "resourceId"
>): Promise<number> {
  const teamId = resolveProviderLedgerTeamId(input.teamId);
  const txDb = getTxDb();
  await txDb.transaction(async (tx: any) => {
    await validateProviderUsageAttribution(
      tx,
      teamId,
      input.campaignId,
      input.contentId,
      input.resourceType,
      input.resourceId,
      input.userId,
    );
    await ownedAgencySnapshot(tx, teamId);
  });
  return teamId;
}

async function rateSnapshot(tx: any, input: ProviderUsageInput, occurredAt: Date) {
  const [rate] = await tx.select({
    id: providerRates.id, versionId: providerRateVersions.id, version: providerRateVersions.version,
    input: providerRates.inputMicrousdPerMillion, output: providerRates.outputMicrousdPerMillion,
    perUnit: providerRates.microusdPerUnit, evidenceUrl: providerRates.evidenceUrl,
  }).from(providerRates).innerJoin(providerRateVersions, eq(providerRates.rateVersionId, providerRateVersions.id))
    .where(and(eq(providerRates.provider, input.provider), eq(providerRates.model, input.model), eq(providerRates.unitType, input.unitType),
      sql`${providerRates.effectiveFrom} <= ${occurredAt}`,
      sql`(${providerRates.effectiveTo} IS NULL OR ${providerRates.effectiveTo} > ${occurredAt})`))
    .orderBy(desc(providerRates.effectiveFrom)).limit(1);
  // Unknown models are deliberately represented as unpriced, never silently priced as free.
  return {
    rateVersionId: rate?.versionId ?? null, providerRateId: rate?.id ?? null,
    snapshot: rate ? { version: rate.version, inputMicrousdPerMillion: rate.input, outputMicrousdPerMillion: rate.output, microusdPerUnit: rate.perUnit, evidenceUrl: rate.evidenceUrl }
      : { version: "unpriced", reason: "No locked provider rate matched this model/unit at occurredAt" },
    costMicrousd: lockedRateCostMicrousd(input, rate),
  };
}

export async function recordProviderUsage(input: ProviderUsageInput) {
  assertSafeMonetaryInteger(input.costMicrousd, "Provider usage cost");
  if (input.costMicrousd < 0) throw new Error("Provider usage cost must be a non-negative safe integer microUSD amount");
  assertSafeUnitInteger(input.unitCount, "Provider usage unitCount");
  if (input.inputUnits != null) assertSafeUnitInteger(input.inputUnits, "Provider usage inputUnits");
  if (input.outputUnits != null) assertSafeUnitInteger(input.outputUnits, "Provider usage outputUnits");
  const teamId = resolveProviderLedgerTeamId(input.teamId);
  const occurredAt = input.occurredAt ?? new Date();
  const sourceEventId = input.sourceEventId ?? deterministicProviderUsageSourceEventId(input, teamId);
  const txDb = getTxDb();
  return txDb.transaction(async (tx: any) => {
    const [existing] = await tx.select().from(providerUsageLedger).where(eq(providerUsageLedger.sourceEventId, sourceEventId)).limit(1);
    if (existing) {
      assertIdempotentUsageMatch(existing, input, teamId);
      return { event: existing, inserted: false };
    }
    await validateProviderUsageAttribution(
      tx,
      teamId,
      input.campaignId,
      input.contentId,
      input.resourceType,
      input.resourceId,
      input.userId,
    );
    const agencyTeamId = await ownedAgencySnapshot(tx, teamId);
    const lockedRate = await rateSnapshot(tx, input, occurredAt);
    const [event] = await tx.insert(providerUsageLedger).values({
      sourceEventId, teamId, agencyTeamId, eventType: "usage", campaignId: input.campaignId ?? null,
      runId: input.runId ?? null, jobId: input.jobId ?? null, contentId: input.contentId ?? null,
      resourceType: input.resourceType ?? null, resourceId: input.resourceId == null ? null : String(input.resourceId),
      operationType: input.operationType, provider: input.provider, model: input.model, unitType: input.unitType,
      inputUnits: input.inputUnits ?? null, outputUnits: input.outputUnits ?? null, unitCount: input.unitCount,
      costMicrousd: lockedRate.costMicrousd, rateVersionId: lockedRate.rateVersionId, providerRateId: lockedRate.providerRateId,
      rateSnapshot: lockedRate.snapshot, providerRequestId: input.providerRequestId ?? null,
      providerMetadata: input.providerMetadata ?? null, occurredAt,
    }).onConflictDoNothing({ target: providerUsageLedger.sourceEventId }).returning();
    if (event) return { event, inserted: true };
    const [raced] = await tx.select().from(providerUsageLedger).where(eq(providerUsageLedger.sourceEventId, sourceEventId)).limit(1);
    if (!raced) throw new Error("Provider usage idempotency conflict did not resolve to an event");
    assertIdempotentUsageMatch(raced, input, teamId);
    return { event: raced, inserted: false };
  });
}

export async function appendProviderAdjustment(input: Omit<ProviderUsageInput, "costMicrousd" | "unitCount"> & {
  eventType: "correction" | "refund"; costMicrousd: number; originalEventId: number; unitCount?: number;
}) {
  validateAdjustmentCost(input.eventType, input.costMicrousd);
  const teamId = resolveProviderLedgerTeamId(input.teamId);
  const sourceEventId = input.sourceEventId ?? deterministicProviderUsageSourceEventId({ ...input, unitCount: input.unitCount ?? 0 }, teamId);
  const txDb = getTxDb();
  return txDb.transaction(async (tx: any) => {
    const [existing] = await tx.select().from(providerUsageLedger).where(eq(providerUsageLedger.sourceEventId, sourceEventId)).limit(1);
    if (existing) {
      if (existing.teamId !== teamId || existing.eventType !== input.eventType || existing.originalEventId !== input.originalEventId) {
        throw new Error("Provider adjustment sourceEventId is already bound to a different accounting event");
      }
      return { event: existing, inserted: false };
    }
    const [original] = await tx.select().from(providerUsageLedger).where(eq(providerUsageLedger.id, input.originalEventId)).limit(1);
    if (!original || original.teamId !== teamId) throw new Error("Provider adjustment original event does not belong to validated team");
    const [event] = await tx.insert(providerUsageLedger).values({
      sourceEventId, teamId, agencyTeamId: original.agencyTeamId, eventType: input.eventType, originalEventId: original.id,
      campaignId: original.campaignId, runId: input.runId ?? original.runId, jobId: input.jobId ?? original.jobId,
      contentId: original.contentId, resourceType: original.resourceType, resourceId: original.resourceId,
      operationType: input.operationType, provider: original.provider, model: original.model, unitType: original.unitType,
      inputUnits: input.inputUnits ?? null, outputUnits: input.outputUnits ?? null, unitCount: input.unitCount ?? 0,
      costMicrousd: input.costMicrousd, rateVersionId: original.rateVersionId, providerRateId: original.providerRateId,
      rateSnapshot: original.rateSnapshot, providerRequestId: input.providerRequestId ?? null,
      providerMetadata: input.providerMetadata ?? null, occurredAt: input.occurredAt ?? new Date(),
    }).onConflictDoNothing({ target: providerUsageLedger.sourceEventId }).returning();
    if (event) return { event, inserted: true };
    const [raced] = await tx.select().from(providerUsageLedger).where(eq(providerUsageLedger.sourceEventId, sourceEventId)).limit(1);
    if (!raced || raced.teamId !== teamId || raced.eventType !== input.eventType || raced.originalEventId !== input.originalEventId) {
      throw new Error("Provider adjustment idempotency conflict is bound to a different accounting event");
    }
    return { event: raced, inserted: false };
  });
}

export async function getProviderReconciliationSummary(provider: string, periodStart: Date, periodEnd: Date) {
  if (periodEnd <= periodStart) throw new Error("Reconciliation period end must be after start");
  const txDb = getTxDb();
  const [row] = await txDb.select({ ledgerCostMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)` })
    .from(providerUsageLedger).where(and(eq(providerUsageLedger.provider, provider), gte(providerUsageLedger.occurredAt, periodStart), lt(providerUsageLedger.occurredAt, periodEnd)));
  const ledgerCostMicrousd = Number(row?.ledgerCostMicrousd ?? 0);
  assertSafeMonetaryInteger(ledgerCostMicrousd, "Reconciled provider ledger cost");
  return { provider, periodStart, periodEnd, ledgerCostMicrousd };
}

export function reconciliationMismatch(ledgerCostMicrousd: number, invoicedCostMicrousd: number) {
  assertSafeMonetaryInteger(ledgerCostMicrousd, "Reconciled provider ledger cost");
  assertSafeMonetaryInteger(invoicedCostMicrousd, "Provider invoice cost");
  const varianceMicrousd = safeMonetaryResult(
    BigInt(invoicedCostMicrousd) - BigInt(ledgerCostMicrousd),
    "Provider invoice variance"
  );
  return { ledgerCostMicrousd, invoicedCostMicrousd, varianceMicrousd, matches: ledgerCostMicrousd === invoicedCostMicrousd };
}

/** Pure accounting helpers used by reconciliation/reporting tests. */
export function netProviderLedgerCosts(events: ReadonlyArray<{ costMicrousd: number }>): number {
  let total = 0n;
  for (const event of events) {
    assertSafeMonetaryInteger(event.costMicrousd, "Provider ledger event cost");
    total += BigInt(event.costMicrousd);
  }
  return safeMonetaryResult(total, "Net provider ledger cost");
}

/** Adjustments copy the original JSON snapshot rather than re-resolving rates. */
export function adjustmentRateSnapshot(originalRateSnapshot: unknown): unknown {
  return originalRateSnapshot;
}

export async function recordProviderInvoiceReconciliation(params: { provider: string; invoiceReference: string; periodStart: Date; periodEnd: Date; invoicedCostMicrousd: number; evidenceUrl?: string; metadata?: Record<string, unknown> }) {
  assertSafeMonetaryInteger(params.invoicedCostMicrousd, "Provider invoice cost");
  const summary = await getProviderReconciliationSummary(params.provider, params.periodStart, params.periodEnd);
  const result = reconciliationMismatch(summary.ledgerCostMicrousd, params.invoicedCostMicrousd);
  const txDb = getTxDb();
  const [row] = await txDb.insert(providerInvoiceReconciliations).values({ ...params, ...result, evidenceUrl: params.evidenceUrl ?? null, metadata: params.metadata ?? null })
    .onConflictDoNothing().returning();
  return { reconciliation: row ?? null, ...result };
}