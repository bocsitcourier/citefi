import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  contentFeedback,
  articles,
  socialPosts,
  videoIdeas,
  contentPerformanceMetrics,
} from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { recordContentFeedback } from "@/lib/learning-integration";
import { z } from "zod";

// Canonical internal type stored in contentPerformanceMetrics / learning tables.
// Legacy UI value "social_post" is normalised to "social" immediately on ingest.
function normalizeContentType(ct: string): string {
  return ct === "social_post" ? "social" : ct;
}

const postSchema = z.object({
  // Accept legacy "social_post" value plus the canonical set.
  contentType: z.enum(["article", "social_post", "social", "podcast", "video"]),
  articleId: z.number().int().positive().optional(),
  socialPostId: z.number().int().positive().optional(),
  videoIdeaId: z.number().int().positive().optional(),
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

    // Normalise to canonical type immediately
    const canonicalType = normalizeContentType(data.contentType);

    // ── Enforce exactly one content ID per type (IDOR guard) ──────────────────
    if (canonicalType === "article" || canonicalType === "podcast") {
      if (!data.articleId) {
        return NextResponse.json(
          { error: `articleId required for contentType ${canonicalType}` },
          { status: 400 }
        );
      }
      if (data.socialPostId || data.videoIdeaId) {
        return NextResponse.json(
          { error: "socialPostId / videoIdeaId must not be set for article/podcast" },
          { status: 400 }
        );
      }
    }
    if (canonicalType === "social") {
      if (!data.socialPostId) {
        return NextResponse.json(
          { error: "socialPostId required for contentType social" },
          { status: 400 }
        );
      }
      if (data.articleId || data.videoIdeaId) {
        return NextResponse.json(
          { error: "articleId / videoIdeaId must not be set for social" },
          { status: 400 }
        );
      }
    }
    if (canonicalType === "video") {
      // Video feedback can reference either a videoIdea (standard) or a
      // socialPost (journey-created video with includeVideo flag).
      if (!data.videoIdeaId && !data.socialPostId) {
        return NextResponse.json(
          { error: "videoIdeaId or socialPostId required for contentType video" },
          { status: 400 }
        );
      }
      if (data.articleId) {
        return NextResponse.json(
          { error: "articleId must not be set for video" },
          { status: 400 }
        );
      }
      if (data.videoIdeaId && data.socialPostId) {
        return NextResponse.json(
          { error: "Provide either videoIdeaId or socialPostId for video — not both" },
          { status: 400 }
        );
      }
    }

    // ── Canonical ID slots ────────────────────────────────────────────────────
    const canonicalArticleId =
      canonicalType === "article" || canonicalType === "podcast" ? data.articleId! : null;
    const canonicalSocialPostId =
      canonicalType === "social" || (canonicalType === "video" && data.socialPostId)
        ? (data.socialPostId ?? null)
        : null;
    const canonicalVideoIdeaId =
      canonicalType === "video" && data.videoIdeaId ? data.videoIdeaId : null;

    // ── Ownership checks (IDOR hardening) ────────────────────────────────────
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
    if (canonicalVideoIdeaId) {
      const [video] = await db
        .select({ teamId: videoIdeas.teamId })
        .from(videoIdeas)
        .where(eq(videoIdeas.id, canonicalVideoIdeaId))
        .limit(1);
      if (!video || video.teamId !== teamId) {
        return NextResponse.json({ error: "Content not found" }, { status: 404 });
      }
    }

    // ── Metric verification ───────────────────────────────────────────────────
    // contentPerformanceMetrics stores the canonical type (article/social/podcast/video).
    // We normalise the incoming type so "social_post" never silently misses.
    let verifiedMetricId: number | null = null;
    if (data.metricId) {
      const [metric] = await db
        .select({
          teamId: contentPerformanceMetrics.teamId,
          contentType: contentPerformanceMetrics.contentType,
          articleId: contentPerformanceMetrics.articleId,
          socialPostId: contentPerformanceMetrics.socialPostId,
          videoIdeaId: contentPerformanceMetrics.videoIdeaId,
        })
        .from(contentPerformanceMetrics)
        .where(eq(contentPerformanceMetrics.id, data.metricId))
        .limit(1);

      if (metric && metric.teamId === teamId) {
        const metricType = normalizeContentType(metric.contentType);
        const typeMatch = metricType === canonicalType;
        const idMatch =
          metric.articleId === canonicalArticleId &&
          metric.socialPostId === canonicalSocialPostId &&
          metric.videoIdeaId === canonicalVideoIdeaId;
        if (typeMatch && idMatch) {
          verifiedMetricId = data.metricId;
        }
      }
      // Silently drop unverified metricId — feedback row still saved, no learning attribution
    }

    const [row] = await db
      .insert(contentFeedback)
      .values({
        teamId,
        userId,
        contentType: canonicalType,
        articleId: canonicalArticleId,
        socialPostId: canonicalSocialPostId,
        videoIdeaId: canonicalVideoIdeaId,
        rating: data.rating,
        comment: data.comment ?? null,
        metricId: verifiedMetricId,
      })
      .returning();

    // Fire-and-forget hook into AI learning system (only when metric ownership verified)
    if (verifiedMetricId) {
      recordContentFeedback(teamId, verifiedMetricId, data.rating === "up", data.comment).catch(
        (e) => console.warn("[feedback] learning hook failed:", (e as Error).message)
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

    const VALID_CONTENT_TYPES = ["article", "social", "social_post", "podcast", "video"];
    const conditions: ReturnType<typeof eq>[] = [];
    if (ratingFilter === "up" || ratingFilter === "down") {
      conditions.push(eq(contentFeedback.rating, ratingFilter));
    }
    if (contentTypeFilter && VALID_CONTENT_TYPES.includes(contentTypeFilter)) {
      // Normalise — "social_post" is stored as "social"
      const normalised = normalizeContentType(contentTypeFilter);
      conditions.push(eq(contentFeedback.contentType, normalised));
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
