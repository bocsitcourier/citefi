/**
 * Deterministic single-process integration tests for the daily model canary.
 *
 * Node 20.20's built-in test runner intermittently corrupts child-process IPC
 * when this real-Redis TypeScript suite is loaded through tsx, reporting:
 * "Unable to deserialize cloned data due to invalid or unsupported version."
 * Running these checks sequentially in one process avoids that upstream runner
 * defect while preserving all assertions and external Redis behavior.
 *
 * Run:
 *   redis-server --daemonize yes --save '' --appendonly no
 *   npm run test:canary
 */

import assert from "node:assert/strict";
import { UnrecoverableError, type Job } from "bullmq";
import Redis from "ioredis";
import {
  CANARY_JOB_OPTIONS,
  CANARY_SCHEDULE_PATTERN,
  CANARY_STALE_AFTER_MS,
  MIN_ARTICLE_CHARS,
  MIN_IMAGE_BYTES,
  evaluateCanaryHealth,
  getLastCanaryResult,
  runCanary,
  writeCanaryResult,
  type CanaryDeps,
  type CanaryResult,
} from "../../lib/canary-worker";
import { createPipelineHandler } from "../../lib/pipeline-worker";
import { getRedisClientConfig, normalizeRedisUrl } from "../../lib/queue";

const TEST_REDIS_URL = "redis://127.0.0.1:6379/14";
const redis = new Redis(TEST_REDIS_URL, {
  maxRetriesPerRequest: 0,
  enableReadyCheck: false,
});

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.info(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(err);
  }
}

const noop = async () => {};
const noopLog = async () => {};

function makeTestDeps(overrides: Partial<CanaryDeps> = {}): CanaryDeps {
  return {
    notifyAdmins: noop,
    logError: noopLog,
    redis,
    ...overrides,
  };
}

async function readResult(): Promise<CanaryResult> {
  return getLastCanaryResult(redis);
}

