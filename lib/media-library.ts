import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  articleAssets,
  articles,
  socialPostAssets,
  socialPosts,
  socialPostVariants,
  teams,
} from "@/shared/schema";
import { resolvePodcastDurationProvenance } from "@/lib/podcast-duration-provenance";

export type AssetKind = "image" | "video" | "audio";
export type AssetSourceType =
  | "article_asset"
  | "article_hero"
  | "article_podcast"
  | "social_asset"
  | "social_variant"
  | "social_video";

export interface CanonicalAsset {
  assetId: string;
  sourceType: AssetSourceType;
  sourceId: number;
  kind: AssetKind;
  teamId: number | null;
  teamName: string | null;
  articleId: number | null;
  socialPostId: number | null;
  title: string | null;
  status: string | null;
  url: string;
  objectKey: string;
  altText: string | null;
  prompt: string | null;
  fileFormat: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  sourceUrl: string;
  actions: {
    edit: string | null;
    delete: string | null;
    download: string;
    regenerate: string | null;
    source: string;
  };
}

type Candidate = Omit<CanonicalAsset, "assetId" | "objectKey" | "actions">;

export interface AssetListOptions {
  teamId?: number;
  kind?: AssetKind;
  articleId?: number;
  teamFilter?: number;
  status?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function canonicalObjectKey(url: string): string {
  const value = url.trim();
  const proxy = value.match(/\/api\/public-objects\/(.+?)(?:[?#].*)?$/);
  if (proxy?.[1]) {
    return decodePath(proxy[1]).replace(/^\/+/, "").replace(/^public\//, "");
  }
  try {
    const parsed = new URL(value);
    return decodePath(parsed.pathname)
      .replace(/^\/+/, "")
      .replace(/^public\//, "");
  } catch {
    return value.replace(/[?#].*$/, "").replace(/^\/+/, "");
  }
}

function canonicalId(objectKey: string): string {
  return `asset_${createHash("sha256").update(objectKey).digest("base64url").slice(0, 24)}`;
}

function formatFromUrl(url: string, fallback: string | null): string | null {
  if (fallback) return fallback;
  const match = canonicalObjectKey(url).match(/\.([a-zA-Z0-9]{2,10})$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function priority(sourceType: AssetSourceType): number {
  if (sourceType === "article_asset" || sourceType === "social_asset") return 3;
  if (sourceType === "social_variant") return 2;
  return 1;
}

function encodeSource(sourceType: AssetSourceType, sourceId: number): string {
  return Buffer.from(`${sourceType}:${sourceId}`, "utf8").toString("base64url");
}

export function decodeAssetSource(identity: string): { sourceType: AssetSourceType; sourceId: number } | null {
  try {
    const decoded = Buffer.from(identity, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf(":");
    const sourceType = decoded.slice(0, separator) as AssetSourceType;
    const sourceId = Number(decoded.slice(separator + 1));
    const valid: AssetSourceType[] = [
      "article_asset", "article_hero", "article_podcast",
      "social_asset", "social_variant", "social_video",
    ];
    return valid.includes(sourceType) && Number.isInteger(sourceId) && sourceId > 0
      ? { sourceType, sourceId }
      : null;
  } catch {
    return null;
  }
}

function withIdentity(candidate: Candidate): CanonicalAsset {
  const objectKey = canonicalObjectKey(candidate.url);
  const identity = encodeSource(candidate.sourceType, candidate.sourceId);
  const mutationBase = `/api/media/assets/${identity}`;
  const canMutate = candidate.sourceType !== "article_hero";
  const regenerate =
    candidate.sourceType === "article_asset" && candidate.kind === "image"
      ? `${mutationBase}/regenerate`
      : (candidate.sourceType === "social_video" || candidate.sourceType === "social_asset")
          && candidate.kind === "video"
        ? `${mutationBase}/regenerate`
        : null;
  return {
    ...candidate,
    assetId: canonicalId(`${candidate.teamId ?? "unowned"}:${objectKey}`),
    objectKey,
    fileFormat: formatFromUrl(candidate.url, candidate.fileFormat),
    actions: {
      edit: canMutate && ["article_asset", "social_asset"].includes(candidate.sourceType) ? mutationBase : null,
      delete: canMutate ? mutationBase : null,
      download: candidate.url,
      regenerate,
      source: candidate.sourceUrl,
    },
  };
}

export function encodeAssetCursor(asset: CanonicalAsset): string {
  return Buffer.from(`${asset.createdAt.toISOString()}|${asset.assetId}`, "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { createdAt: number; assetId: string } | null {
  if (!cursor) return null;
  try {
    const [date, assetId] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!date || !assetId) return null;
    const createdAt = new Date(date).getTime();
    return Number.isFinite(createdAt) && assetId ? { createdAt, assetId } : null;
  } catch {
    return null;
  }
}

export async function listCanonicalAssets(options: AssetListOptions = {}) {
  const teamId = options.teamId ?? options.teamFilter;
  const articleConditions = [isNull(articles.deletedAt), ...(teamId ? [eq(articles.teamId, teamId)] : [])];
  const socialConditions = [isNull(socialPosts.deletedAt), ...(teamId ? [eq(socialPosts.teamId, teamId)] : [])];

  const [articleAssetRows, heroRows, podcastRows, socialAssetRows, variantRows, socialVideoRows] = await Promise.all([
    db.select({
      sourceId: articleAssets.id, kind: articleAssets.assetType, teamId: articles.teamId,
      teamName: teams.name, articleId: articles.id, title: articles.chosenTitle,
      status: articles.articleStatus, url: articleAssets.storageUrl, altText: articleAssets.altText,
      prompt: articleAssets.imagePromptUsed, fileFormat: articleAssets.fileFormat,
      metadata: articleAssets.metadataJson, createdAt: articleAssets.createdAt,
    }).from(articleAssets).innerJoin(articles, eq(articles.id, articleAssets.articleId))
      .leftJoin(teams, eq(teams.id, articles.teamId))
      .where(and(isNull(articleAssets.deletedAt), ...articleConditions)),
    db.select({
      sourceId: articles.id, teamId: articles.teamId, teamName: teams.name, articleId: articles.id,
      title: articles.chosenTitle, status: articles.articleStatus, url: articles.heroImageUrl,
      createdAt: articles.createdAt,
    }).from(articles).leftJoin(teams, eq(teams.id, articles.teamId))
      .where(and(...articleConditions, isNotNull(articles.heroImageUrl))),
    db.select({
      sourceId: articles.id, teamId: articles.teamId, teamName: teams.name, articleId: articles.id,
      title: articles.chosenTitle, status: articles.podcastStatus, url: articles.podcastUrl,
      duration: articles.podcastDuration,
      scriptMetadata: articles.podcastScriptJson,
      createdAt: sql<Date>`coalesce(${articles.podcastGeneratedAt}, ${articles.createdAt})`,
    }).from(articles).leftJoin(teams, eq(teams.id, articles.teamId))
      .where(and(...articleConditions, isNotNull(articles.podcastUrl))),
    db.select({
      sourceId: socialPostAssets.id, kind: socialPostAssets.assetType, teamId: socialPosts.teamId,
      teamName: teams.name, socialPostId: socialPosts.id, title: socialPosts.title,
      status: socialPosts.status, url: socialPostAssets.storageUrl, altText: socialPostAssets.altText,
      prompt: socialPostAssets.promptUsed, fileFormat: socialPostAssets.fileFormat,
      width: socialPostAssets.width, height: socialPostAssets.height,
      duration: socialPostAssets.videoDuration, createdAt: socialPostAssets.createdAt,
    }).from(socialPostAssets).innerJoin(socialPosts, eq(socialPosts.id, socialPostAssets.socialPostId))
      .leftJoin(teams, eq(teams.id, socialPosts.teamId)).where(and(...socialConditions)),
    db.select({
      sourceId: socialPostVariants.id, teamId: socialPosts.teamId, teamName: teams.name,
      socialPostId: socialPosts.id, title: socialPosts.title, status: socialPostVariants.status,
      url: socialPostVariants.imageUrl, createdAt: socialPostVariants.createdAt,
    }).from(socialPostVariants).innerJoin(socialPosts, eq(socialPosts.id, socialPostVariants.socialPostId))
      .leftJoin(teams, eq(teams.id, socialPosts.teamId))
      .where(and(...socialConditions, isNotNull(socialPostVariants.imageUrl))),
    db.select({
      sourceId: socialPosts.id, teamId: socialPosts.teamId, teamName: teams.name,
      socialPostId: socialPosts.id, title: socialPosts.title, status: socialPosts.videoStatus,
      url: socialPosts.videoUrl, altText: socialPosts.videoDescription,
      duration: socialPosts.videoDuration,
      createdAt: sql<Date>`coalesce(${socialPosts.videoGeneratedAt}, ${socialPosts.createdAt})`,
    }).from(socialPosts).leftJoin(teams, eq(teams.id, socialPosts.teamId))
      .where(and(...socialConditions, isNotNull(socialPosts.videoUrl))),
  ]);

  const candidates: Candidate[] = [
    ...articleAssetRows.map((r) => ({
      ...r, sourceType: "article_asset" as const, kind: r.kind as AssetKind,
      metadata: r.metadata as Record<string, unknown> | null,
      socialPostId: null, sourceUrl: `/content/${r.articleId}`,
    })),
    ...heroRows.map((r) => ({
      ...r, sourceType: "article_hero" as const, kind: "image" as const,
      url: r.url!,
      socialPostId: null, altText: null, prompt: null, fileFormat: null, metadata: null,
      sourceUrl: `/content/${r.articleId}`,
    })),
    ...podcastRows.map((r) => {
      const durationProvenance = resolvePodcastDurationProvenance(
        r.scriptMetadata,
        r.duration,
      );
      const scriptMetadata = r.scriptMetadata as Record<string, unknown> | null;
      return {
        ...r, sourceType: "article_podcast" as const, kind: "audio" as const,
        url: r.url!,
        socialPostId: null, altText: null, prompt: null, fileFormat: "mp3",
        duration: durationProvenance.seconds,
        metadata: {
          ...scriptMetadata,
          duration: durationProvenance.seconds,
          durationSource: durationProvenance.source,
        },
        sourceUrl: `/content/${r.articleId}`,
      };
    }),
    ...socialAssetRows.map((r) => ({
      ...r, sourceType: "social_asset" as const, kind: r.kind as AssetKind,
      articleId: null, metadata: { width: r.width, height: r.height, duration: r.duration },
      sourceUrl: `/social/${r.socialPostId}`,
    })),
    ...variantRows.map((r) => ({
      ...r, sourceType: "social_variant" as const, kind: "image" as const, articleId: null,
      url: r.url!,
      altText: null, prompt: null, fileFormat: null, metadata: null,
      sourceUrl: `/social/${r.socialPostId}`,
    })),
    ...socialVideoRows.map((r) => ({
      ...r, sourceType: "social_video" as const, kind: "video" as const, articleId: null,
      url: r.url!,
      prompt: null, fileFormat: "mp4", metadata: { duration: r.duration },
      sourceUrl: `/social/${r.socialPostId}`,
    })),
  ];

  const deduped = new Map<string, CanonicalAsset>();
  for (const candidate of candidates) {
    if (!candidate.url?.trim()) continue;
    const asset = withIdentity(candidate);
    const current = deduped.get(asset.objectKey);
    if (!current) {
      deduped.set(asset.objectKey, asset);
      continue;
    }
    const authoritative = priority(asset.sourceType) > priority(current.sourceType) ? asset : current;
    const supplemental = authoritative === asset ? current : asset;
    const supplementalReady = ["ready", "complete", "published"].includes(supplemental.status?.toLowerCase() || "");
    deduped.set(asset.objectKey, {
      ...authoritative,
      status: supplementalReady ? supplemental.status : authoritative.status,
      altText: authoritative.altText || supplemental.altText,
      prompt: authoritative.prompt || supplemental.prompt,
      metadata: { ...(supplemental.metadata || {}), ...(authoritative.metadata || {}) },
    });
  }

  const status = options.status?.toLowerCase();
  const cursor = decodeCursor(options.cursor);
  const allAssets = [...deduped.values()];
  const totals = {
    image: allAssets.filter((asset) => asset.kind === "image").length,
    video: allAssets.filter((asset) => asset.kind === "video").length,
    audio: allAssets.filter((asset) => asset.kind === "audio").length,
  };
  const matching = allAssets
    .filter((asset) => !options.kind || asset.kind === options.kind)
    .filter((asset) => !options.articleId || asset.articleId === options.articleId)
    .filter((asset) => !status || asset.status?.toLowerCase() === status)
    .filter((asset) => !options.from || asset.createdAt >= options.from)
    .filter((asset) => !options.to || asset.createdAt <= options.to)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.assetId.localeCompare(a.assetId));
  const filtered = matching
    .filter((asset) => !cursor
      || asset.createdAt.getTime() < cursor.createdAt
      || (asset.createdAt.getTime() === cursor.createdAt && asset.assetId.localeCompare(cursor.assetId) < 0));

  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const items = filtered.slice(0, limit);
  return {
    items,
    total: matching.length,
    totals,
    nextCursor: filtered.length > limit && items.length
      ? encodeAssetCursor(items[items.length - 1]!)
      : null,
  };
}