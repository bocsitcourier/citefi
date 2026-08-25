import { createHash } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getTxDb } from "./db";
import { getDatabaseExecutionContext } from "./tenant-context";
import {
  campaigns, providerInvoiceReconciliations, providerRates, providerRateVersions,
  providerUsageLedger, teams, articles, jobBatches,
} from "@/shared/schema";

export type ProviderUsageEventType = "usage" | "correction" | "refund";

export interface ProviderUsageInput {
  sourceEventId?: string;
  teamId?: number | null;
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

function assertIdempotentUsageMatch(existing: any, input: ProviderUsageInput, teamId: number): void {
  if (
    existing.teamId !== teamId ||
    existing.eventType !== "usage" ||
    existing.provider !== input.provider ||
    existing.model !== input.model ||
    existing.operationType !== input.operationType
  ) {
    throw new Error("Provider usage sourceEventId is already bound to a different accounting event");
  }
}

async function ownedAgencySnapshot(tx: any, teamId: number): Promise<number | null> {
  const [team] = await tx.select({ parentTeamId: teams.parentTeamId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new Error(`Provider usage team ${teamId} does not exist`);
  return team.parentTeamId ?? null;
}

async function validateAttribution(tx: any, teamId: number, campaignId?: number | null, contentId?: number | null, resourceType?: string | null, resourceId?: string | number | null): Promise<void> {
  if (campaignId != null) {
    const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.teamId, teamId))).limit(1);
    if (!campaign) throw new Error(`Provider usage campaign ${campaignId} does not belong to team ${teamId}`);
  }
  const articleId = contentId ?? (resourceType === "article" && resourceId != null ? Number(resourceId) : null);
  if (articleId != null) {
    const [article] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.id, articleId), eq(articles.teamId, teamId))).limit(1);
    if (!article) throw new Error(`Provider usage article ${articleId} does not belong to team ${teamId}`);
  }
  if (resourceType === "batch" && resourceId != null) {
    const batchId = Number(resourceId);
    if (!Number.isInteger(batchId)) throw new Error("Provider usage batch resourceId must be an integer");
    const [batch] = await tx.select({ id: jobBatches.id }).from(jobBatches).where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId))).limit(1);
    if (!batch) throw new Error(`Provider usage batch ${batchId} does not belong to team ${teamId}`);
  }
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
    await validateAttribution(tx, teamId, input.campaignId, input.contentId, input.resourceType, input.resourceId);
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