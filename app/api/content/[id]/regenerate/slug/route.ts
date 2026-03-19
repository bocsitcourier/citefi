import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { regenerateSlug } from "@/lib/seo-regenerator";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await params;
    const articleId = parseInt(id);

    // CRITICAL: Fetch article filtered by team_id
    const [article] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // TEAM ISOLATION
        )
      )
      .limit(1);

    if (!article) {
      return NextResponse.json({ error: "Article not found or access denied" }, { status: 404 });
    }

    const currentSlug = article.slug || "";
    const title = article.seoTitle || article.chosenTitle;

    // Regenerate slug
    const newSlug = await regenerateSlug(currentSlug, title);

    // CRITICAL: Update database with team filter
    await db
      .update(articles)
      .set({ slug: newSlug })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // CRITICAL TEAM FILTER ON UPDATE
        )
      );

    return NextResponse.json({
      success: true,
      slug: newSlug,
    });
  } catch (error) {
    console.error("Failed to regenerate slug:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to regenerate slug" },
      { status: 500 }
    );
  }
}
