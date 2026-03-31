import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, articleAssets, jobBatches, errorLogs } from "@/shared/schema";
import { eq, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";

// Helper: Convert any absolute image URL to a relative /api/public-objects/ path.
// This makes URLs immune to Replit dev domain changes and works on any deployment.
function normalizeImageUrl(url: string | null): string | null {
  if (!url) return null;

  // Already relative — ideal format
  if (url.startsWith('/api/public-objects/')) {
    return url;
  }

  // Any absolute URL that routes through /api/public-objects/ (riker.replit.dev, etc.)
  // e.g. https://xxx.riker.replit.dev/api/public-objects/article-784/image/xxx.png
  const publicObjectsMatch = url.match(/\/api\/public-objects\/(.+)$/);
  if (publicObjectsMatch) {
    return `/api/public-objects/${publicObjectsMatch[1]}`;
  }

  // Google Cloud Storage direct URL: https://storage.googleapis.com/{bucket}/public/{path}
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (bucketId && url.includes('storage.googleapis.com') && url.includes(bucketId)) {
    const match = url.match(/\/public\/(.+)$/);
    if (match) {
      return `/api/public-objects/${match[1]}`;
    }
  }

  // Old GCS format: https://{bucket}.id.repl.co/public/{path}
  if (bucketId && url.includes(`${bucketId}.id.repl.co/public/`)) {
    const path = url.split('/public/')[1];
    return `/api/public-objects/${path}`;
  }

  // Legacy temporary DALL-E URLs (oaidalleapiprodscus.blob.core.windows.net) — expired
  if (url.includes('oaidalleapiprodscus.blob.core.windows.net')) {
    return null;
  }

  return url;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId));

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    // Run remaining queries in parallel — they're all independent once we have the article
    const [batchResult, assets, errors] = await Promise.all([
      db.select().from(jobBatches).where(eq(jobBatches.id, article.batchId)),
      db.select().from(articleAssets).where(eq(articleAssets.articleId, articleId)).orderBy(asc(articleAssets.id)),
      db.select().from(errorLogs).where(eq(errorLogs.articleId, articleId)).orderBy(desc(errorLogs.createdAt)).limit(10),
    ]);
    const batch = batchResult[0];

    return NextResponse.json({
      article: {
        id: article.id,
        batchId: article.batchId,
        targetUrl: batch?.targetUrl || null,
        status: article.articleStatus,
        title: article.chosenTitle,
        heroImageUrl: normalizeImageUrl(article.heroImageUrl),
        seoTitle: article.seoTitle,
        metaDescription: article.metaDescription,
        slug: article.slug,
        keywords: article.keywordsJson,
        hashtags: article.hashtagsJson,
        faq: article.faqJson,
        wordCount: article.wordCount,
        htmlContent: article.finalHtmlContent,
        seoScore: article.seoScore,
        hyperlinkedKeywords: article.hyperlinkedKeywordsJson,
        metaEnrichment: article.metaEnrichment,
        podcastUrl: normalizeImageUrl(article.podcastUrl),
        podcastDuration: article.podcastDuration,
        podcastStatus: article.podcastStatus,
        podcastGeneratedAt: article.podcastGeneratedAt,
        podcastScriptJson: article.podcastScriptJson,
        businessName: batch?.businessName || null,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
      errors: errors.map(err => ({
        id: err.id,
        errorType: err.errorType,
        errorMessage: err.errorMessage,
        severity: err.severity,
        createdAt: err.createdAt,
      })),
      assets: assets.map(asset => ({
        id: asset.id,
        url: normalizeImageUrl(asset.storageUrl) || asset.storageUrl,
        altText: asset.altText,
        prompt: asset.imagePromptUsed,
        format: asset.fileFormat,
      })),
    });
  } catch (error) {
    console.error("Error fetching article:", error);
    return NextResponse.json(
      { error: "Failed to fetch article" },
      { status: 500 }
    );
  }
}

const updateArticleSchema = z.object({
  userId: z.number().int(),
  finalHtmlContent: z.string().optional(),
  seoTitle: z.string().max(60).optional(),
  metaDescription: z.string().max(160).optional(),
  slug: z.string().max(255).optional(),
  keywordsJson: z.array(z.string()).optional(),
  hashtagsJson: z.array(z.string()).optional(),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: authUserId, teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validation = updateArticleSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.errors },
        { status: 400 }
      );
    }

    const { userId, ...updateData } = validation.data;

    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId));

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.id, article.batchId));

    if (!batch || batch.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized: You do not have permission to update this article" },
        { status: 403 }
      );
    }

    const updatePayload: any = {};
    if (updateData.finalHtmlContent !== undefined) updatePayload.finalHtmlContent = updateData.finalHtmlContent;
    if (updateData.seoTitle !== undefined) updatePayload.seoTitle = updateData.seoTitle;
    if (updateData.metaDescription !== undefined) updatePayload.metaDescription = updateData.metaDescription;
    if (updateData.slug !== undefined) updatePayload.slug = updateData.slug;
    if (updateData.keywordsJson !== undefined) updatePayload.keywordsJson = updateData.keywordsJson;
    if (updateData.hashtagsJson !== undefined) updatePayload.hashtagsJson = updateData.hashtagsJson;
    updatePayload.updatedAt = new Date();

    if (Object.keys(updatePayload).length > 1) {
      const [updated] = await db
        .update(articles)
        .set(updatePayload)
        .where(eq(articles.id, articleId))
        .returning();

      // MVP: Skip audit log for now
      // TODO: Add audit logging when admin features are implemented

      return NextResponse.json({
        success: true,
        message: "Article updated successfully",
        article: updated,
      });
    }

    return NextResponse.json({
      success: true,
      message: "No changes to save",
    });
  } catch (error) {
    console.error("Error updating article:", error);
    return NextResponse.json(
      { error: "Failed to update article", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: authUserId, teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get("userId");
    
    if (!userIdParam) {
      return NextResponse.json(
        { error: "Missing userId parameter" },
        { status: 400 }
      );
    }

    const userId = parseInt(userIdParam);

    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, articleId));

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.id, article.batchId));

    if (!batch || batch.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized: You do not have permission to delete this article" },
        { status: 403 }
      );
    }

    const assets = await db
      .select()
      .from(articleAssets)
      .where(eq(articleAssets.articleId, articleId))
      .orderBy(asc(articleAssets.id)); // Order by ID to ensure consistent ordering

    // MVP: Only delete article assets
    await db.delete(articleAssets).where(eq(articleAssets.articleId, articleId));

    if (assets.length > 0) {
      const { deleteFromStorage } = await import("@/lib/storage");
      for (const asset of assets) {
        try {
          const urlParts = asset.storageUrl.split('/');
          const key = urlParts.slice(3).join('/');
          await deleteFromStorage(key);
        } catch (err) {
          console.warn(`Failed to delete asset from storage: ${asset.storageUrl}`, err);
        }
      }
    }

    await db.delete(articles).where(eq(articles.id, articleId));

    // MVP: Skip audit log for now
    // TODO: Add audit logging when admin features are implemented

    return NextResponse.json({
      success: true,
      message: "Article and all related data deleted successfully",
      deletedAssets: assets.length,
    });
  } catch (error) {
    console.error("Error deleting article:", error);
    return NextResponse.json(
      { error: "Failed to delete article", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
