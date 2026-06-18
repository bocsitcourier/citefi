import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches, errorLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { addArticleJob } from "@/lib/queue";
import { requireAdmin } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const adminUserId = await requireAdmin(request);
    const body = await request.json();
    const { articleIds } = body;

    if (!articleIds || !Array.isArray(articleIds)) {
      return NextResponse.json(
        { error: "articleIds array is required" },
        { status: 400 }
      );
    }

    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];
    const skipped: { id: number; reason: string }[] = [];

    for (const articleId of articleIds) {
      try {
        const [article] = await db
          .select()
          .from(articles)
          .where(eq(articles.id, articleId))
          .limit(1);

        if (!article) {
          skipped.push({ id: articleId, reason: "Article not found" });
          continue;
        }

        if (article.articleStatus !== "FAILED") {
          skipped.push({
            id: articleId,
            reason: `Status is '${article.articleStatus}', expected 'FAILED'`,
          });
          continue;
        }

        const [batch] = await db
          .select()
          .from(jobBatches)
          .where(eq(jobBatches.id, article.batchId))
          .limit(1);

        if (!batch) {
          skipped.push({ id: articleId, reason: `Batch ${article.batchId} not found` });
          continue;
        }

        await db
          .update(articles)
          .set({ articleStatus: "PENDING", updatedAt: new Date() })
          .where(eq(articles.id, articleId));

        const params = (batch.generationParams as any) || {};
        const runId = crypto.randomUUID();

        await addArticleJob({
          articleId: article.id,
          batchId: article.batchId,
          runId,
          title: article.chosenTitle,
          targetUrl: batch.targetUrl,
          wordCountMin: params.wordCountMin || 800,
          wordCountMax: params.wordCountMax || 2000,
          tone: params.tone,
          geographicFocus: params.geographicFocus,
          audience: params.audience,
          businessName: batch.businessName || undefined,
          companyLogoUrl: batch.companyLogoUrl || undefined,
          competitorUrls: (batch.competitorUrlsJson as string[]) || undefined,
          semanticClusterId: batch.semanticClusterId || undefined,
          serpFeatureTarget: batch.serpFeatureTarget || undefined,
        });

        succeeded.push(articleId);
      } catch (itemErr: any) {
        const reason = itemErr?.message || "Unknown error";
        failed.push({ id: articleId, reason });

        await db
          .insert(errorLogs)
          .values({
            articleId: typeof articleId === "number" ? articleId : null,
            errorType: "REQUEUE_FAILED",
            errorMessage: reason,
            severity: "error",
            context: { articleId, triggeredBy: adminUserId },
          })
          .catch((logErr) =>
            console.error("Failed to write requeue error log:", logErr)
          );
      }
    }

    console.log(
      `🔄 Requeue-failed: ${succeeded.length} succeeded, ${failed.length} errors, ${skipped.length} skipped`
    );

    return NextResponse.json({
      success: true,
      requeuedCount: succeeded.length,
      succeeded,
      failed,
      skipped,
      message: `${succeeded.length} requeued. ${failed.length} error(s). ${skipped.length} skipped.`,
    });
  } catch (error: any) {
    console.error("Error requeuing failed articles:", error);
    return NextResponse.json(
      { error: "Failed to requeue articles", message: error?.message },
      { status: error?.statusCode || 500 }
    );
  }
}
