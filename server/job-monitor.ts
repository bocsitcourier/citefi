import {
  ARTICLE_GENERATION_QUEUE,
  getQueue,
  addArticleJob,
  type ArticleJobData,
} from "../lib/queue";
import { neonHttpDb } from "../lib/db";
import { createNotification } from "../lib/notification-service";
import { articles, articleRuns, jobBatches } from "../shared/schema";
import {
  markArticleRunEnqueueFailed,
  reconcilePendingArticleBilling,
} from "../lib/article-run-state";
import { and, eq, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";

/**
 * Job Monitor - Automatic Stuck Job Detection & Recovery
 *
 * Runs every 5 minutes to detect and fix stuck jobs that exceed timeout.
 * BullMQ handles stalled-job detection automatically via stalledInterval +
 * maxStalledCount on each Worker.  This monitor focuses on batch reconciliation
 * and memory stats — the parts that don't have a native BullMQ equivalent.
 */

let monitorInterval: NodeJS.Timeout | null = null;
let memoryInterval: NodeJS.Timeout | null = null;

export async function startJobMonitor() {
  console.log("🔍 Starting job monitor - checking for stuck jobs every 5 minutes");

  // Memory monitoring - log stats every 2 minutes to catch memory leaks
  memoryInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = (memUsage.rss / 1024 / 1024).toFixed(2);
    const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    console.log(`📊 Memory: ${memMB} MB RSS, ${heapMB} MB Heap`);
  }, 120000);
  memoryInterval.unref();

  // Run immediately on start
  await checkStuckJobs();

  // Then run every 5 minutes
  monitorInterval = setInterval(async () => {
    await checkStuckJobs();
  }, 5 * 60 * 1000);
}

export async function stopJobMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("🛑 Job monitor stopped");
  }
  if (memoryInterval) {
    clearInterval(memoryInterval);
    memoryInterval = null;
  }
}

async function checkStuckJobs() {
  try {
    await logQueueDepths();
    const settlement = await reconcilePendingArticleBilling();
    if (settlement.settled > 0 || settlement.deferred > 0) {
      console.log(
        `💳 Article settlement reconciliation: settled=${settlement.settled} deferred=${settlement.deferred}`
      );
    }
    const resumedRuns = await reconcileExpiredArticleRuns();
    if (resumedRuns > 0) {
      console.warn(`🔄 Requeued ${resumedRuns} expired article run(s) with their original run IDs`);
    }
    await reconcileMissingArticleEnqueues();
    await recoverStalledArticles();
    await reconcileStuckBatches();
    const now = new Date().toISOString();
    console.log(`✅ [${now}] Job monitor check complete`);
  } catch (error) {
    console.error("❌ Job monitor error:", error);
  }
}

const ARTICLE_ENQUEUE_GRACE_MS = 5 * 60 * 1000;

/**
 * Queue.add can fail ambiguously, so enqueue helpers leave durable evidence.
 * Only after the grace period and a direct BullMQ lookup confirms absence do
 * we transition the run to failed_enqueue.
 */
export async function reconcileMissingArticleEnqueues(
  now = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - ARTICLE_ENQUEUE_GRACE_MS);
  const candidates = await neonHttpDb
    .select({
      articleId: articleRuns.articleId,
      runId: articleRuns.runId,
    })
    .from(articleRuns)
    .where(and(
      eq(articleRuns.status, "queued"),
      lt(articleRuns.queuedAt, cutoff)
    ));

  if (candidates.length === 0) return 0;
  const queue = getQueue(ARTICLE_GENERATION_QUEUE);
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const job = await queue.getJob(candidate.runId);
      if (job) continue;
      const changed = await markArticleRunEnqueueFailed({
        articleId: candidate.articleId,
        runId: candidate.runId,
        error: new Error(
          `BullMQ job ${candidate.runId} was absent after the five-minute enqueue grace period`
        ),
      });
      if (changed) {
        failed += 1;
        console.error(
          `❌ Article ${candidate.articleId} run ${candidate.runId.slice(0, 8)} marked FAILED_ENQUEUE`
        );
      }
    } catch (error) {
      // A Redis outage is not proof that the job is absent.
      console.warn(
        `⚠️ Could not verify queued article run ${candidate.runId}; leaving it queued:`,
        error
      );
    }
  }
  return failed;
}

