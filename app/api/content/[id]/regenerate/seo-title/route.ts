import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { regenerateSeoTitle } from "@/lib/seo-regenerator";
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

    // Extract text content from HTML or use raw content
    let articleContent = article.finalHtmlContent || article.finalHtmlContent || "";
    
    // Strip HTML tags for better context
    if (articleContent) {
      articleContent = articleContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    
    // Fallback to title if no content
    if (!articleContent) {
      articleContent = article.chosenTitle;
    }
    
    const currentTitle = article.seoTitle || article.chosenTitle;

    // Regenerate SEO title
    const newSeoTitle = await regenerateSeoTitle(currentTitle, articleContent);

    // CRITICAL: Update database with team filter
    await db
      .update(articles)
      .set({ seoTitle: newSeoTitle })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // CRITICAL TEAM FILTER ON UPDATE
        )
      );

    return NextResponse.json({
      success: true,
      seoTitle: newSeoTitle,
    });
  } catch (error: any) {
    console.error("Failed to regenerate SEO title:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to regenerate SEO title" },
      { status: error?.statusCode || 500 }
    );
  }
}
