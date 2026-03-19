import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { articles, users } from "@/shared/schema";
import { sql, gte, and, eq } from "drizzle-orm";
import { subDays } from "date-fns";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30");

    const startDate = subDays(new Date(), days);

    const dailyStatsResult = await db.execute(sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_articles,
        COUNT(DISTINCT team_id) as active_teams
      FROM ${articles}
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);
    const dailyStats = (dailyStatsResult as any).rows || [];

    const teamStats = await db
      .select({
        teamId: articles.teamId,
        articleCount: sql<number>`count(${articles.id})`,
      })
      .from(articles)
      .where(gte(articles.createdAt, startDate))
      .groupBy(articles.teamId)
      .orderBy(sql`count(${articles.id}) DESC`)
      .limit(10);

    const totalArticles = await db
      .select({ count: sql<number>`count(*)` })
      .from(articles)
      .where(gte(articles.createdAt, startDate));

    const totalTeams = await db
      .select({ count: sql<number>`count(DISTINCT ${articles.teamId})` })
      .from(articles)
      .where(gte(articles.createdAt, startDate));

    return NextResponse.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalArticles: Number(totalArticles[0]?.count) || 0,
        activeTeams: Number(totalTeams[0]?.count) || 0,
        averagePerDay: Number(totalArticles[0]?.count || 0) / days,
      },
      dailyStats: dailyStats,
      topTeams: teamStats,
    });
  } catch (error: any) {
    console.error("Analytics error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to fetch analytics";
    let status = 500;
    
    if (message === "Authentication required" || message === "No authentication token provided" || message === "Invalid or expired token") {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    } else if (error.statusCode) {
      status = error.statusCode;
    }
    
    return NextResponse.json({ error: message }, { status });
  }
}
