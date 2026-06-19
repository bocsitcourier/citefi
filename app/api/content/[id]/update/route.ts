import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const resolvedParams = await params;
    const articleId = parseInt(resolvedParams.id);
    const body = await request.json();

    const { htmlContent, title, seoTitle, metaDescription, slug, hyperlinkedKeywords, hashtags } = body;

    if (!articleId || isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (htmlContent !== undefined) updateData.finalHtmlContent = htmlContent;
    if (title !== undefined) updateData.chosenTitle = title;
    if (seoTitle !== undefined) updateData.seoTitle = seoTitle;
    if (metaDescription !== undefined) updateData.metaDescription = metaDescription;
    if (slug !== undefined) updateData.slug = slug;
    if (hyperlinkedKeywords !== undefined) updateData.hyperlinkedKeywordsJson = hyperlinkedKeywords;
    if (hashtags !== undefined) updateData.hashtagsJson = hashtags;

    if (htmlContent) {
      const text = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const words = text.split(/\s+/).filter((w: string) => w.length > 0);
      updateData.wordCount = words.length;
    }

    // CRITICAL: Update only if article belongs to user's team
    const [updated] = await db
      .update(articles)
      .set(updateData)
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // TEAM ISOLATION
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Article not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      article: updated 
    });
  } catch (error) {
    console.error("Error updating article:", error);
    return NextResponse.json(
      { error: "Failed to update article" },
      { status: 500 }
    );
  }
}
