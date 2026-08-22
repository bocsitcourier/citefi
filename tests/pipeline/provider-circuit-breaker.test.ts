/**
 * Provider circuit breaker integration tests.
 *
 * Uses Redis DB 15 so actual BullMQ pause/resume operations cannot affect the
 * development workers using the default Redis DB.
 *
 * Run:
 *   redis-server --daemonize yes --save '' --appendonly no
 *   WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379/15 \
 *     node --env-file=.env.local --import tsx/esm --test \
 *     tests/pipeline/provider-circuit-breaker.test.ts
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

process.env.REDIS_URL = "redis://127.0.0.1:6379/15";

const queueModule = await import("../../lib/queue");
const breaker = await import("../../lib/provider-circuit-breaker");
const { PipelineError } = await import("../../lib/errors");
const redis = queueModule.getRedisConnection();

const noNotify = async () => {};
const healthySpend = async () => "ok" as const;

function providerError(provider: "gemini" | "openai") {
  return new PipelineError(
    `${provider} 503 service unavailable`,
    "PROVIDER_ERROR",
    "retry",
    "text_gen",
    provider,
  );
}

async function allProtectedQueues() {
  return [...new Set(Object.values(breaker.PROVIDER_QUEUES).flat())];
}

beforeEach(async () => {
  await redis.flushdb();
  await Promise.all((await allProtectedQueues()).map((name) => queueModule.getQueue(name).resume()));
});

after(async () => {
  await redis.flushdb();
  await Promise.all((await allProtectedQueues()).map((name) => queueModule.getQueue(name).resume()));
  await queueModule.closeQueues();
});

test("opens at five failures in two minutes and pauses every Gemini queue", async () => {
  for (let i = 0; i < 4; i++) {
    await breaker.recordProviderFailure("article-generation", providerError("gemini"), { notify: noNotify });
  }
  assert.equal((await breaker.getProviderCircuitStatus()).gemini.status, "closed");
  assert.equal(await queueModule.getQueue("article-generation").isPaused(), false);
  const ttl = await redis.ttl("provider-circuit:gemini:failures");
  assert.ok(ttl > 0 && ttl <= 120, `expected a two-minute failure window, got TTL ${ttl}`);

  let notifications = 0;
  await breaker.recordProviderFailure("article-generation", providerError("gemini"), {
    notify: async () => { notifications++; },
  });

  const state = (await breaker.getProviderCircuitStatus()).gemini;
  assert.equal(state.status, "open");
  assert.equal(state.failures, 5);
  assert.equal(notifications, 1);
  for (const name of breaker.PROVIDER_QUEUES.gemini) {
    assert.equal(await queueModule.getQueue(name).isPaused(), true, `${name} should be paused`);
  }
});

test("successful probe closes the circuit, clears failures, and resumes queues", async () => {
  for (let i = 0; i < 5; i++) {
    await breaker.recordProviderFailure("article-generation", providerError("gemini"), { notify: noNotify });
  }
  let recoveryNotifications = 0;
  await breaker.probeOpenProviderCircuits({
    probe: async () => ({ ok: true }),
    notify: async () => { recoveryNotifications++; },
    getSpendStatus: healthySpend,
  });

  const state = (await breaker.getProviderCircuitStatus()).gemini;
  assert.equal(state.status, "closed");
  assert.equal(state.failures, 0);
  assert.equal(recoveryNotifications, 1);
  for (const name of breaker.PROVIDER_QUEUES.gemini) {
    assert.equal(await queueModule.getQueue(name).isPaused(), false, `${name} should be resumed`);
  }
});

test("shared queues stay paused until both provider circuits recover", async () => {
  for (let i = 0; i < 5; i++) {
    await breaker.recordProviderFailure("article-generation", providerError("gemini"), { notify: noNotify });
    await breaker.recordProviderFailure("article-generation", providerError("openai"), { notify: noNotify });
  }

  await breaker.probeOpenProviderCircuits({
    probe: async (provider) => provider === "gemini"
      ? { ok: true }
      : { ok: false, error: "still unavailable" },
    notify: noNotify,
    getSpendStatus: healthySpend,
  });

  const states = await breaker.getProviderCircuitStatus();
  assert.equal(states.gemini.status, "closed");
  assert.equal(states.openai.status, "open");
  assert.equal(await queueModule.getQueue("article-generation").isPaused(), true);
  assert.equal(await queueModule.getQueue("intelligence-research").isPaused(), false);
});

test("provider recovery never overrides a platform spend pause", async () => {
  for (let i = 0; i < 5; i++) {
    await breaker.recordProviderFailure("article-generation", providerError("openai"), { notify: noNotify });
  }

  await breaker.probeOpenProviderCircuits({
    probe: async () => ({ ok: true }),
    notify: noNotify,
    getSpendStatus: async () => "generation_paused",
  });

  assert.equal((await breaker.getProviderCircuitStatus()).openai.status, "closed");
  for (const name of breaker.PROVIDER_QUEUES.openai) {
    assert.equal(await queueModule.getQueue(name).isPaused(), true, `${name} must remain spend-paused`);
  }
});