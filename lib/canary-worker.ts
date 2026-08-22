/**
 * Daily model health canary
 *
 * Runs once at 06:00 UTC via a BullMQ repeatable job registered in lib/worker.ts.
 * Exercises the configured Gemini text and image model IDs end-to-end and exposes
 * the result on /api/health so any monitoring tool can detect model deprecations
 * within hours of the 06:00 run.
 *
 * Design decisions:
 *  - No real DB article records are created — we call the Gemini APIs directly
 *    so the canary has zero side-effects and zero credit cost.
 *  - Result is persisted to Redis (key canary:last_result) so the Next.js web
 *    process and the BullMQ worker process both read the same state.
 *  - On failure, one in-app notification row is created per active admin user
 *    (matching the visibility predicate used by the notification query layer).
 */

import type Redis from "ioredis";
import { getRedisClientConfig } from "./queue";

// ── Result type ───────────────────────────────────────────────────────────────

export interface CanaryResult {
  status: "pass" | "fail" | "never_run";
  lastRunAt: string | null;
  error: string | null;
  stage: string | null;
  provider: string | null;
  durationMs: number | null;
}

const REDIS_KEY = "canary:last_result";
const REDIS_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — survive worker restarts
export const CANARY_STAGE_TIMEOUT_MS = 2 * 60 * 1000;
export const CANARY_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const CANARY_SCHEDULE_PATTERN = "0 6 * * *";
export const CANARY_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: "fixed" as const, delay: 5 * 60 * 1000 },
  removeOnComplete: 30,
  removeOnFail: 30,
};

const NEVER_RUN: CanaryResult = {
  status: "never_run",
  lastRunAt: null,
  error: null,
  stage: null,
  provider: null,
  durationMs: null,
};

// ── Redis helpers ─────────────────────────────────────────────────────────────

/**
 * Build a short-lived Redis client for a single operation.
 * Uses normalizeRedisUrl() so ediss:// typos and TLS are handled uniformly.
 */
async function makeTransientClient(urlOverride?: string): Promise<Redis> {
  const { default: IORedis } = await import("ioredis");
  const { url, options } = getRedisClientConfig(urlOverride, {
    lazyConnect: true,
    connectTimeout: 3000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 0,
  });
  const client = new IORedis(url, options);
  client.on("error", () => {
    // Connection errors are surfaced to the awaiting operation. This listener
    // prevents EventEmitter "error" events from becoming uncaught exceptions.
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    client.disconnect();
    throw err;
  }
}

/** Write a canary result to Redis. Exported for testing. */
export async function writeCanaryResult(
  result: CanaryResult,
  redisOverride?: Redis
): Promise<void> {
  let client: Redis | null = null;
  const ownsClient = !redisOverride;
  try {
    client = redisOverride ?? (await makeTransientClient());
    await client.set(REDIS_KEY, JSON.stringify(result), "EX", REDIS_TTL_SECONDS);
  } catch (err) {
    console.error("[canary] Failed to persist result to Redis:", err);
  } finally {
    if (ownsClient && client) {
      await (client as Redis).quit().catch(() => {});
    }
  }
}

/**
 * Read the last canary result from Redis.
 * Safe to call from any process (web or worker). Falls back to NEVER_RUN when
 * Redis is unavailable or no result has been stored yet.
 *
 * @param redisOverride - Pass an already-connected Redis client (e.g. in tests)
 *   to avoid creating a transient connection. When provided the client is NOT
 *   closed by this function.
 */
export async function getLastCanaryResult(
  redisOrUrl?: Redis | string
): Promise<CanaryResult> {
  let client: Redis | null = null;
  const ownsClient = typeof redisOrUrl !== "object" || redisOrUrl === null;
  try {
    if (typeof redisOrUrl === "object" && redisOrUrl !== null) {
      client = redisOrUrl;
    } else {
      client = await makeTransientClient(redisOrUrl as string | undefined);
    }
    const raw = await client.get(REDIS_KEY);
    if (!raw) return NEVER_RUN;
    return JSON.parse(raw) as CanaryResult;
  } catch {
    return NEVER_RUN;
  } finally {
    if (ownsClient) await client?.quit().catch(() => {});
  }
}

// ── Admin notification ────────────────────────────────────────────────────────

/**
 * Create one in-app notification per active admin user.
 * A notification with userId=null/teamId=null is never surfaced by the
 * notification query predicates, so per-user rows are required for visibility.
 *
 * Exported so tests can inject a spy instead.
 */
export async function notifyAdminsOfCanaryFailure(
  stage: string,
  provider: string,
  message: string
): Promise<void> {
  try {
    const { getTxDb } = await import("./db");
    const { users } = await import("@/shared/schema");
    const { eq, and } = await import("drizzle-orm");
    const { createNotification } = await import("./notification-service");

    const adminUsers = await getTxDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));

    if (adminUsers.length === 0) {
      console.warn("[canary] No active admin users found — skipping in-app notification");
      return;
    }

    await Promise.all(
      adminUsers.map((admin) =>
        createNotification({
          userId: admin.id,
          type: "error",
          category: "system",
          title: "Model Health Check Failed",
          message: `Daily canary failed at stage "${stage}" (${provider}): ${message.slice(0, 280)}`,
          actionUrl: "/api/health",
        }).catch((err) =>
          console.error(`[canary] Failed to notify admin ${admin.id}:`, err)
        )
      )
    );
  } catch (err) {
    console.error("[canary] Failed to send admin notifications:", err);
  }
}

