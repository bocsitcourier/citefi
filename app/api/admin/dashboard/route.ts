import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, articles, jobEvents, users } from "@/shared/schema";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    // Get total counts
    const [totalBatches] = await db.select({ count: sql<string>`count(*)::text` }).from(jobBatches);
    const [totalArticles] = await db.select({ count: sql<string>`count(*)::text` }).from(articles);
    const [totalUsers] = await db.select({ count: sql<string>`count(*)::text` }).from(users);

    // Get status breakdown for batches
    const batchStatusCounts = await db
      .select({
        status: jobBatches.status,
        count: sql<string>`count(*)::text`,
      })
      .from(jobBatches)
      .groupBy(jobBatches.status);

    // Get status breakdown for articles
    const articleStatusCounts = await db
      .select({
        status: articles.articleStatus,
        count: sql<string>`count(*)::text`,
      })
      .from(articles)
      .groupBy(articles.articleStatus);

    // Get active (in-progress) articles
    const activeArticles = await db
      .select({
        id: articles.id,
        title: articles.chosenTitle,
        status: articles.articleStatus,
        batchId: articles.batchId,
        updatedAt: articles.updatedAt,
      })
      .from(articles)
      .where(
        sql`${articles.articleStatus} IN ('IN_PROGRESS', 'GEMINI_DONE', 'GPT_DONE')`
      )
      .orderBy(desc(articles.updatedAt))
      .limit(10);

    // Get recent batches
    const recentBatches = await db
      .select({
        id: jobBatches.id,
        coreTopic: jobBatches.coreTopic,
        status: jobBatches.status,
        numArticlesRequested: jobBatches.numArticlesRequested,
        createdAt: jobBatches.createdAt,
      })
      .from(jobBatches)
      .orderBy(desc(jobBatches.createdAt))
      .limit(10);

    // Get unresolved errors (using job_events for MVP)
    const unresolvedErrors = await db
      .select({
        count: sql<string>`count(*)::text`,
      })
      .from(jobEvents)
      .where(
        and(
          eq(jobEvents.severity, 'error'),
          gte(jobEvents.createdAt, sql`NOW() - INTERVAL '24 hours'`)
        )
      );

    // Get recent job events
    const recentEvents = await db
      .select()
      .from(jobEvents)
      .orderBy(desc(jobEvents.createdAt))
      .limit(20);

    return NextResponse.json({
      summary: {
        totalBatches: parseInt(totalBatches?.count || "0"),
        totalArticles: parseInt(totalArticles?.count || "0"),
        totalUsers: parseInt(totalUsers?.count || "0"),
        unresolvedErrors: parseInt(unresolvedErrors[0]?.count || "0"),
      },
      batchStatus: batchStatusCounts.reduce((acc, item) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      articleStatus: articleStatusCounts.reduce((acc, item) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      activeArticles,
      recentBatches,
      recentEvents,
    });
  } catch (error: any) {
    console.error("Admin dashboard error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: error?.statusCode || 500 }
    );
  }
}
