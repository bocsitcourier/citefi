import assert from "node:assert/strict";
import { test } from "node:test";
import { Queue } from "bullmq";
import { ISOLATED_TEST_REDIS_PORT } from "../helpers/isolated-redis";

test("video idea and social video enqueue ids are BullMQ-safe on localhost", { timeout: 15_000 }, async () => {
  // This contract test is deliberately isolated from the application Redis URL.
  // It creates no worker and never invokes a provider.
  const {
    addVideoGenerationJob,
    addVideoIdeaJob,
    getSocialVideoJobIdCandidatesForRunId,
    getVideoIdeaJobIdCandidatesForRunId,
  } = await import("../../lib/queue");

  const connection = {
    host: "127.0.0.1",
    port: ISOLATED_TEST_REDIS_PORT,
    maxRetriesPerRequest: null,
  } as const;
  const ideaQueue = new Queue(`video-idea-id-contract-${Date.now()}`, { connection });
  const socialQueue = new Queue(`social-video-id-contract-${Date.now()}`, { connection });
  const added: Array<{ queue: typeof ideaQueue; id: string }> = [];
  const runId = `video:local-id-contract:${Date.now()}`;

  try {
    const ideaStableId = await addVideoIdeaJob({
      videoIdeaId: 999999,
      teamId: 1,
      userId: 1,
      creditRunId: runId,
    }, { queue: ideaQueue });
    const ideaRandomId = await addVideoIdeaJob({
      videoIdeaId: 999998,
      teamId: 1,
      userId: 1,
    }, { queue: ideaQueue });
    const socialStableId = await addVideoGenerationJob({
      socialPostId: 999999,
      teamId: 1,
      userId: 1,
      creditRunId: runId,
    }, undefined, { queue: socialQueue });
    const socialRandomId = await addVideoGenerationJob({
      socialPostId: 999998,
      teamId: 1,
      userId: 1,
    }, undefined, { queue: socialQueue });

    for (const [queue, id] of [
      [ideaQueue, ideaStableId],
      [ideaQueue, ideaRandomId],
      [socialQueue, socialStableId],
      [socialQueue, socialRandomId],
    ] as const) {
      assert.equal(typeof id, "string");
      assert.ok(id && !id.includes(":"), `BullMQ id must be colon-free: ${id}`);
      const stored = await queue.getJob(id);
      assert.ok(stored, `enqueued job ${id} must be retrievable`);
      if (stored?.data.creditRunId) {
        assert.equal(
          stored.data.creditRunId,
          runId,
          "queue migration must not rewrite the durable credit identity",
        );
      }
      added.push({ queue, id });
    }

    const ideaCandidates = getVideoIdeaJobIdCandidatesForRunId(runId);
    const socialCandidates = getSocialVideoJobIdCandidatesForRunId(runId);
    assert.ok(!ideaCandidates[0]!.includes(":"));
    assert.ok(!socialCandidates[0]!.includes(":"));
    assert.equal(ideaCandidates[1], `video-idea:${runId}`);
    assert.equal(socialCandidates[1], `video:${runId}`);
  } finally {
    // Remove only the four jobs created by this test; never clear the queue.
    for (const { queue, id } of added) {
      await queue.getJob(id).then((job) => job?.remove());
    }
    await ideaQueue.close();
    await socialQueue.close();
  }
});