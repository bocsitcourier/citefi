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
    },
  };
}

const billingOpts = {
  stage: "text_gen",
  getBilling: (j: AnyJob) => ({ teamId: j.data.teamId, runId: j.data.creditRunId }),
};

void test("transient failure on NON-final attempt: no release, original error rethrown", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("503 service unavailable"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 0, attempts: 3 })), /503/);
  assert.equal(d.calls.length, 0, "reservation must be preserved for the retry");
});

void test("transient failure on FINAL attempt: releases reservation exactly once", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("503 service unavailable"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3 })));
  assert.equal(d.calls.length, 1, "release must fire exactly once on the final attempt");
  assert.equal(d.calls[0].teamId, 7);
  assert.equal(d.calls[0].runId, "run-abc");
});

void test("full retry lifecycle (3 attempts): release fires exactly once total", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("ETIMEDOUT"); },
    { ...billingOpts, _deps: d._deps } as any);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(() => handler(makeJob({ attemptsMade: attempt, attempts: 3 })));
  }
  assert.equal(d.calls.length, 1, "exactly one release across the whole retry lifecycle");
});

void test("fatal error: releases immediately and throws UnrecoverableError", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("401 unauthorized: invalid api key"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(
    () => handler(makeJob({ attemptsMade: 0, attempts: 3 })),
    (err: unknown) => err instanceof UnrecoverableError
  );
  assert.equal(d.calls.length, 1, "fatal errors release on the first attempt (no more retries will run)");
});

void test("DEBIT_FAILED: never releases (content was delivered; only the debit retries)", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => {
    throw new Error("[billing] DEBIT_FAILED for article 42 — retrying debit");
  }, { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3 })));
  assert.equal(d.calls.length, 0, "DEBIT_FAILED must not refund a delivered product");
});

void test("no billing info (missing runId): final failure does not call release", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("boom"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3, data: { teamId: 7, creditRunId: undefined } })));
  assert.equal(d.calls.length, 0);
});

void test("BUDGET_EXCEEDED thrown by processor (in-processor gate) is fatal and releases once", async () => {
  // The assertRunBudget gate lives inside processors' try blocks; when it
  // throws, the error flows through the processor catch (domain cleanup),
  // gets rethrown, and this wrapper must treat it as fatal + release.
  const d = deps();
  const handler = createPipelineHandler("q", async () => {
    const { PipelineError } = await import("../../lib/errors");
    throw new PipelineError("run spent $0.20 >= ceiling $0.15", "BUDGET_EXCEEDED", "fatal", "text_gen");
  }, {
    ...billingOpts,
    budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
    _deps: d._deps,
  } as any);
  await assert.rejects(
    () => handler(makeJob({ attemptsMade: 0, attempts: 3 })),
    (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message)
  );
  assert.equal(d.calls.length, 1, "budget-exceeded runs must release the reservation");
});

void test("success path: processor result returned, no release", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => ({ ok: true }),
    { ...billingOpts, _deps: d._deps } as any);
  const result = await handler(makeJob());
  assert.deepEqual(result, { ok: true });
  assert.equal(d.calls.length, 0);
});

void test("run-context identity: wrapper enters the SAME runId the processor's budget gate asserts", async () => {
  // Regression guard for the article ID-mismatch bug: telemetry attribution
  // (wrapper enterRunContext via budget.getRunId) and the in-processor
  // assertRunBudget gate must key off the same job-data field (creditRunId),
  // or the ceiling always sums $0 and never trips.
  const { currentRunId } = await import("../../lib/run-context");
  let observed: string | undefined;
  const handler = createPipelineHandler("q", async (job: AnyJob) => {
    observed = currentRunId();
    assert.equal(observed, job.data.creditRunId, "gate would query a different ID than telemetry records under");
    return "ok";
  }, {
    stage: "text_gen",
    budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
  } as any);
  await handler(makeJob());
  assert.equal(observed, "run-abc");
});

void test("recorded telemetry under the run ID trips the next attempt's budget gate (production ID path)", async () => {
  // End-to-end over the real DB: insert cost telemetry keyed by the run ID
  // (cost_telemetry.jobId), then run the article-shaped handler whose
  // processor calls the real assertRunBudget with the same creditRunId —
  // the gate must throw BUDGET_EXCEEDED, and the wrapper must release once
  // and convert it to UnrecoverableError.
  const { db } = await import("../../lib/db");
  const { costTelemetry } = await import("../../shared/schema");
  const { eq } = await import("drizzle-orm");
  const runId = `test-budget-${Date.now()}`;
  await db.insert(costTelemetry).values({
    jobId: runId,
    operationType: "article_generation",
    provider: "gemini",
    model: "test-model",
    costMicrousd: 100_000_000, // $100 — far above any content ceiling
    success: 1,
  });
  try {
    const d = deps();
    const handler = createPipelineHandler("q", async (job: AnyJob) => {
      // Mirrors the production article processor: gate inside the try,
      // keyed by the same creditRunId the wrapper attributed.
      const { assertRunBudget } = await import("../../lib/cost-ceilings");
      await assertRunBudget(job.data.creditRunId, "article", "text_gen");
      return "should not reach";
    }, {
      ...billingOpts,
      budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
      _deps: d._deps,
    } as any);
    await assert.rejects(
      () => handler(makeJob({ attemptsMade: 0, attempts: 3, data: { teamId: 7, creditRunId: runId } })),
      (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message)
    );
    assert.equal(d.calls.length, 1, "budget-tripped run must release its reservation exactly once");
    assert.equal(d.calls[0].runId, runId);
  } finally {
    await db.delete(costTelemetry).where(eq(costTelemetry.jobId, runId));
  }
});