async function main(): Promise<void> {
  await redis.flushdb();

  await check("normal redis:// URL remains unchanged", () => {
    assert.deepEqual(normalizeRedisUrl("redis://127.0.0.1:6379"), {
      url: "redis://127.0.0.1:6379",
      tls: false,
    });
  });

  await check("rediss:// URL enables TLS", () => {
    assert.deepEqual(normalizeRedisUrl("rediss://host:6380"), {
      url: "rediss://host:6380",
      tls: true,
    });
  });

  await check("Replit ediss:// typo is normalized to rediss://", () => {
    assert.deepEqual(normalizeRedisUrl("ediss://host:6380/0"), {
      url: "rediss://host:6380/0",
      tls: true,
    });
  });

  await check("normalized TLS is included in every Redis client config", () => {
    const config = getRedisClientConfig("ediss://host:6380/0", {
      lazyConnect: true,
    });
    assert.equal(config.url, "rediss://host:6380/0");
    assert.deepEqual(config.options.tls, {});
    assert.equal(config.options.lazyConnect, true);
  });

  await check("Redis URL defaults to localhost when unset", () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      assert.equal(normalizeRedisUrl().url, "redis://127.0.0.1:6379");
    } finally {
      if (saved === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = saved;
    }
  });

  await check("missing persisted result reads as never_run", async () => {
    await redis.del("canary:last_result");
    const result = await readResult();
    assert.equal(result.status, "never_run");
    assert.equal(result.lastRunAt, null);
  });

  await check("pass results round-trip through Redis", async () => {
    const sample: CanaryResult = {
      status: "pass",
      lastRunAt: "2026-01-01T06:00:00.000Z",
      error: null,
      stage: null,
      provider: null,
      durationMs: 1234,
    };
    await writeCanaryResult(sample, redis);
    assert.deepEqual(await readResult(), sample);
  });

  await check("fail results round-trip through Redis", async () => {
    const sample: CanaryResult = {
      status: "fail",
      lastRunAt: "2026-01-02T06:00:00.000Z",
      error: "Model not found",
      stage: "text_generation",
      provider: "gemini",
      durationMs: 5000,
    };
    await writeCanaryResult(sample, redis);
    assert.deepEqual(await readResult(), sample);
  });

  await check("persisted result has a seven-day TTL", async () => {
    await writeCanaryResult({
      status: "pass",
      lastRunAt: new Date().toISOString(),
      error: null,
      stage: null,
      provider: null,
      durationMs: 100,
    }, redis);
    const ttl = await redis.ttl("canary:last_result");
    assert.ok(ttl > 604700 && ttl <= 604800, `unexpected TTL ${ttl}`);
  });

  await check("successful text and image checks persist pass", async () => {
    let notificationCount = 0;
    await runCanary(makeTestDeps({
      textGen: async () => "x".repeat(MIN_ARTICLE_CHARS + 50),
      imageGen: async () => MIN_IMAGE_BYTES + 100,
      notifyAdmins: async () => { notificationCount += 1; },
    }));
    const result = await readResult();
    assert.equal(result.status, "pass");
    assert.equal(result.error, null);
    assert.equal(notificationCount, 0);
  });

  await check("text provider failure persists stage and rejects the job", async () => {
    await assert.rejects(runCanary(makeTestDeps({
      textGen: async () => { throw new Error("Model gemini-x is not found"); },
      imageGen: async () => MIN_IMAGE_BYTES + 100,
    })), /gemini-x/);
    const result = await readResult();
    assert.equal(result.status, "fail");
    assert.equal(result.stage, "text_generation");
    assert.equal(result.provider, "gemini");
  });

  await check("short image persists image_generation failure", async () => {
    await assert.rejects(runCanary(makeTestDeps({
      textGen: async () => "z".repeat(MIN_ARTICLE_CHARS + 10),
      imageGen: async () => MIN_IMAGE_BYTES - 1,
    })), /Image response too small/);
    assert.equal((await readResult()).stage, "image_generation");
  });

  await check("failure report includes stage, provider, and message", async () => {
    const reports: Array<[string, string, string]> = [];
    await assert.rejects(runCanary(makeTestDeps({
      textGen: async () => { throw new Error("404 model deprecated"); },
      notifyAdmins: async (stage, provider, message) => {
        reports.push([stage, provider, message]);
      },
    })), /deprecated/);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.[0], "text_generation");
    assert.equal(reports[0]?.[1], "gemini");
    assert.match(reports[0]?.[2] ?? "", /deprecated/);
  });

  await check("notification failure cannot erase persisted failure", async () => {
    await assert.rejects(runCanary(makeTestDeps({
      textGen: async () => { throw new Error("generation error"); },
      notifyAdmins: async () => { throw new Error("DB offline"); },
    })), /generation error/);
    assert.equal((await readResult()).status, "fail");
  });

  await check("persisted error text is capped at 500 characters", async () => {
    await assert.rejects(runCanary(makeTestDeps({
      textGen: async () => { throw new Error("e".repeat(600)); },
    })));
    assert.ok(((await readResult()).error?.length ?? 0) <= 500);
  });

  await check("stalled generation aborts, persists timeout, and rejects", async () => {
    let observedAbort = false;
    await assert.rejects(runCanary(makeTestDeps({
      timeoutMs: 20,
      textGen: async (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            observedAbort = true;
            reject(new Error("aborted"));
          });
        }),
    })), /timed out/);
    const result = await readResult();
    assert.equal(observedAbort, true);
    assert.equal(result.status, "fail");
    assert.equal(result.stage, "text_generation");
    assert.match(result.error ?? "", /timed out/);
  });

  await check("BullMQ retry suppresses duplicate reports but persists failure", async () => {
    let reports = 0;
    await assert.rejects(runCanary(makeTestDeps({
      textGen: async () => { throw new Error("retry failure"); },
      reportFailure: false,
      notifyAdmins: async () => { reports += 1; },
      logError: async () => { reports += 1; },
    })), /retry failure/);
    assert.equal((await readResult()).status, "fail");
    assert.equal(reports, 0);
  });

  await check("scheduler is daily at 06:00 UTC with one retry", () => {
    assert.equal(CANARY_SCHEDULE_PATTERN, "0 6 * * *");
    assert.equal(CANARY_JOB_OPTIONS.attempts, 2);
    assert.deepEqual(CANARY_JOB_OPTIONS.backoff, {
      type: "fixed",
      delay: 5 * 60 * 1000,
    });
  });

  await check("fatal model errors use the canary retry budget and report once", async () => {
    let notifications = 0;
    let errorLogs = 0;
    let providerFailureRecords = 0;

    const processor = async (job: Job<Record<string, never>>) =>
      runCanary(makeTestDeps({
        textGen: async () => {
          throw new Error("404 model gemini-deprecated is not found");
        },
        reportFailure: job.attemptsMade === 0,
        notifyAdmins: async () => { notifications += 1; },
        logError: async () => { errorLogs += 1; },
      }));

    const handler = createPipelineHandler("canary", processor, {
      stage: "text_gen",
      retryFatalErrors: true,
      _deps: {
        recordProviderFailure: async () => {
          providerFailureRecords += 1;
        },
      },
    });

    const firstAttempt = {
      id: "canary-test",
      data: {},
      attemptsMade: 0,
      opts: { attempts: CANARY_JOB_OPTIONS.attempts },
    } as Job<Record<string, never>>;

    await assert.rejects(handler(firstAttempt), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err instanceof UnrecoverableError, false);
      assert.match(err.message, /model gemini-deprecated is not found/);
      return true;
    });

    const retryAttempt = {
      ...firstAttempt,
      attemptsMade: 1,
    } as Job<Record<string, never>>;

    await assert.rejects(handler(retryAttempt), (err: unknown) => {
      assert.ok(err instanceof UnrecoverableError);
      assert.match(err.message, /model gemini-deprecated is not found/);
      return true;
    });

    assert.equal(CANARY_JOB_OPTIONS.backoff.delay, 5 * 60 * 1000);
    assert.equal(notifications, 1);
    assert.equal(errorLogs, 1);
    assert.equal(providerFailureRecords, 2);
  });

  await check("never-run, failed, and stale canaries degrade health", () => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    assert.equal(evaluateCanaryHealth({
      status: "never_run", lastRunAt: null, error: null, stage: null,
      provider: null, durationMs: null,
    }, now).ok, false);
    assert.equal(evaluateCanaryHealth({
      status: "fail", lastRunAt: new Date(now).toISOString(), error: "down",
      stage: "text_generation", provider: "gemini", durationMs: 1,
    }, now).ok, false);
    assert.equal(evaluateCanaryHealth({
      status: "pass",
      lastRunAt: new Date(now - CANARY_STALE_AFTER_MS - 1).toISOString(),
      error: null, stage: null, provider: null, durationMs: 1,
    }, now).stale, true);
  });

  await check("fresh successful canary keeps health healthy", () => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    assert.deepEqual(evaluateCanaryHealth({
      status: "pass",
      lastRunAt: new Date(now - 60_000).toISOString(),
      error: null, stage: null, provider: null, durationMs: 1,
    }, now), { ok: true, stale: false, reason: null });
  });
}

try {
  await main();
} finally {
  await redis.flushdb().catch(() => {});
  redis.disconnect();
}

console.info(`\nCanary checks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;