// ── Assertion thresholds ──────────────────────────────────────────────────────

/** Minimum character count for a ~200-word article response (HTML included). */
export const MIN_ARTICLE_CHARS = 400;
/** Minimum bytes for a real image vs an empty/error response. */
export const MIN_IMAGE_BYTES = 1024;

export function evaluateCanaryHealth(
  result: CanaryResult,
  nowMs = Date.now()
): { ok: boolean; stale: boolean; reason: string | null } {
  if (result.status === "never_run" || !result.lastRunAt) {
    return { ok: false, stale: true, reason: "Canary has never completed" };
  }
  if (result.status === "fail") {
    return { ok: false, stale: false, reason: result.error ?? "Canary failed" };
  }
  const lastRunMs = Date.parse(result.lastRunAt);
  const stale = !Number.isFinite(lastRunMs) || nowMs - lastRunMs > CANARY_STALE_AFTER_MS;
  return {
    ok: !stale,
    stale,
    reason: stale ? "Last successful canary is older than 36 hours" : null,
  };
}

async function withCanaryTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  stage: string,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`Canary ${stage} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeoutHandle.unref();
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

// ── Injectable deps (for testing) ────────────────────────────────────────────

export interface CanaryDeps {
  /** Override text generation. Return the raw text output. */
  textGen?: (signal?: AbortSignal) => Promise<string>;
  /** Override image generation. Return the image byte count. */
  imageGen?: (signal?: AbortSignal) => Promise<number>;
  /** Override admin notification (spy in tests). */
  notifyAdmins?: (stage: string, provider: string, message: string) => Promise<void>;
  /**
   * Override error logging (spy in tests to avoid opening a real DB pool).
   * Receives the same fields that the real logError call would use.
   */
  logError?: (stage: string, provider: string, message: string, durationMs: number) => Promise<void>;
  /** Pre-connected Redis client (tests inject DB-14 client). */
  redis?: Redis;
  /** Per-stage hard timeout; production defaults to two minutes. */
  timeoutMs?: number;
  /** False on BullMQ retries to prevent duplicate admin alerts/error logs. */
  reportFailure?: boolean;
}

// ── Core runner ───────────────────────────────────────────────────────────────

export async function runCanary(deps?: CanaryDeps): Promise<void> {
  console.log("🐤 [canary] Starting daily model health check...");
  const start = Date.now();
  let stage = "text_generation";
  const provider = "gemini";
  const timeoutMs = deps?.timeoutMs ?? CANARY_STAGE_TIMEOUT_MS;

  const notifyFn = deps?.notifyAdmins ?? notifyAdminsOfCanaryFailure;
  const logFn = deps?.logError ?? (async (s: string, p: string, msg: string, ms: number) => {
    const { logError } = await import("./error-logger");
    await logError({
      errorType: "SYSTEM",
      errorMessage: `[canary] stage=${s} provider=${p}: ${msg}`,
      severity: "critical",
      component: "canary-worker",
      context: { stage: s, provider: p, durationMs: ms },
    });
  });

  try {
    // ── Stage 1: Text generation ──────────────────────────────────────────────
    let textOutput: string;

    if (deps?.textGen) {
      textOutput = await withCanaryTimeout(
        (signal) => deps.textGen!(signal),
        stage,
        timeoutMs
      );
    } else {
      const { GoogleGenAI } = await import("@google/genai");
      const { getModel } = await import("./model-resolver");
      const { throttledGeminiRequest } = await import("./gemini");

      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const textModel = getModel("geminiArticle");

      const textResponse = await withCanaryTimeout(
        (signal) => throttledGeminiRequest(() =>
          genAI.models.generateContent({
            model: textModel,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: [
                      "Write a 200-word professional article titled",
                      '"How AI Content Tools Help Small Businesses".',
                      "Return plain HTML with <h1>, <p> tags only.",
                      "This is an automated health check — content quality does not matter.",
                    ].join(" "),
                  },
                ],
              },
            ],
            config: {
              abortSignal: signal,
              httpOptions: { timeout: timeoutMs },
            },
          })
        ),
        stage,
        timeoutMs
      );

      textOutput =
        textResponse.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? "")
          .join("") ?? "";

      console.log(`🐤 [canary] Text OK — ${textOutput.trim().length} chars via model "${textModel}"`);
    }

    if (!textOutput || textOutput.trim().length < MIN_ARTICLE_CHARS) {
      throw new Error(
        `Article text too short: ${textOutput.trim().length} chars returned, ` +
          `expected >= ${MIN_ARTICLE_CHARS}. Model may be returning empty responses.`
      );
    }

    // ── Stage 2: Image generation ─────────────────────────────────────────────
    stage = "image_generation";
    let imageBytes: number;

    if (deps?.imageGen) {
      imageBytes = await withCanaryTimeout(
        (signal) => deps.imageGen!(signal),
        stage,
        timeoutMs
      );
    } else {
      const { GoogleGenAI } = await import("@google/genai");
      const { getModel } = await import("./model-resolver");
      const { throttledGeminiRequest } = await import("./gemini");

      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const imageModel = getModel("geminiImage");

      const imgResponse = await withCanaryTimeout(
        (signal) => throttledGeminiRequest(() =>
          genAI.models.generateContent({
            model: imageModel,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: "A minimal abstract blue gradient background, professional, no text. 256×256 pixels.",
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["Image"],
              abortSignal: signal,
              httpOptions: { timeout: timeoutMs },
            },
          })
        ),
        stage,
        timeoutMs
      );

      imageBytes = 0;
      for (const part of imgResponse.candidates?.[0]?.content?.parts ?? []) {
        if ((part as { inlineData?: { data?: string } }).inlineData?.data) {
          imageBytes = Buffer.from(
            (part as { inlineData: { data: string } }).inlineData.data,
            "base64"
          ).length;
          break;
        }
      }

      console.log(`🐤 [canary] Image OK — ${imageBytes} bytes via model "${imageModel}"`);
    }

    if (imageBytes < MIN_IMAGE_BYTES) {
      throw new Error(
        `Image response too small: ${imageBytes} bytes returned, ` +
          `expected >= ${MIN_IMAGE_BYTES}. Model may be deprecated or returning empty responses.`
      );
    }

    // ── All assertions passed ─────────────────────────────────────────────────
    const durationMs = Date.now() - start;
    const passResult: CanaryResult = {
      status: "pass",
      lastRunAt: new Date().toISOString(),
      error: null,
      stage: null,
      provider: null,
      durationMs,
    };
    await writeCanaryResult(passResult, deps?.redis);
    console.log(`✅ [canary] Daily model health check passed in ${durationMs}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;

    const failResult: CanaryResult = {
      status: "fail",
      lastRunAt: new Date().toISOString(),
      error: message.slice(0, 500),
      stage,
      provider,
      durationMs,
    };
    await writeCanaryResult(failResult, deps?.redis);

    console.error(
      `❌ [canary] Daily model health check FAILED — stage="${stage}" provider="${provider}": ${message}`
    );

    if (deps?.reportFailure !== false) {
      // Per-admin in-app notification (non-fatal — notification failure must not
      // prevent the Redis write or the structured error log from completing)
      try {
        await notifyFn(stage, provider, message);
      } catch (notifyErr) {
        console.error("[canary] notifyAdmins threw (non-fatal):", notifyErr);
      }

      // Structured error log (visible in /admin/error-logs)
      try {
        await logFn(stage, provider, message, durationMs);
      } catch (logErr) {
        console.error("[canary] Failed to write error log:", logErr);
      }
    }

    // BullMQ must record and retry failed canaries instead of marking them as
    // completed. Persistence/reporting happens first so operators still see
    // the initial failure even if the retry later succeeds.
    throw err instanceof Error ? err : new Error(message);
  }
}
