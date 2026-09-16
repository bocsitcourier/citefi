import assert from "node:assert/strict";
import test from "node:test";
import { Queue } from "bullmq";
import { startIsolatedRedis } from "./helpers/isolated-redis";

const {
  addPodcastGenerationJob,
  findPodcastGenerationJobAfterAmbiguousEnqueue,
  podcastGenerationJobIdEnqueueCandidates,
  podcastGenerationJobIdCandidates,
} = await import("../lib/queue");

void test("podcast helper uses a legal deterministic ID with a real isolated Queue.add", async () => {
  const isolated = await startIsolatedRedis();
  const connection = isolated.connection;
  const queueName = `test-podcast-add-${Date.now()}-${process.pid}`;
  const queue = new Queue(queueName, { connection });
  const creditRunId = "podcast:4242:request-key-with-extra:colons";
  const candidates = podcastGenerationJobIdCandidates(4242, creditRunId);
  assert.equal(candidates.length, 3);
  assert.match(candidates[0]!, /^podcast-[a-f0-9]{64}$/);
  assert.match(candidates[1]!, /^podcast:4242:[a-f0-9]{64}$/);
  assert.equal(candidates[2], "podcast:4242");
  assert.deepEqual(
    podcastGenerationJobIdEnqueueCandidates(4242, creditRunId),
    candidates.slice(0, 2),
  );
  const noCreditCandidates = podcastGenerationJobIdEnqueueCandidates(4242);
  assert.match(noCreditCandidates[0]!, /^podcast-[a-f0-9]{64}$/);
  assert.deepEqual(noCreditCandidates.slice(1), ["podcast:4242"]);

  try {
    const jobId = await addPodcastGenerationJob(
      {
        articleId: 4242,
        teamId: 7,
        userId: 9,
        creditRunId,
        capReservationId: 222,
        tone: "Conversational",
        duration: "120",
      },
      { queue }
    );

    assert.ok(jobId);
    assert.ok(!jobId.includes(":"));
    assert.match(jobId, /^podcast-[a-f0-9]{64}$/);
    const stored = await queue.getJob(jobId);
    assert.ok(stored, "real Queue.add must persist the deterministic podcast job");
    assert.equal(stored.data.creditRunId, creditRunId);
    assert.equal(stored.data.capReservationId, 222);
    await stored.remove();

    // Historical credit-scoped IDs remain lookup-only and are returned without
    // being normalized or re-hashed as a new queue id.
    const legacyRunId = "podcast:4242:legacy-run";
    const legacyId = podcastGenerationJobIdCandidates(4242, legacyRunId)[1]!;
    await queue.add("podcast", { articleId: 4242, teamId: 7, creditRunId: legacyRunId }, {
      jobId: legacyId,
    });
    const preservedLegacyId = await addPodcastGenerationJob(
      { articleId: 4242, teamId: 7, creditRunId: legacyRunId },
      { queue },
    );
    assert.equal(preservedLegacyId, legacyId);
    await queue.getJob(legacyId).then((legacyJob) => legacyJob?.remove());

    // The broad article-scoped legacy id can belong to an unrelated historical
    // reservation. It must neither suppress nor satisfy ambiguity recovery for
    // a newer credit-scoped attempt.
    const genericLegacyId = "podcast:4242";
    const genericLegacyJob = {
      id: genericLegacyId,
      data: {
        articleId: 4242,
        teamId: 7,
        creditRunId: "podcast:4242:unrelated-old",
      },
    };
    const newCreditRunId = "podcast:4242:new-credit-reservation";
    const newCreditCandidates = podcastGenerationJobIdCandidates(4242, newCreditRunId);
    const ambiguityLookups: string[] = [];
    const historicalLookupQueue = {
      getJob: async (candidateId: string) => {
        ambiguityLookups.push(candidateId);
        if (candidateId === genericLegacyId) return genericLegacyJob;
        return queue.getJob(candidateId);
      },
    } as unknown as Pick<Queue, "getJob">;
    const unrelatedAmbiguous = await findPodcastGenerationJobAfterAmbiguousEnqueue(
      historicalLookupQueue,
      4242,
      newCreditRunId,
      async () => {},
    );
    assert.equal(unrelatedAmbiguous, null);
    assert.ok(!ambiguityLookups.includes(genericLegacyId));
    const enqueueLookups: string[] = [];
    const enqueueQueue = {
      getJob: async (candidateId: string) => {
        enqueueLookups.push(candidateId);
        if (candidateId === genericLegacyId) return genericLegacyJob;
        return queue.getJob(candidateId);
      },
      add: queue.add.bind(queue),
    } as unknown as import("bullmq").Queue;
    const newCreditJobId = await addPodcastGenerationJob(
      {
        articleId: 4242,
        teamId: 7,
        userId: 9,
        creditRunId: newCreditRunId,
        capReservationId: 823,
      },
      { queue: enqueueQueue },
    );
    assert.equal(newCreditJobId, newCreditCandidates[0]);
    assert.ok(!enqueueLookups.includes(genericLegacyId));
    const newCreditJob = await queue.getJob(newCreditJobId!);
    assert.ok(newCreditJob);
    assert.equal(newCreditJob.data.creditRunId, newCreditRunId);
    assert.equal(newCreditJob.data.capReservationId, 823);
    await newCreditJob.remove();
    await queue.getJob(genericLegacyId).then((genericJob) => genericJob?.remove());

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
    assert.ok(!recoveredJobId.includes(":"));
    assert.match(recoveredJobId, /^podcast-[a-f0-9]{64}$/);
    const recovered = await queue.getJob(recoveredJobId);
    assert.ok(recovered, "acceptance lookup must recover the real committed job");
    assert.equal(recovered.data.creditRunId, secondRunId);
    await recovered.remove();
  } finally {
    await queue.close();
    await isolated.stop();
  }
});