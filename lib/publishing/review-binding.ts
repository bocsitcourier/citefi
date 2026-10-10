import { randomUUID } from "node:crypto";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { articles, articleAssets, jobBatches, publishingConnections, teamMembers, teams, users, campaigns, activityLogs } from "../../shared/schema";
import type { Article, PublishingConnection } from "../../shared/schema";
import { websiteAdapter, makeAbsoluteUrl } from "./channels/website/adapter";
import { reviewHash } from "./dispatch-policy";
import { objectKeyFromUrl } from "../storage-migration";
import { reviewMediaStore, sha256, signedReviewMediaUrl, type ReviewMediaStore } from "./review-media";
import { REVIEW_RETENTION_LOCK } from "./review-retention";
import type { ApprovalSnapshot, ReviewManifest } from "./review-types";
import type { FormattedContent } from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReviewActor = { userId: number; teamId: number; role: string };
export const REVIEW_POLICY = "Owners, admins and members may review their team's unassigned content. When assigned to a client team, only that team's current owner/admin/member/client_viewer may review it. Assignment is the existing approvalTeamId; reassignment or a new review request revokes consent. A removed, changed-role, suspended or inactive reviewer/publisher invalidates queued work. Administrators have no approval bypass: unassign explicitly, audit the reassignment, and review the exact new manifest. Revocation committed before the dispatch claim blocks sending; it cannot recall a request already claimed.";
const conflict = (message: string) => Object.assign(new Error(message), { statusCode: 409 });

export async function assertCurrentActor(tx: Tx, actor: ReviewActor, allowed: string[]): Promise<string> {
  const [membership] = await tx.select().from(teamMembers).where(and(
    eq(teamMembers.userId, actor.userId), eq(teamMembers.teamId, actor.teamId),
  )).for("share");
  const [user] = await tx.select().from(users).where(eq(users.id, actor.userId)).for("share");
  const [team] = await tx.select().from(teams).where(eq(teams.id, actor.teamId)).for("share");
  if (!membership || membership.role !== actor.role || !allowed.includes(membership.role) ||
      !user || user.accountStatus !== "active" || user.deletedAt ||
      !team || team.deletedAt || team.clientStatus !== "active") {
    throw Object.assign(new Error("Current team authority is required"), { statusCode: 403 });
  }
  return reviewHash({ id: membership.id, joinedAt: membership.joinedAt, role: membership.role });
}

export function assertReviewAssignment(article: Article, actor: ReviewActor): void {
  const reviewTeam = article.approvalTeamId ?? article.teamId;
  if (reviewTeam !== actor.teamId || (actor.role === "client_viewer" && article.approvalTeamId !== actor.teamId)) {
    throw Object.assign(new Error("Article not found in your assigned reviews"), { statusCode: 404 });
  }
}

/** Canonical object keys are shared with the media library/storage migration.
 * Remote/data URLs cannot prove ownership or byte identity and fail closed. */
function sourceKey(url: string): string {
  const key = objectKeyFromUrl(url);
  if (!key || !key.startsWith("private/articles/") || key.includes("..") || key.includes("\\") ||
      !new URL(url, "https://review.invalid").pathname.startsWith("/api/public-objects/")) {
    throw conflict("Only durable, owned article media can be approved for publishing");
  }
  return key;
}

function replaceStrings<T>(value: T, replacements: Map<string, string>): T {
  if (typeof value === "string") {
    let result: string = value;
    // Replace longest first so a base URL cannot rewrite a distinct longer key.
    for (const [from, to] of [...replacements].sort(([a], [b]) => b.length - a.length)) result = result.split(from).join(to);
    return result as T;
  }
  if (Array.isArray(value)) return value.map(child => replaceStrings(child, replacements)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(
    ([key, child]) => [key, replaceStrings(child, replacements)],
  )) as T;
  return value;
}

