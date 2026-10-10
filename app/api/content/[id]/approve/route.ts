import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, activityLogs, publishingConnections, teams } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { withAuthenticatedClientReviewerContext } from "@/lib/api/auth";
import { runWithSystemContext } from "@/lib/tenant-context";
import { assertCurrentActor, assertReviewAssignment, buildReviewManifest, persistReview, getApprovalSnapshot, reviewMediaPayload, REVIEW_POLICY } from "@/lib/publishing/review-binding";
import { z } from "zod";

const approveSchema = z.object({
  action: z.enum(["approved", "changes_requested", "in_review"]),
  feedback: z.string().max(2000).optional(),
  connectionId: z.number().int().positive().optional(),
  contentType: z.enum(["article", "podcast"]).default("article"),
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
  approvalTeamId: z.number().int().positive().nullable().optional(),
});
type Params = { params: Promise<{ id: string }> };

function failure(error: any) {
  const status = error?.statusCode ?? 500;
  if (status >= 500) console.error("[content/exact-review]", error);
  return NextResponse.json({ error: status < 500 ? error.message : "Review could not be completed" }, { status });
}
function reject(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }); }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid article ID" }, { status: 400 });
    return await withAuthenticatedClientReviewerContext(req, actor =>
      // Assigned client reviews require parent-owned assets/connections. This
      // bounded callback checks the locked assignment BEFORE reading that data.
      runWithSystemContext("assigned exact publishing review preview", () => db.transaction(async tx => {
        await assertCurrentActor(tx, actor, ["owner", "admin", "member", "client_viewer"]);
        const [article] = await tx.select().from(articles).where(and(eq(articles.id, id), isNull(articles.deletedAt))).for("share");
        if (!article || (article.teamId !== actor.teamId && article.approvalTeamId !== actor.teamId)) reject("Article not found", 404);
        const canReview = (article.approvalTeamId ?? article.teamId) === actor.teamId &&
          (actor.role !== "client_viewer" || article.approvalTeamId === actor.teamId);
        const connections = await tx.select({
          id: publishingConnections.id, name: publishingConnections.name,
          channel: publishingConnections.channel, baseUrl: publishingConnections.baseUrl,
        }).from(publishingConnections).where(and(
          eq(publishingConnections.teamId, article.teamId!), eq(publishingConnections.status, "active"), isNull(publishingConnections.deletedAt),
        ));
        const assignmentTeams = article.teamId === actor.teamId && ["owner", "admin"].includes(actor.role)
          ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(
              eq(teams.parentTeamId, actor.teamId), eq(teams.clientStatus, "active"), isNull(teams.deletedAt),
            )) : [];
        const base = { connections, policy: REVIEW_POLICY, canReview, canAssign: article.teamId === actor.teamId && ["owner", "admin"].includes(actor.role),
          assignmentTeams, assignmentTeamId: article.approvalTeamId, updatedAt: article.updatedAt.toISOString() };
        const connectionId = Number(req.nextUrl.searchParams.get("connectionId"));
        if (!connectionId) return NextResponse.json(base);
        assertReviewAssignment(article, actor);
        const kind = req.nextUrl.searchParams.get("contentType") ?? "article";
        if (!["article", "podcast"].includes(kind)) reject("Unsupported review content type", 400);
        const [connection] = await tx.select().from(publishingConnections).where(and(
          eq(publishingConnections.id, connectionId), eq(publishingConnections.teamId, article.teamId!),
        )).for("share");
        if (!connection) reject("Destination not found", 404);
        const review = await buildReviewManifest(tx, article, connection, kind as "article" | "podcast", undefined, true);
        return NextResponse.json({ ...base, review: { ...review, formatted: reviewMediaPayload(review) } }, { headers: { "Cache-Control": "no-store" } });
      })));
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid article ID" }, { status: 400 });
    return await withAuthenticatedClientReviewerContext(req, async actor => {
      const parsed = approveSchema.safeParse(await req.json());
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
      const input = parsed.data;
      return runWithSystemContext("assigned exact publishing review decision", () => db.transaction(async tx => {
        await assertCurrentActor(tx, actor, ["owner", "admin", "member", "client_viewer"]);
        const [article] = await tx.select().from(articles).where(and(eq(articles.id, id), isNull(articles.deletedAt))).for("update");
        if (!article) reject("Article not found", 404);
        if (input.action === "in_review") {
          if (article.teamId !== actor.teamId || actor.role === "client_viewer") reject("Only the owning content team can request review", 403);
          if (!input.expectedUpdatedAt || article.updatedAt.toISOString() !== input.expectedUpdatedAt) reject("Content changed; reload before requesting review");
          if (input.approvalTeamId !== undefined) {
            if (!["owner", "admin"].includes(actor.role)) reject("Only the team owner/admin can change review assignment", 403);
            if (input.approvalTeamId !== null) {
              const [target] = await tx.select().from(teams).where(and(eq(teams.id, input.approvalTeamId),
                eq(teams.parentTeamId, actor.teamId), isNull(teams.deletedAt), eq(teams.clientStatus, "active"))).for("share");
              if (!target) reject("Assigned client team not found", 404);
            }
          }
        } else {
          if (input.approvalTeamId !== undefined) reject("Assignment changes require a fresh review request", 403);
          assertReviewAssignment(article, actor);
          if (article.approvalStatus !== "in_review") reject("Request a fresh review before making a decision");
        }
        let manifest;
        if (input.reviewDigest) {
          if (!input.connectionId) reject("Select the reviewed destination");
          const [connection] = await tx.select().from(publishingConnections).where(and(
            eq(publishingConnections.id, input.connectionId), eq(publishingConnections.teamId, article.teamId!),
          )).for("share");
          if (!connection) reject("Destination not found", 404);
          manifest = await buildReviewManifest(tx, article, connection, input.contentType);
          if (manifest.digest !== input.reviewDigest) reject("Content, media, assignment or destination changed; reload the exact review");
        } else if (input.action === "approved") reject("Load and confirm the exact destination and asset review");
        else if (!input.expectedUpdatedAt || article.updatedAt.toISOString() !== input.expectedUpdatedAt) reject("Review changed; reload before saving");

        if (input.action === "approved") {
          await persistReview(tx, article, manifest!, actor, input.feedback);
        } else {
          const now = new Date(Math.max(Date.now(), article.updatedAt.getTime() + 1));
          const previousSnapshot = await getApprovalSnapshot(tx, article);
          await tx.update(articles).set({
            approvalStatus: input.action, approvalRequestedAt: input.action === "in_review" ? now : undefined,
            approvalReviewedAt: input.action === "changes_requested" ? now : null,
            approvalReviewedBy: input.action === "changes_requested" ? actor.userId : null,
            approvalFeedback: input.feedback ?? null,
            approvalTeamId: input.approvalTeamId === undefined ? undefined : input.approvalTeamId,
            // Clearing current consent never deletes historical audit manifests.
            updatedAt: now,
          }).where(eq(articles.id, article.id));
          await tx.insert(activityLogs).values({ userId: actor.userId, teamId: article.teamId, action: `article_approval_${input.action}`, resource: "articles",
            resourceId: article.id, details: { previousReviewId: previousSnapshot?.reviewId ?? null,
              previousAssignment: article.approvalTeamId, assignment: input.approvalTeamId === undefined ? article.approvalTeamId : input.approvalTeamId, feedback: input.feedback ?? null } });
        }
        return NextResponse.json({ success: true, approvalStatus: input.action });
      }));
    });
  } catch (error) { return failure(error); }
}
