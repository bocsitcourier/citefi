import { getQueue } from "../lib/queue";
import { neonHttpDb } from "../lib/db";

/**
 * Job Monitor - Automatic Stuck Job Detection & Recovery
 *
 * Runs every 5 minutes to detect and fix stuck jobs that exceed timeout.
 * BullMQ handles stalled-job detection automatically via stalledInterval +
 * maxStalledCount on each Worker.  This monitor focuses on batch reconciliation
 * and memory stats — the parts that don't have a native BullMQ equivalent.
 */

let monitorInterval: NodeJS.Timeout | null = null;

export async function startJobMonitor() {
  console.log("🔍 Starting job monitor - checking for stuck jobs every 5 minutes");

  // Memory monitoring - log stats every 2 minutes to catch memory leaks
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = (memUsage.rss / 1024 / 1024).toFixed(2);
    const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    console.log(`📊 Memory: ${memMB} MB RSS, ${heapMB} MB Heap`);
  }, 120000);

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
}

async function checkStuckJobs() {
  try {
    await logQueueDepths();
    await reconcileStuckBatches();
    const now = new Date().toISOString();
    console.log(`✅ [${now}] Job monitor check complete`);
  } catch (error) {
    console.error("❌ Job monitor error:", error);
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
 * when all their articles are in terminal states (COMPLETE/FAILED)
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

      const totalArticles = batchArticles.length;
      const completedArticles = batchArticles.filter(a => a.articleStatus === "COMPLETE").length;
      const failedArticles = batchArticles.filter(a => a.articleStatus === "FAILED").length;
      const terminalArticles = completedArticles + failedArticles;

      if (terminalArticles === totalArticles) {
        let finalStatus: string;
        if (completedArticles === totalArticles) {
          finalStatus = "COMPLETE";
        } else if (completedArticles > 0) {
          finalStatus = "PARTIAL_COMPLETE";
        } else {
          finalStatus = "FAILED";
        }

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
