import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { articles, jobBatches, creditBalances, teams } from "@/shared/schema";
import { eq, and, isNull, count, desc, sql } from "drizzle-orm";

/** GET /api/client/dashboard — read-only summary for client teams */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const [[team], [balanceRow], articleStats, recentBatches] = await Promise.all([
      db.select({ id: teams.id, name: teams.name, parentTeamId: teams.parentTeamId, billingPlan: teams.billingPlan })
        .from(teams).where(eq(teams.id, teamId)).limit(1),

      db.select({ balance: creditBalances.balance })
        .from(creditBalances).where(eq(creditBalances.teamId, teamId)).limit(1),

      db.select({
        total: count(),
        published: sql<number>`count(*) filter (where status = 'published')`.mapWith(Number),
        draft: sql<number>`count(*) filter (where status = 'draft')`.mapWith(Number),
      }).from(articles).where(and(eq(articles.teamId, teamId), isNull(articles.deletedAt))),

      db.select({
        id: jobBatches.id,
        publicId: jobBatches.publicId,
        status: jobBatches.status,
        totalArticles: jobBatches.totalArticles,
        completedArticles: jobBatches.completedArticles,
        createdAt: jobBatches.createdAt,
      }).from(jobBatches)
        .where(eq(jobBatches.teamId, teamId))
        .orderBy(desc(jobBatches.createdAt))
        .limit(5),
    ]);

    return NextResponse.json({
      team: { id: team?.id, name: team?.name, isClientTeam: !!team?.parentTeamId },
      credits: { balance: balanceRow?.balance ?? 0 },
      articles: {
        total: Number(articleStats[0]?.total ?? 0),
        published: articleStats[0]?.published ?? 0,
        draft: articleStats[0]?.draft ?? 0,
      },
      recentBatches,
    });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[client/dashboard]", err);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
