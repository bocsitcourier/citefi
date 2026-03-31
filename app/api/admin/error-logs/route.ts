import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorLogs, articles, jobBatches, videoIdeas, socialPosts } from "@/shared/schema";
import { desc, eq, and, or, sql, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "all";
    const severity = searchParams.get("severity") || "all";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = 50;
    const offset = (page - 1) * limit;

    // ── Article / batch error logs ──────────────────────────────────────
    const articleErrors = await db
      .select({
        id: errorLogs.id,
        source: sql<string>`'article'`,
        errorType: errorLogs.errorType,
        errorMessage: errorLogs.errorMessage,
        severity: errorLogs.severity,
        resolved: errorLogs.resolved,
        createdAt: errorLogs.createdAt,
        articleId: errorLogs.articleId,
        batchId: errorLogs.batchId,
        title: articles.chosenTitle,
        parentName: jobBatches.coreTopic,
        screenshotUrl: errorLogs.screenshotUrl,
      })
      .from(errorLogs)
      .leftJoin(articles, eq(articles.id, errorLogs.articleId))
      .leftJoin(jobBatches, eq(jobBatches.id, errorLogs.batchId))
      .orderBy(desc(errorLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // ── Video Idea failures ─────────────────────────────────────────────
    const ideaErrors = await db
      .select({
        id: videoIdeas.id,
        source: sql<string>`'video_idea'`,
        errorType: sql<string>`'VIDEO_IDEA'`,
        errorMessage: videoIdeas.errorMessage,
        severity: sql<string>`'error'`,
        resolved: sql<number>`0`,
        createdAt: videoIdeas.updatedAt,
        articleId: sql<null>`null`,
        batchId: sql<null>`null`,
        title: videoIdeas.ideaTitle,
        parentName: sql<string>`'Idea to Video'`,
      })
      .from(videoIdeas)
      .where(eq(videoIdeas.status, "FAILED"))
      .orderBy(desc(videoIdeas.updatedAt))
      .limit(20);

    // ── Social post video failures ──────────────────────────────────────
    const videoErrors = await db
      .select({
        id: socialPosts.id,
        source: sql<string>`'social_video'`,
        errorType: sql<string>`'SOCIAL_VIDEO'`,
        errorMessage: socialPosts.errorMessage,
        severity: sql<string>`'error'`,
        resolved: sql<number>`0`,
        createdAt: socialPosts.updatedAt,
        articleId: sql<null>`null`,
        batchId: sql<null>`null`,
        title: socialPosts.title,
        parentName: sql<string>`'Social Video'`,
      })
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.videoStatus, "FAILED"),
          isNull(socialPosts.deletedAt)
        )
      )
      .orderBy(desc(socialPosts.updatedAt))
      .limit(20);

    // ── Summary counts ──────────────────────────────────────────────────
    const [summaryRow] = await db
      .select({
        total: sql<number>`count(*)`,
        unresolved: sql<number>`sum(case when resolved = 0 then 1 else 0 end)`,
        critical: sql<number>`sum(case when severity = 'critical' then 1 else 0 end)`,
        generation: sql<number>`sum(case when error_type = 'GENERATION' then 1 else 0 end)`,
        brandValidation: sql<number>`sum(case when error_type = 'BRAND_VALIDATION' then 1 else 0 end)`,
        dalle: sql<number>`sum(case when error_type = 'DALLE' then 1 else 0 end)`,
        social: sql<number>`sum(case when error_type = 'SOCIAL' then 1 else 0 end)`,
      })
      .from(errorLogs);

    const [ideaCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(videoIdeas)
      .where(eq(videoIdeas.status, "FAILED"));

    const [videoCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(socialPosts)
      .where(and(eq(socialPosts.videoStatus, "FAILED"), isNull(socialPosts.deletedAt)));

    // ── Merge + filter ──────────────────────────────────────────────────
    let merged = [
      ...articleErrors.map(e => ({ ...e, source: "article" as const })),
      ...ideaErrors.map(e => ({ ...e, source: "video_idea" as const, screenshotUrl: null })),
      ...videoErrors.map(e => ({ ...e, source: "social_video" as const, screenshotUrl: null })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (type !== "all") {
      merged = merged.filter(e => e.source === type);
    }
    if (severity !== "all") {
      merged = merged.filter(e => e.severity === severity);
    }

    return NextResponse.json({
      errors: merged.slice(0, limit),
      summary: {
        ...summaryRow,
        videoIdeas: Number(ideaCount?.count ?? 0),
        socialVideos: Number(videoCount?.count ?? 0),
        total: Number(summaryRow?.total ?? 0) + Number(ideaCount?.count ?? 0) + Number(videoCount?.count ?? 0),
        unresolved: Number(summaryRow?.unresolved ?? 0) + Number(ideaCount?.count ?? 0) + Number(videoCount?.count ?? 0),
      },
      page,
      hasMore: merged.length === limit,
    });
  } catch (error) {
    console.error("Error fetching error logs:", error);
    return NextResponse.json({ error: "Failed to fetch error logs" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { id, resolved } = await req.json();

    await db
      .update(errorLogs)
      .set({
        resolved: resolved ? 1 : 0,
        resolvedAt: resolved ? new Date() : null,
      })
      .where(eq(errorLogs.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating error log:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();

    // Delete specific IDs
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.map(Number).filter((n: number) => !isNaN(n));
      await db.delete(errorLogs).where(
        sql`${errorLogs.id} = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      return NextResponse.json({ success: true, deleted: ids.length });
    }

    // Clear all resolved errors
    if (body.clearResolved === true) {
      const result = await db
        .delete(errorLogs)
        .where(eq(errorLogs.resolved, 1));
      return NextResponse.json({ success: true, deleted: result.rowCount ?? 0 });
    }

    // Clear all errors (optionally filtered by source type)
    if (body.clearAll === true) {
      await db.delete(errorLogs);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  } catch (error) {
    console.error("Error deleting error logs:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
