import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { addArticleJob } from "@/lib/queue";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    console.log("🔄 Finding pending articles...");
    
    const pendingArticles = await db
      .select({
        article: articles,
        batch: jobBatches
      })
      .from(articles)
      .innerJoin(jobBatches, eq(articles.batchId, jobBatches.id))
      .where(eq(articles.articleStatus, "PENDING"));

    console.log(`Found ${pendingArticles.length} pending articles`);

    for (const { article, batch } of pendingArticles) {
      console.log(`Queueing article ${article.id}: "${article.chosenTitle}"`);
      
      const params = batch.generationParams as any || {};
      
      // Generate new run ID for requeue attempt
      const runId = crypto.randomUUID();
      
      await addArticleJob({
        articleId: article.id,
        batchId: article.batchId,
        runId, // Unique ID for requeue tracking
        title: article.chosenTitle!,
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
    }

    console.log("✅ All pending articles re-queued");
    
    return NextResponse.json({ 
      success: true, 
      requeuedCount: pendingArticles.length 
    });
  } catch (error) {
    console.error("❌ Error re-queuing articles:", error);
    return NextResponse.json(
      { error: "Failed to re-queue articles" },
      { status: 500 }
    );
  }
}
