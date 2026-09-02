import assert from "node:assert/strict";
import test from "node:test";
import {
  collectHealth,
  DEFAULT_HEALTH_THRESHOLDS,
  safeMessage,
  type HealthDependencies,
} from "../../lib/ops/health";
import { assertPortAvailable } from "../../lib/ops/port-guard";
import {
  canaryAccountingIsConfigured,
  canaryAccountingIsRequired,
  isDevelopmentCanaryOnlyUnready,
  type WorkerReadinessState,
} from "../../lib/ops/worker-readiness";

const NOW = Date.parse("2026-02-20T12:00:00.000Z");

function healthyDeps(): HealthDependencies {
  return {
    now: () => NOW,
    database: async () => {},
    redis: async () => {},
    workerHeartbeat: async () => new Date(NOW - 1_000).toISOString(),
    workerReadiness: async () => ({
      ready: true,
      registeredAt: new Date(NOW - 2_000).toISOString(),
      releaseVersion: "test",
      requiredRegistrations: { "pipeline-workers": true },
      requiredSchedulers: { "job-monitor": true, "provider-circuit": true, "spend-breaker": true },
      modelsReady: true,
      failureReason: null,
    }),
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
    models: async () => ({ ready: true }),
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

test("fails closed for missing required storage, models, backup, and worker registration", async () => {
  const deps = healthyDeps();
  deps.storage = async () => ({ configured: false, providers: { doSpaces: false } });
  deps.models = async () => ({ ready: false, message: "critical tier unresolved" });
  deps.backupStatus = async () => null;
  deps.workerReadiness = async () => ({
    ready: false,
    registeredAt: null,
    releaseVersion: "test",
    requiredRegistrations: { "pipeline-workers": false },
    requiredSchedulers: { "job-monitor": true },
    modelsReady: false,
    failureReason: "required registration failed",
  });
  const report = await collectHealth(deps);
  assert.equal(report.ok, false);
  for (const name of ["storage", "models", "backup", "worker"]) {
    assert.equal((report.services[name] as { status: string }).status, "fail");
  }
});

test("disabled media is explicit and does not require storage", async () => {
  const deps = healthyDeps();
  deps.storage = async () => ({ configured: false, providers: { doSpaces: false } });
  const report = await collectHealth(deps, DEFAULT_HEALTH_THRESHOLDS, {
    mediaEnabled: false,
    storageRequired: false,
    backupRequired: true,
    modelsRequired: true,
  });
  assert.equal(report.ok, true);
  assert.deepEqual(
    {
      status: (report.services.storage as { status: string }).status,
      reason: (report.services.storage as { reason: string }).reason,
    },
    { status: "skipped", reason: "disabled-by-policy" },
  );
});

test("occupied port fails deterministically without terminating its owner", async () => {
  let probes = 0;
  await assert.rejects(
    assertPortAvailable(5000, async () => {
      probes += 1;
      return false;
    }),
    /Port 5000 is already in use; refusing to terminate an unowned process/,
  );
  assert.equal(probes, 1);
});

test("canary accounting remains fail-closed in production and certification", () => {
  assert.equal(canaryAccountingIsConfigured(undefined), false);
  assert.equal(canaryAccountingIsConfigured("0"), false);
  assert.equal(canaryAccountingIsConfigured("42"), true);
  assert.equal(canaryAccountingIsRequired({ NODE_ENV: "production" }), true);
  assert.equal(canaryAccountingIsRequired({ NODE_ENV: "development", READINESS_CERTIFICATION: "true" }), true);
  assert.equal(canaryAccountingIsRequired({ NODE_ENV: "development", DEPLOY_ENVIRONMENT: "staging" }), true);
  assert.equal(canaryAccountingIsRequired({ NODE_ENV: "development" }), false);
});

test("development can keep workers alive only for an explicitly disabled canary", async () => {
  const state: WorkerReadinessState = {
    version: 1,
    ready: false,
    releaseVersion: "test",
    startedAt: new Date(NOW).toISOString(),
    registeredAt: null,
    updatedAt: new Date(NOW).toISOString(),
    requiredRegistrations: { "pipeline-workers": true },
    requiredSchedulers: {
      "job-monitor": true,
      "provider-circuit": true,
      "spend-breaker": true,
      "scheduled-content": true,
      canary: false,
      "reservation-sweeper": true,
      brief: true,
      "job-recovery": true,
    },
    disabledSchedulers: {
      canary: "CANARY_ACCOUNTING_TEAM_ID is missing; real-provider canary disabled in development",
    },
    modelsReady: true,
    failureReason: null,
  };
  assert.equal(isDevelopmentCanaryOnlyUnready(state, { NODE_ENV: "development" }), true);

  const deps = healthyDeps();
  deps.workerReadiness = async () => state;
  const report = await collectHealth(deps);
  assert.equal(report.ok, false);
  assert.equal((report.services.worker as { status: string }).status, "fail");
  assert.match(
    (report.services.worker as { message: string }).message,
    /canary: CANARY_ACCOUNTING_TEAM_ID is missing/,
  );

  state.requiredSchedulers["job-recovery"] = false;
  assert.equal(isDevelopmentCanaryOnlyUnready(state, { NODE_ENV: "development" }), false);
});