import assert from "node:assert/strict";
import test from "node:test";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { ISOLATED_TEST_REDIS_PORT } from "../helpers/isolated-redis";

import {
  InvalidQueueCustomIdError,
  addIntelligenceResearchJob,
  addPublishingJob,
  addSocialPostJob,
  canonicalQueueJobId,
  enqueueQueueJob,
  enqueueQueueJobs,
  intelligenceResearchJobId,
  publishingGenerationJobId,
  socialPostGenerationJobId,
} from "../../lib/queue";

void test("canonical queue ids and enqueue validation reject unsafe custom ids", async () => {
  const calls: unknown[][] = [];
  const queue = {
    add: async (...args: unknown[]) => {
      calls.push(args);
      return { id: String((args[2] as { jobId?: string })?.jobId ?? "auto") } as never;
    },
  } as unknown as Pick<Queue, "add">;

  const first = canonicalQueueJobId("contract", "request:one");
  const second = canonicalQueueJobId("contract", "requestone");
  assert.match(first, /^[a-z0-9_-]+$/);
  assert.ok(!/^\d+$/.test(first));
  assert.notEqual(first, second, "distinct opaque keys must not collide");
  assert.equal(first, canonicalQueueJobId("contract", "request:one"));

  await assert.rejects(
    enqueueQueueJob(queue, "invalid-colon", {}, { jobId: "legacy:1" }),
    (error: unknown) =>
      error instanceof InvalidQueueCustomIdError &&
      error.code === "INVALID_QUEUE_CUSTOM_ID",
  );
  await assert.rejects(
    enqueueQueueJob(queue, "invalid-number", {}, { jobId: "12345" }),
    InvalidQueueCustomIdError,
  );
  await enqueueQueueJob(queue, "already-valid", {}, { jobId: "Existing.Stable" });
  assert.equal(calls.length, 1, "validation must happen before Queue.add");
});

void test("real isolated Redis queue preserves canonical ids, bulk ids, dedupe, and billing data", async () => {
  const connection = new Redis({
    host: "127.0.0.1",
    port: ISOLATED_TEST_REDIS_PORT,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
  const queue = new Queue(`queue-custom-id-contract-${Date.now()}-${process.pid}`, {
    connection,
  });
  const addedIds = new Set<string>();
  const creditRunId = "credit:run:must-remain-byte-for-byte";

  try {
    await assert.rejects(
      enqueueQueueJob(queue, "invalid-real-id", {}, { jobId: "legacy:501" }),
      InvalidQueueCustomIdError,
    );
    await assert.rejects(
      enqueueQueueJobs(queue, [{
        name: "invalid-real-bulk-id",
        data: {},
        opts: { jobId: "legacy:bulk:501" },
      }]),
      InvalidQueueCustomIdError,
    );

    const bulkIds = [
      canonicalQueueJobId("bulk", "first:opaque"),
      canonicalQueueJobId("bulk", "second:opaque"),
    ];
    const bulkJobs = await enqueueQueueJobs(queue, bulkIds.map((jobId, index) => ({
      name: "bulk-contract",
      data: { index, creditRunId },
      opts: { jobId },
    })));
    for (const [index, job] of bulkJobs.entries()) {
      assert.equal(job.id, bulkIds[index]);
      assert.equal(job.data.creditRunId, creditRunId);
      addedIds.add(job.id!);
    }

    const publishingId = await addPublishingJob(
      { dbJobId: 501, teamId: 7 },
      { queue },
    );
    assert.equal(publishingId, publishingGenerationJobId(501));
    assert.ok(publishingId && !publishingId.includes(":"));
    addedIds.add(publishingId!);

    const intelligenceId = await addIntelligenceResearchJob(
      {
        teamId: 7,
        websiteUrl: "https://example.test",
        companyName: "Contract Fixture",
        campaignId: 502,
      },
      { queue },
    );
    assert.equal(intelligenceId, intelligenceResearchJobId(502));
    assert.ok(intelligenceId && !intelligenceId.includes(":"));
    addedIds.add(intelligenceId!);

    const singletonKey = "social:7:request:key:with:colons";
    const socialId = await addSocialPostJob(
      {
        socialPostId: 503,
        userId: 9,
        teamId: 7,
        prompt: "isolated queue contract",
        platforms: ["linkedin"],
        creditRunId,
      },
      { singletonKey },
      { queue },
    );
    assert.equal(socialId, socialPostGenerationJobId(singletonKey));
    assert.ok(socialId && !socialId.includes(":"));
    assert.equal((await queue.getJob(socialId!))?.data.creditRunId, creditRunId);
    addedIds.add(socialId!);

    const duplicate = await addSocialPostJob(
      {
        socialPostId: 503,
        userId: 9,
        teamId: 7,
        prompt: "isolated queue contract",
        platforms: ["linkedin"],
        creditRunId,
      },
      { singletonKey },
      { queue },
    );
    assert.equal(duplicate, null, "same dedupe identity must suppress duplicates");
  } finally {
    for (const id of addedIds) {
      await queue.getJob(id).then((job) => job?.remove());
    }
    await queue.close();
    await connection.quit();
  }
});