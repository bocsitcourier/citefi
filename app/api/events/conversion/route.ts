import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentEvents, articles, socialPosts } from "@/shared/schema";
import { eq, count, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { z } from "zod";

const conversionSchema = z.object({
  contentType: z.enum(["article", "social_post"]),
  contentId: z.number().int().positive(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json();
    const parsed = conversionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const data = parsed.data;

    // Ownership check — content must belong to this team
    if (data.contentType === "article") {
      const [article] = await db
        .select({ teamId: articles.teamId })
        .from(articles)
        .where(eq(articles.id, data.contentId))
        .limit(1);
      if (!article || article.teamId !== teamId) {
        return NextResponse.json({ error: "Content not found" }, { status: 404 });
      }
    } else {
      const [post] = await db
        .select({ teamId: socialPosts.teamId })
        .from(socialPosts)
        .where(eq(socialPosts.id, data.contentId))
        .limit(1);
      if (!post || post.teamId !== teamId) {
        return NextResponse.json({ error: "Content not found" }, { status: 404 });
      }
    }

    const [row] = await db
      .insert(contentEvents)
      .values({
        teamId,
        contentType: data.contentType,
        articleId: data.contentType === "article" ? data.contentId : null,
        socialPostId: data.contentType === "social_post" ? data.contentId : null,
        eventType: "conversion",
        metadata: data.metadata ?? null,
      })
      .returning({ id: contentEvents.id });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[conversion POST]", err);
    return NextResponse.json({ error: "Failed to record conversion" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const contentType = url.searchParams.get("contentType");
    const contentId = parseInt(url.searchParams.get("contentId") ?? "0");

    if (!contentId || (contentType !== "article" && contentType !== "social_post")) {
      return NextResponse.json({ error: "contentType and contentId required" }, { status: 400 });
    }

    const idCondition =
      contentType === "article"
        ? eq(contentEvents.articleId, contentId)
        : eq(contentEvents.socialPostId, contentId);

    const [result] = await db
      .select({ total: count() })
      .from(contentEvents)
      .where(
        and(
          eq(contentEvents.teamId, teamId),
          eq(contentEvents.eventType, "conversion"),
          idCondition
        )
      );

    return NextResponse.json({ conversions: result?.total ?? 0 });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    return NextResponse.json({ error: "Failed to fetch conversions" }, { status: 500 });
  }
}
