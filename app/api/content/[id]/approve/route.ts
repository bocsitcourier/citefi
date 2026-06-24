import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, activityLogs } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireClientReviewer } from "@/lib/api/auth";
import { z } from "zod";

const approveSchema = z.object({
  action: z.enum(["approved", "changes_requested", "in_review"]),
  feedback: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const articleId = Number(id);
    if (isNaN(articleId)) return NextResponse.json({ error: "Invalid article ID" }, { status: 400 });

    const { userId, teamId, role } = await requireClientReviewer(req);

    if (role === "client_viewer" && (await getApprovalAction(req)) === "in_review") {
      return NextResponse.json({ error: "Client reviewers cannot request reviews; only approve or request changes" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { action, feedback } = parsed.data;

    if (role === "client_viewer" && action === "in_review") {
      return NextResponse.json({ error: "Client reviewers cannot set status to in_review" }, { status: 403 });
    }

    const [article] = await db
      .select({ id: articles.id, teamId: articles.teamId, approvalTeamId: articles.approvalTeamId, chosenTitle: articles.chosenTitle })
      .from(articles)
      .where(and(eq(articles.id, articleId), isNull(articles.deletedAt)))
      .limit(1);

    if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

    // A client_viewer can only act on articles explicitly scoped to their team via approvalTeamId.
    // The article.teamId fallback is intentionally removed — a client_viewer must never
    // be able to act just because they happen to belong to the content-owning team.
    if (role === "client_viewer") {
      if (article.approvalTeamId !== teamId) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
      }
    } else {
      // Admin/member must own the article's parent team
      if (article.teamId !== teamId) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
      }
    }

    const now = new Date();
    const isReview = action === "approved" || action === "changes_requested";

    // Include the same ownership predicate used during the auth read to prevent
    // TOCTOU: if the article is reassigned between the read and write, this
    // UPDATE returns 0 rows and we 404 rather than mutate the wrong article.
    const ownershipWhere =
      role === "client_viewer"
        ? and(eq(articles.id, articleId), eq(articles.approvalTeamId, teamId), isNull(articles.deletedAt))
        : and(eq(articles.id, articleId), eq(articles.teamId, teamId), isNull(articles.deletedAt));

    const updated = await db
      .update(articles)
      .set({
        approvalStatus: action,
        approvalRequestedAt: action === "in_review" ? now : undefined,
        approvalReviewedAt: isReview ? now : undefined,
        approvalReviewedBy: isReview ? userId : undefined,
        approvalFeedback: feedback ?? null,
        updatedAt: now,
      })
      .where(ownershipWhere)
      .returning({ id: articles.id });

    if (!updated.length) return NextResponse.json({ error: "Article not found" }, { status: 404 });

    await db.insert(activityLogs).values({
      userId,
      action: `article_approval_${action}`,
      resource: "articles",
      resourceId: articleId,
      details: feedback ? `Feedback: ${feedback.substring(0, 200)}` : `Status set to ${action}`,
    }).catch(() => {});

    return NextResponse.json({ success: true, approvalStatus: action });
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status;
    if (status === 401 || status === 403 || status === 404) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[content/approve]", err);
    return NextResponse.json({ error: "Failed to update approval status" }, { status: 500 });
  }
}

async function getApprovalAction(req: NextRequest): Promise<string> {
  try { const b = await req.clone().json(); return b.action ?? ""; } catch { return ""; }
}
