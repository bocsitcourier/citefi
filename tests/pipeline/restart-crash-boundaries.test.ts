import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Queue, type Worker } from "bullmq";
import { and, eq } from "drizzle-orm";
import Redis from "ioredis";
import { closeDb, db } from "../../lib/db";
import {
  claimArticleImageStage,
  claimArticleRun,
  completeArticleImageStage,
  prepareArticleRunForEnqueue,
  reconcilePendingArticleBilling,
} from "../../lib/article-run-state";
import { reserveCredits } from "../../lib/billing";
import { generateImagesForArticle } from "../../lib/gemini-image-generator";
import {
  getRedisClientConfig,
  type ArticleJobData,
} from "../../lib/queue";
import { reconcileExpiredArticleRuns } from "../../server/job-monitor";
import { createPipelineWorker } from "../../lib/pipeline-worker";
import { processArticleGenerationJob } from "../../lib/worker";
import {
  articleAssets,
  articleRuns,
  articles,
  creditBalances,
  creditLedger,
  jobEvents,
  jobBatches,
  teamMembers,
  teams,
  users,
} from "../../shared/schema";

after(async () => {
  const [{ closeGeminiRateLimiter }, { closeOpenAIClient }] = await Promise.all([
    import("../../lib/gemini"),
    import("../../lib/openai-client"),
  ]);
  await Promise.all([
    closeGeminiRateLimiter(),
    closeOpenAIClient(),
  ]);
  await closeDb();
});

