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

test("worker readiness waits for every durable scheduler", async () => {
  const values = new Map<string, string>();
  const redis = {
    set: async (key: string, value: string) => { values.set(key, value); },
    get: async (key: string) => values.get(key) ?? null,
    del: async (key: string) => { values.delete(key); },
  } as any;

  await beginWorkerReadiness(redis);
  await markWorkerModelsReady(redis);
  await markWorkerRegistration(redis, "pipeline-workers");
  for (const scheduler of [
    "job-monitor",
    "provider-circuit",
    "spend-breaker",
    "scheduled-content",
    "canary",
    "reservation-sweeper",
    "brief",
  ]) {
    await markWorkerScheduler(redis, scheduler);
  }
  assert.equal((await readWorkerReadiness(redis))?.ready, false);
  await markWorkerScheduler(redis, "job-recovery");
  assert.equal((await readWorkerReadiness(redis))?.ready, true);
});