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
 *  - State is module-level so /api/health can read it without a DB round-trip.
 *  - Failure creates an admin notification (visible in the in-app bell) and a
 *    structured error log entry (visible in /admin/error-logs).
 */

import { GoogleGenAI } from "@google/genai";
import { getModel } from "./model-resolver";
import { throttledGeminiRequest } from "./gemini";
import { createNotification } from "./notification-service";
import { logError } from "./error-logger";

// ── Public state (stored in Redis so both worker and web process can read it) ─

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

const NEVER_RUN: CanaryResult = {
  status: "never_run",
  lastRunAt: null,
  error: null,
  stage: null,
  provider: null,
  durationMs: null,
};

async function writeResult(result: CanaryResult): Promise<void> {
  try {
    const { getRedisConnection } = await import("./queue");
    const redis = getRedisConnection();
    await redis.set(REDIS_KEY, JSON.stringify(result), "EX", REDIS_TTL_SECONDS);
  } catch (err) {
    console.error("[canary] Failed to persist result to Redis:", err);
  }
}

/**
 * Read the last canary result from Redis.
 * Safe to call from any process (web or worker). Falls back to NEVER_RUN if Redis
 * is unavailable or no result has been stored yet.
 */
export async function getLastCanaryResult(): Promise<CanaryResult> {
  try {
    const Redis = (await import("ioredis")).default;
    const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 0,
    });
    await client.connect();
    const raw = await client.get(REDIS_KEY);
    await client.quit();
    if (!raw) return NEVER_RUN;
    return JSON.parse(raw) as CanaryResult;
  } catch {
    return NEVER_RUN;
  }
}

// ── Assertion thresholds ──────────────────────────────────────────────────────

/** Minimum character count for a ~200-word article response (HTML included). */
const MIN_ARTICLE_CHARS = 400;
/** Minimum bytes for a real image vs an empty/error response. */
const MIN_IMAGE_BYTES = 1024;

// ── Core runner ───────────────────────────────────────────────────────────────

export async function runCanary(): Promise<void> {
  console.log("🐤 [canary] Starting daily model health check...");
  const start = Date.now();
  let stage = "text_generation";
  let provider = "gemini";

  try {
    // ── Stage 1: Text generation ──────────────────────────────────────────────
    // A direct minimal call — no batch/SEO/DB machinery; we just want proof that
    // the configured article model ID is live and returns coherent text.
    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const textModel = getModel("geminiArticle");

    const textResponse = await throttledGeminiRequest(() =>
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
      })
    );

    const text =
      textResponse.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("") ?? "";

    if (!text || text.trim().length < MIN_ARTICLE_CHARS) {
      throw new Error(
        `Article text too short: ${text.trim().length} chars returned, ` +
          `expected >= ${MIN_ARTICLE_CHARS}. Model="${textModel}" may be returning empty responses.`
      );
    }
    console.log(
      `🐤 [canary] Text OK — ${text.trim().length} chars via model "${textModel}"`
    );

    // ── Stage 2: Image generation ─────────────────────────────────────────────
    stage = "image_generation";
    const imageModel = getModel("geminiImage");

    const imgResponse = await throttledGeminiRequest(() =>
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
        config: { responseModalities: ["Image"] },
      })
    );

    let imageBytes = 0;
    for (const part of imgResponse.candidates?.[0]?.content?.parts ?? []) {
      if ((part as { inlineData?: { data?: string } }).inlineData?.data) {
        imageBytes = Buffer.from(
          (part as { inlineData: { data: string } }).inlineData.data,
          "base64"
        ).length;
        break;
      }
    }

    if (imageBytes < MIN_IMAGE_BYTES) {
      throw new Error(
        `Image response too small: ${imageBytes} bytes returned, ` +
          `expected >= ${MIN_IMAGE_BYTES}. Model="${imageModel}" may be deprecated or returning empty responses.`
      );
    }
    console.log(
      `🐤 [canary] Image OK — ${imageBytes} bytes via model "${imageModel}"`
    );

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
    await writeResult(passResult);
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
    await writeResult(failResult);

    console.error(
      `❌ [canary] Daily model health check FAILED — stage="${stage}" provider="${provider}": ${message}`
    );

    // In-app notification (null userId/teamId = visible to all admins)
    try {
      await createNotification({
        type: "error",
        category: "system",
        title: "Model Health Check Failed",
        message: `Daily canary failed at stage "${stage}" (${provider}): ${message.slice(0, 300)}`,
      });
    } catch (notifyErr) {
      console.error("[canary] Failed to send admin notification:", notifyErr);
    }

    // Structured error log (visible in /admin/error-logs)
    try {
      await logError({
        errorType: "SYSTEM",
        errorMessage: `[canary] stage=${stage} provider=${provider}: ${message}`,
        severity: "critical",
        component: "canary-worker",
        context: { stage, provider, durationMs },
      });
    } catch (logErr) {
      console.error("[canary] Failed to write error log:", logErr);
    }
  }
}
