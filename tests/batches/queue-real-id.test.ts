import assert from "node:assert/strict";
import { test } from "node:test";
import { Queue } from "bullmq";
import { startIsolatedRedis } from "../helpers/isolated-redis";
import {
  articleGenerationJobId,
  articleQueueJobId,
  batchGenerationJobId,
  dailyBriefGenerationJobId,
  enqueueQueueJob,
  enqueueDailyBriefJob,
  enqueueBatchGenerationJob,
  findArticleGenerationJob,
  imageGenerationJobId,
  InvalidQueueCustomIdError,
} from "../../lib/queue";

void test("installed BullMQ accepts stable batch, article, and image IDs", async () => {
  // Never consume an application/provider URL in an isolated destructive test.
  const isolated = await startIsolatedRedis();
  const redis = isolated.connection;
  const queue = new Queue(`batch-id-regression-${Date.now()}`, { connection: redis });
  try {
    const batchId = await enqueueBatchGenerationJob(queue, {
      batchId: 280,
      userId: 1,
      teamId: 1,
      selectedTitles: ["One"],
      targetUrl: "https://example.test",
      businessName: "Regression",
    });
    const articleRunId = articleGenerationJobId(280, 91);
    const articleId = articleQueueJobId(articleRunId);
    const imageId = imageGenerationJobId(91, articleRunId);
    await queue.add("article", { articleId: 91 }, { jobId: articleId });
    await queue.add("image", { articleId: 91 }, { jobId: imageId });

    assert.equal(batchId, batchGenerationJobId(280));
    assert.ok(await queue.getJob(batchGenerationJobId(280)));
    assert.ok(await queue.getJob(articleId));
    assert.equal((await findArticleGenerationJob(articleRunId, queue))?.id, articleId);
    assert.ok(await queue.getJob(imageId));
    await assert.rejects(
      enqueueQueueJob(queue, "legacy-invalid", {}, { jobId: "batch:280" }),
      InvalidQueueCustomIdError,
    );

    // Exercise the real local Redis path without starting any provider worker.
    const briefQueue = new Queue(`daily-brief-id-regression-${Date.now()}`, {
      connection: redis,
    });
    try {
      const briefId = await enqueueDailyBriefJob(briefQueue, {
        userId: 1,
        teamId: 1,
        localDate: "2099-01-02",
        force: true,
      });
      assert.equal(
        briefId,
        dailyBriefGenerationJobId(1, "2099-01-02", true),
      );
      assert.ok(briefId && !briefId.includes(":"));
      assert.ok(await briefQueue.getJob(briefId));
      // The installed BullMQ version permits some three-segment colon IDs.
      // Our common enqueue boundary must reject them regardless of vendor
      // parser behavior.
      const vendorLegacyJob = await briefQueue.add(
        "legacy-vendor-fixture",
        {},
        { jobId: "daily-brief:1:2099-01-02" },
      );
      assert.equal(vendorLegacyJob.id, "daily-brief:1:2099-01-02");
      await vendorLegacyJob.remove();
      await assert.rejects(
        enqueueQueueJob(
          briefQueue,
          "legacy-invalid-brief",
          {},
          { jobId: "daily-brief:1:2099-01-02" },
        ),
        InvalidQueueCustomIdError,
      );
    } finally {
      await briefQueue.obliterate({ force: true });
      await briefQueue.close();
    }
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
    await isolated.stop();
  }
});