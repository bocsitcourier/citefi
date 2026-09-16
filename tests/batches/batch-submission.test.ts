import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BatchSubmissionLatch,
  compensateBatchEnqueueFailure,
  createBatchSubmissionKey,
  inspectBatchSubmissionReplay,
  validateBatchSubmissionKey,
} from "../../lib/batch-submission";
import { batchSubmitSchema } from "../../lib/batch-submission-validation";
import {
  AmbiguousBatchEnqueueError,
  enqueueBatchGenerationJob,
} from "../../lib/queue";

void describe("batch submission idempotency", () => {
  const validPayload = {
    batchId: 28,
    selectedTitles: ["A usable title"],
    targetUrl: "https://example.test",
    businessName: "Example",
  };

  void test("rejects missing, non-integer, and non-positive batch IDs", () => {
    for (const batchId of [undefined, 0, -1, 1.5, Number.NaN]) {
      const parsed = batchSubmitSchema.safeParse({ ...validPayload, batchId });
      assert.equal(parsed.success, false, `batchId ${String(batchId)} must be rejected`);
    }
  });

  void test("rejects empty selected title values", () => {
    assert.equal(
      batchSubmitSchema.safeParse({ ...validPayload, selectedTitles: ["   "] }).success,
      false,
    );
  });

  void test("deduplicates titles before costing and enforces title/count limits", () => {
    const duplicate = batchSubmitSchema.parse({
      ...validPayload,
      selectedTitles: [" First ", "First", "Second"],
    });
    assert.deepEqual(duplicate.selectedTitles, ["First", "Second"]);
    assert.equal(batchSubmitSchema.safeParse({
      ...validPayload,
      selectedTitles: ["x".repeat(256)],
    }).success, false);
    assert.equal(batchSubmitSchema.safeParse({
      ...validPayload,
      selectedTitles: Array.from({ length: 101 }, (_, index) => `Title ${index}`),
    }).success, false);
  });

  void test("creates a batch-scoped header-safe operation key", () => {
    const key = createBatchSubmissionKey(
      42,
      () => "11111111-2222-4333-8444-555555555555",
    );
    assert.equal(
      key,
      "batch-submit:42:11111111-2222-4333-8444-555555555555",
    );
    assert.equal(validateBatchSubmissionKey(key), key);
  });

  void test("rejects malformed or oversized keys before submission is claimed", () => {
    assert.throws(
      () => validateBatchSubmissionKey("contains spaces"),
      /Invalid batch submission idempotency key/,
    );
    assert.throws(
      () => validateBatchSubmissionKey("x".repeat(201)),
      /Invalid batch submission idempotency key/,
    );
  });

  void test("blocks a second click synchronously and reuses the key on retry", () => {
    const latch = new BatchSubmissionLatch();
    const first = latch.begin(28);
    assert.ok(first);
    assert.equal(latch.begin(28), null, "same-render double click must be blocked");

    latch.finish(first);
    const retry = latch.begin(28);
    assert.ok(retry);
    assert.equal(
      retry.idempotencyKey,
      first.idempotencyKey,
      "an explicit retry must preserve operation identity",
    );

    latch.finish(retry);
    latch.reset();
    const newAttempt = latch.begin(28);
    assert.ok(newAttempt);
    assert.notEqual(newAttempt.idempotencyKey, first.idempotencyKey);
  });

  void test("starts a new operation identity after a definitive compensated queue failure", () => {
    const latch = new BatchSubmissionLatch();
    const failed = latch.begin(28);
    assert.ok(failed);
    latch.finish(failed, false);

    const retry = latch.begin(28);
    assert.ok(retry);
    assert.notEqual(retry.idempotencyKey, failed.idempotencyKey);
  });

  void test("replays an accepted acknowledgement for the same durable key", () => {
    assert.deepEqual(inspectBatchSubmissionReplay({
      batchId: 28,
      status: "QUEUED",
      idempotencyKey: "same-key",
      generationParams: {
        submission: {
          idempotencyKey: "same-key",
          state: "ACCEPTED",
          jobId: "batch:28",
        },
      },
    }), {
      outcome: "accepted",
      jobId: "batch:28",
    });
    assert.equal(inspectBatchSubmissionReplay({
      batchId: 28,
      status: "QUEUED",
      idempotencyKey: "different-key",
      generationParams: {
        submission: { idempotencyKey: "same-key", state: "ACCEPTED" },
      },
    }).outcome, "not_match");
    assert.equal(inspectBatchSubmissionReplay({
      batchId: 28,
      status: "CANCELLED",
      idempotencyKey: "same-key",
      generationParams: {
        submission: { idempotencyKey: "same-key", state: "ACCEPTED" },
      },
    }).outcome, "terminal");
  });
});

void test("an unconfirmed Redis write is classified as ambiguous, never rejected", async () => {
  const lookupIds: string[] = [];
  let addCalls = 0;
  const queue = {
    add: async () => {
      addCalls++;
      throw new Error("connection reset after write");
    },
    getJob: async (jobId: string) => {
      lookupIds.push(jobId);
      return undefined;
    },
  };
  await assert.rejects(
    enqueueBatchGenerationJob(queue as never, {
      batchId: 28,
      userId: 1,
      teamId: 1,
      selectedTitles: ["Title"],
      targetUrl: "https://example.test",
      businessName: "Example",
    }),
    (error: unknown) =>
      error instanceof AmbiguousBatchEnqueueError &&
      error.jobId === "batch-28",
  );
  assert.equal(addCalls, 1);
  assert.deepEqual(lookupIds, [
    "batch:28",
    "batch-28",
    "batch-28",
    "batch-28",
    "batch-28",
  ]);
});

void test("a found legacy batch job is reused before attempting a new enqueue", async () => {
  let addCalls = 0;
  const queue = {
    add: async () => {
      addCalls++;
      throw new Error("legacy lookup should have returned first");
    },
    getJob: async (jobId: string) =>
      jobId === "batch:28" ? { id: "batch:28" } : undefined,
  };

  const result = await enqueueBatchGenerationJob(queue as never, {
    batchId: 28,
    userId: 1,
    teamId: 1,
    selectedTitles: ["Title"],
    targetUrl: "https://example.test",
    businessName: "Example",
  });

  assert.equal(result, "batch:28");
  assert.equal(addCalls, 0);
});

void describe("batch enqueue compensation", () => {
  void test("releases both holds before making the batch retryable", async () => {
    const calls: string[] = [];
    const result = await compensateBatchEnqueueFailure({
      releaseCredits: async () => { calls.push("credits"); },
      releaseCap: async () => { calls.push("cap"); },
      markRetryable: async () => { calls.push("retryable"); },
    });

    assert.deepEqual(calls, ["credits", "cap", "retryable"]);
    assert.deepEqual(result, {
      creditsReleased: true,
      capReleased: true,
      retryEnabled: true,
    });
  });

  void test("does not enable retry when credit release fails", async () => {
    const calls: string[] = [];
    const result = await compensateBatchEnqueueFailure({
      releaseCredits: async () => {
        calls.push("credits");
        throw new Error("database unavailable");
      },
      releaseCap: async () => { calls.push("cap"); },
      markRetryable: async () => { calls.push("retryable"); },
    });

    assert.deepEqual(calls, ["credits", "cap"]);
    assert.deepEqual(result, {
      creditsReleased: false,
      capReleased: true,
      retryEnabled: false,
    });
  });
});