import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";
import {
  ArticleRunLeaseConflictError,
  BillingSettlementError,
  createPipelineHandler,
  drainWorkers,
  type CloseableWorker,
} from "../../lib/pipeline-worker";
import { findJobAfterAmbiguousEnqueue } from "../../lib/queue";
import {
  getArticleResumePlan,
  nextSettlementAttemptAt,
  protectsDeliveredReservation,
} from "../../lib/article-run-state";
import { summarizeBatchArticleStatuses } from "../../server/job-monitor";

test("ambiguous enqueue is accepted when the BullMQ job appears during confirmation", async () => {
  let lookups = 0;
  const expected = { id: "run-1" } as Job;
  const queue = {
    async getJob() {
      lookups += 1;
      return lookups >= 2 ? expected : undefined;
    },
  };
  const sleeps: number[] = [];

  const result = await findJobAfterAmbiguousEnqueue(
    queue as any,
    "run-1",
    async (ms) => { sleeps.push(ms); }
  );

  assert.equal(result, expected);
  assert.deepEqual(sleeps, [100]);
});

test("ambiguous enqueue is absent only after every confirmation lookup", async () => {
  let lookups = 0;
  const queue = {
    async getJob() {
      lookups += 1;
      return undefined;
    },
  };

  const result = await findJobAfterAmbiguousEnqueue(
    queue as any,
    "run-missing",
    async () => {}
  );

  assert.equal(result, null);
  assert.equal(lookups, 4);
});

test("billing settlement failures never release a delivered reservation", async () => {
  let releases = 0;
  const handler = createPipelineHandler(
    "article-generation",
    async () => {
      throw new BillingSettlementError("debit unavailable");
    },
    {
      stage: "text_gen",
      execution: { scope: "system", reason: "restart-safety test" },
      getBilling: () => ({ teamId: 1, runId: "credit-run" }),
      _deps: {
        releaseReservation: async () => { releases += 1; },
        recordProviderFailure: async () => {},
      },
    }
  );
  const job = {
    id: "article-run",
    attemptsMade: 2,
    opts: { attempts: 3 },
  } as Job;

  await assert.rejects(() => handler(job), BillingSettlementError);
  assert.equal(releases, 0);
});

test("lease conflicts never release a reservation on the final attempt", async () => {
  let releases = 0;
  const handler = createPipelineHandler(
    "article-generation",
    async () => {
      throw new ArticleRunLeaseConflictError("previous delivery still owns the run");
    },
    {
      stage: "text_gen",
      execution: { scope: "system", reason: "restart-safety test" },
      getBilling: () => ({ teamId: 1, runId: "credit-run" }),
      _deps: {
        releaseReservation: async () => { releases += 1; },
        recordProviderFailure: async () => {},
      },
    }
  );
  const job = {
    id: "article-run",
    attemptsMade: 2,
    opts: { attempts: 3 },
  } as Job;

  await assert.rejects(() => handler(job), ArticleRunLeaseConflictError);
  assert.equal(releases, 0);
});

test("worker drain waits gracefully when active processors finish", async () => {
  const calls: Array<boolean | undefined> = [];
  const worker: CloseableWorker = {
    async close(force) { calls.push(force); },
  };

  const result = await drainWorkers([worker], 100);

  assert.deepEqual(result, { drained: 1, forced: 0, timedOut: false });
  assert.deepEqual(calls, [false]);
});

test("worker drain force-closes local resources after the deadline", async () => {
  const calls: Array<boolean | undefined> = [];
  const worker: CloseableWorker = {
    close(force) {
      calls.push(force);
      return force ? Promise.resolve() : new Promise<void>(() => {});
    },
  };

  const result = await drainWorkers([worker], 5);

  assert.deepEqual(result, { drained: 0, forced: 1, timedOut: true });
  assert.deepEqual(calls, [false, true]);
});

test("resume plan skips every durable stage and enters settlement-only mode", () => {
  const now = new Date();
  const plan = getArticleResumePlan({
    run: {
      status: "billing_pending",
      geminiGeneratedAt: now,
      chatgptReviewedAt: now,
      textGeneratedAt: now,
      imageGeneratedAt: now,
      cachedGpt4Output: { finalHtml: "<article>done</article>" },
    },
    article: {
      articleStatus: "COMPLETE",
      finalHtmlContent: "<article>done</article>",
    },
  });

  assert.deepEqual(plan, {
    skipGemini: true,
    skipChatgpt: true,
    skipGpt4: true,
    skipImage: true,
    settlementOnly: true,
  });
});

test("legacy intermediate states skip only stages with durable evidence", () => {
  const plan = getArticleResumePlan({
    run: { status: "failed" },
    article: {
      articleStatus: "CHATGPT_REVIEWED",
      finalHtmlContent: "saved",
    },
  });

  assert.equal(plan.skipGemini, true);
  assert.equal(plan.skipChatgpt, true);
  assert.equal(plan.skipGpt4, false);
  assert.equal(plan.skipImage, false);
  assert.equal(plan.settlementOnly, false);
});

test("DEAD articles are terminal for batch reconciliation", () => {
  assert.deepEqual(
    summarizeBatchArticleStatuses(["COMPLETE", "DEAD", "FAILED"]),
    {
      totalArticles: 3,
      completedArticles: 1,
      failedArticles: 2,
      terminalArticles: 3,
      finalStatus: "PARTIAL_COMPLETE",
    }
  );
  assert.equal(
    summarizeBatchArticleStatuses(["DEAD", "FAILED"]).finalStatus,
    "FAILED"
  );
});

test("settlement retries back off and never exceed six hours", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");
  assert.equal(
    nextSettlementAttemptAt(0, now).toISOString(),
    "2026-08-22T12:05:00.000Z"
  );
  assert.equal(
    nextSettlementAttemptAt(20, now).toISOString(),
    "2026-08-22T18:00:00.000Z"
  );
});

test("the stale reservation sweeper protects only delivered settlement runs", () => {
  const base = {
    billingRunId: "credit-run",
    reservationRunId: "credit-run",
  };
  assert.equal(
    protectsDeliveredReservation({
      ...base,
      articleRunStatus: "billing_pending",
      articleStatus: "COMPLETE",
    }),
    true
  );
  assert.equal(
    protectsDeliveredReservation({
      ...base,
      articleRunStatus: "running",
      articleStatus: "COMPLETE",
    }),
    true
  );
  assert.equal(
    protectsDeliveredReservation({
      ...base,
      articleRunStatus: "running",
      articleStatus: "GEMINI_COMPLETE",
    }),
    false
  );
  assert.equal(
    protectsDeliveredReservation({
      ...base,
      articleRunStatus: "failed",
      articleStatus: "FAILED",
    }),
    false
  );
});