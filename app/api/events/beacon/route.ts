import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentEvents, articles, socialPosts } from "@/shared/schema";
import { eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { z } from "zod";

// Public endpoint — allow all origins (tracking pixel pattern)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const VALID_EVENT_TYPES = [
  "view", "click", "share",
  "page_view", "heartbeat", "scroll_milestone", "cta_click", "read_complete",
  "conversion",
  // session_end: fired on pagehide; carries bounced/engagedSec/scrollPct summary.
  // Kept separate from page_view so the labeler's view count (page_view only) is not
  // double-counted when aggregating sessions.
  "session_end",
] as const;

const beaconEventSchema = z.object({
  teamId: z.number().int().positive(),
  contentType: z.enum(["article", "social_post"]),
  contentId: z.number().int().positive(),
  eventType: z.enum(VALID_EVENT_TYPES),
  sessionId: z.string().max(100).optional(),
  visitorId: z.string().max(100).optional(),
  variantId: z.string().max(100).optional(),
  armId: z.number().int().positive().optional(),
  scrollPct: z.number().int().min(0).max(100).optional(),
  engagedSec: z.number().int().min(0).optional(),
  readComplete: z.boolean().optional(),
  bounced: z.boolean().optional(),
  fatigueSignal: z.boolean().optional(),
  // Journey / return-visitor signals (sent by beacon.js, stored for learning signal)
  isReturn: z.boolean().optional(),
  sessionCount: z.number().int().min(0).optional(),
  journeyId: z.string().max(100).optional(),
  journeyStep: z.number().int().min(1).optional(),
  conversionType: z.string().max(50).optional(),
  conversionValue: z.number().optional(),
  channel: z.string().max(30).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
  utmContent: z.string().max(100).optional(),
  device: z.string().max(20).optional(),
  locale: z.string().max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Batch payload: array of events OR single event
const beaconPayloadSchema = z.union([
  beaconEventSchema,
  z.array(beaconEventSchema).max(50),
]);

// In-memory rate limit: max 100 events per IP hash per minute (spec: 100/min)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ipHash: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ipHash);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ipHash, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 100) return false;
  entry.count++;
  return true;
}

// Periodically prune expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 120_000);

// Ownership cache to avoid repeated DB lookups for the same contentId
const ownershipCache = new Map<string, { teamId: number; expiresAt: number }>();

async function verifyOwnership(
  contentType: "article" | "social_post",
  contentId: number,
  declaredTeamId: number
): Promise<boolean> {
  const cacheKey = `${contentType}:${contentId}`;
  const cached = ownershipCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.teamId === declaredTeamId;
  }
  if (contentType === "article") {
    const [row] = await db
      .select({ teamId: articles.teamId })
      .from(articles)
      .where(eq(articles.id, contentId))
      .limit(1);
    if (!row) return false;
    ownershipCache.set(cacheKey, { teamId: row.teamId, expiresAt: Date.now() + 5 * 60_000 });
    return row.teamId === declaredTeamId;
  } else {
    const [row] = await db
      .select({ teamId: socialPosts.teamId })
      .from(socialPosts)
      .where(eq(socialPosts.id, contentId))
      .limit(1);
    if (!row) return false;
    ownershipCache.set(cacheKey, { teamId: row.teamId, expiresAt: Date.now() + 5 * 60_000 });
    return row.teamId === declaredTeamId;
  }
}

