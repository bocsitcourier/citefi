/**
 * lib/user-gate.ts — Per-user concurrency and daily quota gates.
 *
 * Called at enqueue time (API routes), before the run record is written and
 * before queue.add(). A gate rejection costs zero provider budget and gives
 * the UI a structured 429 body it can render without guessing.
 *
 * Gate response shape (matches /api/me/entitlements):
 * {
 *   allowed: boolean,
 *   code?: "CONCURRENCY_LIMIT" | "DAILY_QUOTA_EXCEEDED" | "MONTHLY_SPEND_EXCEEDED",
 *   scope?: "video_concurrent" | "video_daily" | "video_monthly_spend",
 *   remaining?: number,
 *   resetsAt?: string,       // ISO timestamp
 *   upgradeUrl?: string,
 *   message?: string,
 * }
 */

import { db } from "./db";
import { socialPosts, articles } from "@/shared/schema";
import { and, eq, gte, inArray, count } from "drizzle-orm";
import { CONCURRENCY_CAPS, DAILY_QUOTAS, type ContentType } from "./cost-ceilings";

export interface GateResult {
  allowed: boolean;
  code?: "CONCURRENCY_LIMIT" | "DAILY_QUOTA_EXCEEDED" | "MONTHLY_SPEND_EXCEEDED";
  scope?: string;
  remaining?: number;
  resetsAt?: string;
  upgradeUrl?: string;
  message?: string;
}

/** Derive tier from team billingPlan (conservative default: free) */
async function getTeamTier(teamId: number): Promise<"free" | "pro" | "enterprise"> {
  try {
    const { teams } = await import("@/shared/schema");
    const [team] = await db
      .select({ billingPlan: teams.billingPlan })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    const plan = (team?.billingPlan ?? "free").toLowerCase();
    if (plan === "enterprise") return "enterprise";
    if (plan === "pro" || plan === "professional" || plan === "growth" || plan === "agency") return "pro";
    return "free";
  } catch {
    return "free"; // gate failures default to most restrictive
  }
}

/** UTC start of today */
function todayUtcStart(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

/** UTC start of tomorrow (for resetsAt) */
function tomorrowUtcStart(): Date {
  const d = todayUtcStart();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ── Video gate ────────────────────────────────────────────────────────────────

/** In-flight video statuses that count against concurrency */
const VIDEO_ACTIVE_STATUSES = ["PENDING", "GENERATING", "PROCESSING"] as const;

/** Terminal-failure statuses that DON'T count against daily quota */
const VIDEO_FAILED_STATUSES = ["FAILED", "CANCELLED"] as const;

export async function checkVideoGate(
  userId: number,
  teamId: number
): Promise<GateResult> {
  const tier = await getTeamTier(teamId);
  const concurrencyCap = CONCURRENCY_CAPS.video[tier];
  const dailyCap = DAILY_QUOTAS.video[tier];
  const upgradeUrl = "/settings/billing";

  // 1. Concurrency check: how many videos is this user generating right now?
  const [concRow] = await db
    .select({ cnt: count() })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.userId, userId),
        inArray(socialPosts.videoStatus, [...VIDEO_ACTIVE_STATUSES])
      )
    );
  const concurrent = Number(concRow?.cnt ?? 0);
  if (concurrent >= concurrencyCap) {
    return {
      allowed: false,
      code: "CONCURRENCY_LIMIT",
      scope: "video_concurrent",
      remaining: 0,
      message: `You already have ${concurrent} video${concurrent === 1 ? "" : "s"} generating. ` +
               `Wait for ${concurrent === 1 ? "it" : "one"} to finish before starting another.`,
      upgradeUrl,
    };
  }

  // 2. Daily quota check: how many videos has this user started today (non-failed)?
  const [dailyRow] = await db
    .select({ cnt: count() })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.userId, userId),
        gte(socialPosts.createdAt, todayUtcStart()),
        // exclude failed/cancelled — user didn't get value from those
        inArray(socialPosts.videoStatus, ["PENDING", "GENERATING", "PROCESSING", "COMPLETED"])
      )
    );
  const usedToday = Number(dailyRow?.cnt ?? 0);
  if (usedToday >= dailyCap) {
    return {
      allowed: false,
      code: "DAILY_QUOTA_EXCEEDED",
      scope: "video_daily",
      remaining: 0,
      resetsAt: tomorrowUtcStart().toISOString(),
      message: `You've used all ${dailyCap} video${dailyCap === 1 ? "" : "s"} for today. ` +
               `Your quota resets at midnight UTC.`,
      upgradeUrl,
    };
  }

  return {
    allowed: true,
    remaining: Math.min(concurrencyCap - concurrent, dailyCap - usedToday),
  };
}

