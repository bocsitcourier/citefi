import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorLogs, articles, jobBatches, videoIdeas, socialPosts } from "@/shared/schema";
import { desc, eq, and, or, sql, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { z } from "zod";

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
  } catch (error: any) {
    console.error("Error fetching error logs:", error);
    return NextResponse.json({ error: "Failed to fetch error logs" }, { status: error?.statusCode || 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();

    const patchSchema = z.object({
      id: z.number().int().positive(),
      resolved: z.boolean(),
      source: z.enum(["article", "video_idea", "social_video"]).optional().default("article"),
    });
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.errors },
        { status: 400 }
      );
    }
    const { id, resolved, source } = parsed.data;

    // Route resolve/unresolve to the correct table based on the error source
    if (source === "video_idea") {
      // Mark as DISMISSED so it no longer shows in the FAILED query
      await db
        .update(videoIdeas)
        .set({ status: resolved ? "DISMISSED" : "FAILED" })
        .where(eq(videoIdeas.id, id));
    } else if (source === "social_video") {
      await db
        .update(socialPosts)
        .set({ videoStatus: resolved ? "DISMISSED" : "FAILED" })
        .where(eq(socialPosts.id, id));
    } else {
      // Default: article error log
      await db
        .update(errorLogs)
        .set({
          resolved: resolved ? 1 : 0,
          resolvedAt: resolved ? new Date() : null,
        })
        .where(eq(errorLogs.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error updating error log:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: error?.statusCode || 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();

    // Delete specific IDs with source routing
    // body.entries = [{ id, source }] for cross-table deletes
    if (Array.isArray(body.entries) && body.entries.length > 0) {
      const articleIds: number[] = [];
      const videoIdeaIds: number[] = [];
      const socialVideoIds: number[] = [];

      for (const entry of body.entries) {
        const id = Number(entry.id);
        if (isNaN(id)) continue;
        if (entry.source === "video_idea") videoIdeaIds.push(id);
        else if (entry.source === "social_video") socialVideoIds.push(id);
        else articleIds.push(id);
      }

      if (articleIds.length > 0) {
        await db.delete(errorLogs).where(
          sql`${errorLogs.id} = ANY(ARRAY[${sql.join(articleIds.map(id => sql`${id}`), sql`, `)}]::int[])`
        );
      }
      if (videoIdeaIds.length > 0) {
        await db.delete(videoIdeas).where(
          sql`${videoIdeas.id} = ANY(ARRAY[${sql.join(videoIdeaIds.map(id => sql`${id}`), sql`, `)}]::int[])`
        );
      }
      if (socialVideoIds.length > 0) {
        // Soft-delete social posts to preserve data integrity
        await db.update(socialPosts)
          .set({ deletedAt: new Date() })
          .where(
            sql`${socialPosts.id} = ANY(ARRAY[${sql.join(socialVideoIds.map(id => sql`${id}`), sql`, `)}]::int[])`
          );
      }

      return NextResponse.json({ success: true, deleted: body.entries.length });
    }

    // Legacy: delete specific article errorLog IDs (backward compat)
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.map(Number).filter((n: number) => !isNaN(n));
      await db.delete(errorLogs).where(
        sql`${errorLogs.id} = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      return NextResponse.json({ success: true, deleted: ids.length });
    }

    // Clear all resolved errors (article errorLogs only)
    if (body.clearResolved === true) {
      const result = await db
        .delete(errorLogs)
        .where(eq(errorLogs.resolved, 1));
      return NextResponse.json({ success: true, deleted: result.rowCount ?? 0 });
    }

    // Clear all errors
    if (body.clearAll === true) {
      await db.delete(errorLogs);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  } catch (error: any) {
    console.error("Error deleting error logs:", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: error?.statusCode || 500 });
  }
}
