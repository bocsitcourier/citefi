import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, articles } from "@/shared/schema";
import { and, eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Use requireTeamMember (not requireAuth) for team isolation.
    // requireAuth only validates the user token; it does NOT scope by teamId.
    // Without teamId scoping, any authenticated user can poll any batch by ID.
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    // Project only the columns the response actually uses — avoids pulling
    // large fields (titlePoolJson can be large; other fields are unnecessary)
    const [batch] = await db
      .select({
        id: jobBatches.id,
        status: jobBatches.status,
        coreTopic: jobBatches.coreTopic,
        targetUrl: jobBatches.targetUrl,
        numArticlesRequested: jobBatches.numArticlesRequested,
        titlePoolJson: jobBatches.titlePoolJson,
        createdAt: jobBatches.createdAt,
        completedAt: jobBatches.completedAt,
      })
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // TEAM ISOLATION — prevents cross-team IDOR
        )
      );

    if (!batch) {
      // Return 404 (not 403) to avoid revealing whether the batch exists
      return NextResponse.json(
        { error: "Batch not found" },
        { status: 404 }
      );
    }

    // Only fetch the one column needed for status aggregation — avoids pulling
    // bodyHtml (20KB+ per article) into memory just to count status values
    const batchArticles = await db
      .select({ articleStatus: articles.articleStatus })
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
