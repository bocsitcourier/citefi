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

    // A client_viewer can only approve articles scoped to their own team
    if (role === "client_viewer") {
      if (article.approvalTeamId !== teamId && article.teamId !== teamId) {
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

    await db
      .update(articles)
      .set({
        approvalStatus: action,
        approvalRequestedAt: action === "in_review" ? now : undefined,
        approvalReviewedAt: isReview ? now : undefined,
        approvalReviewedBy: isReview ? userId : undefined,
        approvalFeedback: feedback ?? null,
        updatedAt: now,
      })
      .where(eq(articles.id, articleId));

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