function isArticleJobData(value: unknown): value is ArticleJobData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ArticleJobData>;
  return (
    typeof data.articleId === "number" &&
    typeof data.batchId === "number" &&
    typeof data.runId === "string" &&
    typeof data.title === "string" &&
    typeof data.targetUrl === "string"
  );
}

/**
 * BullMQ normally redelivers stalled active jobs itself. This is the durable
 * backstop for a job that was incorrectly completed/failed, or removed, while
 * its article run still owns checkpoint state. The same run ID and persisted
 * payload are always reused; recovery never creates a fresh generation run.
 */
export async function reconcileExpiredArticleRuns(
  now = new Date(),
  limit = 100,
  onlyRunIds?: string[],
  queueOverride?: Pick<ReturnType<typeof getQueue>, "getJob">
): Promise<number> {
  const candidates = await neonHttpDb
    .select({
      articleId: articleRuns.articleId,
      runId: articleRuns.runId,
      jobDataJson: articleRuns.jobDataJson,
    })
    .from(articleRuns)
    .innerJoin(articles, eq(articles.id, articleRuns.articleId))
    .where(and(
      eq(articleRuns.status, "running"),
      or(
        isNull(articleRuns.leaseExpiresAt),
        lt(articleRuns.leaseExpiresAt, now)
      ),
      ne(articles.articleStatus, "COMPLETE"),
      inArray(articles.articleStatus, [
        "IN_PROGRESS",
        "GEMINI_COMPLETE",
        "CHATGPT_REVIEWED",
        "GPT4_ENHANCED",
      ]),
      isNotNull(articleRuns.jobDataJson),
      onlyRunIds?.length ? inArray(articleRuns.runId, onlyRunIds) : undefined
    ))
    .limit(limit);

  if (candidates.length === 0) return 0;
  const queue = queueOverride ?? getQueue(ARTICLE_GENERATION_QUEUE);
  let resumed = 0;

  for (const candidate of candidates) {
    try {
      const job = await queue.getJob(candidate.runId);
      if (job) {
        const state = await job.getState();
        if (state === "completed" || state === "failed") {
          await job.retry(state);
          resumed += 1;
        }
        // Waiting/delayed/active jobs already have a BullMQ recovery owner.
        continue;
      }

      if (!isArticleJobData(candidate.jobDataJson)) {
        console.error(
          `❌ Cannot recover article ${candidate.articleId} run ${candidate.runId.slice(0, 8)}: ` +
          `durable job payload is missing`
        );
        continue;
      }

      await addArticleJob({
        ...candidate.jobDataJson,
        articleId: candidate.articleId,
        runId: candidate.runId,
      });
      resumed += 1;
    } catch (error) {
      console.warn(
        `⚠️ Could not recover expired article run ${candidate.runId.slice(0, 8)}; ` +
        `leaving durable state unchanged:`,
        error
      );
    }
  }

  return resumed;
}

export function summarizeBatchArticleStatuses(
  statuses: Array<string | null>
): {
  totalArticles: number;
  completedArticles: number;
  failedArticles: number;
  terminalArticles: number;
  finalStatus: "COMPLETE" | "PARTIAL_COMPLETE" | "FAILED" | null;
} {
  const totalArticles = statuses.length;
  const completedArticles = statuses.filter((status) => status === "COMPLETE").length;
  const failedArticles = statuses.filter(
    (status) => status === "FAILED" || status === "DEAD"
  ).length;
  const terminalArticles = completedArticles + failedArticles;
  const finalStatus =
    totalArticles === 0 || terminalArticles !== totalArticles
      ? null
      : completedArticles === totalArticles
      ? "COMPLETE"
      : completedArticles > 0
      ? "PARTIAL_COMPLETE"
      : "FAILED";

  return {
    totalArticles,
    completedArticles,
    failedArticles,
    terminalArticles,
    finalStatus,
  };
}

