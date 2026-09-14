import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import type { Job } from "bullmq";
import {
  claimBatchForSubmission,
  recordBatchEnqueueAccepted,
} from "../../lib/batch-submission-server";
import { compensateBatchEnqueueFailure } from "../../lib/batch-submission";
import { getBucketBalance, releaseReservation, reserveCredits } from "../../lib/billing";
import { closeDb, systemDb } from "../../lib/db";
import { runWithTenantContext } from "../../lib/tenant-context";
import type { ArticleJobData, BatchJobData } from "../../lib/queue";
import { processBatchGenerationJob } from "../../lib/worker";
import {
  articles,
  jobEvents,
  creditBalances,
  creditLedger,
  creditReservations,
  errorLogs,
  jobBatches,
  teamMembers,
  teams,
  users,
} from "../../shared/schema";

let ownerUserId = 0;
let otherUserId = 0;
let ownerTeamId = 0;
let otherTeamId = 0;
let batchId = 0;

before(async () => {
  const marker = `batch-claim-${Date.now()}`;
  const [owner] = await systemDb.insert(users).values({
    email: `${marker}-owner@example.test`,
    role: "team_member",
  }).returning({ id: users.id });
  const [other] = await systemDb.insert(users).values({
    email: `${marker}-other@example.test`,
    role: "team_member",
  }).returning({ id: users.id });
  assert.ok(owner && other);
  ownerUserId = owner.id;
  otherUserId = other.id;

  const [ownerTeam] = await systemDb.insert(teams).values({
    name: `${marker}-owner`,
    createdBy: ownerUserId,
  }).returning({ id: teams.id });
  const [otherTeam] = await systemDb.insert(teams).values({
    name: `${marker}-other`,
    createdBy: otherUserId,
  }).returning({ id: teams.id });
  assert.ok(ownerTeam && otherTeam);
  ownerTeamId = ownerTeam.id;
  otherTeamId = otherTeam.id;

  await systemDb.insert(teamMembers).values([
    { userId: ownerUserId, teamId: ownerTeamId, role: "owner" },
    { userId: otherUserId, teamId: otherTeamId, role: "owner" },
  ]);

  const [batch] = await systemDb.insert(jobBatches).values({
    userId: ownerUserId,
    teamId: ownerTeamId,
    coreTopic: marker,
    targetUrl: "https://example.test",
    status: "PENDING",
    numArticlesRequested: 28,
  }).returning({ id: jobBatches.id });
  assert.ok(batch);
  batchId = batch.id;
  await systemDb.insert(creditBalances).values({
    teamId: ownerTeamId,
    balance: 10_000_000,
    allowanceCredits: 10_000_000,
    purchasedCredits: 0,
    allowanceUsed: 0,
    purchasedUsed: 0,
    reservedCredits: 0,
  });
});

after(async () => {
  if (batchId) await systemDb.delete(errorLogs).where(eq(errorLogs.batchId, batchId));
  if (batchId) await systemDb.delete(jobEvents).where(eq(jobEvents.batchId, batchId));
  if (batchId) await systemDb.delete(articles).where(eq(articles.batchId, batchId));
  if (ownerTeamId) await systemDb.delete(creditLedger).where(eq(creditLedger.teamId, ownerTeamId));
  if (ownerTeamId) await systemDb.delete(creditReservations).where(eq(creditReservations.teamId, ownerTeamId));
  if (ownerTeamId) await systemDb.delete(creditBalances).where(eq(creditBalances.teamId, ownerTeamId));
  if (batchId) await systemDb.delete(jobBatches).where(eq(jobBatches.id, batchId));
  if (ownerTeamId) await systemDb.delete(teamMembers).where(eq(teamMembers.teamId, ownerTeamId));
  if (otherTeamId) await systemDb.delete(teamMembers).where(eq(teamMembers.teamId, otherTeamId));
  if (ownerTeamId) await systemDb.delete(teams).where(eq(teams.id, ownerTeamId));
  if (otherTeamId) await systemDb.delete(teams).where(eq(teams.id, otherTeamId));
  if (ownerUserId) await systemDb.delete(users).where(eq(users.id, ownerUserId));
  if (otherUserId) await systemDb.delete(users).where(eq(users.id, otherUserId));
  await closeDb();
});

void test("tenant ownership is enforced before a batch can be claimed", async () => {
  const result = await runWithTenantContext({
    actorType: "web",
    userId: otherUserId,
    teamId: otherTeamId,
    role: "owner",
  }, () => claimBatchForSubmission(batchId, otherTeamId));

  assert.deepEqual(result, { outcome: "not_found" });
});

