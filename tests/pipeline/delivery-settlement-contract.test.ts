import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";

import {
  BillingSettlementError,
  createPipelineHandler,
} from "../../lib/pipeline-worker";
import {
  beginWorkerReadiness,
  markWorkerModelsReady,
  markWorkerRegistration,
  markWorkerScheduler,
  readWorkerReadiness,
} from "../../lib/ops/worker-readiness";

test("typed delivery settlement failure retains reservation on final attempt", async () => {
  const cause = new Error("database unavailable");
  const settlementError = new BillingSettlementError(
    "delivered media debit failed",
    "reservation-123",
    cause
  );
  let releases = 0;
  const handler = createPipelineHandler(
    "delivered-media",
    async () => {
      throw settlementError;
    },
    {
      stage: "video_gen",
      execution: undefined as never,
      getBilling: () => ({ teamId: 7, runId: "reservation-123" }),
      _deps: {
        releaseReservation: async () => {
          releases += 1;
        },
        recordProviderFailure: async () => {},
      },
    }
  );

  const job = {
    id: "settlement-job",
    data: {},
    attemptsMade: 2,
    opts: { attempts: 3 },
  } as Job<unknown>;
  await assert.rejects(() => handler(job), (error: unknown) => {
    assert.equal(error, settlementError);
    assert.equal(settlementError.reservationRunId, "reservation-123");
    assert.equal(settlementError.cause, cause);
    return true;
  });
  assert.equal(releases, 0);
});

test("fatal quality rejection releases a reserved credit once without provider settlement", async () => {
  let releases = 0;
  let providerFailureRecords = 0;
  const qualityError = Object.assign(
    new Error("QUALITY_GATE_FAILED: final review rejected output"),
    { code: "QUALITY_GATE_FAILED" as const },
  );
  const handler = createPipelineHandler(
    "quality-rejection",
    async () => {
      throw qualityError;
    },
    {
      stage: "text_gen",
      execution: undefined as never,
      getBilling: () => ({
        teamId: 7,
        runId: "quality-reservation-123",
        amount: 10,
        releaseKey: "quality-rejection:job",
      }),
      _deps: {
        releaseReservation: async () => {
          releases += 1;
        },
        recordProviderFailure: async () => {
          providerFailureRecords += 1;
        },
      },
    },
  );
  const job = {
    id: "quality-rejection-job",
    data: {},
    attemptsMade: 0,
    opts: { attempts: 1 },
  } as Job<unknown>;

  await assert.rejects(() => handler(job), (error: unknown) => {
    assert.equal((error as { message?: string }).message?.includes("QUALITY_GATE_FAILED"), true);
    return true;
  });
  assert.equal(releases, 1, "terminal quality failure releases the customer reservation");
  assert.equal(providerFailureRecords, 1, "only failure telemetry is recorded; no provider work is replayed");
});

test("worker readiness waits for every durable scheduler", async () => {
  const values = new Map<string, string>();
  const redis = {
    set: async (key: string, value: string) => { values.set(key, value); },
    get: async (key: string) => values.get(key) ?? null,
    del: async (key: string) => { values.delete(key); },
  } as any;

  const requiredSchedulers = [
    "job-monitor",
    "provider-circuit",
    "spend-breaker",
    "scheduled-content",
    "canary",
    "reservation-sweeper",
    "brief",
    "job-recovery",
    "stripe-credit-reconciliation",
  ];

  for (const omitted of requiredSchedulers) {
    await beginWorkerReadiness(redis);
    await markWorkerModelsReady(redis);
    await markWorkerRegistration(redis, "pipeline-workers");
    for (const scheduler of requiredSchedulers) {
      if (scheduler !== omitted) await markWorkerScheduler(redis, scheduler);
    }
    assert.equal(
      (await readWorkerReadiness(redis))?.ready,
      false,
      `readiness must wait for ${omitted}`,
    );
  }

  await markWorkerScheduler(redis, requiredSchedulers.at(-1)!);
  assert.equal((await readWorkerReadiness(redis))?.ready, true);
});