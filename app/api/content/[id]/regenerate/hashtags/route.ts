import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { regenerateHashtags } from "@/lib/seo-regenerator";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await params;
    const articleId = parseInt(id);

    // Fetch article — enforce team ownership
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
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
    
    const currentHashtags = (article.hashtagsJson as string[] | null) || [];

    // Regenerate hashtags
    const newHashtags = await regenerateHashtags(currentHashtags, articleContent);

    // Update database — enforce team ownership on write
    await db
      .update(articles)
      .set({ hashtagsJson: newHashtags })
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)));

    return NextResponse.json({
      success: true,
      hashtags: newHashtags,
    });
  } catch (error: any) {
    console.error("Failed to regenerate hashtags:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to regenerate hashtags" },
      { status: error?.statusCode || 500 }
    );
  }
}
