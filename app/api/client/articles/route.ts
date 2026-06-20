import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { articles } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

/** GET /api/client/articles — read-only article list for client team */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const rows = await db
      .select({
        id: articles.id,
        publicId: articles.publicId,
        title: articles.title,
        status: articles.status,
        seoScore: articles.seoScore,
        wordCount: articles.wordCount,
        createdAt: articles.createdAt,
        publishedAt: articles.publishedAt,
      })
      .from(articles)
      .where(and(eq(articles.teamId, teamId), isNull(articles.deletedAt)))
      .orderBy(desc(articles.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ articles: rows, limit, offset });
  } catch (err: any) {
    const httpStatus = err.status ?? err.statusCode;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/articles]", err);
    return NextResponse.json({ error: "Failed to load articles" }, { status: err?.statusCode || 500 });
  }
}