const ARTICLE_STALL_MESSAGE = "Stalled — auto-recovered";
const ARTICLE_STAGE_TIMEOUT_MS: Record<string, number> = {
  // Gemini text generation is hard-capped at ten minutes in the worker.
  IN_PROGRESS: 10 * 60 * 1000,
  // Post-generation enrichment/checkpoint stages have a little more room for
  // provider retries and follow-on image work.
  GEMINI_COMPLETE: 15 * 60 * 1000,
  CHATGPT_REVIEWED: 15 * 60 * 1000,
  // Reformat jobs can include upload/media work.
  REFORMATTING: 60 * 60 * 1000,
};

/**
 * Recover article rows whose worker heartbeat stopped advancing.
 *
 * First stall: record FAILED briefly, then enqueue one recovery job.
 * Second stall: move the row to DEAD and notify the owning team. This avoids an
 * infinite loop that repeatedly spends provider quota on an article that cannot
 * make progress.
 */
async function recoverStalledArticles() {
  const watchedStatuses = Object.keys(ARTICLE_STAGE_TIMEOUT_MS);
  const now = Date.now();

  try {
    const candidates = await neonHttpDb
      .select({
        id: articles.id,
        batchId: articles.batchId,
        teamId: articles.teamId,
        chosenTitle: articles.chosenTitle,
        articleStatus: articles.articleStatus,
        updatedAt: articles.updatedAt,
        lastHeartbeatAt: articles.lastHeartbeatAt,
        stallCount: articles.stallCount,
        finalHtmlContent: articles.finalHtmlContent,
        targetUrl: jobBatches.targetUrl,
        generationParams: jobBatches.generationParams,
        businessName: jobBatches.businessName,
        companyLogoUrl: jobBatches.companyLogoUrl,
        personaId: jobBatches.personaId,
      })
      .from(articles)
      .innerJoin(jobBatches, eq(articles.batchId, jobBatches.id))
      .where(inArray(articles.articleStatus, watchedStatuses));

    const durableRunArticleIds = candidates.length > 0
      ? await neonHttpDb
          .select({ articleId: articleRuns.articleId })
          .from(articleRuns)
          .where(inArray(
            articleRuns.articleId,
            candidates.map((article) => article.id)
          ))
      : [];
    const durablyOwnedArticles = new Set(
      durableRunArticleIds.map((run) => run.articleId)
    );

    for (const article of candidates) {
      if (durablyOwnedArticles.has(article.id)) {
        // The article-run lease/token monitor owns recovery for this exact run.
        // Never replace it with a fresh run ID or discard its checkpoints.
        continue;
      }
      if (
        article.articleStatus !== "IN_PROGRESS" ||
        (article.finalHtmlContent ?? "").trim()
      ) {
        // Legacy intermediate/failed content is not safe to replay under a new
        // run ID. It requires explicit manual recovery.
        continue;
      }
      const timeoutMs = ARTICLE_STAGE_TIMEOUT_MS[article.articleStatus ?? ""];
      if (!timeoutMs) continue;
      const heartbeatAt = article.lastHeartbeatAt ?? article.updatedAt;
      if (now - new Date(heartbeatAt).getTime() < timeoutMs) continue;

      const currentStatus = article.articleStatus!;
      const nextStallCount = (article.stallCount ?? 0) + 1;
      const updated = await neonHttpDb
        .update(articles)
        .set({
          articleStatus: nextStallCount >= 2 ? "DEAD" : "FAILED",
          errorMessage: nextStallCount >= 2
            ? "Stalled twice — manual intervention required"
            : ARTICLE_STALL_MESSAGE,
          stallCount: nextStallCount,
          lastStalledAt: new Date(),
          updatedAt: new Date(),
        })
        // Compare the old status + stall count so concurrent monitor ticks, a
        // newly resumed worker, or a manual retry cannot be overwritten.
        .where(and(
          eq(articles.id, article.id),
          eq(articles.articleStatus, currentStatus),
          eq(articles.stallCount, article.stallCount ?? 0),
        ))
        .returning({ id: articles.id });

      if (updated.length === 0) continue;

      if (nextStallCount >= 2) {
        if (article.teamId) {
          void createNotification({
            teamId: article.teamId,
            type: "error",
            category: "article",
            title: "Article needs manual attention",
            message: `"${article.chosenTitle.slice(0, 80)}" stalled twice and was stopped to prevent another loop.`,
            entityId: article.id,
            entityType: "article",
            actionUrl: `/batches/${article.batchId}`,
          }).catch(() => {});
        }
        console.error(`🛑 Article ${article.id} moved to DEAD after a second stalled run`);
        continue;
      }

      const params = (article.generationParams ?? {}) as Record<string, unknown>;
      try {
        await addArticleJob({
          articleId: article.id,
          batchId: article.batchId,
          runId: crypto.randomUUID(),
          title: article.chosenTitle,
          targetUrl: article.targetUrl,
          tone: params.tone as string | undefined,
          wordCountMin: params.wordCountMin as number | undefined,
          wordCountMax: params.wordCountMax as number | undefined,
          geographicFocus: params.geographicFocus as string | undefined,
          audience: params.audience as string | undefined,
          businessName: article.businessName ?? undefined,
          companyLogoUrl: article.companyLogoUrl ?? undefined,
          competitorUrls: params.competitorUrls as string[] | undefined,
          semanticClusterId: params.semanticClusterId as number | undefined,
          serpFeatureTarget: params.serpFeatureTarget as string | undefined,
          teamId: article.teamId ?? undefined,
          personaId: article.personaId ?? undefined,
        });
        console.warn(`🔄 Requeued stalled article ${article.id} from ${currentStatus} (auto-recovery 1/1)`);
      } catch (err) {
        console.error(`❌ Failed to enqueue stalled article ${article.id}; it remains FAILED for manual retry:`, err);
      }
    }
  } catch (error) {
    console.error("❌ Article stall watchdog error:", error);
  }
}

