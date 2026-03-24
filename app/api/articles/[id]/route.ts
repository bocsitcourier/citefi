import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { 
  articles, 
  articleAssets, 
  jobEvents, 
  seoLogs, 
  socialPosts, 
  socialPostVariants,
  socialPostAssets,
  socialPostJobs,
  socialPostLogs,
  errorLogs,
  articleVersions,
  publishingJobs,
} from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    // CRITICAL: Check if article exists AND belongs to user's team
    const [article] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!article) {
      return NextResponse.json(
        { error: "Article not found or access denied" },
        { status: 404 }
      );
    }

    // Execute cascading delete (Neon HTTP driver doesn't support transactions)
    // Get social posts before deleting
    const socialPostsToDelete = await db
      .select({ id: socialPosts.id })
      .from(socialPosts)
      .where(eq(socialPosts.articleId, articleId));
    
    const socialPostIds = socialPostsToDelete.map(sp => sp.id);

    // CRITICAL: Delete in correct cascade order to avoid FK violations
    if (socialPostIds.length > 0) {
      // 1. Delete social post logs (depends on social_posts)
      await db.delete(socialPostLogs).where(
        sql`${socialPostLogs.socialPostId} = ANY(${socialPostIds})`
      );
      
      // 2. Delete social post variants (depends on social_posts)
      await db.delete(socialPostVariants).where(
        sql`${socialPostVariants.socialPostId} = ANY(${socialPostIds})`
      );
      
      // 3. Delete social post assets (depends on social_posts)
      await db.delete(socialPostAssets).where(
        sql`${socialPostAssets.socialPostId} = ANY(${socialPostIds})`
      );
      
      // 4. Delete social post jobs (depends on social_posts)
      await db.delete(socialPostJobs).where(
        sql`${socialPostJobs.socialPostId} = ANY(${socialPostIds})`
      );
    }
    
    // 5. Delete social posts (now safe - ALL children removed)
    await db.delete(socialPosts).where(eq(socialPosts.articleId, articleId));
    await db.delete(articleVersions).where(eq(articleVersions.articleId, articleId));
    await db.delete(seoLogs).where(eq(seoLogs.articleId, articleId));
    await db.delete(articleAssets).where(eq(articleAssets.articleId, articleId));
    await db.delete(jobEvents).where(eq(jobEvents.articleId, articleId));
    await db.delete(errorLogs).where(eq(errorLogs.articleId, articleId));
    // 6. Delete publishing jobs (FK reference to articles — must go before article delete)
    //    Child rows referencing publishingJobs.id have onDelete:'cascade' so they
    //    are removed automatically when the publishing_jobs row is deleted.
    await db.delete(publishingJobs).where(eq(publishingJobs.articleId, articleId));
    
    // Finally delete the article itself
    await db.delete(articles).where(eq(articles.id, articleId));

    return NextResponse.json({
      success: true,
      message: "Article permanently deleted",
      deletedId: articleId,
    });
  } catch (error) {
    console.error("Error deleting article:", error);
    return NextResponse.json(
      { error: "Failed to delete article" },
      { status: 500 }
    );
  }
}
