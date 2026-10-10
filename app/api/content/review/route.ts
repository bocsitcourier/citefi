import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { withAuthenticatedClientReviewerContext } from "@/lib/api/auth";
import { runWithSystemContext } from "@/lib/tenant-context";

/** GET /api/content/review — articles pending review for the caller's team */
export async function GET(req: NextRequest) {
  try {
    return await withAuthenticatedClientReviewerContext(req, async ({ teamId, role }) => {
      const url = new URL(req.url);
      const statusFilter = url.searchParams.get("status") ?? "in_review";
      const validStatuses = ["draft", "in_review", "approved", "changes_requested"];
      const status = validStatuses.includes(statusFilter) ? statusFilter : "in_review";

      // Only return the established team/assignment-scoped rows. Client viewers
      // cannot read parent audit logs directly; expose only the binding boolean.
      const rows = await runWithSystemContext("assigned review queue binding indicators", () => db
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
          updatedAt: articles.updatedAt,
          publishingReviewBound: sql<boolean>`EXISTS (
            SELECT 1 FROM activity_logs AS approval_evidence
            WHERE approval_evidence.resource = 'articles' AND approval_evidence.resource_id = articles.id
              AND approval_evidence.team_id = articles.team_id AND approval_evidence.user_id = articles.approval_reviewed_by
              AND approval_evidence.action = 'article_exact_review_approved'
              AND approval_evidence.details->>'reviewedAt' = to_char(articles.approval_reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )`,
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
        .limit(100));

      return NextResponse.json({ articles: rows, total: rows.length, status });
    });
  } catch (err: any) {
    const s = err?.statusCode ?? err?.status;
    if (s === 401 || s === 403) return NextResponse.json({ error: err.message }, { status: s });
    console.error("[content/review GET]", err);
    return NextResponse.json({ error: "Failed to load review queue" }, { status: 500 });
  }
}