async function within<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeRedisConnection(): Redis {
  const { url, options } = getRedisClientConfig(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return new Redis(url, options);
}

async function seedArticle(suffix: string) {
  const marker = `t119-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [user] = await db.insert(users).values({
    email: `${marker}@test.invalid`,
    passwordHash: "x",
    role: "team_member",
    accountStatus: "active",
  }).returning();
  assert.ok(user);
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  assert.ok(team);
  await db.insert(teamMembers).values({
    teamId: team.id,
    userId: user.id,
    role: "owner",
  });
  const [batch] = await db.insert(jobBatches).values({
    userId: user.id,
    teamId: team.id,
    coreTopic: marker,
    targetUrl: "https://example.test",
    businessName: "Crash Boundary Test",
    status: "RUNNING",
    numArticlesRequested: 1,
  }).returning();
  assert.ok(batch);
  const [article] = await db.insert(articles).values({
    batchId: batch.id,
    teamId: team.id,
    chosenTitle: marker,
    articleStatus: "COMPLETE",
    finalHtmlContent: "<article>durable content</article>",
  }).returning();
  assert.ok(article);
  return { user, team, batch, article };
}

async function cleanupSeed(seed: Awaited<ReturnType<typeof seedArticle>>) {
  await db.delete(creditLedger).where(eq(creditLedger.teamId, seed.team.id));
  await db.delete(creditBalances).where(eq(creditBalances.teamId, seed.team.id));
  await db.delete(articleAssets).where(eq(articleAssets.articleId, seed.article.id));
  await db.delete(jobEvents).where(eq(jobEvents.articleId, seed.article.id));
  await db.delete(jobEvents).where(eq(jobEvents.batchId, seed.batch.id));
  await db.delete(articleRuns).where(eq(articleRuns.articleId, seed.article.id));
  await db.delete(articles).where(eq(articles.id, seed.article.id));
  await db.delete(jobBatches).where(eq(jobBatches.id, seed.batch.id));
  await db.delete(teamMembers).where(eq(teamMembers.teamId, seed.team.id));
  await db.delete(teams).where(eq(teams.id, seed.team.id));
  await db.delete(users).where(eq(users.id, seed.user.id));
}

test("a final-attempt crash after COMPLETE settles without provider re-entry", async () => {
  const seed = await seedArticle("settlement");
  const articleRunId = randomUUID();
  const billingRunId = `billing-${randomUUID()}`;
  const billingJobId = `job-${randomUUID()}`;

  try {
    await db.insert(creditBalances).values({
      teamId: seed.team.id,
      allowanceCredits: 100,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      balance: 100,
    });
    await reserveCredits({
      teamId: seed.team.id,
      operationType: "article",
      runId: billingRunId,
      amount: 10,
    });
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId: articleRunId,
      status: "running",
      completedAt: new Date(),
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
      billingTeamId: seed.team.id,
      billingRunId,
      billingAmount: 10,
      billingJobId,
    });

    const result = await reconcilePendingArticleBilling(
      new Date(),
      1,
      [articleRunId]
    );

    assert.deepEqual(result, { settled: 1, deferred: 0 });
    const [run] = await db
      .select()
      .from(articleRuns)
      .where(eq(articleRuns.runId, articleRunId));
    assert.ok(run);
    assert.equal(run.status, "completed");
    assert.equal(run.leaseToken, null);
    assert.equal(run.settlementLastError, null);

    const ledger = await db
      .select()
      .from(creditLedger)
      .where(and(
        eq(creditLedger.teamId, seed.team.id),
        eq(creditLedger.runId, billingRunId)
      ));
    assert.equal(
      ledger.filter((row) => row.eventType === "debit").length,
      1,
      "independent reconciliation must debit exactly once"
    );
    assert.equal(
      ledger.find((row) => row.eventType === "reserve")?.reservationStatus,
      "DEBITED"
    );
  } finally {
    await cleanupSeed(seed);
  }
});

test("legacy COMPLETE runs without billing identity are not promoted into settlement", async () => {
  const seed = await seedArticle("legacy-no-billing");
  const runId = randomUUID();

  try {
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId,
      status: "running",
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });

    const result = await reconcilePendingArticleBilling(
      new Date(),
      1,
      [runId]
    );
    assert.deepEqual(result, { settled: 0, deferred: 0 });

    const [run] = await db
      .select({
        status: articleRuns.status,
        settlementAttempts: articleRuns.settlementAttempts,
        settlementLastError: articleRuns.settlementLastError,
      })
      .from(articleRuns)
      .where(eq(articleRuns.runId, runId));
    assert.ok(run);
    assert.equal(run.status, "running");
    assert.equal(run.settlementAttempts, 0);
    assert.equal(run.settlementLastError, null);
  } finally {
    await cleanupSeed(seed);
  }
});

test("expired finished jobs are retried with the same durable run", async () => {
  const seed = await seedArticle("expired-monitor");
  const runId = randomUUID();
  const jobData: ArticleJobData = {
    articleId: seed.article.id,
    batchId: seed.batch.id,
    runId,
    title: seed.article.chosenTitle,
    targetUrl: seed.batch.targetUrl,
    businessName: seed.batch.businessName ?? undefined,
    teamId: seed.team.id,
  };
  const retriedStates: string[] = [];

  try {
    await db
      .update(articles)
      .set({ articleStatus: "GEMINI_COMPLETE" })
      .where(eq(articles.id, seed.article.id));
    await prepareArticleRunForEnqueue({
      articleId: seed.article.id,
      runId,
      runType: "generation",
      jobData,
    });
    await db
      .update(articleRuns)
      .set({
        status: "running",
        leaseToken: "expired-delivery",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(articleRuns.runId, runId));

    const resumed = await reconcileExpiredArticleRuns(
      new Date(),
      1,
      [runId],
      {
        async getJob(jobId: string) {
          assert.equal(jobId, runId);
          return {
            async getState() { return "completed"; },
            async retry(state: string) { retriedStates.push(state); },
          } as any;
        },
      }
    );

    assert.equal(resumed, 1);
    assert.deepEqual(retriedStates, ["completed"]);
    const [run] = await db
      .select({
        status: articleRuns.status,
        runId: articleRuns.runId,
        jobDataJson: articleRuns.jobDataJson,
      })
      .from(articleRuns)
      .where(eq(articleRuns.runId, runId));
    assert.ok(run);
    assert.equal(run.status, "running");
    assert.equal(run.runId, runId);
    assert.deepEqual(run.jobDataJson, jobData);
  } finally {
    await cleanupSeed(seed);
  }
});

test("historical FAILED and payload-less runs are not auto-replayed", async () => {
  const seed = await seedArticle("monitor-filter");
  const runId = randomUUID();
  const jobData: ArticleJobData = {
    articleId: seed.article.id,
    batchId: seed.batch.id,
    runId,
    title: seed.article.chosenTitle,
    targetUrl: seed.batch.targetUrl,
    teamId: seed.team.id,
  };
  let queueLookups = 0;
  const queue = {
    async getJob() {
      queueLookups += 1;
      throw new Error("filtered recovery candidate reached the queue");
    },
  } as any;

  try {
    await prepareArticleRunForEnqueue({
      articleId: seed.article.id,
      runId,
      runType: "generation",
      jobData,
    });
    await db
      .update(articleRuns)
      .set({
        status: "running",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(articleRuns.runId, runId));

    await db
      .update(articles)
      .set({ articleStatus: "FAILED" })
      .where(eq(articles.id, seed.article.id));
    assert.equal(
      await reconcileExpiredArticleRuns(new Date(), 100, [runId], queue),
      0,
      "FAILED rows must require an explicit manual retry"
    );

    await db
      .update(articleRuns)
      .set({ jobDataJson: null })
      .where(eq(articleRuns.runId, runId));
    for (const articleStatus of ["PENDING", "IN_PROGRESS"] as const) {
      await db
        .update(articles)
        .set({ articleStatus })
        .where(eq(articles.id, seed.article.id));
      assert.equal(
        await reconcileExpiredArticleRuns(new Date(), 100, [runId], queue),
        0,
        `${articleStatus} rows without their original payload must not replay`
      );
    }
    assert.equal(queueLookups, 0);
  } finally {
    await cleanupSeed(seed);
  }
});

test("a pre-stage claim crash is retried and completed under the same run ID", {
  timeout: 25_000,
}, async () => {
  const seed = await seedArticle("pre-stage-claim");
  const runId = randomUUID();
  const queueName = `t119-pre-stage-${runId}`;
  const jobData: ArticleJobData = {
    articleId: seed.article.id,
    batchId: seed.batch.id,
    runId,
    title: seed.article.chosenTitle,
    targetUrl: seed.batch.targetUrl,
    businessName: seed.batch.businessName ?? undefined,
    teamId: seed.team.id,
  };
  const queueConnection = makeRedisConnection();
  const firstConnection = makeRedisConnection();
  const secondConnection = makeRedisConnection();
  const queue = new Queue<ArticleJobData>(queueName, { connection: queueConnection });
  let firstWorker: Worker<ArticleJobData> | null = null;
  let secondWorker: Worker<ArticleJobData> | null = null;
  let claimedResolve!: () => void;
  let claimedReject!: (error: Error) => void;
  const claimed = new Promise<void>((resolve, reject) => {
    claimedResolve = resolve;
    claimedReject = reject;
  });
  let recoveredResolve!: () => void;
  let recoveredReject!: (error: Error) => void;
  const recovered = new Promise<void>((resolve, reject) => {
    recoveredResolve = resolve;
    recoveredReject = reject;
  });
  let providerCalls = 0;
  const envOverrides = {
    DISABLE_REFLEXIVE_CHECK: "true",
    DISABLE_CRITIC_LOOP: "true",
    DISABLE_CHATGPT_REVIEW: "true",
    DISABLE_GPT_ENHANCEMENT: "true",
  } as const;
  const previousEnv = Object.fromEntries(
    Object.keys(envOverrides).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, envOverrides);

  try {
    await db
      .update(articles)
      .set({ articleStatus: "PENDING", finalHtmlContent: null })
      .where(eq(articles.id, seed.article.id));
    await prepareArticleRunForEnqueue({
      articleId: seed.article.id,
      runId,
      runType: "generation",
      jobData,
    });

    firstWorker = createPipelineWorker<ArticleJobData>(
      queueName,
      async (job) => {
        try {
          const claim = await claimArticleRun({
            articleId: seed.article.id,
            runId,
            deliveryToken: job.token,
          });
          assert.ok(claim);
          // Simulate a crash boundary after the durable claim but before the
          // production processor's first articles-table mutation.
          claimedResolve();
        } catch (error) {
          claimedReject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      },
      {
        stage: "text_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        _deps: { recordProviderFailure: async () => {} },
        _workerOptions: { connection: firstConnection },
      }
    );
    await firstWorker.waitUntilReady();
    await queue.add("article", jobData, {
      jobId: runId,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    await within(claimed, 5_000, "pre-stage durable claim");

    await within((async () => {
      while (true) {
        const job = await queue.getJob(runId);
        if (await job?.getState() === "completed") return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })(), 5_000, "incorrectly terminalized first delivery");
    await firstWorker.close();

    const [[beforeRecovery], [claimedRun]] = await Promise.all([
      db
        .select({ articleStatus: articles.articleStatus })
        .from(articles)
        .where(eq(articles.id, seed.article.id)),
      db
        .select({
          status: articleRuns.status,
          runId: articleRuns.runId,
          jobDataJson: articleRuns.jobDataJson,
        })
        .from(articleRuns)
        .where(eq(articleRuns.runId, runId)),
    ]);
    assert.equal(beforeRecovery?.articleStatus, "PENDING");
    assert.equal(claimedRun?.status, "running");
    assert.equal(claimedRun?.runId, runId);
    assert.deepEqual(claimedRun?.jobDataJson, jobData);
    await db
      .update(articleRuns)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(articleRuns.runId, runId));

    secondWorker = createPipelineWorker<ArticleJobData>(
      queueName,
      async (job) => {
        try {
          await processArticleGenerationJob(job, {
            async generateGemini() {
              providerCalls += 1;
              return {
                rawContent: "Recovered before the first stage.",
                seoTitle: "Pre-stage Recovery",
                metaDescription: "A same-run pre-stage recovery test.",
                slug: `pre-stage-recovery-${runId}`,
                keywords: ["pre-stage recovery"],
                hashtags: ["#Recovery"],
                faq: [],
                imagePrompts: [],
                wordCount: 5,
              } as any;
            },
          });
          recoveredResolve();
        } catch (error) {
          recoveredReject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      },
      {
        stage: "text_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        _deps: { recordProviderFailure: async () => {} },
        _workerOptions: { connection: secondConnection },
      }
    );
    secondWorker.on("error", (error) => recoveredReject(error));
    await secondWorker.waitUntilReady();

    assert.equal(
      await reconcileExpiredArticleRuns(new Date(), 100, [runId], queue),
      1
    );
    await within(recovered, 10_000, "same-run pre-stage recovery");

    const [[completedRun], [completedArticle], runRows] = await Promise.all([
      db
        .select({
          status: articleRuns.status,
          runId: articleRuns.runId,
          geminiGeneratedAt: articleRuns.geminiGeneratedAt,
        })
        .from(articleRuns)
        .where(eq(articleRuns.runId, runId)),
      db
        .select({
          articleStatus: articles.articleStatus,
          finalHtmlContent: articles.finalHtmlContent,
        })
        .from(articles)
        .where(eq(articles.id, seed.article.id)),
      db
        .select({ runId: articleRuns.runId })
        .from(articleRuns)
        .where(eq(articleRuns.articleId, seed.article.id)),
    ]);
    assert.equal(providerCalls, 1);
    assert.equal(completedRun?.status, "completed");
    assert.equal(completedRun?.runId, runId);
    assert.ok(completedRun?.geminiGeneratedAt);
    assert.equal(completedArticle?.articleStatus, "COMPLETE");
    assert.match(completedArticle?.finalHtmlContent ?? "", /Recovered before/);
    assert.deepEqual(runRows.map((row) => row.runId), [runId]);
  } finally {
    await Promise.allSettled([
      firstWorker?.close(true),
      secondWorker?.close(true),
    ].filter(Boolean) as Array<Promise<void>>);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close().catch(() => {});
    await Promise.allSettled([
      queueConnection.quit(),
      firstConnection.quit(),
      secondConnection.quit(),
    ]);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await cleanupSeed(seed);
  }
});

test("stalled BullMQ redelivery waits for lease expiry and fences the real article processor", {
  timeout: 30_000,
}, async () => {
  const seed = await seedArticle("stalled-redelivery");
  const runId = randomUUID();
  const queueName = `t119-stalled-${runId}`;
  const jobData: ArticleJobData = {
    articleId: seed.article.id,
    batchId: seed.batch.id,
    runId,
    title: seed.article.chosenTitle,
    targetUrl: seed.batch.targetUrl,
    businessName: seed.batch.businessName ?? undefined,
    teamId: seed.team.id,
  };
  const queueConnection = makeRedisConnection();
  const firstConnection = makeRedisConnection();
  const secondConnection = makeRedisConnection();
  const queue = new Queue<ArticleJobData>(queueName, { connection: queueConnection });
  let firstWorker: Worker<ArticleJobData> | null = null;
  let secondWorker: Worker<ArticleJobData> | null = null;
  let releaseOriginal!: () => void;
  const originalGate = new Promise<void>((resolve) => { releaseOriginal = resolve; });
  let originalStartedResolve!: () => void;
  let originalStartedReject!: (error: Error) => void;
  const originalStarted = new Promise<void>((resolve, reject) => {
    originalStartedResolve = resolve;
    originalStartedReject = reject;
  });
  let originalFinishedResolve!: () => void;
  const originalFinished = new Promise<void>((resolve) => {
    originalFinishedResolve = resolve;
  });
  let recoveredResolve!: () => void;
  let recoveredReject!: (error: Error) => void;
  const recovered = new Promise<void>((resolve, reject) => {
    recoveredResolve = resolve;
    recoveredReject = reject;
  });
  let providerCalls = 0;
  let firstDeliveryToken: string | undefined;
  const recoveredDeliveryTokens: string[] = [];
  let originalReachedProviderBoundary = false;
  const envOverrides = {
    DISABLE_REFLEXIVE_CHECK: "true",
    DISABLE_CRITIC_LOOP: "true",
    DISABLE_CHATGPT_REVIEW: "true",
    DISABLE_GPT_ENHANCEMENT: "true",
  } as const;
  const previousEnv = Object.fromEntries(
    Object.keys(envOverrides).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, envOverrides);
  const fakeGemini = async () => {
    providerCalls += 1;
    return {
      rawContent: "Durable test article content.",
      seoTitle: "Durable Test Article",
      metaDescription: "A restart-safe article generation test.",
      slug: `durable-test-${runId}`,
      keywords: ["restart safety"],
      hashtags: ["#RestartSafety"],
      faq: [{ question: "Is this durable?", answer: "Yes." }],
      imagePrompts: [],
      wordCount: 4,
    } as any;
  };

  try {
    await db
      .update(articles)
      .set({
        articleStatus: "PENDING",
        finalHtmlContent: null,
      })
      .where(eq(articles.id, seed.article.id));
    await prepareArticleRunForEnqueue({
      articleId: seed.article.id,
      runId,
      runType: "generation",
      jobData,
    });

    firstWorker = createPipelineWorker<ArticleJobData>(
      queueName,
      async (job) => {
        firstDeliveryToken = job.token;
        try {
          await processArticleGenerationJob(job, {
            generateGemini: fakeGemini,
            async beforeProvider(stage) {
              if (stage !== "Gemini generation") return;
              originalReachedProviderBoundary = true;
              originalStartedResolve();
              await originalGate;
            },
          });
        } catch (error) {
          if (!originalReachedProviderBoundary) {
            originalStartedReject(
              error instanceof Error ? error : new Error(String(error))
            );
          }
          throw error;
        } finally {
          originalFinishedResolve();
        }
      },
      {
        stage: "text_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        _deps: {
          recordProviderFailure: async () => {},
        },
        _workerOptions: {
          connection: firstConnection,
          lockDuration: 250,
          stalledInterval: 100,
          skipLockRenewal: true,
          maxStalledCount: 2,
        },
      }
    );
    firstWorker.on("error", (error) => {
      if (!firstDeliveryToken) originalStartedReject(error);
    });
    await firstWorker.waitUntilReady();
    await queue.add("article", jobData, {
      jobId: runId,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    await within(originalStarted, 10_000, "original provider boundary");

    // Keep the lease live beyond BullMQ's first stalled redelivery, but short
    // enough for the test to prove the same job wakes after lease expiry.
    await db
      .update(articleRuns)
      .set({ leaseExpiresAt: new Date(Date.now() + 900) })
      .where(eq(articleRuns.runId, runId));

    // Simulate process loss: stop the worker connection while its processor is
    // still active. Redis revokes this delivery after lock expiry.
    await firstWorker.close(true);

    secondWorker = createPipelineWorker<ArticleJobData>(
      queueName,
      async (job) => {
        try {
          if (job.token) recoveredDeliveryTokens.push(job.token);
          await processArticleGenerationJob(job, {
            generateGemini: fakeGemini,
          });
          recoveredResolve();
        } catch (error) {
          if (error instanceof Error && error.name === "DelayedError") {
            throw error;
          }
          recoveredReject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      },
      {
        stage: "text_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        _deps: {
          recordProviderFailure: async () => {},
        },
        _workerOptions: {
          connection: secondConnection,
          lockDuration: 5_000,
          stalledInterval: 100,
          maxStalledCount: 2,
        },
      }
    );
    secondWorker.on("error", (error) => recoveredReject(error));
    await secondWorker.waitUntilReady();
    await within(recovered, 10_000, "stalled redelivery");

    releaseOriginal();
    await within(originalFinished, 3_000, "stale owner completion");

    assert.ok(firstDeliveryToken);
    assert.ok(
      recoveredDeliveryTokens.length >= 2,
      "one redelivery must defer while the old durable lease is still live"
    );
    assert.notEqual(recoveredDeliveryTokens[0], firstDeliveryToken);
    assert.notEqual(
      recoveredDeliveryTokens.at(-1),
      recoveredDeliveryTokens[0],
      "the post-expiry delivery must receive a fresh BullMQ lock token"
    );
    assert.equal(providerCalls, 1);
    const [[run], [article]] = await Promise.all([
      db
        .select({
          status: articleRuns.status,
          geminiGeneratedAt: articleRuns.geminiGeneratedAt,
          chatgptReviewedAt: articleRuns.chatgptReviewedAt,
        })
        .from(articleRuns)
        .where(eq(articleRuns.runId, runId)),
      db
        .select({
          articleStatus: articles.articleStatus,
          finalHtmlContent: articles.finalHtmlContent,
          errorMessage: articles.errorMessage,
        })
        .from(articles)
        .where(eq(articles.id, seed.article.id)),
    ]);
    assert.ok(run);
    assert.equal(run.status, "completed");
    assert.ok(run.geminiGeneratedAt);
    assert.equal(run.chatgptReviewedAt, null);
    assert.ok(article);
    assert.equal(article.articleStatus, "COMPLETE");
    assert.match(article.finalHtmlContent ?? "", /Durable test article content/);
    assert.equal(article.errorMessage, null);
  } finally {
    releaseOriginal?.();
    await Promise.allSettled([
      firstWorker?.close(true),
      secondWorker?.close(true),
    ].filter(Boolean) as Array<Promise<void>>);
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close().catch(() => {});
    await Promise.allSettled([
      queueConnection.quit(),
      firstConnection.quit(),
      secondConnection.quit(),
    ]);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await cleanupSeed(seed);
  }
});

test("an uploaded image is reused after a crash and committed with its checkpoint", async () => {
  const seed = await seedArticle("image");
  const runId = randomUUID();
  const durableUrl = `https://cdn.example.test/${runId}.png`;

  try {
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId,
      status: "completed",
      completedAt: new Date(),
    });
    const [asset] = await db.insert(articleAssets).values({
      articleId: seed.article.id,
      teamId: seed.team.id,
      assetType: "image",
      storageUrl: durableUrl,
      fileFormat: "png",
      imagePromptUsed: "durable prompt",
      metadataJson: {
        articleRunId: runId,
        isHeroImage: true,
      },
    }).returning();
    assert.ok(asset);

    const recovered = await generateImagesForArticle(
      seed.article.id,
      ["this provider call must be skipped"],
      "Crash Boundary Test",
      "https://example.test",
      runId
    );
    assert.equal(recovered[0]?.url, durableUrl);
    assert.equal(recovered[0]?.assetId, asset.id);
    assert.equal(recovered[0]?.reused, true);

    const imageLeaseToken = await claimArticleImageStage({
      articleId: seed.article.id,
      runId,
    });
    assert.ok(imageLeaseToken);
    await completeArticleImageStage({
      articleId: seed.article.id,
      runId,
      imageLeaseToken,
      heroImageUrl: recovered[0]!.url,
    });

    const [article] = await db
      .select({ heroImageUrl: articles.heroImageUrl })
      .from(articles)
      .where(eq(articles.id, seed.article.id));
    const [run] = await db
      .select({
        imageGeneratedAt: articleRuns.imageGeneratedAt,
        imageLeaseToken: articleRuns.imageLeaseToken,
      })
      .from(articleRuns)
      .where(eq(articleRuns.runId, runId));
    assert.ok(article);
    assert.ok(run);
    assert.equal(article.heroImageUrl, durableUrl);
    assert.ok(run.imageGeneratedAt);
    assert.equal(run.imageLeaseToken, null);
  } finally {
    await cleanupSeed(seed);
  }
});

