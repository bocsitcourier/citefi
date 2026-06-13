import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { addArticleJob } from "@/lib/queue";
import { requireAdmin } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { articleIds } = body;

    if (!articleIds || !Array.isArray(articleIds)) {
      return NextResponse.json(
        { error: "articleIds array is required" },
        { status: 400 }
      );
    }

    let requeuedCount = 0;

    for (const articleId of articleIds) {
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, articleId))
        .limit(1);

      if (!article || article.articleStatus !== "FAILED") {
        continue;
      }

      const [batch] = await db
        .select()
        .from(jobBatches)
        .where(eq(jobBatches.id, article.batchId))
        .limit(1);

      if (!batch) {
        continue;
      }

      const params = batch.generationParams as any || {};
      
      await db
        .update(articles)
        .set({ 
          articleStatus: "PENDING",
          updatedAt: new Date()
        })
        .where(eq(articles.id, articleId));

      // Generate new run ID for retry attempt
      const runId = crypto.randomUUID();
      
      await addArticleJob({
        articleId: article.id,
        batchId: article.batchId,
        runId, // Unique ID for retry tracking
        title: article.chosenTitle,
        targetUrl: batch.targetUrl,
        wordCountMin: params.wordCountMin || 800,
        wordCountMax: params.wordCountMax || 2000,
        tone: params.tone,
        geographicFocus: params.geographicFocus,
        audience: params.audience,
        businessName: batch.businessName || undefined,
        companyLogoUrl: batch.companyLogoUrl || undefined,
        competitorUrls: batch.competitorUrlsJson as string[] || undefined,
        semanticClusterId: batch.semanticClusterId || undefined,
        serpFeatureTarget: batch.serpFeatureTarget || undefined,
      });

      requeuedCount++;
    }

    return NextResponse.json({ 
      success: true, 
      requeuedCount,
      message: `${requeuedCount} article(s) requeued successfully`
    });
  } catch (error) {
    console.error("Error requeuing articles:", error);
    return NextResponse.json(
      { error: "Failed to requeue articles" },
      { status: 500 }
    );
  }
}
