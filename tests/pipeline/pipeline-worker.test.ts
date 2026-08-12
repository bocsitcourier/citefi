/**
 * Unit tests for createPipelineHandler — the single policy point for all
 * BullMQ workers (error taxonomy, budget gate, final-attempt credit release).
 *
 * Run: WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm --test tests/pipeline/pipeline-worker.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnrecoverableError } from "bullmq";
import { createPipelineHandler } from "../../lib/pipeline-worker";

type AnyJob = any;

function makeJob(overrides: Partial<{ attemptsMade: number; attempts: number; data: any }> = {}): AnyJob {
  return {
    id: "job-1",
    data: { teamId: 7, creditRunId: "run-abc", articleId: 42, ...(overrides.data ?? {}) },
    opts: { attempts: overrides.attempts ?? 3 },
    attemptsMade: overrides.attemptsMade ?? 0,
  };
}

function deps() {
  const calls: any[] = [];
  return {
    calls,
    _deps: {
      releaseReservation: async (args: any) => { calls.push(args); },
      assertRunBudget: async () => {},
    },
  };
}

const billingOpts = {
  stage: "text_gen",
  getBilling: (j: AnyJob) => ({ teamId: j.data.teamId, runId: j.data.creditRunId }),
};

test("transient failure on NON-final attempt: no release, original error rethrown", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("503 service unavailable"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 0, attempts: 3 })), /503/);
  assert.equal(d.calls.length, 0, "reservation must be preserved for the retry");
});

test("transient failure on FINAL attempt: releases reservation exactly once", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("503 service unavailable"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3 })));
  assert.equal(d.calls.length, 1, "release must fire exactly once on the final attempt");
  assert.equal(d.calls[0].teamId, 7);
  assert.equal(d.calls[0].runId, "run-abc");
});

test("full retry lifecycle (3 attempts): release fires exactly once total", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("ETIMEDOUT"); },
    { ...billingOpts, _deps: d._deps } as any);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(() => handler(makeJob({ attemptsMade: attempt, attempts: 3 })));
  }
  assert.equal(d.calls.length, 1, "exactly one release across the whole retry lifecycle");
});

test("fatal error: releases immediately and throws UnrecoverableError", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("401 unauthorized: invalid api key"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(
    () => handler(makeJob({ attemptsMade: 0, attempts: 3 })),
    (err: unknown) => err instanceof UnrecoverableError
  );
  assert.equal(d.calls.length, 1, "fatal errors release on the first attempt (no more retries will run)");
});

test("DEBIT_FAILED: never releases (content was delivered; only the debit retries)", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => {
    throw new Error("[billing] DEBIT_FAILED for article 42 — retrying debit");
  }, { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3 })));
  assert.equal(d.calls.length, 0, "DEBIT_FAILED must not refund a delivered product");
});

test("no billing info (missing runId): final failure does not call release", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("boom"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3, data: { teamId: 7, creditRunId: undefined } })));
  assert.equal(d.calls.length, 0);
});

test("budget gate: BUDGET_EXCEEDED from assertRunBudget is fatal and releases once", async () => {
  const calls: any[] = [];
  const handler = createPipelineHandler("q", async () => "never reached", {
    ...billingOpts,
    budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
    _deps: {
      releaseReservation: async (args: any) => { calls.push(args); },
      assertRunBudget: async () => {
        const { PipelineError } = await import("../../lib/errors");
        throw new PipelineError("run spent $0.20 >= ceiling $0.15", "BUDGET_EXCEEDED", "fatal", "text_gen");
      },
    },
  } as any);
  await assert.rejects(
    () => handler(makeJob({ attemptsMade: 0, attempts: 3 })),
    (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message)
  );
  assert.equal(calls.length, 1, "budget-exceeded runs must release the reservation");
});

test("success path: processor result returned, no release", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => ({ ok: true }),
    { ...billingOpts, _deps: d._deps } as any);
  const result = await handler(makeJob());
  assert.deepEqual(result, { ok: true });
  assert.equal(d.calls.length, 0);
});
