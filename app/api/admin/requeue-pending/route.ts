import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches, errorLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { addArticleJob } from "@/lib/queue";
import { requireAdmin } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const adminUserId = await requireAdmin(request);

    const pendingRows = await db
      .select({ article: articles, batch: jobBatches })
      .from(articles)
      .innerJoin(jobBatches, eq(articles.batchId, jobBatches.id))
      .where(eq(articles.articleStatus, "PENDING"));

    console.log(`🔄 Requeue-pending: ${pendingRows.length} pending articles found`);

    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];

    for (const { article, batch } of pendingRows) {
      try {
        const params = (batch.generationParams as any) || {};
        const runId = crypto.randomUUID();

        await addArticleJob({
          articleId: article.id,
          batchId: article.batchId,
          runId,
          title: article.chosenTitle!,
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

        succeeded.push(article.id);
        console.log(`  ✅ Queued article ${article.id}: "${article.chosenTitle}"`);
      } catch (itemErr: any) {
        const reason = itemErr?.message || "Unknown error";
        failed.push({ id: article.id, reason });
        console.error(`  ❌ Failed article ${article.id}:`, reason);

        await db
          .insert(errorLogs)
          .values({
            articleId: article.id,
            errorType: "REQUEUE_PENDING_FAILED",
            errorMessage: reason,
            severity: "error",
            context: {
              articleId: article.id,
              batchId: article.batchId,
              triggeredBy: adminUserId,
            },
          })
          .catch((logErr) =>
            console.error("Failed to write requeue-pending error log:", logErr)
          );
      }
    }

    console.log(
      `✅ Requeue-pending done: ${succeeded.length} succeeded, ${failed.length} errors`
    );

    return NextResponse.json({
      success: true,
      requeuedCount: succeeded.length,
      succeeded,
      failed,
      message: `${succeeded.length} requeued. ${failed.length} error(s).`,
    });
  } catch (error: any) {
    console.error("❌ Error requeuing pending articles:", error);
    return NextResponse.json(
      { error: "Failed to requeue articles", message: error?.message },
      { status: error?.statusCode || 500 }
    );
  }
}
