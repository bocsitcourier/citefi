import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin, requireTeamMember } from "@/lib/api/auth";
import { db, getTxDb } from "@/lib/db";
import { canonicalObjectKey, decodeAssetSource, type AssetSourceType } from "@/lib/media-library";
import { deleteFromStorage } from "@/lib/storage";
import {
  articleAssets,
  articles,
  socialPostAssets,
  socialPosts,
  socialPostVariants,
} from "@/shared/schema";

type RouteContext = { params: Promise<{ identity: string }> };
type Scope = { teamId: number | null };

async function authorize(request: NextRequest): Promise<Scope> {
  try {
    await requireAdmin(request);
    return { teamId: null };
  } catch (error: any) {
    if (error?.statusCode !== 403) throw error;
    const { teamId } = await requireTeamMember(request);
    return { teamId };
  }
}

function scoped(sourceTeamId: number | null, scope: Scope): boolean {
  return scope.teamId === null || sourceTeamId === scope.teamId;
}

async function loadSource(sourceType: AssetSourceType, sourceId: number, scope: Scope) {
  if (sourceType === "article_asset") {
    const [row] = await db.select({
      sourceId: articleAssets.id, teamId: articles.teamId, url: articleAssets.storageUrl,
      articleId: articles.id,
    }).from(articleAssets).innerJoin(articles, eq(articles.id, articleAssets.articleId))
      .where(eq(articleAssets.id, sourceId)).limit(1);
    return row && scoped(row.teamId, scope) ? { ...row, socialPostId: null } : null;
  }
  if (sourceType === "article_hero" || sourceType === "article_podcast") {
    const [row] = await db.select({
      sourceId: articles.id, teamId: articles.teamId,
      heroUrl: articles.heroImageUrl, podcastUrl: articles.podcastUrl, articleId: articles.id,
    }).from(articles).where(eq(articles.id, sourceId)).limit(1);
    if (!row || !scoped(row.teamId, scope)) return null;
    return { ...row, url: sourceType === "article_hero" ? row.heroUrl : row.podcastUrl, socialPostId: null };
  }
  if (sourceType === "social_asset") {
    const [row] = await db.select({
      sourceId: socialPostAssets.id, teamId: socialPosts.teamId, url: socialPostAssets.storageUrl,
      socialPostId: socialPosts.id, articleId: socialPosts.articleId,
    }).from(socialPostAssets).innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
      .where(eq(socialPostAssets.id, sourceId)).limit(1);
    return row && scoped(row.teamId, scope) ? row : null;
  }
  if (sourceType === "social_variant") {
    const [row] = await db.select({
      sourceId: socialPostVariants.id, teamId: socialPosts.teamId, url: socialPostVariants.imageUrl,
      socialPostId: socialPosts.id, articleId: socialPosts.articleId,
    }).from(socialPostVariants).innerJoin(socialPosts, eq(socialPosts.id, socialPostVariants.socialPostId))
      .where(eq(socialPostVariants.id, sourceId)).limit(1);
    return row && scoped(row.teamId, scope) ? row : null;
  }
  const [row] = await db.select({
    sourceId: socialPosts.id, teamId: socialPosts.teamId, url: socialPosts.videoUrl,
    socialPostId: socialPosts.id, articleId: socialPosts.articleId,
  }).from(socialPosts).where(eq(socialPosts.id, sourceId)).limit(1);
  return row && scoped(row.teamId, scope) ? row : null;
}

const editSchema = z.object({ altText: z.string().max(255) });

