import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * Source contracts for the durable article/batch cap handoff. These checks are
 * intentionally side-effect free: they do not enqueue work or call providers.
 */
void test("batch cap ownership survives orchestration until child settlement", async () => {
  const worker = await readFile(
    new URL("../../lib/worker.ts", import.meta.url),
    "utf8",
  );
  const queue = await readFile(
    new URL("../../lib/queue.ts", import.meta.url),
    "utf8",
  );
  const billing = await readFile(
    new URL("../../lib/pipeline-billing.ts", import.meta.url),
    "utf8",
  );

  assert.match(queue, /capReservationScope\?: "batch" \| "article"/);
  const batchStart = worker.indexOf("export async function processBatchGenerationJob");
  assert.notEqual(batchStart, -1);
  const firstChildEnqueue = worker.indexOf("await enqueueArticle({", batchStart);
  assert.notEqual(firstChildEnqueue, -1);
  assert.doesNotMatch(
    worker.slice(batchStart, firstChildEnqueue),
    /cancelCapReservation\(/,
    "a shared cap cannot be cancelled before the first child is enqueued",
  );
  assert.match(
    worker.slice(batchStart),
    /generationParams:[\s\S]*capReservationId:[\s\S]*capReservationScope: "batch"/,
    "the batch row must durably retain aggregate cap ownership",
  );
  assert.match(
    worker.slice(firstChildEnqueue, worker.length),
    /capReservationId:[\s\S]*capReservationScope: "batch"/,
    "every child payload must carry the aggregate reservation scope",
  );
  assert.match(
    billing,
    /capReservationScope === "batch"[\s\S]*?\? null/,
    "generic child failure cleanup must not cancel the aggregate cap",
  );
});

void test("billing recovery settles cap without provider re-entry", async () => {
  const worker = await readFile(
    new URL("../../lib/worker.ts", import.meta.url),
    "utf8",
  );
  const runState = await readFile(
    new URL("../../lib/article-run-state.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    worker,
    /claim\.previousStatus === "billing_pending"[\s\S]*?completeCapReservation/,
    "worker recovery must settle a cap after an idempotent debit",
  );
  assert.match(
    runState,
    /settleRecoveredArticleCap[\s\S]*?completeCapReservation/,
    "monitor recovery must settle the cap without regenerating content",
  );
  assert.match(
    worker,
    /articleStatus: "COMPLETE"[\s\S]*?errorMessage: null/,
    "successful article writes must clear stale error text",
  );
});