test("an expired image-stage owner cannot commit its provider result", async () => {
  const seed = await seedArticle("expired-image-owner");
  const runId = randomUUID();
  const staleUrl = `https://cdn.example.test/${runId}-stale.png`;
  const recoveredUrl = `https://cdn.example.test/${runId}-recovered.png`;

  try {
    await db.insert(articleRuns).values({
      articleId: seed.article.id,
      runId,
      status: "completed",
      completedAt: new Date(),
    });
    const staleToken = await claimArticleImageStage({
      articleId: seed.article.id,
      runId,
    });
    assert.ok(staleToken);
    await db
      .update(articleRuns)
      .set({ imageLeaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(articleRuns.runId, runId));

    await assert.rejects(
      completeArticleImageStage({
        articleId: seed.article.id,
        runId,
        imageLeaseToken: staleToken,
        heroImageUrl: staleUrl,
      }),
      /LEASE_LOST/
    );
    const [[afterStale], [staleRun]] = await Promise.all([
      db
        .select({ heroImageUrl: articles.heroImageUrl })
        .from(articles)
        .where(eq(articles.id, seed.article.id)),
      db
        .select({
          imageGeneratedAt: articleRuns.imageGeneratedAt,
          imageLeaseToken: articleRuns.imageLeaseToken,
        })
        .from(articleRuns)
        .where(eq(articleRuns.runId, runId)),
    ]);
    assert.equal(afterStale?.heroImageUrl, null);
    assert.equal(staleRun?.imageGeneratedAt, null);
    assert.equal(staleRun?.imageLeaseToken, staleToken);

    const recoveredToken = await claimArticleImageStage({
      articleId: seed.article.id,
      runId,
    });
    assert.ok(recoveredToken);
    assert.notEqual(recoveredToken, staleToken);
    assert.equal(
      await completeArticleImageStage({
        articleId: seed.article.id,
        runId,
        imageLeaseToken: recoveredToken,
        heroImageUrl: recoveredUrl,
      }),
      true
    );
    const [completedArticle] = await db
      .select({ heroImageUrl: articles.heroImageUrl })
      .from(articles)
      .where(eq(articles.id, seed.article.id));
    assert.equal(completedArticle?.heroImageUrl, recoveredUrl);
  } finally {
    await cleanupSeed(seed);
  }
});