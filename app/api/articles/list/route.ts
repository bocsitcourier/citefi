import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, locales, users } from "@/shared/schema";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/api/auth";

/**
 * GET /api/articles/list
 * Returns completed articles for social media post generation
 * CRITICAL: Team-scoped to prevent cross-team data leaks
 */
export async function GET(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { userId, teamId: memberTeamId } = await requireAuth(request);
    
    // Fallback to user's default_team_id if not in team_members table
    let teamId = memberTeamId;
    if (!teamId) {
      const [user] = await db
        .select({ defaultTeamId: users.defaultTeamId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      
      teamId = user?.defaultTeamId || null;
    }
    
    // Skip team filter if still no teamId (legacy data)
    if (!teamId) {
      console.warn(`User ${userId} has no team assignment - returning user's articles only`);
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "1000");

    // Build where conditions dynamically
    // Include both COMPLETE and GPT4_ENHANCED articles (ready for publishing)
    const whereConditions = [or(
      eq(articles.articleStatus, "COMPLETE"),
      eq(articles.articleStatus, "GPT4_ENHANCED"),
      eq(articles.articleStatus, "PUBLISHED")
    )];
    
    // CRITICAL SECURITY FIX: Proper team isolation for NULL team_id
    if (teamId) {
      // User has a team: show articles matching their teamId OR articles with NULL team_id (legacy)
      whereConditions.push(
        or(
          eq(articles.teamId, teamId),
          isNull(articles.teamId)
        )
      );
    } else {
      // User has NO team: ONLY show articles with NULL team_id (prevent cross-team leaks)
      whereConditions.push(isNull(articles.teamId));
    }

    // CRITICAL: Fetch completed articles filtered by team_id (if available)
    const completedArticles = await db
      .select({
        id: articles.id,
        title: articles.chosenTitle,
        word_count: articles.wordCount,
        location: locales.city, // Get city name from locales table
        seo_score: articles.seoScore,
        article_status: articles.articleStatus,
      })
      .from(articles)
      .leftJoin(locales, eq(articles.localeId, locales.id))
      .where(and(...whereConditions))
      .orderBy(desc(articles.createdAt))
      .limit(limit);

    return NextResponse.json(completedArticles);
  } catch (error: any) {
    console.error("Error fetching articles for social media:", error);
    
    // Return proper status code for auth errors
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch completed articles" },
      { status: statusCode }
    );
  }
}
