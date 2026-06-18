import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentFeedback, articles, socialPosts, contentPerformanceMetrics } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { recordContentFeedback } from "@/lib/learning-integration";
import { z } from "zod";

const postSchema = z.object({
  contentType: z.enum(["article", "social_post"]),
  articleId: z.number().int().positive().optional(),
  socialPostId: z.number().int().positive().optional(),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(1000).optional(),
  metricId: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamMember(req);
    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data;

    // Enforce exactly one content ID matching the declared contentType.
    // Reject any extraneous ID to prevent cross-team polymorphic poisoning.
    if (data.contentType === "article") {
      if (!data.articleId) {
        return NextResponse.json({ error: "articleId required for contentType article" }, { status: 400 });
      }
      if (data.socialPostId) {
        return NextResponse.json({ error: "socialPostId must not be set for contentType article" }, { status: 400 });
      }
    }
    if (data.contentType === "social_post") {
      if (!data.socialPostId) {
        return NextResponse.json({ error: "socialPostId required for contentType social_post" }, { status: 400 });
      }
      if (data.articleId) {
        return NextResponse.json({ error: "articleId must not be set for contentType social_post" }, { status: 400 });
      }
    }

    // Canonical IDs for this type (the other is always null)
    const canonicalArticleId = data.contentType === "article" ? data.articleId! : null;
    const canonicalSocialPostId = data.contentType === "social_post" ? data.socialPostId! : null;

    // Ownership check — verify content row belongs to the authenticated team
    if (canonicalArticleId) {
      const [article] = await db
        .select({ teamId: articles.teamId })
        .from(articles)
        .where(eq(articles.id, canonicalArticleId))
        .limit(1);
      if (!article || article.teamId !== teamId) {
        return NextResponse.json({ error: "Content not found" }, { status: 404 });
      }
    }
    if (canonicalSocialPostId) {
      const [post] = await db
        .select({ teamId: socialPosts.teamId })
        .from(socialPosts)
        .where(eq(socialPosts.id, canonicalSocialPostId))
        .limit(1);
      if (!post || post.teamId !== teamId) {
        return NextResponse.json({ error: "Content not found" }, { status: 404 });
      }
    }

    // Validate metricId: must belong to same team AND match content type + content ID
    let verifiedMetricId: number | null = null;
    if (data.metricId) {
      const [metric] = await db
        .select({
          teamId: contentPerformanceMetrics.teamId,
          contentType: contentPerformanceMetrics.contentType,
          articleId: contentPerformanceMetrics.articleId,
          socialPostId: contentPerformanceMetrics.socialPostId,
        })
        .from(contentPerformanceMetrics)
        .where(eq(contentPerformanceMetrics.id, data.metricId))
        .limit(1);

      const teamMatch = metric && metric.teamId === teamId;
      const contentMatch =
        teamMatch &&
        metric.contentType === data.contentType &&
        metric.articleId === canonicalArticleId &&
        metric.socialPostId === canonicalSocialPostId;

      if (contentMatch) {
        verifiedMetricId = data.metricId;
      }
      // Silently drop unverified metricId — feedback row is still saved without learning attribution
    }

    const [row] = await db
      .insert(contentFeedback)
      .values({
        teamId,
        userId,
        contentType: data.contentType,
        articleId: canonicalArticleId,
        socialPostId: canonicalSocialPostId,
        rating: data.rating,
        comment: data.comment ?? null,
        metricId: verifiedMetricId,
      })
      .returning();

    // Fire-and-forget hook into AI learning system (only when metric ownership verified)
    if (verifiedMetricId) {
      recordContentFeedback(teamId, verifiedMetricId, data.rating === "up", data.comment).catch((e) =>
        console.warn("[feedback] learning hook failed:", (e as Error).message)
      );
    }

    return NextResponse.json({ ok: true, id: row.id });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[feedback POST]", err);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const ratingFilter = url.searchParams.get("rating");
    const contentTypeFilter = url.searchParams.get("contentType");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
    const limit = 50;
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];
    if (ratingFilter === "up" || ratingFilter === "down") {
      conditions.push(eq(contentFeedback.rating, ratingFilter));
    }
    if (contentTypeFilter === "article" || contentTypeFilter === "social_post") {
      conditions.push(eq(contentFeedback.contentType, contentTypeFilter));
    }

    const rows = await db
      .select()
      .from(contentFeedback)
      .where(
        conditions.length
          ? and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]))
          : undefined
      )
      .orderBy(desc(contentFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ feedback: rows, page, hasMore: rows.length === limit });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[feedback GET]", err);
    return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });
  }
}
