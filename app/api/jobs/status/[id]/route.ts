import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, articles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth(request);
    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.id, batchId));

    if (!batch) {
      return NextResponse.json(
        { error: "Batch not found" },
        { status: 404 }
      );
    }

    const batchArticles = await db
      .select()
      .from(articles)
      .where(eq(articles.batchId, batchId));

    const totalArticles = batchArticles.length;
    const completedArticles = batchArticles.filter(a => a.articleStatus === "COMPLETE").length;
    const failedArticles = batchArticles.filter(a => a.articleStatus === "FAILED").length;
    const pendingArticles = batchArticles.filter(a => a.articleStatus === "PENDING").length;
    const inProgressArticles = batchArticles.filter(a => 
      a.articleStatus === "IN_PROGRESS" || 
      a.articleStatus === "GEMINI_DONE" || 
      a.articleStatus === "GPT_DONE"
    ).length;

    // Properly structure the title pool data for frontend consumption
    const titlePool = batch.titlePoolJson as any;
    const structuredTitlePool = titlePool ? {
      titles: titlePool.titles || [],
      primaryKeywords: titlePool.primaryKeywords || [],
      contentStrategy: titlePool.contentStrategy || "",
      isMultiCity: titlePool.isMultiCity || false,
      cities: titlePool.cities || undefined,
    } : null;

    return NextResponse.json({
      id: batch.id,
      status: batch.status,
      coreTopic: batch.coreTopic,
      targetUrl: batch.targetUrl,
      numArticlesRequested: batch.numArticlesRequested,
      titlePool: structuredTitlePool,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
      articles: {
        total: totalArticles,
        completed: completedArticles,
        failed: failedArticles,
        inProgress: inProgressArticles,
        pending: pendingArticles,
        progress: totalArticles > 0 ? Math.round((completedArticles / totalArticles) * 100) : 0,
      },
    });
  } catch (error) {
    console.error("❌ Job status error:", error);
    return NextResponse.json(
      { 
        error: "Failed to fetch job status",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