// ── Entitlements query ────────────────────────────────────────────────────────

export interface EntitlementsResult {
  video: {
    remaining: number;
    cap: number;
    inFlight: number;
    concurrencyCap: number;
    resetsAt: string;
  };
  article: {
    remaining: number;
    cap: number;
    inFlight: number;
    concurrencyCap: number;
    resetsAt: string;
  };
  platform: {
    status: "ok" | "video_paused" | "generation_paused";
    message?: string;
  };
}

export async function getUserEntitlements(
  userId: number,
  teamId: number
): Promise<EntitlementsResult> {
  const tier = await getTeamTier(teamId);
  const resetsAt = tomorrowUtcStart().toISOString();

  // Video stats
  const [videoInflightRow] = await db
    .select({ cnt: count() })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.userId, userId),
      inArray(socialPosts.videoStatus, [...VIDEO_ACTIVE_STATUSES])
    ));
  const videoInFlight = Number(videoInflightRow?.cnt ?? 0);

  const [videoDailyRow] = await db
    .select({ cnt: count() })
    .from(socialPosts)
    .where(and(
      eq(socialPosts.userId, userId),
      gte(socialPosts.createdAt, todayUtcStart()),
      inArray(socialPosts.videoStatus, ["PENDING", "GENERATING", "PROCESSING", "COMPLETED"])
    ));
  const videoUsedToday = Number(videoDailyRow?.cnt ?? 0);
  const videoDailyCap = DAILY_QUOTAS.video[tier];
  const videoConcurrencyCap = CONCURRENCY_CAPS.video[tier];

  // Article stats (in-flight = GENERATING/PENDING, daily = all non-failed today)
  const [artInflightRow] = await db
    .select({ cnt: count() })
    .from(articles)
    .where(and(
      eq(articles.teamId, teamId),
      inArray(articles.articleStatus, ["PENDING", "GENERATING", "GEMINI_COMPLETE", "GPT4_ENHANCED"])
    ));
  const articleInFlight = Number(artInflightRow?.cnt ?? 0);

  const [artDailyRow] = await db
    .select({ cnt: count() })
    .from(articles)
    .where(and(
      eq(articles.teamId, teamId),
      gte(articles.createdAt, todayUtcStart()),
    ));
  const articleUsedToday = Number(artDailyRow?.cnt ?? 0);
  const articleDailyCap = DAILY_QUOTAS.article[tier];
  const articleConcurrencyCap = CONCURRENCY_CAPS.article[tier];

  // Platform status — check Redis for breaker state (graceful fallback to ok)
  let platformStatus: "ok" | "video_paused" | "generation_paused" = "ok";
  let platformMessage: string | undefined;
  try {
    const { getRedisConnection } = await import("./queue");
    const redis = getRedisConnection();
    const breaker = await redis.get("platform:breaker:status");
    if (breaker === "generation_paused") {
      platformStatus = "generation_paused";
      platformMessage = "Content generation is briefly paused — your queued work will resume automatically.";
    } else if (breaker === "video_paused") {
      platformStatus = "video_paused";
      platformMessage = "Video generation is briefly paused due to high demand — articles and social posts continue normally.";
    }
  } catch {
    // Redis unavailable — don't block entitlements
  }

  return {
    video: {
      remaining: Math.max(0, Math.min(videoConcurrencyCap - videoInFlight, videoDailyCap - videoUsedToday)),
      cap: videoDailyCap,
      inFlight: videoInFlight,
      concurrencyCap: videoConcurrencyCap,
      resetsAt,
    },
    article: {
      remaining: Math.max(0, articleDailyCap - articleUsedToday),
      cap: articleDailyCap,
      inFlight: articleInFlight,
      concurrencyCap: articleConcurrencyCap,
      resetsAt,
    },
    platform: {
      status: platformStatus,
      ...(platformMessage ? { message: platformMessage } : {}),
    },
  };
}
