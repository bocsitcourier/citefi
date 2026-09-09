import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import { systemDb as db } from "@/lib/db";
import { requireAdmin } from "@/lib/api/auth";
import {
  articleAssets,
  articles,
  socialPostAssets,
  socialPosts,
  teams,
} from "@/shared/schema";

type LibraryType = "articles" | "images" | "videos" | "podcasts";

const validTypes = new Set<LibraryType>(["articles", "images", "videos", "podcasts"]);

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const requestedType = request.nextUrl.searchParams.get("type") as LibraryType | null;
    const type: LibraryType = requestedType && validTypes.has(requestedType)
      ? requestedType
      : "articles";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 60, 1), 200);
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";

    const [
      articleCountRow,
      failedArticleCountRow,
      articleImageCountRow,
      socialImageCountRow,
      articleVideoCountRow,
      socialVideoAssetCountRow,
      readySocialVideoCountRow,
      podcastCountRow,
      socialPostCountRow,
      ownershipGapRow,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(articles).where(isNull(articles.deletedAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(articles).where(and(isNull(articles.deletedAt), eq(articles.articleStatus, "FAILED"))),
      db.select({ count: sql<number>`count(*)::int` }).from(articleAssets).where(and(isNull(articleAssets.deletedAt), eq(articleAssets.assetType, "image"))),
      db.select({ count: sql<number>`count(*)::int` }).from(socialPostAssets).where(eq(socialPostAssets.assetType, "image")),
      db.select({ count: sql<number>`count(*)::int` }).from(articleAssets).where(and(isNull(articleAssets.deletedAt), eq(articleAssets.assetType, "video"))),
      db.select({ count: sql<number>`count(*)::int` }).from(socialPostAssets).where(eq(socialPostAssets.assetType, "video")),
      db.select({ count: sql<number>`count(*)::int` }).from(socialPosts).where(and(isNull(socialPosts.deletedAt), eq(socialPosts.videoStatus, "READY"), isNotNull(socialPosts.videoUrl))),
      db.select({ count: sql<number>`count(*)::int` }).from(articles).where(and(isNull(articles.deletedAt), eq(articles.podcastStatus, "ready"), isNotNull(articles.podcastUrl))),
      db.select({ count: sql<number>`count(*)::int` }).from(socialPosts).where(isNull(socialPosts.deletedAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(articleAssets).where(and(isNull(articleAssets.deletedAt), isNull(articleAssets.teamId))),
    ]);

    const summary = {
      articles: numberValue(articleCountRow[0]?.count),
      failedArticles: numberValue(failedArticleCountRow[0]?.count),
      images: numberValue(articleImageCountRow[0]?.count) + numberValue(socialImageCountRow[0]?.count),
      videos: numberValue(articleVideoCountRow[0]?.count)
        + numberValue(socialVideoAssetCountRow[0]?.count)
        + numberValue(readySocialVideoCountRow[0]?.count),
      podcasts: numberValue(podcastCountRow[0]?.count),
      socialPosts: numberValue(socialPostCountRow[0]?.count),
      missingAssetOwnership: numberValue(ownershipGapRow[0]?.count),
    };

    let items: Array<Record<string, unknown>> = [];

    if (type === "articles") {
      const conditions = [isNull(articles.deletedAt)];
      if (search) conditions.push(ilike(articles.chosenTitle, `%${search}%`));
      items = await db
        .select({
          id: articles.id,
          sourceId: articles.id,
          kind: sql<string>`'article'`,
          title: articles.chosenTitle,
          status: articles.articleStatus,
          teamId: articles.teamId,
          teamName: teams.name,
          createdAt: articles.createdAt,
          updatedAt: articles.updatedAt,
          wordCount: articles.wordCount,
          url: articles.heroImageUrl,
          detailUrl: sql<string>`'/content/' || ${articles.id}::text`,
        })
        .from(articles)
        .leftJoin(teams, eq(teams.id, articles.teamId))
        .where(and(...conditions))
        .orderBy(desc(articles.updatedAt))
        .limit(limit);
    }

    if (type === "images") {
      const [articleImages, socialImages] = await Promise.all([
        db.select({
          id: articleAssets.id,
          sourceId: articleAssets.id,
          kind: sql<string>`'article-image'`,
          title: articles.chosenTitle,
          status: sql<string>`'READY'`,
          teamId: articles.teamId,
          teamName: teams.name,
          createdAt: articleAssets.createdAt,
          url: articleAssets.storageUrl,
          altText: articleAssets.altText,
          fileFormat: articleAssets.fileFormat,
          detailUrl: sql<string>`'/content/' || ${articles.id}::text`,
        })
          .from(articleAssets)
          .innerJoin(articles, eq(articles.id, articleAssets.articleId))
          .leftJoin(teams, eq(teams.id, articles.teamId))
          .where(and(isNull(articleAssets.deletedAt), eq(articleAssets.assetType, "image")))
          .orderBy(desc(articleAssets.createdAt))
          .limit(limit),
        db.select({
          id: socialPostAssets.id,
          sourceId: socialPostAssets.id,
          kind: sql<string>`'social-image'`,
          title: socialPosts.title,
          status: socialPosts.status,
          teamId: socialPosts.teamId,
          teamName: teams.name,
          createdAt: socialPostAssets.createdAt,
          url: socialPostAssets.storageUrl,
          altText: socialPostAssets.altText,
          fileFormat: socialPostAssets.fileFormat,
          detailUrl: sql<string>`'/social/' || ${socialPosts.id}::text`,
        })
          .from(socialPostAssets)
          .innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
          .leftJoin(teams, eq(teams.id, socialPosts.teamId))
          .where(and(isNull(socialPosts.deletedAt), eq(socialPostAssets.assetType, "image")))
          .orderBy(desc(socialPostAssets.createdAt))
          .limit(limit),
      ]);
      items = [...articleImages, ...socialImages]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit);
    }

    if (type === "videos") {
      const [articleVideos, socialAssetVideos, socialVideos] = await Promise.all([
        db.select({
          id: articleAssets.id,
          sourceId: articleAssets.id,
          kind: sql<string>`'article-video'`,
          title: articles.chosenTitle,
          status: sql<string>`'READY'`,
          teamId: articles.teamId,
          teamName: teams.name,
          createdAt: articleAssets.createdAt,
          url: articleAssets.storageUrl,
          altText: articleAssets.altText,
          fileFormat: articleAssets.fileFormat,
          detailUrl: sql<string>`'/content/' || ${articles.id}::text`,
        })
          .from(articleAssets)
          .innerJoin(articles, eq(articles.id, articleAssets.articleId))
          .leftJoin(teams, eq(teams.id, articles.teamId))
          .where(and(isNull(articleAssets.deletedAt), eq(articleAssets.assetType, "video")))
          .orderBy(desc(articleAssets.createdAt))
          .limit(limit),
        db.select({
          id: socialPostAssets.id,
          sourceId: socialPostAssets.id,
          kind: sql<string>`'social-video-asset'`,
          title: socialPosts.title,
          status: socialPosts.videoStatus,
          teamId: socialPosts.teamId,
          teamName: teams.name,
          createdAt: socialPostAssets.createdAt,
          url: socialPostAssets.storageUrl,
          altText: socialPostAssets.altText,
          fileFormat: socialPostAssets.fileFormat,
          detailUrl: sql<string>`'/social/' || ${socialPosts.id}::text`,
        })
          .from(socialPostAssets)
          .innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
          .leftJoin(teams, eq(teams.id, socialPosts.teamId))
          .where(and(isNull(socialPosts.deletedAt), eq(socialPostAssets.assetType, "video")))
          .orderBy(desc(socialPostAssets.createdAt))
          .limit(limit),
        db.select({
          id: socialPosts.id,
          sourceId: socialPosts.id,
          kind: sql<string>`'social-video'`,
          title: socialPosts.title,
          status: socialPosts.videoStatus,
          teamId: socialPosts.teamId,
          teamName: teams.name,
          createdAt: socialPosts.videoGeneratedAt,
          url: socialPosts.videoUrl,
          altText: socialPosts.videoDescription,
          fileFormat: sql<string>`'mp4'`,
          detailUrl: sql<string>`'/social/' || ${socialPosts.id}::text`,
        })
          .from(socialPosts)
          .leftJoin(teams, eq(teams.id, socialPosts.teamId))
          .where(and(isNull(socialPosts.deletedAt), eq(socialPosts.videoStatus, "READY"), isNotNull(socialPosts.videoUrl)))
          .orderBy(desc(socialPosts.videoGeneratedAt))
          .limit(limit),
      ]);
      items = [...articleVideos, ...socialAssetVideos, ...socialVideos]
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
        .slice(0, limit);
    }

    if (type === "podcasts") {
      items = await db
        .select({
          id: articles.id,
          sourceId: articles.id,
          kind: sql<string>`'podcast'`,
          title: articles.chosenTitle,
          status: articles.podcastStatus,
          teamId: articles.teamId,
          teamName: teams.name,
          createdAt: articles.podcastGeneratedAt,
          url: articles.podcastUrl,
          duration: articles.podcastDuration,
          fileFormat: sql<string>`'mp3'`,
          detailUrl: sql<string>`'/content/' || ${articles.id}::text`,
        })
        .from(articles)
        .leftJoin(teams, eq(teams.id, articles.teamId))
        .where(and(isNull(articles.deletedAt), eq(articles.podcastStatus, "ready"), isNotNull(articles.podcastUrl)))
        .orderBy(desc(articles.podcastGeneratedAt))
        .limit(limit);
    }

    return NextResponse.json({ type, summary, items, count: items.length });
  } catch (error: any) {
    const status = error?.statusCode || 500;
    if (status === 500) console.error("Admin content library error:", error);
    return NextResponse.json(
      { error: status === 500 ? "Failed to load generated content" : error.message },
      { status },
    );
  }
}