async function findDuplicateReferences(teamId: number, objectKey: string) {
  const [articleAssetRows, articleRows, socialAssetRows, variantRows, socialVideoRows] = await Promise.all([
    db.select({ id: articleAssets.id, articleId: articleAssets.articleId, url: articleAssets.storageUrl })
      .from(articleAssets).innerJoin(articles, eq(articles.id, articleAssets.articleId))
      .where(and(eq(articles.teamId, teamId), isNull(articleAssets.deletedAt), isNull(articles.deletedAt))),
    db.select({
      id: articles.id, heroUrl: articles.heroImageUrl, podcastUrl: articles.podcastUrl,
    }).from(articles).where(and(eq(articles.teamId, teamId), isNull(articles.deletedAt))),
    db.select({ id: socialPostAssets.id, url: socialPostAssets.storageUrl })
      .from(socialPostAssets).innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
      .where(and(eq(socialPosts.teamId, teamId), isNull(socialPosts.deletedAt))),
    db.select({ id: socialPostVariants.id, url: socialPostVariants.imageUrl })
      .from(socialPostVariants).innerJoin(socialPosts, eq(socialPosts.id, socialPostVariants.socialPostId))
      .where(and(eq(socialPosts.teamId, teamId), isNull(socialPosts.deletedAt))),
    db.select({ id: socialPosts.id, url: socialPosts.videoUrl })
      .from(socialPosts).where(and(eq(socialPosts.teamId, teamId), isNull(socialPosts.deletedAt))),
  ]);
  const matches = (url: string | null) => Boolean(url && canonicalObjectKey(url) === objectKey);
  return {
    articleAssets: articleAssetRows.filter((row) => matches(row.url)),
    articleHeroes: articleRows.filter((row) => matches(row.heroUrl)).map((row) => row.id),
    articlePodcasts: articleRows.filter((row) => matches(row.podcastUrl)).map((row) => row.id),
    socialAssets: socialAssetRows.filter((row) => matches(row.url)).map((row) => row.id),
    socialVariants: variantRows.filter((row) => matches(row.url)).map((row) => row.id),
    socialVideos: socialVideoRows.filter((row) => matches(row.url)).map((row) => row.id),
  };
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const scope = await authorize(request);
    const source = decodeAssetSource((await context.params).identity);
    if (!source) return NextResponse.json({ error: "Invalid asset identity" }, { status: 400 });
    const row = await loadSource(source.sourceType, source.sourceId, scope);
    if (!row) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    const { altText } = editSchema.parse(await request.json());

    if (source.sourceType === "article_asset") {
      await db.update(articleAssets).set({ altText }).where(eq(articleAssets.id, source.sourceId));
    } else if (source.sourceType === "social_asset") {
      await db.update(socialPostAssets).set({ altText }).where(eq(socialPostAssets.id, source.sourceId));
    } else {
      return NextResponse.json({ error: "This asset source does not support metadata editing" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error?.statusCode || 500;
    if (status === 500) console.error("Asset edit error:", error);
    return NextResponse.json({ error: status === 500 ? "Failed to edit asset" : error.message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const scope = await authorize(request);
    const source = decodeAssetSource((await context.params).identity);
    if (!source) return NextResponse.json({ error: "Invalid asset identity" }, { status: 400 });
    const row = await loadSource(source.sourceType, source.sourceId, scope);
    if (!row?.url) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    if (!row.teamId) {
      return NextResponse.json({ error: "Asset ownership must be repaired before deletion" }, { status: 409 });
    }
    const refs = await findDuplicateReferences(row.teamId, canonicalObjectKey(row.url));
    const txDb = getTxDb();
    await txDb.transaction(async (tx) => {
      if (refs.articleAssets.length) {
        await tx.update(articleAssets).set({ deletedAt: new Date() })
          .where(inArray(articleAssets.id, refs.articleAssets.map((ref) => ref.id)));
        for (const ref of refs.articleAssets) {
          await tx.update(articles)
            .set({ finalHtmlContent: sql`replace(coalesce(${articles.finalHtmlContent}, ''), ${ref.url}, '')` })
            .where(eq(articles.id, ref.articleId));
        }
      }
      if (refs.articleHeroes.length) {
        await tx.update(articles).set({ heroImageUrl: null }).where(inArray(articles.id, refs.articleHeroes));
      }
      if (refs.articlePodcasts.length) {
        await tx.update(articles).set({
          podcastUrl: null, podcastDuration: null, podcastGeneratedAt: null, podcastStatus: "none",
        }).where(inArray(articles.id, refs.articlePodcasts));
      }
      if (refs.socialAssets.length) {
        await tx.delete(socialPostAssets).where(inArray(socialPostAssets.id, refs.socialAssets));
      }
      if (refs.socialVariants.length) {
        await tx.update(socialPostVariants).set({ imageUrl: null })
          .where(inArray(socialPostVariants.id, refs.socialVariants));
      }
      if (refs.socialVideos.length) {
        await tx.update(socialPosts).set({ videoUrl: null, videoStatus: null, videoGeneratedAt: null })
          .where(inArray(socialPosts.id, refs.socialVideos));
      }
    });

    await deleteFromStorage(row.url).catch((error) => {
      console.warn("Asset metadata deleted but object removal failed:", error);
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const status = error?.statusCode || 500;
    if (status === 500) console.error("Asset delete error:", error);
    return NextResponse.json({ error: status === 500 ? "Failed to delete asset" : error.message }, { status });
  }
}