import assert from "node:assert/strict";
import { test } from "node:test";
import { Queue } from "bullmq";
import Redis from "ioredis";
import {
  articleGenerationJobId,
  articleQueueJobId,
  batchGenerationJobId,
  dailyBriefGenerationJobId,
  enqueueDailyBriefJob,
  enqueueBatchGenerationJob,
  findArticleGenerationJob,
  imageGenerationJobId,
} from "../../lib/queue";

void test("installed BullMQ accepts stable batch, article, and image IDs", async () => {
  // Never consume an application/provider URL in an isolated destructive test.
  const port = Number(process.env.LOCAL_TEST_REDIS_PORT ?? "6379");
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "Invalid local test Redis port");
  const redis = new Redis({
    host: "127.0.0.1",
    port,
    maxRetriesPerRequest: null,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
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
      queue.add("legacy-invalid", {}, { jobId: "batch:280" }),
      /Custom Id cannot contain :/,
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
      await assert.rejects(
        briefQueue.add(
          "legacy-invalid-brief",
          {},
          { jobId: "daily-brief:1:2099-01-02" },
        ),
        /Custom Id cannot contain :/,
      );
    } finally {
      await briefQueue.obliterate({ force: true });
      await briefQueue.close();
    }
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
    await redis.quit();
  }
});