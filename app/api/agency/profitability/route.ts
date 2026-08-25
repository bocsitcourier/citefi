import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { creditLedger, providerUsageLedger, teams } from "@/shared/schema";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { microusdToUsd } from "@/lib/cost-telemetry";

/**
 * Agency-safe accounting view.  The child query is deliberately rooted at
 * parent_team_id = the authenticated agency; no client ID supplied by a caller
 * is trusted, and grandchildren are never included.
 */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const [agency] = await db.select({ billingPlan: teams.billingPlan })
      .from(teams).where(and(eq(teams.id, teamId), isNull(teams.deletedAt))).limit(1);
    if (!agency) return NextResponse.json({ error: "Agency team not found" }, { status: 404 });
    if (agency.billingPlan !== "agency") return NextResponse.json({ error: "Agency plan required", upgradeUrl: "/settings/billing" }, { status: 403 });

    const requestedDays = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "30", 10);
    const days = Math.max(1, Math.min(Number.isFinite(requestedDays) ? requestedDays : 30, 365));
    const since = new Date(Date.now() - days * 86_400_000);
    const clients = await db.select({ id: teams.id, name: teams.name })
      .from(teams).where(and(eq(teams.parentTeamId, teamId), isNull(teams.deletedAt), eq(teams.clientStatus, "active")));
    if (!clients.length) return NextResponse.json({ periodDays: days, clients: [] });
    const clientIds = clients.map((client) => client.id);
    const [costs, debits] = await Promise.all([
      db.select({ teamId: providerUsageLedger.teamId, costMicrousd: sql<number>`coalesce(sum(${providerUsageLedger.costMicrousd}), 0)::bigint` })
        .from(providerUsageLedger).where(and(inArray(providerUsageLedger.teamId, clientIds), gte(providerUsageLedger.occurredAt, since))).groupBy(providerUsageLedger.teamId),
      db.select({ teamId: creditLedger.teamId, credits: sql<number>`coalesce(sum(case when ${creditLedger.eventType} = 'debit' then abs(${creditLedger.amount}) else 0 end), 0)::bigint` })
        .from(creditLedger).where(and(inArray(creditLedger.teamId, clientIds), gte(creditLedger.createdAt, since))).groupBy(creditLedger.teamId),
    ]);
    const costsByTeam = new Map(costs.map((row) => [row.teamId, Number(row.costMicrousd)]));
    const creditsByTeam = new Map(debits.map((row) => [row.teamId, Number(row.credits)]));
    return NextResponse.json({
      periodDays: days,
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        providerCogsUsd: microusdToUsd(costsByTeam.get(client.id) ?? 0),
        creditsConsumed: creditsByTeam.get(client.id) ?? 0,
        // No markup/rebilling configuration table exists.  Do not infer one.
        revenueConfigured: false,
        approvedRebilling: null,
        margin: null,
      })),
    });
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status === 401 || status === 403) return NextResponse.json({ error: error.message }, { status });
    console.error("[agency/profitability GET]", error);
    return NextResponse.json({ error: "Failed to load client cost summary" }, { status: 500 });
  }
}