export function reviewMediaPayload(manifest: ReviewManifest): FormattedContent {
  const replacements = new Map(manifest.assets.map(asset => {
    const url = makeAbsoluteUrl(signedReviewMediaUrl(asset.pinnedKey));
    if (!url || !/^https?:\/\//.test(url)) throw conflict("A configured engine URL is required for reviewed media");
    return [`/api/publishing/review-media?key=${encodeURIComponent(asset.pinnedKey)}`, url];
  }));
  return replaceStrings(manifest.formatted, replacements);
}

export async function buildReviewManifest(
  tx: Tx, article: Article, connection: PublishingConnection, contentType: "article" | "podcast",
  store: ReviewMediaStore = reviewMediaStore, pin = false,
): Promise<ReviewManifest> {
  // Shared transaction lock fences pin/read + approval/admission commit against
  // the exclusive cleanup barrier, including copies already present in storage.
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${REVIEW_RETENTION_LOCK}, 0))`);
  if (!article.teamId || article.deletedAt || article.articleStatus !== "COMPLETE" ||
      connection.teamId !== article.teamId || connection.deletedAt || connection.status !== "active" ||
      connection.channel !== "website" || !connection.apiKeyHash || !connection.encryptedApiKey) {
    throw conflict("Complete content and an active owned destination account are required");
  }
  const receiver = new URL(connection.baseUrl ?? "");
  if (receiver.protocol !== "https:" || receiver.username || receiver.password) throw conflict("Invalid publishing destination");
  const assets = await tx.select().from(articleAssets).where(and(
    eq(articleAssets.articleId, article.id), isNull(articleAssets.deletedAt),
  )).orderBy(articleAssets.id).for("share");
  if (assets.some(asset => asset.teamId !== article.teamId)) throw conflict("All media must have established team ownership");
  const [batch] = await tx.select().from(jobBatches).where(and(
    eq(jobBatches.id, article.batchId), eq(jobBatches.teamId, article.teamId),
  )).for("share");
  if (!batch) throw conflict("Owned content batch is unavailable");
  const [campaign] = article.campaignId ? await tx.select().from(campaigns).where(and(
    eq(campaigns.id, article.campaignId), eq(campaigns.teamId, article.teamId),
  )).for("share") : [];
  if (article.campaignId && !campaign) throw conflict("Owning Campaign is unavailable");
  // Use the existing formatter and immutable Campaign aggregate rather than
  // reconstructing a different editor/export payload.
  const formatted = await websiteAdapter.format({ type: contentType, article, articleAssets: assets, businessName: batch.businessName ?? undefined }, connection);
  const validation = await websiteAdapter.validate({ type: contentType, article, articleAssets: assets }, connection);
  if (!validation.valid) throw conflict(validation.errors?.join(", ") ?? "Content is not publishable");
  const urls = new Set([...assets.map(asset => asset.storageUrl), ...(formatted.mediaToUpload ?? []).map(asset => asset.sourceUrl)]);
  if (article.heroImageUrl) urls.add(article.heroImageUrl);
  if (contentType === "podcast" && article.podcastUrl) urls.add(article.podcastUrl);
  const versions = new Map<string, ReviewManifest["assets"][number]>();
  const replacements = new Map<string, string>();
  let totalBytes = 0;
  for (const url of urls) {
    const key = sourceKey(url);
    if (!key.startsWith(`private/articles/${article.id}/`)) throw conflict("Media key does not belong to this article");
    let asset = versions.get(key);
    if (!asset) {
      const bytes = await store.read(key);
      totalBytes += bytes.length;
      if (totalBytes > 96 * 1024 * 1024) throw conflict("Review media exceeds 96 MiB");
      const digest = sha256(bytes);
      const ext = key.split(".").pop()?.toLowerCase();
      if (!ext || !["webp", "png", "jpg", "jpeg", "mp3", "wav", "mp4", "ogg"].includes(ext)) throw conflict("Unsupported review media format");
      const pinnedKey = `private/publishing-reviewed/${article.teamId}/${digest}.${ext}`;
      asset = { sourceKey: key, sha256: digest, size: bytes.length, pinnedKey };
      if (pin) {
        const mime = formatted.mediaToUpload?.find(media => sourceKey(media.sourceUrl) === key)?.mimeType ?? "application/octet-stream";
        await store.pin(pinnedKey, bytes, mime);
      }
      // Always verify the persisted copy, including pre-existing objects.
      try {
        if (sha256(await store.read(pinnedKey)) !== digest) throw conflict("Immutable reviewed media is unavailable");
      } catch {
        throw conflict("Reviewed media changed or its immutable version is unavailable; review again");
      }
      versions.set(key, asset);
    }
    const pinnedUrl = `/api/publishing/review-media?key=${encodeURIComponent(asset.pinnedKey)}`;
    replacements.set(url, pinnedUrl);
    // Formatter absolutizes originals in bodyHtml as well as media URLs.
    for (const media of formatted.mediaToUpload ?? []) {
      if (sourceKey(media.sourceUrl) === key) replacements.set(media.sourceUrl, pinnedUrl);
    }
  }
  // Refuse inline media not represented in the owned byte manifest.
  const body = String(formatted.payload?.bodyHtml ?? "");
  for (const match of body.matchAll(/(?:src|poster)\s*=\s*["']([^"']+)["']/gi)) {
    if (![...replacements.keys()].includes(match[1]!)) throw conflict("Inline media must be tracked in the reviewed asset manifest");
  }
  if (/\bsrcset\s*=|url\s*\(/i.test(body)) throw conflict("Unversioned inline media is not supported");
  const sourceHash = reviewHash({
    formatted, assets, campaign: campaign ? {
      id: campaign.id, publicId: campaign.publicId, teamId: campaign.teamId,
      clientTeamId: campaign.clientTeamId, brandProfileSnapshot: campaign.brandProfileSnapshot,
      brandConfirmedAt: campaign.brandConfirmedAt, deletedAt: campaign.deletedAt,
    } : null,
    // Bind source content even when sanitation/formatting discards a field.
    article: {
      id: article.id, teamId: article.teamId, publicId: article.publicId, campaignId: article.campaignId,
      finalHtmlContent: article.finalHtmlContent, chosenTitle: article.chosenTitle, seoTitle: article.seoTitle,
      metaDescription: article.metaDescription, slug: article.slug, keywordsJson: article.keywordsJson,
      hashtagsJson: article.hashtagsJson, faqJson: article.faqJson, metaEnrichment: article.metaEnrichment,
      hyperlinkedKeywordsJson: article.hyperlinkedKeywordsJson, qualityGateStatus: article.qualityGateStatus,
      podcastUrl: article.podcastUrl, podcastScriptJson: article.podcastScriptJson,
      podcastStatus: article.podcastStatus, podcastDuration: article.podcastDuration,
      heroImageUrl: article.heroImageUrl, aiDisclosureIncluded: article.aiDisclosureIncluded,
    },
  });
  const unsigned = {
    version: 1 as const, sourceHash, contentType, assignmentTeamId: article.approvalTeamId,
    requestedAt: article.approvalRequestedAt?.toISOString() ?? null,
    destination: {
      id: connection.id, name: connection.name, channel: connection.channel, origin: receiver.origin,
      // A stable connection ID/origin alone cannot identify its account. Also
      // bind encrypted credential revision without revealing key material.
      accountFingerprint: reviewHash({ publicId: connection.publicId, apiKeyHash: connection.apiKeyHash, encryptedApiKey: connection.encryptedApiKey, capabilities: connection.capabilities }),
    },
    formatted: replaceStrings(formatted, replacements), assets: [...versions.values()].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
  };
  return { ...unsigned, digest: reviewHash(unsigned) };
}

/** Existing approval columns select the current immutable audit manifest.
 * Legacy records have no manifest; never infer/backfill consent. A missing or
 * pruned audit record revokes eligibility rather than falling back to flags. */
export async function getApprovalSnapshot(tx: Tx, article: Article): Promise<ApprovalSnapshot | null> {
  if (article.approvalStatus !== "approved" || !article.approvalReviewedAt || !article.approvalReviewedBy || !article.teamId) return null;
  const [record] = await tx.select({ details: activityLogs.details }).from(activityLogs).where(and(
    eq(activityLogs.resource, "articles"), eq(activityLogs.resourceId, article.id),
    eq(activityLogs.teamId, article.teamId), eq(activityLogs.userId, article.approvalReviewedBy),
    eq(activityLogs.action, "article_exact_review_approved"),
    sql`${activityLogs.details}->>'reviewedAt' = ${article.approvalReviewedAt.toISOString()}`,
  )).orderBy(desc(activityLogs.id)).limit(1).for("share");
  const value = record?.details as ApprovalSnapshot | undefined;
  return value?.version === 1 && typeof value.reviewId === "string" &&
    typeof value.digest === "string" && typeof value.reviewerMembership === "string" ? value : null;
}

export async function assertBoundReview(
  tx: Tx, article: Article, connection: PublishingConnection, contentType: "article" | "podcast",
): Promise<ApprovalSnapshot> {
  const snapshot = await getApprovalSnapshot(tx, article);
  if (!snapshot || snapshot.version !== 1 || article.approvalStatus !== "approved" ||
      article.approvalReviewedBy !== snapshot.reviewedBy ||
      article.approvalReviewedAt?.toISOString() !== snapshot.reviewedAt) throw conflict("An exact destination and asset review is required");
  assertReviewAssignment(article, { userId: snapshot.reviewedBy, teamId: snapshot.reviewerTeamId, role: snapshot.reviewerRole });
  const membership = await assertCurrentActor(tx, { userId: snapshot.reviewedBy, teamId: snapshot.reviewerTeamId, role: snapshot.reviewerRole }, ["owner", "admin", "member", "client_viewer"]);
  if (membership !== snapshot.reviewerMembership) throw conflict("Reviewer membership was replaced; review again");
  const current = await buildReviewManifest(tx, article, connection, contentType);
  if (current.digest !== snapshot.digest) throw conflict("Content, assets, assignment or destination changed; review again");
  return snapshot;
}

export async function persistReview(tx: Tx, article: Article, manifest: ReviewManifest, actor: ReviewActor, feedback?: string) {
  const now = new Date(Math.max(Date.now(), article.updatedAt.getTime() + 1));
  const snapshot: ApprovalSnapshot = {
    ...manifest, reviewId: randomUUID(), reviewedBy: actor.userId, reviewerTeamId: actor.teamId,
    reviewerRole: actor.role, reviewedAt: now.toISOString(),
    reviewerMembership: await assertCurrentActor(tx, actor, ["owner", "admin", "member", "client_viewer"]),
  };
  await tx.update(articles).set({
    approvalStatus: "approved", approvalReviewedAt: now, approvalReviewedBy: actor.userId,
    approvalFeedback: feedback ?? null, updatedAt: now,
  }).where(eq(articles.id, article.id));
  // Historical full immutable manifest is append-only evidence. Not best-effort:
  // an audit failure rolls back consent. No credentials/signed links recorded.
  await tx.insert(activityLogs).values({
    userId: actor.userId, action: "article_exact_review_approved", resource: "articles",
    resourceId: article.id, teamId: article.teamId, details: snapshot,
  });
  return snapshot;
}
