import assert from "node:assert/strict";
import test from "node:test";
import { Queue } from "bullmq";
import Redis from "ioredis";

const { addPodcastGenerationJob } = await import("../lib/queue");

void test("podcast helper uses a legal deterministic ID with a real isolated Queue.add", async () => {
  const port = Number(process.env.LOCAL_TEST_REDIS_PORT ?? "6379");
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "Invalid local test Redis port");
  const connection = new Redis({
    host: "127.0.0.1",
    port,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
  const queueName = `test-podcast-add-${Date.now()}-${process.pid}`;
  const queue = new Queue(queueName, { connection });
  const creditRunId = "podcast:4242:request-key-with-extra:colons";

  try {
    const jobId = await addPodcastGenerationJob(
      {
        articleId: 4242,
        teamId: 7,
        userId: 9,
        creditRunId,
        tone: "Conversational",
        duration: "120",
      },
      { queue }
    );

    assert.ok(jobId);
    assert.equal(jobId.split(":").length, 3);
    assert.match(jobId, /^podcast:4242:[a-f0-9]{64}$/);
    const stored = await queue.getJob(jobId);
    assert.ok(stored, "real Queue.add must persist the deterministic podcast job");
    assert.equal(stored.data.creditRunId, creditRunId);
    await stored.remove();

    // Exercise the production ambiguity lookup around a real Redis write: the
    // command commits, then the caller observes a synthetic lost response.
    const secondRunId = "podcast:4242:accepted-response-lost";
    const realAdd = queue.add.bind(queue);
    queue.add = (async (...args: Parameters<typeof queue.add>) => {
      await realAdd(...args);
      throw new Error("synthetic socket timeout after Redis accepted Queue.add");
    }) as typeof queue.add;
    const recoveredJobId = await addPodcastGenerationJob(
      {
        articleId: 4242,
        teamId: 7,
        userId: 9,
        creditRunId: secondRunId,
      },
      { queue }
    );
    assert.ok(recoveredJobId);
    assert.equal(recoveredJobId.split(":").length, 3);
    const recovered = await queue.getJob(recoveredJobId);
    assert.ok(recovered, "acceptance lookup must recover the real committed job");
    assert.equal(recovered.data.creditRunId, secondRunId);
    await recovered.remove();
  } finally {
    await queue.close();
    await connection.quit();
  }
});