// Preflight handler — needed when XHR sends application/json
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const rawIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = createHash("sha256").update(rawIp).digest("hex");

    if (!checkRateLimit(ipHash)) {
      return new NextResponse(null, { status: 429, headers: CORS_HEADERS });
    }

    let rawBody: unknown;
    try {
      const text = await req.text();
      rawBody = JSON.parse(text);
    } catch {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    const parsed = beaconPayloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    // Normalise to array for uniform processing
    const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

    // Batched ownership check — two IN queries (one per content type) instead of
    // N sequential lookups. Cache hit avoids DB round-trip entirely.
    const uncachedArticleIds: number[] = [];
    const uncachedSocialIds: number[] = [];
    const seenKeys = new Set<string>();

    for (const evt of events) {
      const key = `${evt.contentType}:${evt.contentId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const cached = ownershipCache.get(key);
      if (cached && Date.now() < cached.expiresAt) continue; // already cached

      if (evt.contentType === "article") {
        if (!uncachedArticleIds.includes(evt.contentId)) uncachedArticleIds.push(evt.contentId);
      } else {
        if (!uncachedSocialIds.includes(evt.contentId)) uncachedSocialIds.push(evt.contentId);
      }
    }

    const cacheExpiry = Date.now() + 5 * 60_000;
    const [articleRows, socialRows] = await Promise.all([
      uncachedArticleIds.length > 0
        ? db.select({ id: articles.id, teamId: articles.teamId }).from(articles)
            .where(inArray(articles.id, uncachedArticleIds))
        : Promise.resolve([] as { id: number; teamId: number | null }[]),
      uncachedSocialIds.length > 0
        ? db.select({ id: socialPosts.id, teamId: socialPosts.teamId }).from(socialPosts)
            .where(inArray(socialPosts.id, uncachedSocialIds))
        : Promise.resolve([] as { id: number; teamId: number | null }[]),
    ]);

    for (const row of articleRows) {
      if (row.teamId != null) ownershipCache.set(`article:${row.id}`, { teamId: row.teamId, expiresAt: cacheExpiry });
    }
    for (const row of socialRows) {
      if (row.teamId != null) ownershipCache.set(`social_post:${row.id}`, { teamId: row.teamId, expiresAt: cacheExpiry });
    }

    // Filter to only owned events — always return 204 (no diagnostic leakage)
    const validEvents = events.filter((evt) => {
      const cached = ownershipCache.get(`${evt.contentType}:${evt.contentId}`);
      return cached != null && cached.teamId === evt.teamId;
    });

    if (validEvents.length === 0) {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    // Bulk insert all valid events in one round-trip.
    // Enrichment (server-side fatigueSignal, quality scoring) is handled by the
    // nightly ConversionLabeler worker — the beacon endpoint is accept+store only.
    await db.insert(contentEvents).values(
      validEvents.map((evt) => ({
        teamId: evt.teamId,
        contentType: evt.contentType,
        articleId: evt.contentType === "article" ? evt.contentId : null,
        socialPostId: evt.contentType === "social_post" ? evt.contentId : null,
        eventType: evt.eventType,
        sessionId: evt.sessionId ?? null,
        visitorId: evt.visitorId ?? null,
        variantId: evt.variantId ?? null,
        armId: evt.armId ?? null,
        ipHash,
        scrollPct: evt.scrollPct ?? null,
        engagedSec: evt.engagedSec ?? null,
        readComplete: evt.readComplete ?? false,
        bounced: evt.bounced ?? false,
        // Client-provided heuristic (rapid scroll <5s); deep cross-session fatigue
        // analysis is deferred to the nightly ConversionLabeler worker.
        fatigueSignal: evt.fatigueSignal ?? false,
        // Return-visitor / journey signals from beacon.js client
        isReturn: evt.isReturn ?? false,
        sessionCount: evt.sessionCount ?? null,
        journeyId: evt.journeyId ?? null,
        journeyStep: evt.journeyStep ?? null,
        conversionType: evt.conversionType ?? null,
        conversionValue: evt.conversionValue ?? null,
        channel: evt.channel ?? null,
        utmSource: evt.utmSource ?? null,
        utmMedium: evt.utmMedium ?? null,
        utmCampaign: evt.utmCampaign ?? null,
        utmContent: evt.utmContent ?? null,
        device: evt.device ?? null,
        locale: evt.locale ?? null,
        metadata: evt.metadata ?? null,
      }))
    );

    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  } catch (err) {
    console.error("[beacon]", (err as Error).message);
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
}
