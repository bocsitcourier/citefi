import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, locales } from "@/shared/schema";
import { eq, desc, and, or } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

/**
 * GET /api/articles/list
 * Returns completed articles scoped strictly to the authenticated user's team.
 * SECURITY: requireTeamMember enforces hard team isolation — no NULL-team fallback.
 */
export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get("limit") || "1000"), 1000);

    const completedArticles = await db
      .select({
        id: articles.id,
        title: articles.chosenTitle,
        word_count: articles.wordCount,
        location: locales.city,
        seo_score: articles.seoScore,
        article_status: articles.articleStatus,
        batchId: articles.batchId,
      })
      .from(articles)
      .leftJoin(locales, eq(articles.localeId, locales.id))
      .where(
        and(
          eq(articles.teamId, teamId),
          or(
            eq(articles.articleStatus, "COMPLETE"),
            eq(articles.articleStatus, "GPT4_ENHANCED"),
            eq(articles.articleStatus, "PUBLISHED")
          )
        )
      )
      .orderBy(desc(articles.createdAt))
      .limit(limit);

    return NextResponse.json(completedArticles);
  } catch (error: any) {
    console.error("Error fetching articles list:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch completed articles" },
      { status: error?.statusCode || 500 }
    );
  }
}
