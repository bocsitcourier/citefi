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
 * Run in-process (local Redis must be up). Avoid `node --test` isolation here:
 * Node 20 can corrupt test-runner IPC for tsx suites with real service clients.
 *   WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379 node --env-file=.env.local --import tsx/esm tests/pipeline/budget-stop-cleanup.test.ts
 */
import { test as nodeTest, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import { Client } from "pg";
import { createPipelineHandler } from "../../lib/pipeline-worker";
import { processArticleGenerationJob, processSocialVideoJob } from "../../lib/worker";
import { db, closeDb } from "../../lib/db";
import { runWithSystemContext } from "../../lib/tenant-context";
import { assertRunBudget } from "../../lib/cost-ceilings";
import { logCostTelemetry } from "../../lib/cost-telemetry";
import { recordProviderUsage } from "../../lib/provider-usage-ledger";
import {
  users, teams, jobBatches, articles, articleRuns, socialPosts, costTelemetry,
  creditReservations, errorLogs, notifications, jobEvents,
} from "../../shared/schema";
import { eq, like } from "drizzle-orm";

type AnyJob = any;

function test(
  name: string,
  fn: (context: TestContext) => void | Promise<void>
) {
  return nodeTest(name, (context) =>
    runWithSystemContext(
      "budget stop integration fixture setup",
      () => fn(context)
    )
  );
}

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

async function insertOverCeilingUsage(runId: string, teamId: number) {
  const result = await recordProviderUsage({
    sourceEventId: `budget-stop:${runId}`,
    teamId,
    runId,
    operationType: "veo_clip",
    provider: "gemini",
    model: "veo-3.1-fast-generate-preview",
    unitType: "seconds",
    unitCount: 20,
    costMicrousd: 3_600_000,
  });
  assert.ok(result.event.rateVersionId, "budget fixture must use a locked rate version");
  assert.ok(result.event.providerRateId, "budget fixture must use a locked provider rate");
  assert.equal(result.event.costMicrousd, 3_600_000);
}

async function deleteProviderUsage(runIds: string[]) {
  const connectionString = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required for provider ledger fixture cleanup");
  const owner = new Client({ connectionString });
  await owner.connect();
  try {
    await owner.query("BEGIN");
    await owner.query("LOCK TABLE provider_usage_ledger IN ACCESS EXCLUSIVE MODE");
    await owner.query("ALTER TABLE provider_usage_ledger DISABLE TRIGGER provider_usage_ledger_append_only");
    await owner.query("DELETE FROM provider_usage_ledger WHERE run_id = ANY($1::varchar[])", [runIds]);
    await owner.query("ALTER TABLE provider_usage_ledger ENABLE TRIGGER provider_usage_ledger_append_only");
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await owner.end();
  }
}

void test("budget-stopped ARTICLE: FAILED status, batch not stuck, one release, no retry", async (t) => {
  const marker = `budget-stop-test-${Date.now()}`;
  const runId = randomUUID();
  const articleRunId = randomUUID();

  // Real rows: user → batch (RUNNING) → single PENDING article.
  const [user] = await db.insert(users).values({
    email: `${marker}@example.test`,
    role: "team_member",
  }).returning();
  assert.ok(user, "article fixture user must be created");
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  assert.ok(team, "article fixture team must be created");
  const [batch] = await db.insert(jobBatches).values({
    userId: user.id,
    teamId: team.id,
    coreTopic: marker,
    targetUrl: "https://example.test",
    businessName: marker,
    status: "RUNNING",
    numArticlesRequested: 1,
  }).returning();
  assert.ok(batch, "article fixture batch must be created");
  const [article] = await db.insert(articles).values({
    batchId: batch.id,
    teamId: team.id,
    chosenTitle: marker,
    articleStatus: "PENDING",
  }).returning();
  assert.ok(article, "article fixture row must be created");
  await insertOverCeilingUsage(runId, team.id);

  try {
    const d = deps();
    // Same wrapper options shape as the production registration in lib/worker.ts.
    const handler = createPipelineHandler("article-generation", processArticleGenerationJob as any, {
      stage: "text_gen",
      execution: {
        scope: "tenant",
        getTeamId: (j: AnyJob) => j.data.teamId ?? null,
      },
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
        runId: articleRunId,
        title: marker,
        targetUrl: "https://example.test",
        businessName: marker,
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
    assert.ok(a, "article row must remain available for status verification");
    assert.equal(a.articleStatus, "FAILED", "article must be marked FAILED");
    assert.match(a.errorMessage ?? "", /budget reached|BUDGET_EXCEEDED|cost ceiling/i);

    // 3) Batch completion logic ran: with its only article FAILED, the batch
    //    must be terminal (FAILED), not stuck RUNNING.
    const [b] = await db.select().from(jobBatches).where(eq(jobBatches.id, batch.id));
    assert.ok(b, "batch row must remain available for status verification");
    assert.equal(b.status, "FAILED", "batch must not be left RUNNING");
    assert.ok(b.completedAt, "batch completedAt must be set");

    // 4) Reservation released exactly once, with per-article partial release.
    assert.equal(d.calls.length, 1, "exactly one reservation release");
    assert.equal(d.calls[0].runId, runId);
    assert.equal(d.calls[0].amount, 10, "partial release amount (not whole batch)");
    assert.equal(d.calls[0].releaseKey, `article:${article.id}`);
  } finally {
    await deleteProviderUsage([runId]);
    await db.delete(errorLogs).where(eq(errorLogs.articleId, article.id)).catch(() => {});
    await db.delete(jobEvents).where(eq(jobEvents.articleId, article.id)).catch(() => {});
    await db.delete(jobEvents).where(eq(jobEvents.batchId, batch.id)).catch(() => {});
    await db.delete(articleRuns).where(eq(articleRuns.articleId, article.id));
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
  const runId = randomUUID();

  const [user] = await db.insert(users).values({
    email: `${marker}@example.test`,
    role: "team_member",
  }).returning();
  assert.ok(user, "video fixture user must be created");
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  assert.ok(team, "video fixture team must be created");
  const [post] = await db.insert(socialPosts).values({
    userId: user.id,
    teamId: team.id,
    topic: marker,
    title: marker,
    location: "Testville",
    platformsJson: ["x"],
    videoStatus: "GENERATING",
    videoCreditRunId: runId,
  } as any).returning();
  assert.ok(post, "video fixture social post must be created");
  await db.insert(creditReservations).values({
    teamId: team.id,
    runId,
    operationType: "video",
    originalAmount: 30,
    remainingAmount: 30,
    status: "RESERVED",
    requestKey: `budget-stop:${runId}`,
  });
  await insertOverCeilingUsage(runId, team.id);

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
      execution: {
        scope: "tenant",
        getTeamId: async (j: AnyJob) => {
          if (j.data.teamId) return j.data.teamId;
          const [row] = await db
            .select({ teamId: socialPosts.teamId })
            .from(socialPosts)
            .where(eq(socialPosts.id, j.data.socialPostId))
            .limit(1);
          return row?.teamId ?? null;
        },
        systemTeamResolutionReason:
          "budget stop test: resolve legacy social video owner",
      },
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
      data: {
        socialPostId: post.id,
        platform: "x",
        creditRunId: runId,
        teamId: team.id,
        userId: user.id,
      },
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
    assert.ok(p, "social post must remain available for status verification");
    assert.equal(p.videoStatus, "FAILED");
    // Accept both the legacy raw cost-ceiling message and the new user-friendly
    // budget-stop copy stored by the worker ("Generation budget reached…").
    assert.match(p.errorMessage ?? "", /BUDGET_EXCEEDED|cost ceiling|budget reached/i);

    // 4) Failure captured in the admin error log.
    const errRows = await db.select().from(errorLogs)
      .where(like(errorLogs.errorMessage, `%Social Post #${post.id}%`));
    assert.ok(errRows.length >= 1, "video failure must be written to error_logs");

    // 5) Reservation released exactly once.
    assert.equal(d.calls.length, 1);
    assert.equal(d.calls[0].runId, runId);
  } finally {
    await deleteProviderUsage([runId]);
    await db.delete(errorLogs).where(like(errorLogs.errorMessage, `%Social Post #${post.id}%`)).catch(() => {});
    await db.delete(socialPosts).where(eq(socialPosts.id, post.id));
    await db.delete(creditReservations).where(eq(creditReservations.runId, runId));
    await db.delete(notifications).where(eq(notifications.userId, user.id)).catch(() => {});
    await db.delete(teams).where(eq(teams.id, team.id));
    await db.delete(users).where(eq(users.id, user.id));
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

void test("provider telemetry inherits the worker tenant and trips its run budget", async () => {
  const marker = `tenant-telemetry-${Date.now()}`;
  const runId = randomUUID();

  const [user] = await db.insert(users).values({
    email: `${marker}@example.test`,
    role: "team_member",
  }).returning();
  assert.ok(user, "telemetry fixture user must be created");
  const [team] = await db.insert(teams).values({
    name: marker,
    createdBy: user.id,
  }).returning();
  assert.ok(team, "telemetry fixture team must be created");

  try {
    const handler = createPipelineHandler(
      "tenant-telemetry",
      async () => {
        await logCostTelemetry(
          {
            operationType: "veo_clip",
            provider: "gemini",
            model: "veo-3.1-fast-generate-preview",
            // Deliberately omit teamId and jobId, like deep provider helpers.
          },
          { videoSeconds: 20 },
          25,
          true
        );

        const [row] = await db
          .select({
            teamId: costTelemetry.teamId,
            jobId: costTelemetry.jobId,
          })
          .from(costTelemetry)
          .where(eq(costTelemetry.jobId, runId))
          .limit(1);
        assert.ok(row, "provider telemetry must persist under RLS");
        assert.equal(row.teamId, team.id);
        assert.equal(row.jobId, runId);

        await assert.rejects(
          () => assertRunBudget(runId, "video", "video_gen"),
          /BUDGET_EXCEEDED|exceeded cost ceiling/
        );
        await assert.rejects(
          () =>
            logCostTelemetry(
              {
                operationType: "veo_clip",
                provider: "gemini",
                model: "veo-3.1-fast-generate-preview",
                teamId: team.id + 1,
              },
              { videoSeconds: 1 },
              1,
              true
            ),
          /does not match the validated tenant/
        );
      },
      {
        stage: "video_gen",
        execution: {
          scope: "tenant",
          getTeamId: () => team.id,
        },
        budget: {
          contentType: "video",
          getRunId: () => runId,
        },
        _deps: {
          recordProviderFailure: async () => {},
        },
      }
    );

    await handler({
      id: `telemetry:${runId}`,
      data: {},
      opts: { attempts: 1 },
      attemptsMade: 0,
    } as AnyJob);
  } finally {
    await db.delete(costTelemetry).where(eq(costTelemetry.jobId, runId));
    await deleteProviderUsage([runId]);
    await db.delete(teams).where(eq(teams.id, team.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});
