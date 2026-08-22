/**
 * Canary worker tests
 *
 * Uses a real Redis instance on DB 14 (isolated from the main app's DB 0 and
 * the provider-circuit tests' DB 15) so results are real and not mocked.
 *
 * Run with:
 *   redis-server --daemonize yes --save '' --appendonly no
 *   WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379 \
 *     node --env-file=.env.local --import tsx/esm --test \
 *     tests/pipeline/canary-worker.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Redis from "ioredis";
import {
  runCanary,
  writeCanaryResult,
  getLastCanaryResult,
  notifyAdminsOfCanaryFailure,
  MIN_ARTICLE_CHARS,
  MIN_IMAGE_BYTES,
  type CanaryResult,
} from "../../lib/canary-worker";
import { normalizeRedisUrl } from "../../lib/queue";

// ── Shared Redis client on DB 14 ──────────────────────────────────────────────

const TEST_REDIS_URL = "redis://127.0.0.1:6379/14";
let redis: Redis;

before(async () => {
  // maxRetriesPerRequest:0 so the client doesn't keep the event loop alive after quit()
  redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 0, enableReadyCheck: false });
  await redis.flushdb(); // clean slate for every run
});

after(async () => {
  await redis.flushdb();
  await redis.quit();
});

// Shared no-op deps injected in every runCanary() call so tests never open a
// real DB connection (avoiding a lingering pool that prevents clean exit).
const noop = async () => {};
const noopLog = async () => {};
function makeTestDeps(overrides: Partial<Parameters<typeof runCanary>[0]> = {}) {
  return {
    notifyAdmins: noop,
    logError: noopLog,
    redis,
    ...overrides,
  };
}

// ── normalizeRedisUrl ─────────────────────────────────────────────────────────

describe("normalizeRedisUrl", () => {
  it("leaves a normal redis:// URL unchanged", () => {
    const { url, tls } = normalizeRedisUrl("redis://127.0.0.1:6379");
    assert.equal(url, "redis://127.0.0.1:6379");
    assert.equal(tls, false);
  });

  it("leaves a rediss:// URL unchanged and marks TLS", () => {
    const { url, tls } = normalizeRedisUrl("rediss://host:6380");
    assert.equal(url, "rediss://host:6380");
    assert.equal(tls, true);
  });

  it("corrects the ediss:// Replit typo to rediss:// and marks TLS", () => {
    const { url, tls } = normalizeRedisUrl("ediss://host:6380/0");
    assert.equal(url, "rediss://host:6380/0");
    assert.equal(tls, true);
  });

  it("falls back to localhost when no argument and no env var", () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const { url } = normalizeRedisUrl();
    assert.equal(url, "redis://127.0.0.1:6379");
    if (saved !== undefined) process.env.REDIS_URL = saved;
  });
});

// ── Redis persistence (writeCanaryResult / getLastCanaryResult) ───────────────

describe("Redis persistence", () => {
  it("getLastCanaryResult returns NEVER_RUN when no result is stored", async () => {
    await redis.del("canary:last_result"); // ensure key absent
    const result = await getLastCanaryResult(redis);
    assert.equal(result.status, "never_run");
    assert.equal(result.lastRunAt, null);
    assert.equal(result.error, null);
  });

  it("writeCanaryResult + getLastCanaryResult roundtrips a pass result", async () => {
    const sample: CanaryResult = {
      status: "pass",
      lastRunAt: "2026-01-01T06:00:00.000Z",
      error: null,
      stage: null,
      provider: null,
      durationMs: 1234,
    };
    await writeCanaryResult(sample, redis);
    const readback = await getLastCanaryResult(redis);
    assert.deepEqual(readback, sample);
  });

  it("writeCanaryResult + getLastCanaryResult roundtrips a fail result", async () => {
    const sample: CanaryResult = {
      status: "fail",
      lastRunAt: "2026-01-02T06:00:00.000Z",
      error: "Model not found",
      stage: "text_generation",
      provider: "gemini",
      durationMs: 5000,
    };
    await writeCanaryResult(sample, redis);
    const readback = await getLastCanaryResult(redis);
    assert.deepEqual(readback, sample);
  });

  it("writeCanaryResult sets a 7-day TTL", async () => {
    const sample: CanaryResult = {
      status: "pass",
      lastRunAt: new Date().toISOString(),
      error: null,
      stage: null,
      provider: null,
      durationMs: 100,
    };
    await writeCanaryResult(sample, redis);
    const ttl = await redis.ttl("canary:last_result");
    // TTL should be ~7 days (604800s); allow a window for test execution lag
    assert.ok(ttl > 604700 && ttl <= 604800, `Expected TTL ~604800, got ${ttl}`);
  });
});

// ── runCanary success path ────────────────────────────────────────────────────

describe("runCanary — success path", () => {
  it("stores a pass result in Redis when both generators succeed", async () => {
    await redis.del("canary:last_result");

    const notifyCalls: Array<[string, string, string]> = [];

    await runCanary(makeTestDeps({
      textGen: async () => "x".repeat(MIN_ARTICLE_CHARS + 50),
      imageGen: async () => MIN_IMAGE_BYTES + 100,
      notifyAdmins: async (stage, provider, msg) => { notifyCalls.push([stage, provider, msg]); },
    }));

    const result = await getLastCanaryResult(redis);
    assert.equal(result.status, "pass");
    assert.ok(result.lastRunAt !== null);
    assert.equal(result.error, null);
    assert.equal(result.stage, null);
    assert.equal(notifyCalls.length, 0, "No notification sent on pass");
  });

  it("records positive durationMs on pass", async () => {
    await runCanary(makeTestDeps({
      textGen: async () => "y".repeat(MIN_ARTICLE_CHARS + 10),
      imageGen: async () => MIN_IMAGE_BYTES + 1,
    }));
    const result = await getLastCanaryResult(redis);
    assert.ok(typeof result.durationMs === "number" && result.durationMs >= 0);
  });
});

// ── runCanary failure path ────────────────────────────────────────────────────

describe("runCanary — failure path", () => {
  it("stores fail result with correct stage when text generation throws", async () => {
    const notifyCalls: Array<{ stage: string; provider: string; message: string }> = [];

    await runCanary(makeTestDeps({
      textGen: async () => { throw new Error("Model gemini-x is not found"); },
      imageGen: async () => MIN_IMAGE_BYTES + 100,
      notifyAdmins: async (stage, provider, message) => { notifyCalls.push({ stage, provider, message }); },
    }));

    const result = await getLastCanaryResult(redis);
    assert.equal(result.status, "fail");
    assert.equal(result.stage, "text_generation");
    assert.equal(result.provider, "gemini");
    assert.ok(result.error?.includes("gemini-x"), "error message preserved");
  });

  it("stores fail result with stage=image_generation when image gen returns too few bytes", async () => {
    const notifyCalls: Array<{ stage: string }> = [];

    await runCanary(makeTestDeps({
      textGen: async () => "z".repeat(MIN_ARTICLE_CHARS + 10),
      imageGen: async () => MIN_IMAGE_BYTES - 1,
      notifyAdmins: async (stage) => { notifyCalls.push({ stage }); },
    }));

    const result = await getLastCanaryResult(redis);
    assert.equal(result.status, "fail");
    assert.equal(result.stage, "image_generation");
    assert.equal(notifyCalls[0]?.stage, "image_generation");
  });

  it("invokes notifyAdmins with stage, provider, and error message on failure", async () => {
    const notifyCalls: Array<{ stage: string; provider: string; message: string }> = [];

    await runCanary(makeTestDeps({
      textGen: async () => { throw new Error("404 model deprecated"); },
      imageGen: async () => MIN_IMAGE_BYTES + 100,
      notifyAdmins: async (stage, provider, message) => { notifyCalls.push({ stage, provider, message }); },
    }));

    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0]!.stage, "text_generation");
    assert.equal(notifyCalls[0]!.provider, "gemini");
    assert.ok(notifyCalls[0]!.message.includes("404 model deprecated"));
  });

  it("still writes fail result to Redis even if notifyAdmins itself throws", async () => {
    await runCanary(makeTestDeps({
      textGen: async () => { throw new Error("generation error"); },
      imageGen: async () => MIN_IMAGE_BYTES,
      notifyAdmins: async () => { throw new Error("DB offline"); },
    }));

    const result = await getLastCanaryResult(redis);
    assert.equal(result.status, "fail");
  });

  it("truncates error messages longer than 500 chars", async () => {
    await runCanary(makeTestDeps({
      textGen: async () => { throw new Error("e".repeat(600)); },
      imageGen: async () => MIN_IMAGE_BYTES,
    }));

    const result = await getLastCanaryResult(redis);
    assert.ok((result.error?.length ?? 0) <= 500);
  });
});
