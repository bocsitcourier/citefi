import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { articles, socialPosts } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20")));
    const type = searchParams.get("type") ?? "all";
    const offset = (page - 1) * limit;

    const half = Math.ceil(limit / 2);
    const items: any[] = [];

    if (type === "all" || type === "article") {
      const rows = await db.select({
        id: articles.id,
        publicId: articles.publicId,
        title: articles.chosenTitle,
        status: articles.articleStatus,
        wordCount: articles.wordCount,
        seoScore: articles.seoScore,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt,
      }).from(articles)
        .where(and(eq(articles.teamId, teamId), isNull(articles.deletedAt)))
        .orderBy(desc(articles.createdAt))
        .limit(type === "all" ? half : limit)
        .offset(offset);
      items.push(...rows.map(r => ({ ...r, type: "article" })));
    }

    if (type === "all" || type === "social") {
      const rows = await db.select({
        id: socialPosts.id,
        publicId: socialPosts.publicId,
        title: socialPosts.title,
        status: socialPosts.status,
        createdAt: socialPosts.createdAt,
        updatedAt: socialPosts.updatedAt,
      }).from(socialPosts)
        .where(eq(socialPosts.teamId, teamId))
        .orderBy(desc(socialPosts.createdAt))
        .limit(type === "all" ? limit - half : limit)
        .offset(offset);
      items.push(...rows.map(r => ({ ...r, type: "social" })));
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ items: items.slice(0, limit), page, limit });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/content]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