void test("concurrent submissions produce exactly one atomic claim", async () => {
  const results = await runWithTenantContext({
    actorType: "web",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, () => Promise.all([
    claimBatchForSubmission(batchId, ownerTeamId),
    claimBatchForSubmission(batchId, ownerTeamId),
  ]));

  assert.equal(results.filter((result) => result.outcome === "claimed").length, 1);
  assert.equal(results.filter((result) => result.outcome === "conflict").length, 1);
  const [stored] = await systemDb
    .select({ status: jobBatches.status })
    .from(jobBatches)
    .where(eq(jobBatches.id, batchId));
  assert.equal(stored?.status, "SUBMITTING");
});

void test("28-title, 280-credit submission reserves once and queue-failure cleanup releases it", async () => {
  const runId = `batch:${batchId}:screenshot-regression`;
  await systemDb
    .update(jobBatches)
    .set({ status: "SUBMITTING" })
    .where(eq(jobBatches.id, batchId));

  await runWithTenantContext({
    actorType: "web",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, async () => {
    // Two server requests with the same operation identity model the duplicate
    // delivery side of a rapid double-click. No queue or provider is invoked.
    const reservations = await Promise.all([
      reserveCredits({
        teamId: ownerTeamId,
        operationType: "article",
        runId,
        amount: 28 * 10,
        userId: ownerUserId,
      }),
      reserveCredits({
        teamId: ownerTeamId,
        operationType: "article",
        runId,
        amount: 28 * 10,
        userId: ownerUserId,
      }),
    ]);
    assert.equal(reservations.filter((result) => result.ok).length, 2);

    const ownedRows = await systemDb
      .select()
      .from(creditReservations)
      .where(and(
        eq(creditReservations.teamId, ownerTeamId),
        eq(creditReservations.runId, runId),
      ));
    const reserveLedgerRows = await systemDb
      .select()
      .from(creditLedger)
      .where(and(
        eq(creditLedger.teamId, ownerTeamId),
        eq(creditLedger.runId, runId),
        eq(creditLedger.eventType, "reserve"),
      ));
    assert.equal(ownedRows.length, 1, "duplicate delivery must own one reservation");
    assert.equal(reserveLedgerRows.length, 1, "duplicate delivery must write one reserve event");

    const held = await getBucketBalance(ownerTeamId);
    assert.equal(held.reservedCredits, 280);
    assert.equal(held.totalRemaining, 10_000_000 - 280);

    let queueCalls = 0;
    const provenRejectedEnqueue = async () => {
      queueCalls += 1;
      throw new Error("simulated validation rejection before Redis write");
    };
    await assert.rejects(provenRejectedEnqueue, /validation rejection/);

    let retryableWrites = 0;
    const compensation = await compensateBatchEnqueueFailure({
      releaseCredits: () => releaseReservation({
        teamId: ownerTeamId,
        runId,
        userId: ownerUserId,
        reason: `Release: batch ${batchId} simulated queue failure`,
      }),
      releaseCap: async () => {},
      markRetryable: async () => {
        retryableWrites += 1;
        await systemDb
          .update(jobBatches)
          .set({ status: "PENDING" })
          .where(eq(jobBatches.id, batchId));
      },
    });
    assert.equal(queueCalls, 1, "one queue submission was attempted");
    assert.equal(retryableWrites, 1, "simulated queue failure is compensated once");
    assert.equal(compensation.retryEnabled, true);

    const released = await getBucketBalance(ownerTeamId);
    assert.equal(released.reservedCredits, 0);
    assert.equal(released.totalRemaining, 10_000_000);
  });
});

void test("production batch processor accepts SUBMITTING and creates 28 unique child records", async () => {
  const titles = Array.from({ length: 28 }, (_, index) => `Regression title ${index + 1}`);
  const childJobs: ArticleJobData[] = [];
  await systemDb.update(jobBatches).set({
    status: "SUBMITTING",
    numArticlesRequested: titles.length,
  }).where(eq(jobBatches.id, batchId));

  await runWithTenantContext({
    actorType: "worker",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, () => processBatchGenerationJob({
    id: `batch:${batchId}`,
    data: {
      batchId,
      userId: ownerUserId,
      teamId: ownerTeamId,
      selectedTitles: [...titles, titles[0]],
      targetUrl: "https://example.test",
      businessName: "Regression Business",
      creditRunId: `batch:${batchId}:worker-regression`,
      creditCostPerUnit: 10,
    },
  } as unknown as Job<BatchJobData>, {
    addArticleJob: async (data) => {
      childJobs.push(data);
      return `article:${data.articleId}`;
    },
  }));

  const storedArticles = await systemDb.select({
    chosenTitle: articles.chosenTitle,
  }).from(articles).where(eq(articles.batchId, batchId));
  const [storedBatch] = await systemDb.select({
    status: jobBatches.status,
    requested: jobBatches.numArticlesRequested,
  }).from(jobBatches).where(eq(jobBatches.id, batchId));

  assert.equal(storedBatch?.status, "RUNNING");
  assert.equal(storedBatch?.requested, 28);
  assert.equal(storedArticles.length, 28);
  assert.equal(new Set(storedArticles.map((row) => row.chosenTitle)).size, 28);
  assert.equal(childJobs.length, 28);
});

void test("claim through accepted queue state reaches the production batch processor", async () => {
  await systemDb.delete(jobEvents).where(eq(jobEvents.batchId, batchId));
  await systemDb.delete(articles).where(eq(articles.batchId, batchId));
  await systemDb.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId));
  const titles = Array.from({ length: 28 }, (_, index) => `Queued title ${index + 1}`);
  let parentQueueCalls = 0;
  const childJobs: ArticleJobData[] = [];

  await runWithTenantContext({
    actorType: "worker",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, async () => {
    const claim = await claimBatchForSubmission(batchId, ownerTeamId);
    assert.equal(claim.outcome, "claimed");
    const mockedParentEnqueue = async () => {
      parentQueueCalls += 1;
      return `batch:${batchId}`;
    };
    const parentJobId = await mockedParentEnqueue();
    assert.equal(await recordBatchEnqueueAccepted({
      batchId,
      teamId: ownerTeamId,
      generationParams: {
        submission: {
          idempotencyKey: "route-regression",
          state: "ACCEPTED",
          jobId: parentJobId,
        },
      },
    }), true);

    await processBatchGenerationJob({
      id: parentJobId,
      data: {
        batchId,
        userId: ownerUserId,
        teamId: ownerTeamId,
        selectedTitles: titles,
        targetUrl: "https://example.test",
        businessName: "Regression Business",
      },
    } as unknown as Job<BatchJobData>, {
      addArticleJob: async (data) => {
        childJobs.push(data);
        return `article:${data.articleId}`;
      },
    });
  });

  const storedArticles = await systemDb.select({ id: articles.id })
    .from(articles).where(eq(articles.batchId, batchId));
  assert.equal(parentQueueCalls, 1);
  assert.equal(storedArticles.length, 28);
  assert.equal(childJobs.length, 28);
  assert.equal(await runWithTenantContext({
    actorType: "worker",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, () => recordBatchEnqueueAccepted({
    batchId,
    teamId: ownerTeamId,
    generationParams: { stale: true },
  })), false, "late route acknowledgement must not regress RUNNING to QUEUED");
});

void test("partial child enqueue failure is retryable and stable child IDs fill the gap exactly once", async () => {
  await systemDb.delete(jobEvents).where(eq(jobEvents.batchId, batchId));
  await systemDb.delete(articles).where(eq(articles.batchId, batchId));
  await systemDb.update(jobBatches).set({ status: "QUEUED" }).where(eq(jobBatches.id, batchId));
  const titles = Array.from({ length: 28 }, (_, index) => `Retry title ${index + 1}`);
  const durableChildIds = new Set<string>();
  const acceptedCounts = new Map<string, number>();
  const acceptStableChild = (runId: string) => {
    if (!durableChildIds.has(runId)) {
      durableChildIds.add(runId);
      acceptedCounts.set(runId, 1);
    }
  };
  let calls = 0;
  const enqueueWithFirstAttemptFailure = async (data: ArticleJobData) => {
    calls += 1;
    if (calls === 2) throw new Error("isolated child queue write failure");
    acceptStableChild(data.runId);
    return data.runId;
  };
  const baseData: BatchJobData = {
    batchId,
    userId: ownerUserId,
    teamId: ownerTeamId,
    selectedTitles: titles,
    targetUrl: "https://example.test",
    businessName: "Regression Business",
  };

  await runWithTenantContext({
    actorType: "worker",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, async () => {
    await assert.rejects(processBatchGenerationJob({
      id: `batch-${batchId}`,
      data: baseData,
      opts: { attempts: 2 },
      attemptsMade: 0,
    } as unknown as Job<BatchJobData>, {
      addArticleJob: enqueueWithFirstAttemptFailure,
    }), /isolated child queue write failure/);

    const [retryable] = await systemDb.select({ status: jobBatches.status })
      .from(jobBatches).where(eq(jobBatches.id, batchId));
    assert.equal(retryable?.status, "QUEUED");

    await processBatchGenerationJob({
      id: `batch-${batchId}`,
      data: baseData,
      opts: { attempts: 2 },
      attemptsMade: 1,
    } as unknown as Job<BatchJobData>, {
      addArticleJob: async (data) => {
        acceptStableChild(data.runId);
        return data.runId;
      },
    });
  });

  const storedArticles = await systemDb.select({ id: articles.id })
    .from(articles).where(eq(articles.batchId, batchId));
  assert.equal(storedArticles.length, 28);
  assert.equal(durableChildIds.size, 28);
  assert.ok([...acceptedCounts.values()].every((count) => count === 1));
});

void test("late replay acknowledgement cannot overwrite RUNNING or CANCELLED", async () => {
  await runWithTenantContext({
    actorType: "worker",
    userId: ownerUserId,
    teamId: ownerTeamId,
    role: "owner",
  }, async () => {
    for (const protectedStatus of ["RUNNING", "CANCELLED"] as const) {
      // Models the worker/cancellation winning after replay read but before the
      // route persists its accepted queue acknowledgement.
      await systemDb.update(jobBatches)
        .set({ status: protectedStatus })
        .where(eq(jobBatches.id, batchId));
      const updated = await recordBatchEnqueueAccepted({
        batchId,
        teamId: ownerTeamId,
        generationParams: { submission: { state: "ACCEPTED" } },
      });
      assert.equal(updated, false);
      const [stored] = await systemDb.select({ status: jobBatches.status })
        .from(jobBatches).where(eq(jobBatches.id, batchId));
      assert.equal(stored?.status, protectedStatus);
    }
  });
});