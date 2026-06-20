import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { creditBalances, creditLedger, teams } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const teamIdParam = searchParams.get("teamId");
    const teamId = teamIdParam ? parseInt(teamIdParam, 10) : null;

    if (teamId) {
      const [balance] = await db
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.teamId, teamId));

      const ledger = await db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.teamId, teamId))
        .orderBy(desc(creditLedger.createdAt))
        .limit(100);

      const allowanceRemaining = balance
        ? Math.max(0, balance.allowanceCredits - balance.allowanceUsed)
        : 0;
      const purchasedRemaining = balance
        ? Math.max(0, balance.purchasedCredits - balance.purchasedUsed)
        : 0;
      const totalRemaining = Math.max(
        0,
        allowanceRemaining + purchasedRemaining - (balance?.reservedCredits ?? 0)
      );

      return NextResponse.json({
        teamId,
        balance: balance?.balance ?? 0,
        allowanceCredits: balance?.allowanceCredits ?? 0,
        purchasedCredits: balance?.purchasedCredits ?? 0,
        allowanceUsed: balance?.allowanceUsed ?? 0,
        purchasedUsed: balance?.purchasedUsed ?? 0,
        reservedCredits: balance?.reservedCredits ?? 0,
        allowanceRemaining,
        purchasedRemaining,
        totalRemaining,
        periodStart: balance?.periodStart ?? null,
        periodEnd: balance?.periodEnd ?? null,
        ledger,
      });
    }

    const allBalances = await db
      .select({
        teamId: creditBalances.teamId,
        teamName: teams.name,
        balance: creditBalances.balance,
        allowanceCredits: creditBalances.allowanceCredits,
        purchasedCredits: creditBalances.purchasedCredits,
        allowanceUsed: creditBalances.allowanceUsed,
        purchasedUsed: creditBalances.purchasedUsed,
        reservedCredits: creditBalances.reservedCredits,
        periodEnd: creditBalances.periodEnd,
        updatedAt: creditBalances.updatedAt,
      })
      .from(creditBalances)
      .leftJoin(teams, eq(creditBalances.teamId, teams.id))
      .orderBy(desc(creditBalances.updatedAt));

    return NextResponse.json({ balances: allBalances });
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    if (msg === "Authentication required") return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === "Admin access required") return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: err?.statusCode || 500 });
  }
}
