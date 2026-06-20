import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { getBucketBalance } from "@/lib/billing";
import { db } from "@/lib/db";
import { creditLedger } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/billing/balance
 *
 * Returns the authenticated team's two-bucket credit balance and the last
 * 20 ledger entries for the real-time meter panel.
 */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const [balance, recentLedger] = await Promise.all([
      getBucketBalance(teamId),
      db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.teamId, teamId))
        .orderBy(desc(creditLedger.createdAt))
        .limit(20),
    ]);

    return NextResponse.json({
      allowanceCredits: balance.allowanceCredits,
      purchasedCredits: balance.purchasedCredits,
      allowanceUsed: balance.allowanceUsed,
      purchasedUsed: balance.purchasedUsed,
      reservedCredits: balance.reservedCredits,
      allowanceRemaining: balance.allowanceRemaining,
      purchasedRemaining: balance.purchasedRemaining,
      totalRemaining: balance.totalRemaining,
      periodStart: balance.periodStart,
      periodEnd: balance.periodEnd,
      recentLedger,
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[billing/balance]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
