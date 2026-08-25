import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  creditLedger,
  providerInvoiceReconciliations,
  providerUsageLedger,
  teams,
} from "@/shared/schema";
import { and, gte, isNull, sql } from "drizzle-orm";
import { microusdToUsd } from "@/lib/cost-telemetry";

/**
 * Platform-only accounting read model.  Do not substitute costTelemetry here:
 * provider_usage_ledger is append-only and carries later corrections/refunds.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const requestedDays = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10);
    const days = Math.max(1, Math.min(Number.isFinite(requestedDays) ? requestedDays : 7, 365));
    const since = new Date(Date.now() - days * 86_400_000);

    const [summaryRows, byProvider, rateVersions, reconciliations, credits, workspaceCosts, providerRuns, creditRuns] = await Promise.all([
      db.select({
        eventCount: sql<number>`count(*)::int`,
        netCostMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)::bigint`,
        usageCostMicrousd: sql<number>`coalesce(sum(case when ${providerUsageLedger.eventType} = 'usage' then ${providerUsageLedger.costMicrousd} else 0 end), 0)::bigint`,
        correctionCostMicrousd: sql<number>`coalesce(sum(case when ${providerUsageLedger.eventType} = 'correction' then ${providerUsageLedger.costMicrousd} else 0 end), 0)::bigint`,
        refundCostMicrousd: sql<number>`coalesce(sum(case when ${providerUsageLedger.eventType} = 'refund' then ${providerUsageLedger.costMicrousd} else 0 end), 0)::bigint`,
        unpricedEvents: sql<number>`count(*) filter (where ${providerUsageLedger.rateVersionId} is null)::int`,
      }).from(providerUsageLedger).where(gte(providerUsageLedger.occurredAt, since)),
      db.select({
        provider: providerUsageLedger.provider,
        eventCount: sql<number>`count(*)::int`,
        netCostMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)::bigint`,
        unpricedEvents: sql<number>`count(*) filter (where ${providerUsageLedger.rateVersionId} is null)::int`,
      }).from(providerUsageLedger).where(gte(providerUsageLedger.occurredAt, since))
        .groupBy(providerUsageLedger.provider).orderBy(sql`sum(${providerUsageLedger.costMicrousd}) desc`),
      db.select({
        rateVersionId: providerUsageLedger.rateVersionId,
        eventCount: sql<number>`count(*)::int`,
        netCostMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)::bigint`,
      }).from(providerUsageLedger).where(gte(providerUsageLedger.occurredAt, since))
        .groupBy(providerUsageLedger.rateVersionId).orderBy(sql`sum(${providerUsageLedger.costMicrousd}) desc`),
      db.select({
        id: providerInvoiceReconciliations.id,
        provider: providerInvoiceReconciliations.provider,
        invoiceReference: providerInvoiceReconciliations.invoiceReference,
        periodStart: providerInvoiceReconciliations.periodStart,
        periodEnd: providerInvoiceReconciliations.periodEnd,
        invoicedCostMicrousd: providerInvoiceReconciliations.invoicedCostMicrousd,
        ledgerCostMicrousd: providerInvoiceReconciliations.ledgerCostMicrousd,
        varianceMicrousd: providerInvoiceReconciliations.varianceMicrousd,
      }).from(providerInvoiceReconciliations)
        .where(gte(providerInvoiceReconciliations.periodEnd, since))
        .orderBy(sql`${providerInvoiceReconciliations.recordedAt} desc`).limit(50),
      db.select({
        creditsDebited: sql<number>`coalesce(sum(case when ${creditLedger.eventType} = 'debit' then abs(${creditLedger.amount}) else 0 end), 0)::bigint`,
      }).from(creditLedger).where(gte(creditLedger.createdAt, since)),
      db.select({
        teamId: teams.id,
        teamName: teams.name,
        providerCostMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)::bigint`,
      }).from(teams).innerJoin(providerUsageLedger, sql`${providerUsageLedger.teamId} = ${teams.id}`)
        .where(and(gte(providerUsageLedger.occurredAt, since), isNull(teams.deletedAt)))
        .groupBy(teams.id, teams.name).orderBy(sql`sum(${providerUsageLedger.costMicrousd}) desc`).limit(100),
      db.select({
        teamId: providerUsageLedger.teamId,
        runKey: sql<string>`coalesce(${providerUsageLedger.runId}, ${providerUsageLedger.jobId})`,
        netCostMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)::bigint`,
      }).from(providerUsageLedger)
        .where(and(
          gte(providerUsageLedger.occurredAt, since),
          sql`coalesce(${providerUsageLedger.runId}, ${providerUsageLedger.jobId}) is not null`
        ))
        .groupBy(providerUsageLedger.teamId, sql`coalesce(${providerUsageLedger.runId}, ${providerUsageLedger.jobId})`),
      db.select({
        teamId: creditLedger.teamId,
        runKey: sql<string>`coalesce(${creditLedger.runId}, ${creditLedger.jobId})`,
        creditsDebited: sql<number>`coalesce(sum(abs(${creditLedger.amount})), 0)::bigint`,
      }).from(creditLedger)
        .where(and(
          gte(creditLedger.createdAt, since),
          sql`${creditLedger.eventType} = 'debit'`,
          sql`coalesce(${creditLedger.runId}, ${creditLedger.jobId}) is not null`
        ))
        .groupBy(creditLedger.teamId, sql`coalesce(${creditLedger.runId}, ${creditLedger.jobId})`),
    ]);
    const summary = summaryRows[0];
    const keyFor = (row: { teamId: number; runKey: string }) => `${row.teamId}:${row.runKey}`;
    const providerRunKeys = new Set(providerRuns.map(keyFor));
    const creditRunKeys = new Set(creditRuns.map(keyFor));
    const ledgerRunsWithoutCreditDebit = providerRuns
      .filter((row) => !creditRunKeys.has(keyFor(row)))
      .slice(0, 50)
      .map((row) => ({ teamId: row.teamId, runId: row.runKey, providerCogsUsd: microusdToUsd(Number(row.netCostMicrousd)) }));
    const creditDebitsWithoutLedgerUsage = creditRuns
      .filter((row) => !providerRunKeys.has(keyFor(row)))
      .slice(0, 50)
      .map((row) => ({ teamId: row.teamId, runId: row.runKey, creditsDebited: Number(row.creditsDebited) }));

    return NextResponse.json({
      periodDays: days,
      since: since.toISOString(),
      summary: {
        ledgerEvents: summary?.eventCount ?? 0,
        netActualCogsUsd: microusdToUsd(Number(summary?.netCostMicrousd ?? 0)),
        usageCogsUsd: microusdToUsd(Number(summary?.usageCostMicrousd ?? 0)),
        correctionsUsd: microusdToUsd(Number(summary?.correctionCostMicrousd ?? 0)),
        refundsUsd: microusdToUsd(Number(summary?.refundCostMicrousd ?? 0)),
        unpricedEvents: summary?.unpricedEvents ?? 0,
        creditsDebited: Number(credits[0]?.creditsDebited ?? 0),
      },
      byProvider: byProvider.map((row) => ({ ...row, netActualCogsUsd: microusdToUsd(Number(row.netCostMicrousd)) })),
      rateVersions: rateVersions.map((row) => ({
        rateVersionId: row.rateVersionId,
        label: row.rateVersionId == null ? "Unpriced / no locked rate" : `Rate version #${row.rateVersionId}`,
        eventCount: row.eventCount,
        netActualCogsUsd: microusdToUsd(Number(row.netCostMicrousd)),
      })),
      invoiceReconciliations: reconciliations.map((row) => ({
        ...row,
        invoicedCostUsd: microusdToUsd(Number(row.invoicedCostMicrousd)),
        ledgerCostUsd: microusdToUsd(Number(row.ledgerCostMicrousd)),
        varianceUsd: microusdToUsd(Number(row.varianceMicrousd)),
      })),
      creditProviderReconciliation: {
        providerRuns: providerRuns.length,
        creditDebitRuns: creditRuns.length,
        ledgerRunsWithoutCreditDebit,
        creditDebitsWithoutLedgerUsage,
        matches: ledgerRunsWithoutCreditDebit.length === 0 && creditDebitsWithoutLedgerUsage.length === 0,
        note: "Mismatches are reported only; credit balances are never changed by reconciliation.",
      },
      // There is no approved revenue/markup configuration in the current schema.
      // Returning null, rather than estimating from plan prices, prevents invented margins.
      negativeMarginWorkspaces: [],
      marginStatus: "unavailable_without_approved_rebilling_configuration",
      workspaceCogs: workspaceCosts.map((row) => ({
        teamId: row.teamId, teamName: row.teamName,
        providerCogsUsd: microusdToUsd(Number(row.providerCostMicrousd)),
        margin: null,
      })),
    });
  } catch (error: any) {
    const status = error?.statusCode ?? (String(error?.message).includes("Admin") ? 403 : 500);
    if (status === 401 || status === 403) return NextResponse.json({ error: error.message }, { status });
    console.error("Cost telemetry route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}