import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, creditBalances, creditLedger, articles } from "@/shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { BILLING_PLANS } from "@/lib/billing/plans";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const periodStart = new Date();
    periodStart.setDate(1);
    periodStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [[team], [balance], usageRows, dailyUsage, articleCount] = await Promise.all([
      db.select({ billingPlan: teams.billingPlan, currentPeriodEnd: teams.currentPeriodEnd })
        .from(teams).where(eq(teams.id, teamId)).limit(1),

      db.select({ balance: creditBalances.balance })
        .from(creditBalances).where(eq(creditBalances.teamId, teamId)).limit(1),

      db.select({
        productType: creditLedger.productType,
        used: sql<number>`ABS(SUM(${creditLedger.amount}))`.mapWith(Number),
      })
        .from(creditLedger)
        .where(and(
          eq(creditLedger.teamId, teamId),
          gte(creditLedger.createdAt, periodStart),
          sql`${creditLedger.amount} < 0`
        ))
        .groupBy(creditLedger.productType),

      db.select({
        day: sql<string>`DATE_TRUNC('day', ${creditLedger.createdAt})::date::text`,
        used: sql<number>`ABS(SUM(${creditLedger.amount}))`.mapWith(Number),
      })
        .from(creditLedger)
        .where(and(
          eq(creditLedger.teamId, teamId),
          gte(creditLedger.createdAt, thirtyDaysAgo),
          sql`${creditLedger.amount} < 0`
        ))
        .groupBy(sql`DATE_TRUNC('day', ${creditLedger.createdAt})`)
        .orderBy(sql`DATE_TRUNC('day', ${creditLedger.createdAt})`),

      db.select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(articles)
        .where(and(eq(articles.teamId, teamId), gte(articles.createdAt, periodStart))),
    ]);

    const plan = BILLING_PLANS[(team?.billingPlan ?? "free") as keyof typeof BILLING_PLANS];
    const creditsAllocated = plan?.monthlyCredits ?? 50;
    const currentBalance = balance?.balance ?? 0;

    const breakdown = usageRows.reduce((acc, row) => {
      if (row.productType) acc[row.productType] = row.used ?? 0;
      return acc;
    }, {} as Record<string, number>);
    const creditsUsed = Object.values(breakdown).reduce((a, b) => a + b, 0);

    return NextResponse.json({
      credits: {
        balance: currentBalance,
        used: creditsUsed,
        allocated: creditsAllocated,
        usedPct: creditsAllocated > 0 ? Math.round((creditsUsed / creditsAllocated) * 100) : 0,
      },
      breakdown: {
        article: breakdown.article ?? 0,
        social: breakdown.social ?? 0,
        podcast: breakdown.podcast ?? 0,
        video: breakdown.video ?? 0,
      },
      dailySeries: dailyUsage.map(r => ({ day: r.day, used: r.used })),
      articlesThisPeriod: Number(articleCount[0]?.count ?? 0),
      currentPeriodEnd: team?.currentPeriodEnd ?? null,
      planName: plan?.name ?? "Free",
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/usage]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: err?.statusCode || 500 });
  }
}
