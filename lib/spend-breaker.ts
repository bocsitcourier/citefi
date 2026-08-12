/**
 * lib/spend-breaker.ts — Platform-level spend circuit breaker.
 *
 * Protects against aggregate runaway spend (retry storms, pricing changes,
 * viral spikes) that per-user caps can't catch.
 *
 * Levels:
 *  - Soft (80% of daily budget): pause the expensive queues only (video),
 *    articles keep flowing. Degradation, not outage.
 *  - Hard (100%): pause all generation queues. Enqueue is still accepted —
 *    BullMQ holds jobs in the paused queue, so user work is not lost and
 *    drains automatically when the breaker closes.
 *
 * State lives in Redis (`platform:breaker:status`) so every worker and web
 * process sees it instantly; /api/me/entitlements exposes it to clients.
 * Auto-closes when the UTC day rolls over (daily spend resets); manual
 * override via clearBreaker().
 */

import { db } from "./db";
import { costTelemetry } from "@/shared/schema";
import { gte, sum } from "drizzle-orm";

const DAILY_BUDGET_USD = parseFloat(process.env.PLATFORM_DAILY_BUDGET_USD || "50");
const SOFT_LIMIT_PCT = 0.8;

const BREAKER_KEY = "platform:breaker:status";
const BREAKER_REASON_KEY = "platform:breaker:reason";

export type BreakerStatus = "ok" | "video_paused" | "generation_paused";

/** Queues paused at the soft limit (most expensive per attempt) */
const EXPENSIVE_QUEUES = ["social-video-generation", "video-idea-generation"];
/** Additional queues paused at the hard limit */
const ALL_GENERATION_QUEUES = [
  ...EXPENSIVE_QUEUES,
  "article-generation",
  "social-post-generation",
  "image-generation",
  "article-podcast",
  "article-reformat",
];

function todayUtcStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Total platform spend today (USD) from cost telemetry. */
export async function getPlatformDailySpend(): Promise<number> {
  const [row] = await db
    .select({ total: sum(costTelemetry.costMicrousd) })
    .from(costTelemetry)
    .where(gte(costTelemetry.createdAt, todayUtcStart()));
  return Number(row?.total ?? 0) / 1_000_000;
}

export async function getBreakerStatus(): Promise<BreakerStatus> {
  try {
    const { getRedisConnection } = await import("./queue");
    const status = await getRedisConnection().get(BREAKER_KEY);
    if (status === "video_paused" || status === "generation_paused") return status;
    return "ok";
  } catch {
    return "ok"; // Redis down — don't block anything on breaker reads
  }
}

async function setBreaker(status: BreakerStatus, reason: string): Promise<void> {
  const { getRedisConnection } = await import("./queue");
  const redis = getRedisConnection();
  if (status === "ok") {
    await redis.del(BREAKER_KEY, BREAKER_REASON_KEY);
  } else {
    // TTL to end of UTC day + 1h grace — auto-expires at budget window reset
    const msToMidnight = todayUtcStart().getTime() + 24 * 3600 * 1000 - Date.now();
    const ttlSec = Math.ceil(msToMidnight / 1000) + 3600;
    await redis.set(BREAKER_KEY, status, "EX", ttlSec);
    await redis.set(BREAKER_REASON_KEY, reason, "EX", ttlSec);
  }
}

async function pauseQueues(names: string[]): Promise<void> {
  const { getQueue } = await import("./queue");
  await Promise.allSettled(names.map((n) => getQueue(n).pause()));
}

async function resumeQueues(names: string[]): Promise<void> {
  const { getQueue } = await import("./queue");
  await Promise.allSettled(names.map((n) => getQueue(n).resume()));
}

/**
 * Evaluate current spend against the daily budget and trip/close the breaker.
 * Called by the scheduler every 5 minutes in the worker process.
 * Idempotent — safe to call repeatedly.
 */
export async function evaluateSpendBreaker(): Promise<{
  status: BreakerStatus;
  spendUsd: number;
  budgetUsd: number;
}> {
  const spend = await getPlatformDailySpend();
  const current = await getBreakerStatus();

  let next: BreakerStatus = "ok";
  if (spend >= DAILY_BUDGET_USD) {
    next = "generation_paused";
  } else if (spend >= DAILY_BUDGET_USD * SOFT_LIMIT_PCT) {
    next = "video_paused";
  }

  if (next !== current) {
    if (next === "generation_paused") {
      console.error(
        `🚨 [spend-breaker] HARD LIMIT: $${spend.toFixed(2)} >= $${DAILY_BUDGET_USD} daily budget — pausing ALL generation queues`
      );
      await pauseQueues(ALL_GENERATION_QUEUES);
      await setBreaker("generation_paused", `Daily spend $${spend.toFixed(2)} hit hard limit $${DAILY_BUDGET_USD}`);
      // Alert ops via error log + notification
      const { logCritical } = await import("./error-logger");
      await logCritical(
        "SYSTEM" as any,
        `Platform spend breaker HARD TRIP: $${spend.toFixed(2)} / $${DAILY_BUDGET_USD} daily budget. All generation paused.`,
        { component: "spend-breaker" }
      ).catch(() => {});
    } else if (next === "video_paused") {
      console.warn(
        `⚠️ [spend-breaker] SOFT LIMIT: $${spend.toFixed(2)} >= ${SOFT_LIMIT_PCT * 100}% of $${DAILY_BUDGET_USD} — pausing video queues only`
      );
      // If we were harder before, resume the cheap queues
      if (current === "generation_paused") {
        await resumeQueues(ALL_GENERATION_QUEUES.filter((q) => !EXPENSIVE_QUEUES.includes(q)));
      }
      await pauseQueues(EXPENSIVE_QUEUES);
      await setBreaker("video_paused", `Daily spend $${spend.toFixed(2)} hit soft limit (${SOFT_LIMIT_PCT * 100}%)`);
    } else {
      console.log(`✅ [spend-breaker] Spend $${spend.toFixed(2)} back under limits — resuming all queues`);
      await resumeQueues(ALL_GENERATION_QUEUES);
      await setBreaker("ok", "");
    }
  }

  return { status: next, spendUsd: spend, budgetUsd: DAILY_BUDGET_USD };
}

/** Manual override: clear the breaker and resume all queues. */
export async function clearBreaker(): Promise<void> {
  await resumeQueues(ALL_GENERATION_QUEUES);
  await setBreaker("ok", "");
  console.log("✅ [spend-breaker] Manually cleared — all queues resumed");
}

/** Register the 5-minute evaluation loop. Call once in the worker process. */
export function startSpendBreakerScheduler(): void {
  const run = () =>
    evaluateSpendBreaker().catch((e) =>
      console.warn("[spend-breaker] evaluation failed:", e instanceof Error ? e.message : e)
    );
  run(); // evaluate immediately at boot (picks up state after restart)
  setInterval(run, 5 * 60 * 1000);
  console.log(`⏱️ Spend breaker scheduler registered (every 5 min, daily budget $${DAILY_BUDGET_USD})`);
}
