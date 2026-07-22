import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentEvents, articles, socialPosts } from "@/shared/schema";
import { eq, gte, desc, count, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Total events in last 24h
    const [totalRow] = await db
      .select({ total: count() })
      .from(contentEvents)
      .where(gte(contentEvents.createdAt, since24h));

    // Event type breakdown in last 24h
    const breakdown = await db
      .select({
        eventType: contentEvents.eventType,
        total: count(),
      })
      .from(contentEvents)
      .where(gte(contentEvents.createdAt, since24h))
      .groupBy(contentEvents.eventType)
      .orderBy(desc(count()));

    // Last 10 conversions with content title
    const lastConversions = await db
      .select({
        id: contentEvents.id,
        contentType: contentEvents.contentType,
        articleId: contentEvents.articleId,
        socialPostId: contentEvents.socialPostId,
        conversionType: contentEvents.conversionType,
        conversionValue: contentEvents.conversionValue,
        visitorId: contentEvents.visitorId,
        createdAt: contentEvents.createdAt,
      })
      .from(contentEvents)
      .where(eq(contentEvents.eventType, "conversion"))
      .orderBy(desc(contentEvents.createdAt))
      .limit(10);

    // Enrich conversions with article/post titles
    const enriched = await Promise.all(
      lastConversions.map(async (c) => {
        let contentTitle = "Unknown";
        if (c.contentType === "article" && c.articleId) {
          const [row] = await db
            .select({ title: articles.chosenTitle })
            .from(articles)
            .where(eq(articles.id, c.articleId))
            .limit(1);
          contentTitle = row?.title ?? "Untitled Article";
        } else if (c.contentType === "social_post" && c.socialPostId) {
          const [row] = await db
            .select({ title: socialPosts.title })
            .from(socialPosts)
            .where(eq(socialPosts.id, c.socialPostId))
            .limit(1);
          contentTitle = row?.title ?? "Untitled Post";
        }
        return {
          id: c.id,
          contentType: c.contentType,
          contentTitle,
          conversionType: c.conversionType ?? "conversion",
          conversionValue: c.conversionValue ?? null,
          visitorId: c.visitorId ?? null,
          createdAt: c.createdAt,
        };
      })
    );

    // ConversionLabeler last run — BullMQ does not persist completed job history
    // in a queryable Postgres table. Return null; future work can log a timestamp
    // to the app DB when the labeler completes.
    const labelerLastRun: string | null = null;

    return NextResponse.json({
      last24h: {
        total: totalRow?.total ?? 0,
        breakdown: breakdown.map((b) => ({ eventType: b.eventType, count: Number(b.total) })),
      },
      lastConversions: enriched,
      labelerLastRun,
    });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[admin/analytics/events]", err);
    return NextResponse.json({ error: "Failed to load event analytics" }, { status: err?.statusCode || 500 });
  }
}
