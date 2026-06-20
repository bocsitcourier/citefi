import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { 
  jobBatches, 
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
  batchSeoCache 
} from "@/shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    // CRITICAL: Check if batch exists AND belongs to user's team
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!batch) {
      return NextResponse.json(
        { error: "Batch not found or access denied" },
        { status: 404 }
      );
    }

    // Only select columns needed for the UI — avoids pulling 20KB+ bodyHtml on every poll
    const batchArticles = await db
      .select({
        id: articles.id,
        articleStatus: articles.articleStatus,
        chosenTitle: articles.chosenTitle,
        seoTitle: articles.seoTitle,
        slug: articles.slug,
        wordCount: articles.wordCount,
        heroImageUrl: articles.heroImageUrl,
        errorMessage: articles.errorMessage,
        createdAt: articles.createdAt,
      })
      .from(articles)
      .where(eq(articles.batchId, batchId));
    
    // Fetch SEO cache metadata only — redditResearch is a large JSON blob
    // not needed for the batch status display (omitted from poll response)
    const [seoCache] = await db
      .select({
        cacheVersion: batchSeoCache.cacheVersion,
        generatedAt: batchSeoCache.generatedAt,
      })
      .from(batchSeoCache)
      .where(eq(batchSeoCache.batchId, batchId))
      .limit(1);

    return NextResponse.json({
      batch: {
        id: batch.id,
        userId: batch.userId,
        coreTopic: batch.coreTopic,
        targetUrl: batch.targetUrl,
        status: batch.status,
        numArticlesRequested: batch.numArticlesRequested,
        titlePoolJson: batch.titlePoolJson,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
      },
      seoCache: seoCache ? {
        cacheVersion: seoCache.cacheVersion,
        generatedAt: seoCache.generatedAt,
      } : null,
      articles: batchArticles.map(article => ({
        id: article.id,
        articleStatus: article.articleStatus,
        chosenTitle: article.chosenTitle,
        seoTitle: article.seoTitle,
        slug: article.slug,
        wordCount: article.wordCount,
        heroImageUrl: article.heroImageUrl,
        errorMessage: article.errorMessage ?? null,
        createdAt: article.createdAt,
      })),
      summary: {
        total: batchArticles.length,
        completed: batchArticles.filter(a => a.articleStatus === "COMPLETE").length,
        inProgress: batchArticles.filter(a => 
          a.articleStatus === "IN_PROGRESS" ||
          a.articleStatus === "GEMINI_COMPLETE" ||
          a.articleStatus === "CHATGPT_REVIEWED" ||
          a.articleStatus === "GPT4_ENHANCED"
        ).length,
        pending: batchArticles.filter(a => a.articleStatus === "PENDING").length,
        failed: batchArticles.filter(a => a.articleStatus === "FAILED").length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching batch:", error);
    return NextResponse.json(
      { error: "Failed to fetch batch details" },
      { status: error?.statusCode || 500 }
      );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const batchId = parseInt(id);
    
    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { 
      coreTopic, 
      targetUrl,
      tone,
      geographicFocus,
      audience,
      competitorUrls,
      semanticClusterId,
      serpFeatureTarget
    } = body;

    // CRITICAL: Check if batch exists AND belongs to user's team
    const [existingBatch] = await db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!existingBatch) {
      return NextResponse.json(
        { error: "Batch not found or access denied" },
        { status: 404 }
      );
    }

    if (existingBatch.status === "RUNNING") {
      return NextResponse.json(
        { error: "Cannot edit batch while it is running" },
        { status: 400 }
      );
    }

    const updateData: any = {};

    if (coreTopic !== undefined) updateData.coreTopic = coreTopic;
    if (targetUrl !== undefined) updateData.targetUrl = targetUrl;
    if (competitorUrls !== undefined) {
      updateData.competitorUrlsJson = competitorUrls.length > 0 ? competitorUrls : null;
    }
    if (semanticClusterId !== undefined) updateData.semanticClusterId = semanticClusterId || null;
    if (serpFeatureTarget !== undefined) updateData.serpFeatureTarget = serpFeatureTarget || null;

    const generationParams = existingBatch.generationParams as any || {};
    if (tone !== undefined) generationParams.tone = tone;
    if (geographicFocus !== undefined) generationParams.geographicFocus = geographicFocus;
    if (audience !== undefined) generationParams.audience = audience;
    
    if (Object.keys(generationParams).length > 0) {
      updateData.generationParams = generationParams;
    }

    const [updatedBatch] = await db
      .update(jobBatches)
      .set(updateData)
      .where(eq(jobBatches.id, batchId))
      .returning();

    console.log(`✅ Batch ${batchId} updated successfully`);

    return NextResponse.json({
      success: true,
      batch: updatedBatch,
    });
  } catch (error: any) {
    console.error("❌ Error updating batch:", error);
    return NextResponse.json(
      { 
        error: "Failed to update batch",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    // CRITICAL: Check if batch exists AND belongs to user's team
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!batch) {
      return NextResponse.json(
        { error: "Batch not found or access denied" },
        { status: 404 }
      );
    }

    // Get all articles in this batch
    const batchArticles = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.batchId, batchId));

    const articleIds = batchArticles.map(a => a.id);

    // Execute cascading delete (Neon HTTP driver doesn't support transactions)
    if (articleIds.length > 0) {
      // Get all social posts for these articles
      const socialPostsToDelete = await db
        .select({ id: socialPosts.id })
        .from(socialPosts)
        .where(inArray(socialPosts.articleId, articleIds));
      
      const socialPostIds = socialPostsToDelete.map(sp => sp.id);

      // CRITICAL: Delete in correct cascade order to avoid FK violations
      if (socialPostIds.length > 0) {
        // 1. Delete social post logs (depends on social_posts)
        await db.delete(socialPostLogs).where(
          inArray(socialPostLogs.socialPostId, socialPostIds)
        );
        
        // 2. Delete social post variants (depends on social_posts)
        await db.delete(socialPostVariants).where(
          inArray(socialPostVariants.socialPostId, socialPostIds)
        );
        
        // 3. Delete social post assets (depends on social_posts)
        await db.delete(socialPostAssets).where(
          inArray(socialPostAssets.socialPostId, socialPostIds)
        );
        
        // 4. Delete social post jobs (depends on social_posts)
        await db.delete(socialPostJobs).where(
          inArray(socialPostJobs.socialPostId, socialPostIds)
        );
      }

      // 5. Delete social posts (now safe - ALL children removed)
      await db.delete(socialPosts).where(inArray(socialPosts.articleId, articleIds));
      await db.delete(articleVersions).where(inArray(articleVersions.articleId, articleIds));
      await db.delete(seoLogs).where(inArray(seoLogs.articleId, articleIds));
      await db.delete(articleAssets).where(inArray(articleAssets.articleId, articleIds));
      await db.delete(jobEvents).where(inArray(jobEvents.articleId, articleIds));
      await db.delete(errorLogs).where(inArray(errorLogs.articleId, articleIds));

      // Delete all articles in batch
      await db.delete(articles).where(eq(articles.batchId, batchId));
    }

    // Delete batch-level records
    await db.delete(jobEvents).where(eq(jobEvents.batchId, batchId));
    await db.delete(errorLogs).where(eq(errorLogs.batchId, batchId));

    // Delete the batch itself
    await db.delete(jobBatches).where(eq(jobBatches.id, batchId));

    return NextResponse.json({
      success: true,
      message: "Batch and all associated articles permanently deleted",
      deletedBatchId: batchId,
      deletedArticlesCount: articleIds.length,
    });
  } catch (error: any) {
    console.error("Error deleting batch:", error);
    return NextResponse.json(
      { error: "Failed to delete batch" },
      { status: error?.statusCode || 500 }
    );
  }
}
