/**
 * End-to-end regression tests for task: "a budget-stopped article can't leave
 * its batch stuck forever".
 *
 * Drives the REAL production processors (processArticleGenerationJob,
 * processSocialVideoJob exported from lib/worker.ts — the exact functions
 * registered with createPipelineWorker) wrapped in createPipelineHandler,
 * against the real database, with a run that has already exceeded its cost
 * ceiling. Asserts the full budget-stop cleanup chain:
 *
 * Article: status → FAILED, batch completion runs (batch → FAILED, not stuck
 * RUNNING), reservation released exactly once, job not retried
 * (UnrecoverableError).
 *
 * Video: temp files cleaned, videoStatus → FAILED, error logged, reservation
 * released exactly once, UnrecoverableError.
 *
 * Run (local Redis must be up; --test-force-exit because the app's import
 * chain holds background handles beyond the closed DB/Redis singletons):
 *   WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379 node --env-file=.env.local --import tsx/esm --test --test-force-exit tests/pipeline/budget-stop-cleanup.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { UnrecoverableError } from "bullmq";
import { createPipelineHandler } from "../../lib/pipeline-worker";
import { processArticleGenerationJob, processSocialVideoJob } from "../../lib/worker";
import { db, closeDb } from "../../lib/db";
import {
  users, teams, jobBatches, articles, socialPosts, costTelemetry, errorLogs, notifications, jobEvents,
} from "../../shared/schema";
import { eq, like } from "drizzle-orm";

type AnyJob = any;

after(async () => {
  // Close the Redis singleton (opened by the video-slot cleanup path) and the
  // pooled DB connection so the node:test process exits deterministically.
  const { closeQueues } = await import("../../lib/queue");
  await closeQueues().catch(() => {});
  await closeDb();
});

function deps() {
  const calls: any[] = [];
  return { calls, _deps: { releaseReservation: async (args: any) => { calls.push(args); } } };
}

async function insertOverCeilingTelemetry(runId: string) {
  await db.insert(costTelemetry).values({
    jobId: runId,
    operationType: "article_generation",
    provider: "gemini",
    model: "test-model",
    costMicrousd: 100_000_000, // $100 — far above every ceiling
    success: 1,
  });
}

void test("budget-stopped ARTICLE: FAILED status, batch not stuck, one release, no retry", async (t) => {
  const marker = `budget-stop-test-${Date.now()}`;
  const runId = `${marker}-run`;

  // Real rows: user → batch (RUNNING) → single PENDING article.
  const [user] = await db.insert(users).values({
    email: `${marker}@example.test`,
    role: "team_member",
  }).returning();
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  const [batch] = await db.insert(jobBatches).values({
    userId: user.id,
    teamId: team.id,
    coreTopic: marker,
    targetUrl: "https://example.test",
    status: "RUNNING",
    numArticlesRequested: 1,
  }).returning();
  const [article] = await db.insert(articles).values({
    batchId: batch.id,
    teamId: team.id,
    chosenTitle: marker,
    articleStatus: "PENDING",
  }).returning();
  await insertOverCeilingTelemetry(runId);

  try {
    const d = deps();
    // Same wrapper options shape as the production registration in lib/worker.ts.
    const handler = createPipelineHandler("article-generation", processArticleGenerationJob as any, {
      stage: "text_gen",
      budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
      getBilling: async (j: AnyJob) => ({
        teamId: j.data.teamId,
        runId: j.data.creditRunId,
        amount: j.data.creditCostPerUnit ?? 10,
        releaseKey: `article:${j.data.articleId}`,
        reason: `Article ${j.data.articleId} generation failed`,
      }),
      _deps: d._deps,
    } as any);

    const job: AnyJob = {
      id: `job-${marker}`,
      data: {
        articleId: article.id,
        batchId: batch.id,
        runId: `${marker}-telemetry`,
        title: marker,
        targetUrl: "https://example.test",
        teamId: team.id,
        creditRunId: runId,
        creditCostPerUnit: 10,
      },
      opts: { attempts: 3 },
      attemptsMade: 0, // FIRST attempt — fatal budget stop must not wait for retries
    };

    // 1) Job is not retried: BUDGET_EXCEEDED is fatal → UnrecoverableError.
    await assert.rejects(
      () => handler(job),
      (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message),
      "budget stop must surface as UnrecoverableError (no retries)"
    );

    // 2) Article marked FAILED (not left PENDING forever).
    const [a] = await db.select().from(articles).where(eq(articles.id, article.id));
    assert.equal(a.articleStatus, "FAILED", "article must be marked FAILED");
    assert.match(a.errorMessage ?? "", /budget reached|BUDGET_EXCEEDED|cost ceiling/i);

    // 3) Batch completion logic ran: with its only article FAILED, the batch
    //    must be terminal (FAILED), not stuck RUNNING.
    const [b] = await db.select().from(jobBatches).where(eq(jobBatches.id, batch.id));
    assert.equal(b.status, "FAILED", "batch must not be left RUNNING");
    assert.ok(b.completedAt, "batch completedAt must be set");

    // 4) Reservation released exactly once, with per-article partial release.
    assert.equal(d.calls.length, 1, "exactly one reservation release");
    assert.equal(d.calls[0].runId, runId);
    assert.equal(d.calls[0].amount, 10, "partial release amount (not whole batch)");
    assert.equal(d.calls[0].releaseKey, `article:${article.id}`);
  } finally {
    await db.delete(costTelemetry).where(eq(costTelemetry.jobId, runId));
    await db.delete(errorLogs).where(eq(errorLogs.articleId, article.id)).catch(() => {});
    await db.delete(jobEvents).where(eq(jobEvents.articleId, article.id)).catch(() => {});
    await db.delete(jobEvents).where(eq(jobEvents.batchId, batch.id)).catch(() => {});
    await db.delete(articles).where(eq(articles.id, article.id));
    await db.delete(jobBatches).where(eq(jobBatches.id, batch.id));
    await db.delete(notifications).where(eq(notifications.userId, user.id)).catch(() => {});
    await db.delete(errorLogs).where(like(errorLogs.errorMessage, `%${marker}%`)).catch(() => {});
    await db.delete(teams).where(eq(teams.id, team.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});

void test("budget-stopped VIDEO: temp files cleaned, videoStatus FAILED, one release, no retry", async () => {
  const marker = `budget-stop-video-${Date.now()}`;
  const runId = `${marker}-run`;

  const [user] = await db.insert(users).values({
    email: `${marker}@example.test`,
    role: "team_member",
  }).returning();
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  const [post] = await db.insert(socialPosts).values({
    userId: user.id,
    teamId: team.id,
    topic: marker,
    title: marker,
    location: "Testville",
    platformsJson: ["x"],
    videoStatus: "GENERATING",
  } as any).returning();
  await insertOverCeilingTelemetry(runId);

  // Temp dir the compositor cleanup must remove on failure.
  const fs = await import("fs/promises");
  const tempDir = `/tmp/video-${post.id}`;
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(`${tempDir}/scratch.bin`, "x");

  try {
    const d = deps();
    // Same wrapper options shape as the production registration in lib/worker.ts.
    const handler = createPipelineHandler("social-video-generation", processSocialVideoJob as any, {
      stage: "video_gen",
      budget: { contentType: "video", getRunId: (j: AnyJob) => j.data.creditRunId },
      getBilling: async (j: AnyJob) => {
        const [videoPost] = await db.select({ teamId: socialPosts.teamId })
          .from(socialPosts).where(eq(socialPosts.id, j.data.socialPostId)).limit(1);
        return { teamId: videoPost?.teamId, runId: j.data.creditRunId };
      },
      _deps: d._deps,
    } as any);

    const job: AnyJob = {
      id: `job-${marker}`,
      data: { socialPostId: post.id, platform: "x", creditRunId: runId },
      opts: { attempts: 2 },
      attemptsMade: 0,
    };

    // 1) Fatal, no retry.
    await assert.rejects(
      () => handler(job),
      (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message)
    );

    // 2) Temp files cleaned up (disk can't fill from budget-stopped runs).
    const dirGone = await fs.access(tempDir).then(() => false, () => true);
    assert.ok(dirGone, "temp dir must be removed on budget stop");

    // 3) videoStatus FAILED (UI not stuck at GENERATING).
    const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, post.id));
    assert.equal(p.videoStatus, "FAILED");
    assert.match(p.errorMessage ?? "", /BUDGET_EXCEEDED|cost ceiling/i);

    // 4) Failure captured in the admin error log.
    const errRows = await db.select().from(errorLogs)
      .where(like(errorLogs.errorMessage, `%Social Post #${post.id}%`));
    assert.ok(errRows.length >= 1, "video failure must be written to error_logs");

    // 5) Reservation released exactly once.
    assert.equal(d.calls.length, 1);
    assert.equal(d.calls[0].runId, runId);
  } finally {
    await db.delete(costTelemetry).where(eq(costTelemetry.jobId, runId));
    await db.delete(errorLogs).where(like(errorLogs.errorMessage, `%Social Post #${post.id}%`)).catch(() => {});
    await db.delete(socialPosts).where(eq(socialPosts.id, post.id));
    await db.delete(notifications).where(eq(notifications.userId, user.id)).catch(() => {});
    await db.delete(teams).where(eq(teams.id, team.id));
    await db.delete(users).where(eq(users.id, user.id));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
