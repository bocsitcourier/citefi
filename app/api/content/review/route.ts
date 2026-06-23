import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { requireClientReviewer } from "@/lib/api/auth";

/** GET /api/content/review — articles pending review for the caller's team */
export async function GET(req: NextRequest) {
  try {
    const { teamId, role } = await requireClientReviewer(req);

    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? "in_review";
    const validStatuses = ["draft", "in_review", "approved", "changes_requested"];
    const status = validStatuses.includes(statusFilter) ? statusFilter : "in_review";

    const rows = await db
      .select({
        id: articles.id,
        publicId: articles.publicId,
        chosenTitle: articles.chosenTitle,
        seoTitle: articles.seoTitle,
        slug: articles.slug,
        wordCount: articles.wordCount,
        approvalStatus: articles.approvalStatus,
        approvalFeedback: articles.approvalFeedback,
        approvalRequestedAt: articles.approvalRequestedAt,
        approvalReviewedAt: articles.approvalReviewedAt,
        heroImageUrl: articles.heroImageUrl,
        teamId: articles.teamId,
        approvalTeamId: articles.approvalTeamId,
        batchId: articles.batchId,
        createdAt: articles.createdAt,
      })
      .from(articles)
      .where(
        and(
          role === "client_viewer"
            ? inArray(articles.approvalTeamId, [teamId])
            : eq(articles.teamId, teamId),
          eq(articles.approvalStatus, status),
          isNull(articles.deletedAt)
        )
      )
      .orderBy(articles.approvalRequestedAt, articles.createdAt)
      .limit(100);

    return NextResponse.json({ articles: rows, total: rows.length, status });
  } catch (err: any) {
    const s = err?.statusCode ?? err?.status;
    if (s === 401 || s === 403) return NextResponse.json({ error: err.message }, { status: s });
    console.error("[content/review GET]", err);
    return NextResponse.json({ error: "Failed to load review queue" }, { status: 500 });
  }
}
