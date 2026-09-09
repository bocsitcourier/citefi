import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import { requireAdmin } from "@/lib/api/auth";
import { articleAssets, articles, socialPosts, teams } from "@/shared/schema";
import { and, eq, ilike, isNull } from "drizzle-orm";
import { listCanonicalAssets, type AssetKind } from "@/lib/media-library";

type LibraryType = "articles" | "images" | "videos" | "podcasts";
const validTypes = new Set<LibraryType>(["articles", "images", "videos", "podcasts"]);

function dateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const params = request.nextUrl.searchParams;
    const requestedType = params.get("type") as LibraryType | null;
    const type = requestedType && validTypes.has(requestedType) ? requestedType : "articles";
    const limit = Math.min(Math.max(Number(params.get("limit")) || 60, 1), 200);
    const teamFilter = Number(params.get("teamId")) || undefined;
    const status = params.get("status")?.trim() || undefined;
    const from = dateParam(params.get("from"));
    const to = dateParam(params.get("to"));

    const [assetSummary, articleRows, socialRows, ownershipGapRows] = await Promise.all([
      listCanonicalAssets({ limit: 1 }),
      db.select({ id: articles.id, status: articles.articleStatus }).from(articles).where(isNull(articles.deletedAt)),
      db.select({ id: socialPosts.id }).from(socialPosts).where(isNull(socialPosts.deletedAt)),
      db.select({ id: articleAssets.id }).from(articleAssets)
        .where(and(isNull(articleAssets.deletedAt), isNull(articleAssets.teamId))),
    ]);
    const summary = {
      articles: articleRows.length,
      failedArticles: articleRows.filter((row) => row.status === "FAILED").length,
      images: assetSummary.totals.image,
      videos: assetSummary.totals.video,
      podcasts: assetSummary.totals.audio,
      socialPosts: socialRows.length,
      missingAssetOwnership: ownershipGapRows.length,
    };

    if (type !== "articles") {
      const kind: AssetKind = type === "images" ? "image" : type === "videos" ? "video" : "audio";
      const result = await listCanonicalAssets({
        kind, teamFilter, status, from, to,
        cursor: params.get("cursor") || undefined,
        limit,
      });
      return NextResponse.json({
        type,
        summary,
        items: result.items.map((asset) => ({
          ...asset,
          id: asset.assetId,
          duration: asset.metadata?.duration ?? null,
          detailUrl: asset.sourceUrl,
          actions: {
            ...asset.actions,
            // Social video regeneration performs tenant billing and quota checks;
            // a platform admin has no tenant billing context, so do not expose an
            // action that cannot be safely authorized from the global explorer.
            regenerate: asset.sourceType.startsWith("social") ? null : asset.actions.regenerate,
          },
        })),
        count: result.items.length,
        total: result.total,
        nextCursor: result.nextCursor,
      });
    }

    const conditions = [isNull(articles.deletedAt)];
    const search = params.get("search")?.trim();
    if (search) conditions.push(ilike(articles.chosenTitle, `%${search}%`));
    if (teamFilter) conditions.push(eq(articles.teamId, teamFilter));
    if (status) conditions.push(eq(articles.articleStatus, status));
    const cursor = decodeArticleCursor(params.get("cursor"));
    const allArticles = await db.select({
      id: articles.id,
      sourceId: articles.id,
      title: articles.chosenTitle,
      status: articles.articleStatus,
      teamId: articles.teamId,
      teamName: teams.name,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
      wordCount: articles.wordCount,
      url: articles.heroImageUrl,
    }).from(articles).leftJoin(teams, eq(teams.id, articles.teamId)).where(and(...conditions));

    const matching = allArticles
      .filter((row) => !from || row.createdAt >= from)
      .filter((row) => !to || row.createdAt <= to)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
    const filtered = matching
      .filter((row) => !cursor
        || row.createdAt.getTime() < cursor.date
        || (row.createdAt.getTime() === cursor.date && row.id < cursor.id));
    const page = filtered.slice(0, limit);
    return NextResponse.json({
      type,
      summary,
      items: page.map((row) => ({
        ...row,
        kind: "article",
        detailUrl: `/content/${row.id}`,
      })),
      count: page.length,
      total: matching.length,
      nextCursor: filtered.length > limit && page.length
        ? encodeArticleCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
        : null,
    });
  } catch (error: any) {
    const status = error?.statusCode || 500;
    if (status === 500) console.error("Admin content library error:", error);
    return NextResponse.json(
      { error: status === 500 ? "Failed to load generated content" : error.message },
      { status },
    );
  }
}

function decodeArticleCursor(value: string | null): { date: number; id: number } | null {
  if (!value) return null;
  try {
    const [dateValue, idValue] = Buffer.from(value, "base64url").toString("utf8").split("|");
    if (!dateValue || !idValue) return null;
    const date = new Date(dateValue).getTime();
    const id = Number(idValue);
    return Number.isFinite(date) && Number.isInteger(id) ? { date, id } : null;
  } catch {
    return null;
  }
}

function encodeArticleCursor(createdAt: Date, id: number): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}
