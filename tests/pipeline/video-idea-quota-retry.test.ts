/**
 * Video-idea quota retry regression.
 *
 * Run:
 *   WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
 *     --test tests/pipeline/video-idea-quota-retry.test.ts
 */
import assert from "node:assert/strict";
import { after, test as nodeTest } from "node:test";
import { UnrecoverableError, type Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "../../lib/db";
import {
  runWithBlockedDatabaseContext,
  runWithSystemContext,
} from "../../lib/tenant-context";

function test(name: string, fn: () => void | Promise<void>) {
  return nodeTest(name, () =>
    runWithSystemContext("video idea retry test fixture setup", fn)
  );
}
import {
  debitReservation,
  releaseReservation,
  reserveCredits,
} from "../../lib/billing";
import {
  BillingSettlementError,
  createPipelineHandler,
} from "../../lib/pipeline-worker";
import {
  VIDEO_IDEA_GENERATION_QUEUE,
  VIDEO_IDEA_JOB_OPTIONS,
  type VideoIdeaJobData,
} from "../../lib/queue";
import {
  getVideoIdeaGenerationBilling,
  processVideoIdeaGenerationJob,
  VIDEO_IDEA_RETRY_DISPOSITIONS,
  type VideoIdeaGenerationDependencies,
} from "../../workers/video-idea-worker";
import { generateVeoVideoForIdea } from "../../lib/veo-idea-orchestrator";
import { sweepStaleReservations } from "../../lib/reservation-sweeper";
import {
  creditBalances,
  creditLedger,
  teamMembers,
  teams,
  users,
  socialPosts,
  videoIdeas,
} from "../../shared/schema";
import { enqueueAutomaticSocialVideo } from "../../lib/social-worker";

after(async () => {
  const { closeDb } = await import("../../lib/db");
  await closeDb();
});

void test("the production Veo orchestration stage lets quota errors reach BullMQ", async () => {
  let providerCalls = 0;
  await assert.rejects(
    () => generateVeoVideoForIdea(
      {} as Parameters<typeof generateVeoVideoForIdea>[0],
      async () => {
        providerCalls += 1;
        throw new Error("RESOURCE_EXHAUSTED: Veo quota exceeded (429)");
      }
    ),
    /RESOURCE_EXHAUSTED/
  );
  assert.equal(providerCalls, 1);
});

void test("disabled media skips automatic social video before it can queue or reserve work", async () => {
  const fixtureId = `test-social-auto-media-disabled-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let userId: number | undefined;
  let teamId: number | undefined;
  let socialPostId: number | undefined;

  try {
    const [user] = await db.insert(users).values({
      email: `${fixtureId}@test.invalid`,
      passwordHash: "x",
      role: "member",
      accountStatus: "active",
    }).returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const [team] = await db.insert(teams).values({
      name: `Automatic social disabled ${fixtureId}`,
      createdBy: userId,
    }).returning({ id: teams.id });
    assert.ok(team);
    teamId = team.id;
    await db.insert(teamMembers).values({ teamId, userId, role: "owner" });

    const [post] = await db.insert(socialPosts).values({
      userId,
      teamId,
      topic: "Disabled media test",
      title: "Disabled media test",
      location: "Testville",
      platformsJson: ["x"],
      status: "READY",
      companyName: "Test Co",
    }).returning({ id: socialPosts.id });
    assert.ok(post);
    socialPostId = post.id;

    let queueCalls = 0;
    const result = await enqueueAutomaticSocialVideo(
      { socialPostId, teamId, userId, platform: "tiktok" },
      {
        isMediaFeatureEnabled: () => false,
        addJob: async () => {
          queueCalls += 1;
          return "must-not-queue";
        },
      }
    );

    assert.equal(result, null);
    assert.equal(queueCalls, 0, "disabled media must not enqueue provider work");
    const [unchangedPost] = await db.select({
      status: socialPosts.status,
      videoCreditRunId: socialPosts.videoCreditRunId,
      videoCapReservationId: socialPosts.videoCapReservationId,
      videoStatus: socialPosts.videoStatus,
    }).from(socialPosts).where(eq(socialPosts.id, socialPostId));
    assert.equal(unchangedPost?.status, "READY", "the parent social post remains terminal");
    assert.equal(unchangedPost?.videoCreditRunId, null);
    assert.equal(unchangedPost?.videoCapReservationId, null);
    assert.equal(unchangedPost?.videoStatus, null);
  } finally {
    if (socialPostId !== undefined) {
      await db.delete(socialPosts).where(eq(socialPosts.id, socialPostId));
    }
    if (teamId !== undefined) {
      await db.delete(creditLedger).where(eq(creditLedger.teamId, teamId));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      await db.delete(teams).where(eq(teams.id, teamId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

void test("disabled media terminally fails queued video ideas without calling Veo or stranding credits", async () => {
  const runId = `test-video-idea-media-disabled-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let userId: number | undefined;
  let teamId: number | undefined;
  let videoIdeaId: number | undefined;

  try {
    const [user] = await db.insert(users).values({
      email: `${runId}@test.invalid`,
      passwordHash: "x",
      role: "member",
      accountStatus: "active",
    }).returning({ id: users.id });
    assert.ok(user);
    userId = user.id;
    const [team] = await db.insert(teams).values({
      name: `Disabled video idea ${runId}`,
      createdBy: userId,
    }).returning({ id: teams.id });
    assert.ok(team);
    teamId = team.id;
    await db.insert(teamMembers).values({ teamId, userId, role: "owner" });
    await db.insert(creditBalances).values({
      teamId,
      allowanceCredits: 100,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      balance: 100,
    });
    const [idea] = await db.insert(videoIdeas).values({
      userId,
      teamId,
      ideaTitle: "Disabled queued video",
      shortIdea: "This must never reach the Veo provider.",
      status: "EXPANDING",
    }).returning({ id: videoIdeas.id });
    assert.ok(idea);
    videoIdeaId = idea.id;
    assert.equal((await reserveCredits({
      teamId,
      operationType: "video",
      runId,
      amount: 20,
    })).ok, true);

    let providerCalls = 0;
    const releases: unknown[] = [];
    const handler = createPipelineHandler<VideoIdeaJobData>(
      VIDEO_IDEA_GENERATION_QUEUE,
      (job) => processVideoIdeaGenerationJob(job, {
        isMediaFeatureEnabled: () => false,
        orchestrate: async () => {
          providerCalls += 1;
          return { videoUrl: "https://must-not-be-created.test/video.mp4" };
        },
        logError: async () => {},
        notifyVideoFailed: async () => {},
      }),
      {
        stage: "video_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? null },
        getBilling: getVideoIdeaGenerationBilling,
        _deps: {
          recordProviderFailure: async () => {},
          releaseReservation: async (args) => {
            releases.push(args);
            await releaseReservation(args);
          },
        },
      }
    );
    const job = {
      id: `video-idea:${runId}`,
      data: { videoIdeaId, teamId, userId, creditRunId: runId },
      opts: VIDEO_IDEA_JOB_OPTIONS,
      attemptsMade: 0,
    } as unknown as Job<VideoIdeaJobData>;

    await assert.rejects(
      () => handler(job),
      (error: unknown) => error instanceof UnrecoverableError && /FEATURE_DISABLED/.test((error as Error).message)
    );
    assert.equal(providerCalls, 0, "disabled media must not call Veo");
    assert.equal(releases.length, 1, "terminal cleanup releases the reservation once");
    const [failedIdea] = await db.select({
      status: videoIdeas.status,
      currentStage: videoIdeas.currentStage,
      errorMessage: videoIdeas.errorMessage,
    }).from(videoIdeas).where(eq(videoIdeas.id, videoIdeaId));
    assert.equal(failedIdea?.status, "FAILED");
    assert.equal(failedIdea?.currentStage, "error");
    assert.match(failedIdea?.errorMessage ?? "", /Media generation disabled/);
    const [balance] = await db.select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances).where(eq(creditBalances.teamId, teamId));
    assert.equal(balance?.reservedCredits, 0, "disabled job must not strand credits");
  } finally {
    if (videoIdeaId !== undefined) {
      await db.delete(videoIdeas).where(eq(videoIdeas.id, videoIdeaId));
    }
    if (teamId !== undefined) {
      await db.delete(creditLedger).where(eq(creditLedger.teamId, teamId));
      await db.delete(creditBalances).where(eq(creditBalances.teamId, teamId));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      await db.delete(teams).where(eq(teams.id, teamId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

void test("Veo quota failures retry before the wrapper releases credits on the final attempt", async () => {
  const runId = `test-video-idea-quota-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reservedCredits = 20;
  let userId: number | undefined;
  let teamId: number | undefined;
  let videoIdeaId: number | undefined;

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `${runId}@test.invalid`,
        passwordHash: "x",
        role: "member",
        accountStatus: "active",
      })
      .returning({ id: users.id });
    assert.ok(user, "test user must be created");
    userId = user.id;

    const [team] = await db
      .insert(teams)
      .values({ name: `Video quota ${runId}`, createdBy: userId })
      .returning({ id: teams.id });
    assert.ok(team, "test team must be created");
    teamId = team.id;

    await db.insert(teamMembers).values({ teamId, userId, role: "owner" });
    await db.insert(creditBalances).values({
      teamId,
      allowanceCredits: 100,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      balance: 100,
    });

    const [idea] = await db
      .insert(videoIdeas)
      .values({
        userId,
        teamId,
        ideaTitle: "Quota retry regression",
        shortIdea: "A deterministic video idea used to test Veo quota retries.",
        status: "EXPANDING",
      })
      .returning({ id: videoIdeas.id });
    assert.ok(idea, "test video idea must be created");
    videoIdeaId = idea.id;

    const reservation = await reserveCredits({
      teamId,
      operationType: "video",
      runId,
      amount: reservedCredits,
    });
    assert.equal(reservation.ok, true, "video credit reservation must succeed");

    assert.equal(VIDEO_IDEA_JOB_OPTIONS.attempts, 3);
    assert.deepEqual(VIDEO_IDEA_JOB_OPTIONS.backoff, {
      type: "exponential",
      delay: 60_000,
    });

    let orchestrations = 0;
    const failedNotifications: string[] = [];
    const dependencies: VideoIdeaGenerationDependencies = {
      isStorageConfigured: true,
      orchestrate: async () => {
        orchestrations += 1;
        throw new Error("RESOURCE_EXHAUSTED: Veo quota exceeded (429)");
      },
      logError: async () => {},
      notifyVideoFailed: async (_teamId, _ideaId, _title, message) => {
        failedNotifications.push(message);
      },
    };

    const releases: Array<Parameters<typeof releaseReservation>[0]> = [];
    const handler = createPipelineHandler<VideoIdeaJobData>(
      VIDEO_IDEA_GENERATION_QUEUE,
      (job) => processVideoIdeaGenerationJob(job, dependencies),
      {
        stage: "video_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        getBilling: getVideoIdeaGenerationBilling,
        _deps: {
          recordProviderFailure: async () => {},
          releaseReservation: async (args) => {
            releases.push(args);
            await releaseReservation(args);
          },
        },
      }
    );

    const makeJob = (attemptsMade: number) => ({
      id: `video-idea:${runId}`,
      data: { videoIdeaId, teamId, userId, creditRunId: runId },
      opts: VIDEO_IDEA_JOB_OPTIONS,
      attemptsMade,
    }) as unknown as Job<VideoIdeaJobData>;

    for (const attemptsMade of [0, 1]) {
      await assert.rejects(
        () =>
          runWithBlockedDatabaseContext(
            "simulate unscoped BullMQ delivery",
            () => handler(makeJob(attemptsMade))
          ),
        /RESOURCE_EXHAUSTED/
      );
      assert.equal(releases.length, 0, "transient quota attempts must preserve the reservation");
      assert.equal(failedNotifications.length, 0, "users must not receive a terminal failure before retries finish");

      const [retryingIdea] = await db
        .select({
          status: videoIdeas.status,
          currentStage: videoIdeas.currentStage,
          errorMessage: videoIdeas.errorMessage,
        })
        .from(videoIdeas)
        .where(eq(videoIdeas.id, videoIdeaId));
      assert.ok(retryingIdea);
      assert.equal(retryingIdea.status, "EXPANDING");
      assert.equal(retryingIdea.currentStage, "retry_wait");
      assert.match(retryingIdea.errorMessage ?? "", /Veo video quota exceeded/);

      const [balance] = await db
        .select({ reservedCredits: creditBalances.reservedCredits })
        .from(creditBalances)
        .where(eq(creditBalances.teamId, teamId));
      assert.equal(balance?.reservedCredits, reservedCredits);
    }

    await assert.rejects(
      () =>
        runWithBlockedDatabaseContext(
          "simulate unscoped BullMQ final delivery",
          () => handler(makeJob(2))
        ),
      /RESOURCE_EXHAUSTED/
    );

    assert.equal(orchestrations, 3, "the provider must receive the full retry budget");
    assert.equal(releases.length, 1, "the wrapper must release exactly once on the final failure");
    assert.equal(failedNotifications.length, 1, "the exhausted job must notify the user once");
    assert.match(failedNotifications[0] ?? "", /Veo video quota exceeded/);

    const [failedIdea] = await db
      .select({
        status: videoIdeas.status,
        currentStage: videoIdeas.currentStage,
        errorMessage: videoIdeas.errorMessage,
      })
      .from(videoIdeas)
      .where(eq(videoIdeas.id, videoIdeaId));
    assert.ok(failedIdea);
    assert.equal(failedIdea.status, "FAILED");
    assert.equal(failedIdea.currentStage, "error");
    assert.match(failedIdea.errorMessage ?? "", /Veo video quota exceeded/);

    const [settledBalance] = await db
      .select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId));
    assert.equal(settledBalance?.reservedCredits, 0);

    const releaseEvents = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(
        eq(creditLedger.teamId, teamId),
        eq(creditLedger.runId, runId),
        eq(creditLedger.eventType, "release")
      ));
    assert.equal(releaseEvents.length, 1);
  } finally {
    if (videoIdeaId !== undefined) {
      await db.delete(videoIdeas).where(eq(videoIdeas.id, videoIdeaId));
    }
    if (teamId !== undefined) {
      await db.delete(creditLedger).where(eq(creditLedger.teamId, teamId));
      await db.delete(creditBalances).where(eq(creditBalances.teamId, teamId));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      await db.delete(teams).where(eq(teams.id, teamId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

void test("non-quota errors follow the worker's retry disposition policy", async () => {
  const fixtureId = `test-video-idea-provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let userId: number | undefined;
  let teamId: number | undefined;
  let videoIdeaId: number | undefined;

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `${fixtureId}@test.invalid`,
        passwordHash: "x",
        role: "member",
        accountStatus: "active",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const [team] = await db
      .insert(teams)
      .values({ name: `Video provider ${fixtureId}`, createdBy: userId })
      .returning({ id: teams.id });
    assert.ok(team);
    teamId = team.id;

    await db.insert(teamMembers).values({ teamId, userId, role: "owner" });

    const [idea] = await db
      .insert(videoIdeas)
      .values({
        userId,
        teamId,
        ideaTitle: "Provider retry regression",
        shortIdea: "A deterministic video idea used to test non-quota retries.",
        status: "EXPANDING",
      })
      .returning({ id: videoIdeas.id });
    assert.ok(idea);
    videoIdeaId = idea.id;

    const makeJob = (attemptsMade: number) => ({
      id: `video-idea:${fixtureId}`,
      data: { videoIdeaId, teamId, userId },
      opts: VIDEO_IDEA_JOB_OPTIONS,
      attemptsMade,
    }) as unknown as Job<VideoIdeaJobData>;

    const providerFailure = "Veo provider returned 503 Service Unavailable";
    const providerNotifications: string[] = [];
    const providerDependencies: VideoIdeaGenerationDependencies = {
      isStorageConfigured: true,
      orchestrate: async () => {
        throw new Error(providerFailure);
      },
      logError: async () => {},
      notifyVideoFailed: async (_teamId, _ideaId, _title, message) => {
        providerNotifications.push(message);
      },
    };

    await assert.rejects(
      () => processVideoIdeaGenerationJob(makeJob(0), providerDependencies),
      { message: providerFailure }
    );
    assert.equal(providerNotifications.length, 0);

    const [retryingIdea] = await db
      .select({
        status: videoIdeas.status,
        currentStage: videoIdeas.currentStage,
        errorMessage: videoIdeas.errorMessage,
      })
      .from(videoIdeas)
      .where(eq(videoIdeas.id, videoIdeaId));
    assert.ok(retryingIdea);
    assert.equal(retryingIdea.status, "EXPANDING");
    assert.equal(retryingIdea.currentStage, "retry_wait");
    assert.equal(retryingIdea.errorMessage, providerFailure);

    await assert.rejects(
      () => processVideoIdeaGenerationJob(makeJob(2), providerDependencies),
      { message: providerFailure }
    );
    assert.equal(providerNotifications.length, 1);

    await db.update(videoIdeas)
      .set({
        status: "EXPANDING",
        currentStage: "queued",
        errorMessage: null,
      })
      .where(eq(videoIdeas.id, videoIdeaId));

    const policyFailure = "Veo content policy violation";
    const policyNotifications: string[] = [];
    const policyDependencies: VideoIdeaGenerationDependencies = {
      isStorageConfigured: true,
      orchestrate: async () => {
        throw new Error(policyFailure);
      },
      logError: async () => {},
      notifyVideoFailed: async (_teamId, _ideaId, _title, message) => {
        policyNotifications.push(message);
      },
    };
    const policyHandler = createPipelineHandler<VideoIdeaJobData>(
      VIDEO_IDEA_GENERATION_QUEUE,
      (job) => processVideoIdeaGenerationJob(job, policyDependencies),
      {
        stage: "video_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        retryDispositions: VIDEO_IDEA_RETRY_DISPOSITIONS,
        _deps: { recordProviderFailure: async () => {} },
      }
    );

    await assert.rejects(
      () => policyHandler(makeJob(0)),
      (error: unknown) => error instanceof UnrecoverableError
    );
    assert.equal(policyNotifications.length, 1);
    assert.equal(policyNotifications[0], policyFailure);

    const [policyFailedIdea] = await db
      .select({
        status: videoIdeas.status,
        currentStage: videoIdeas.currentStage,
        errorMessage: videoIdeas.errorMessage,
      })
      .from(videoIdeas)
      .where(eq(videoIdeas.id, videoIdeaId));
    assert.ok(policyFailedIdea);
    assert.equal(policyFailedIdea.status, "FAILED");
    assert.equal(policyFailedIdea.currentStage, "error");
    assert.equal(policyFailedIdea.errorMessage, policyFailure);
  } finally {
    if (videoIdeaId !== undefined) {
      await db.delete(videoIdeas).where(eq(videoIdeas.id, videoIdeaId));
    }
    if (teamId !== undefined) {
      await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      await db.delete(teams).where(eq(teams.id, teamId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

void test("debit retries settle a durable video without regenerating or refunding it", async () => {
  const runId = `test-video-idea-debit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const reservedCredits = 20;
  let userId: number | undefined;
  let teamId: number | undefined;
  let videoIdeaId: number | undefined;

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `${runId}@test.invalid`,
        passwordHash: "x",
        role: "member",
        accountStatus: "active",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const [team] = await db
      .insert(teams)
      .values({ name: `Video debit ${runId}`, createdBy: userId })
      .returning({ id: teams.id });
    assert.ok(team);
    teamId = team.id;

    await db.insert(teamMembers).values({ teamId, userId, role: "owner" });
    await db.insert(creditBalances).values({
      teamId,
      allowanceCredits: 100,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      balance: 100,
    });

    const [idea] = await db
      .insert(videoIdeas)
      .values({
        userId,
        teamId,
        ideaTitle: "Debit settlement regression",
        shortIdea: "A durable video used to prove billing-only retries.",
        status: "EXPANDING",
      })
      .returning({ id: videoIdeas.id });
    assert.ok(idea);
    videoIdeaId = idea.id;

    const reservation = await reserveCredits({
      teamId,
      operationType: "video",
      runId,
      amount: reservedCredits,
    });
    assert.equal(reservation.ok, true);

    let orchestrations = 0;
    let debitAttempts = 0;
    let budgetChecks = 0;
    let rejectBudget = false;
    let completionNotifications = 0;
    const failedNotifications: string[] = [];
    const durableVideoUrl = "https://media.test/video-idea-settlement.mp4";
    const dependencies: VideoIdeaGenerationDependencies = {
      isStorageConfigured: true,
      assertRunBudget: async () => {
        budgetChecks += 1;
        if (rejectBudget) {
          throw new Error("BUDGET_EXCEEDED: generation gate must not run during settlement");
        }
      },
      orchestrate: async () => {
        orchestrations += 1;
        await db.update(videoIdeas)
          .set({
            status: "READY",
            progress: 100,
            currentStage: "complete",
            videoUrl: durableVideoUrl,
          })
          .where(eq(videoIdeas.id, idea.id));
        return { videoUrl: durableVideoUrl };
      },
      debitReservation: async () => {
        debitAttempts += 1;
        if (debitAttempts === 2) {
          throw new Error("temporary debit database outage");
        }
        return {
          ok: false,
          fromAllowance: 0,
          fromPurchased: 0,
          allowanceRemaining: 80,
          purchasedRemaining: 0,
          totalRemaining: 80,
        };
      },
      recordUsageEvent: async () => {},
      recordContentGenerated: async () => 0,
      notifyVideoComplete: async () => {
        completionNotifications += 1;
      },
      logError: async () => {},
      notifyVideoFailed: async (_teamId, _ideaId, _title, message) => {
        failedNotifications.push(message);
      },
    };

    const releases: unknown[] = [];
    const handler = createPipelineHandler<VideoIdeaJobData>(
      VIDEO_IDEA_GENERATION_QUEUE,
      (job) => processVideoIdeaGenerationJob(job, dependencies),
      {
        stage: "video_gen",
        execution: { scope: "tenant", getTeamId: (j) => j.data.teamId ?? 1 },
        getBilling: getVideoIdeaGenerationBilling,
        retryDispositions: VIDEO_IDEA_RETRY_DISPOSITIONS,
        _deps: {
          recordProviderFailure: async () => {},
          releaseReservation: async (args) => {
            releases.push(args);
          },
        },
      }
    );
    const makeJob = (attemptsMade: number) => ({
      id: `video-idea:${runId}`,
      data: { videoIdeaId, teamId, userId, creditRunId: runId },
      opts: VIDEO_IDEA_JOB_OPTIONS,
      attemptsMade,
    }) as unknown as Job<VideoIdeaJobData>;

    for (const attemptsMade of [0, 1, 2]) {
      await assert.rejects(
        () => handler(makeJob(attemptsMade)),
        (error: unknown) => error instanceof BillingSettlementError
      );
      assert.equal(orchestrations, 1, "settlement retries must never call Veo again");
      if (attemptsMade === 0) {
        // Generation prerequisites can change after content is durable. A
        // settlement-only retry must bypass both of them.
        dependencies.isStorageConfigured = false;
        rejectBudget = true;
      }
    }

    assert.equal(debitAttempts, 3);
    assert.equal(budgetChecks, 1, "budget checks are generation-only");
    assert.equal(releases.length, 0, "delivered content must never be refunded");
    assert.equal(failedNotifications.length, 0, "billing retries must not report video generation failure");
    assert.equal(completionNotifications, 0);

    const [durableIdea] = await db
      .select({
        status: videoIdeas.status,
        videoUrl: videoIdeas.videoUrl,
        errorMessage: videoIdeas.errorMessage,
        jobId: videoIdeas.jobId,
      })
      .from(videoIdeas)
      .where(eq(videoIdeas.id, videoIdeaId));
    assert.ok(durableIdea);
    assert.equal(durableIdea.status, "READY");
    assert.equal(durableIdea.videoUrl, durableVideoUrl);
    assert.equal(durableIdea.errorMessage, null);
    assert.equal(durableIdea.jobId, `video-idea:${runId}`);

    const [balanceBeforeRecovery] = await db
      .select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId));
    assert.equal(balanceBeforeRecovery?.reservedCredits, reservedCredits);

    await db
      .update(creditLedger)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(and(
        eq(creditLedger.teamId, teamId),
        eq(creditLedger.runId, runId),
        eq(creditLedger.eventType, "reserve")
      ));

    const recoveries: unknown[] = [];
    const sweepResult = await sweepStaleReservations({
      cutoff: new Date(),
      teamId,
      requeueVideoSettlement: async (recovery) => {
        recoveries.push(recovery);
      },
    });
    assert.deepEqual(sweepResult, {
      found: 1,
      protected: 1,
      requeued: 1,
      released: 0,
      skipped: 1,
    });
    assert.deepEqual(recoveries, [{
      videoIdeaId,
      teamId,
      userId,
      creditRunId: runId,
      jobId: `video-idea:${runId}`,
    }]);

    const [balanceAfterSweep] = await db
      .select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId));
    assert.equal(
      balanceAfterSweep?.reservedCredits,
      reservedCredits,
      "the stale-reservation sweeper must not refund delivered video content"
    );

    // A later settlement recovery can still consume the preserved reservation.
    // READY/videoUrl must continue to prevent another Veo invocation.
    dependencies.debitReservation = debitReservation;
    const recoveryResult = await handler(makeJob(2));
    assert.deepEqual(recoveryResult, {
      success: true,
      videoUrl: durableVideoUrl,
    });
    assert.equal(orchestrations, 1);
    assert.equal(budgetChecks, 1);
    assert.equal(completionNotifications, 1);
    assert.equal(releases.length, 0);

    const [settledBalance] = await db
      .select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId));
    assert.equal(settledBalance?.reservedCredits, 0);

    const releaseEvents = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(
        eq(creditLedger.teamId, teamId),
        eq(creditLedger.runId, runId),
        eq(creditLedger.eventType, "release")
      ));
    assert.equal(releaseEvents.length, 0);

    const debitEvents = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(
        eq(creditLedger.teamId, teamId),
        eq(creditLedger.runId, runId),
        eq(creditLedger.eventType, "debit")
      ));
    assert.equal(debitEvents.length, 1);
  } finally {
    if (videoIdeaId !== undefined) {
      await db.delete(videoIdeas).where(eq(videoIdeas.id, videoIdeaId));
    }
    if (teamId !== undefined) {
      await db.delete(creditLedger).where(eq(creditLedger.teamId, teamId));
      await db.delete(creditBalances).where(eq(creditBalances.teamId, teamId));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      await db.delete(teams).where(eq(teams.id, teamId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});