/**
 * Log BullMQ queue depths for the main queues so ops can spot backlogs.
 * BullMQ Workers handle their own stalled-job recovery automatically.
 */
async function logQueueDepths() {
  const WATCHED_QUEUES = [
    "article-generation",
    "batch-generation",
    "image-generation",
    "social-post-generation",
    "content-publishing",
    "social-video-generation",
  ];

  for (const name of WATCHED_QUEUES) {
    try {
      const q = getQueue(name);
      const [waiting, active, failed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getFailedCount(),
      ]);
      if (waiting > 0 || active > 0 || failed > 0) {
        console.log(`📊 Queue "${name}": waiting=${waiting} active=${active} failed=${failed}`);
      }
    } catch (_) {
      // queue may not exist yet — non-fatal
    }
  }
}

/**
 * Reconcile batches that are stuck in RUNNING/PARTIAL_COMPLETE
 * when all their articles are in terminal states (COMPLETE/FAILED/DEAD)
 */
async function reconcileStuckBatches() {
  try {
    const { jobBatches, articles } = await import("@/shared/schema");
    const { eq, inArray } = await import("drizzle-orm");

    const incompleteBatches = await neonHttpDb
      .select()
      .from(jobBatches)
      .where(inArray(jobBatches.status, ["RUNNING", "PARTIAL_COMPLETE", "PENDING"]));

    for (const batch of incompleteBatches) {
      const batchArticles = await neonHttpDb
        .select()
        .from(articles)
        .where(eq(articles.batchId, batch.id));

      if (batchArticles.length === 0) continue;

      const {
        totalArticles,
        completedArticles,
        failedArticles,
        finalStatus,
      } = summarizeBatchArticleStatuses(
        batchArticles.map((article) => article.articleStatus)
      );

      if (finalStatus) {

        if (batch.status !== finalStatus) {
          await neonHttpDb
            .update(jobBatches)
            .set({ status: finalStatus })
            .where(eq(jobBatches.id, batch.id));

          console.log(`🔧 Reconciled batch ${batch.id}: ${batch.status} → ${finalStatus} (${completedArticles}/${totalArticles} complete, ${failedArticles} failed)`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Batch reconciliation error:", error);
  }
}
