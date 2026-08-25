import assert from "node:assert/strict";
import test from "node:test";
import {
  collectHealth,
  DEFAULT_HEALTH_THRESHOLDS,
  safeMessage,
  type HealthDependencies,
} from "../../lib/ops/health";

const NOW = Date.parse("2026-02-20T12:00:00.000Z");

function healthyDeps(): HealthDependencies {
  return {
    now: () => NOW,
    database: async () => {},
    redis: async () => {},
    workerHeartbeat: async () => new Date(NOW - 1_000).toISOString(),
    queues: async () => ({
      "article-generation": { waiting: 0, active: 1, failed: 0 },
    }),
    providerCircuits: async () => ({
      gemini: { status: "closed" },
      openai: { status: "closed" },
    }),
    canary: async () => ({
      result: {
        status: "pass",
        lastRunAt: new Date(NOW - 60_000).toISOString(),
        error: null,
        stage: null,
        provider: null,
        durationMs: 20,
      },
      health: { ok: true, stale: false, reason: null },
    }),
    storage: async () => ({ configured: true, providers: { doSpaces: true } }),
    backupStatus: async () => ({
      state: "success",
      completedAt: new Date(NOW - 60_000).toISOString(),
    }),
    deploymentStatus: async () => ({
      state: "success",
      timestamp: new Date(NOW - 60_000).toISOString(),
    }),
    recentCriticalErrors: async () => 0,
  };
}

test("reports all injected controls healthy", async () => {
  const report = await collectHealth(healthyDeps());
  assert.equal(report.status, "healthy");
  assert.equal(report.ok, true);
  assert.equal((report.services.database as { status: string }).status, "ok");
  assert.equal((report.services.storage as { configured: boolean }).configured, true);
});

test("reports threshold warnings as degraded without failing readiness", async () => {
  const deps = healthyDeps();
  deps.queues = async () => ({
    "article-generation": {
      waiting: DEFAULT_HEALTH_THRESHOLDS.queueWaitingWarn,
      active: 0,
      failed: 0,
    },
  });
  const report = await collectHealth(deps);
  assert.equal(report.status, "degraded");
  assert.equal(report.ok, true);
  assert.equal((report.services.queues as { status: string }).status, "degraded");
});

test("never-run canary fails readiness while an active deployment alone only degrades", async () => {
  const deps = healthyDeps();
  deps.deploymentStatus = async () => ({ state: "deploying", updatedAt: new Date(NOW).toISOString() });
  const deploying = await collectHealth(deps);
  assert.equal(deploying.status, "degraded");
  assert.equal(deploying.ok, true);
  assert.equal((deploying.services.deployment as { status: string }).status, "degraded");

  deps.canary = async () => ({
    result: { status: "never_run", lastRunAt: null },
    health: { ok: false, stale: true, reason: "Canary has never completed" },
  });
  const report = await collectHealth(deps);
  assert.equal(report.status, "unhealthy");
  assert.equal(report.ok, false);
  assert.equal((report.services.canary as { status: string }).status, "fail");
});

test("reports stale heartbeat, open circuit, and queue threshold as failure", async () => {
  const deps = healthyDeps();
  deps.workerHeartbeat = async () =>
    new Date(NOW - DEFAULT_HEALTH_THRESHOLDS.workerStaleMs - 1).toISOString();
  deps.providerCircuits = async () => ({ gemini: { status: "open" } });
  deps.queues = async () => ({
    "article-generation": {
      waiting: DEFAULT_HEALTH_THRESHOLDS.queueWaitingFail,
      active: 0,
      failed: 0,
    },
  });
  const report = await collectHealth(deps);
  assert.equal(report.status, "unhealthy");
  assert.equal(report.ok, false);
  assert.equal((report.services.worker as { status: string }).status, "fail");
  assert.equal((report.services.providerCircuits as { status: string }).status, "fail");
});

test("bounds, redacts, and fails timed out checks deterministically", async () => {
  const deps = healthyDeps();
  deps.database = () => new Promise<void>(() => {});
  const report = await collectHealth(deps, {
    ...DEFAULT_HEALTH_THRESHOLDS,
    timeoutMs: 5,
  });
  assert.equal(report.status, "unhealthy");
  assert.match(
    (report.services.database as { message: string }).message,
    /database timed out/,
  );
  const safe = safeMessage(
    new Error("postgres://alice:hunter2@db/private?token=abcdef\n" + "x".repeat(300)),
  );
  assert.equal(safe.includes("hunter2"), false);
  assert.equal(safe.includes("abcdef"), false);
  assert.ok(safe.length <= 160);
});