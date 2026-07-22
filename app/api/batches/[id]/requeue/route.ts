import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { addArticleJob } from "@/lib/queue";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

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
          .where(and(eq(articles.id, articleId), eq(articles.batchId, batchId)))
          .limit(1);

        if (!article) {
          skipped.push({ id: articleId, reason: "Article not found in this batch" });
          continue;
        }

        if (article.articleStatus !== "FAILED") {
          skipped.push({
            id: articleId,
            reason: `Status is '${article.articleStatus}', expected 'FAILED'`,
          });
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
        failed.push({ id: articleId, reason: itemErr?.message || "Unknown error" });
      }
    }

    return NextResponse.json({
      success: true,
      requeuedCount: succeeded.length,
      succeeded,
      failed,
      skipped,
      message: `${succeeded.length} requeued. ${failed.length} error(s). ${skipped.length} skipped.`,
    });
  } catch (error: any) {
    console.error("Error requeuing articles:", error);
    return NextResponse.json(
      { error: "Failed to requeue articles", message: error?.message },
      { status: error?.statusCode || 500 }
    );
  }
}
