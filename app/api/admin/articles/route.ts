import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, desc, like, sql, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    let query = db
      .select({
        id: articles.id,
        batchId: articles.batchId,
        status: articles.articleStatus,
        title: articles.chosenTitle,
        seoTitle: articles.seoTitle,
        slug: articles.slug,
        wordCount: articles.wordCount,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt,
        coreTopic: jobBatches.coreTopic,
      })
      .from(articles)
      .leftJoin(jobBatches, eq(articles.batchId, jobBatches.id))
      .$dynamic();

    // Apply filters
    const conditions = [];
    if (status) {
      conditions.push(eq(articles.articleStatus, status));
    }
    if (search) {
      conditions.push(like(articles.chosenTitle, `%${search}%`));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query
      .orderBy(desc(articles.updatedAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(articles).$dynamic();
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions));
    }
    const countResult = await countQuery;
    const count = countResult[0]?.count ?? 0;

    return NextResponse.json({
      articles: results,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error: any) {
    console.error("Admin articles error:", error);
    return NextResponse.json(
      { error: "Failed to fetch articles" },
      { status: error?.statusCode || 500 }
    );
  }
}
