import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contentEvents, articles, socialPosts } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import { z } from "zod";

// Public endpoint — allow all origins (tracking pixel pattern)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const VALID_EVENT_TYPES = ["view", "click", "share"] as const;

const beaconSchema = z.object({
  teamId: z.number().int().positive(),
  contentType: z.enum(["article", "social_post"]),
  contentId: z.number().int().positive(),
  eventType: z.enum(VALID_EVENT_TYPES),
  sessionId: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Simple in-memory rate limit: max 300 events per IP hash per minute
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ipHash: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ipHash);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ipHash, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 300) return false;
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

// Preflight handler — needed when XHR sends application/json
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    // Hash the IP — never store raw IP
    const rawIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = createHash("sha256").update(rawIp).digest("hex");

    if (!checkRateLimit(ipHash)) {
      return new NextResponse(null, { status: 429, headers: CORS_HEADERS });
    }

    // Accept both application/json and text/plain (sendBeacon uses text/plain to avoid preflight)
    let rawBody: unknown;
    try {
      const text = await req.text();
      rawBody = JSON.parse(text);
    } catch {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    const parsed = beaconSchema.safeParse(rawBody);
    if (!parsed.success) {
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }
    const data = parsed.data;

    // Ownership check — verify content exists AND belongs to the declared teamId.
    // Always returns 204 so client pages get no diagnostic info.
    if (data.contentType === "article") {
      const [article] = await db
        .select({ teamId: articles.teamId })
        .from(articles)
        .where(eq(articles.id, data.contentId))
        .limit(1);
      if (!article || article.teamId !== data.teamId) {
        return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
      }
    } else {
      const [post] = await db
        .select({ teamId: socialPosts.teamId })
        .from(socialPosts)
        .where(eq(socialPosts.id, data.contentId))
        .limit(1);
      if (!post || post.teamId !== data.teamId) {
        return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
      }
    }

    await db.insert(contentEvents).values({
      teamId: data.teamId,
      contentType: data.contentType,
      articleId: data.contentType === "article" ? data.contentId : null,
      socialPostId: data.contentType === "social_post" ? data.contentId : null,
      eventType: data.eventType,
      sessionId: data.sessionId ?? null,
      ipHash,
      metadata: data.metadata ?? null,
    });

    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  } catch (err) {
    // Silently swallow — beacon failures must never break the client page
    console.error("[beacon]", (err as Error).message);
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
}
