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

      return NextResponse.json({ balance: balance?.balance ?? 0, teamId, ledger });
    }

    const allBalances = await db
      .select({
        teamId: creditBalances.teamId,
        teamName: teams.name,
        balance: creditBalances.balance,
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
