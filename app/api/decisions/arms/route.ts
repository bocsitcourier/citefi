import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember, requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { decisionArms, decisionPolicies, articles, socialPosts } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { createArm } from "@/lib/bayesian-decision-service";
import { z } from "zod";

const createArmSchema = z.object({
  policyId: z.number().int().positive(),
  contentType: z.enum(["article", "social_post"]),
  articleId: z.number().int().positive().nullable().optional(),
  socialPostId: z.number().int().positive().nullable().optional(),
  label: z.string().max(100).nullable().optional(),
  priorAlpha: z.number().positive().default(1.0),
  priorBeta: z.number().positive().default(1.0),
});

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const policyId = parseInt(url.searchParams.get("policyId") ?? "");

    if (isNaN(policyId)) {
      return NextResponse.json({ error: "policyId query param required" }, { status: 400 });
    }

    // Verify policy belongs to this team
    const [policy] = await db
      .select({ id: decisionPolicies.id })
      .from(decisionPolicies)
      .where(
        and(
          eq(decisionPolicies.id, policyId),
          eq(decisionPolicies.teamId, teamId)
        )
      )
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const arms = await db
      .select()
      .from(decisionArms)
      .where(eq(decisionArms.policyId, policyId))
      .orderBy(decisionArms.id);

    return NextResponse.json({ arms });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisions/arms GET]", err);
    return NextResponse.json({ error: "Failed to fetch arms" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const body = await req.json().catch(() => ({}));
    const parsed = createArmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { policyId, contentType, articleId, socialPostId } = parsed.data;

    // Verify policy ownership and content type match
    const [policy] = await db
      .select({ id: decisionPolicies.id, contentType: decisionPolicies.contentType })
      .from(decisionPolicies)
      .where(
        and(
          eq(decisionPolicies.id, policyId),
          eq(decisionPolicies.teamId, teamId)
        )
      )
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    // Content type on the arm must match the policy's content type
    if (contentType !== policy.contentType) {
      return NextResponse.json(
        { error: `Content type mismatch: policy targets "${policy.contentType}", arm specifies "${contentType}"` },
        { status: 400 }
      );
    }

    // Verify articleId belongs to this team (IDOR guard)
    if (articleId != null) {
      const [article] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
        .limit(1);
      if (!article) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
      }
    }

    // Verify socialPostId belongs to this team (IDOR guard)
    if (socialPostId != null) {
      const [socialPost] = await db
        .select({ id: socialPosts.id })
        .from(socialPosts)
        .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)))
        .limit(1);
      if (!socialPost) {
        return NextResponse.json({ error: "Social post not found" }, { status: 404 });
      }
    }

    const arm = await createArm({ teamId, ...parsed.data });
    return NextResponse.json({ arm }, { status: 201 });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisions/arms POST]", err);
    return NextResponse.json({ error: "Failed to create arm" }, { status: 500 });
  }
}
