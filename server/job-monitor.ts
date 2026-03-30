import { getPgBoss } from "../lib/queue";
import { neonHttpDb } from "../lib/db";

/**
 * Job Monitor - Automatic Stuck Job Detection & Recovery
 * 
 * Runs every 5 minutes to detect and fix stuck jobs that exceed timeout
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
  }, 120000); // 2 minutes
  
  // Run immediately on start
  await checkStuckJobs();
  
  // Then run every 5 minutes
  monitorInterval = setInterval(async () => {
    await checkStuckJobs();
  }, 5 * 60 * 1000); // 5 minutes
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
    const boss = await getPgBoss();
    
    // CRITICAL: Reset jobs stuck in "active" state after app crashes
    // This runs BEFORE checking queue stats to immediately fix stuck jobs
    await resetStuckActiveJobs();
    
    // Get queue health stats
    const queues = await boss.getQueues();
    
    for (const queue of queues) {
      const queueName = typeof queue === 'string' ? queue : queue.name;
      
      // Get active jobs count
      const activeJobs = await boss.getQueueSize(queueName);
      
      if (activeJobs > 0) {
        console.log(`⚠️ Queue "${queueName}" has ${activeJobs} active jobs - auto-recovery enabled`);
      }
    }
    
    // CRITICAL: Reconcile stuck batches where all articles are done but batch is still RUNNING
    await reconcileStuckBatches();
    
    // Log monitoring heartbeat
    const now = new Date().toISOString();
    console.log(`✅ [${now}] Job monitor check complete - auto-recovery enabled`);
    
  } catch (error) {
    console.error("❌ Job monitor error:", error);
  }
}

/**
 * Reset jobs stuck in "active" state after app crashes
 * 
 * When the app crashes, pg-boss jobs in "active" state stay active.
 * This function detects jobs active for > 15 minutes and resets them
 * so workers can resume processing (threshold exceeds Gemini's 10-min hard timeout).
 */
async function resetStuckActiveJobs() {
  try {
    // Use neonHttpDb (stateless HTTP) so this periodic check is immune to
    // Neon compute suspension killing idle pool connections between monitor cycles.
    const { sql } = await import("drizzle-orm");
    
    // Reset article-generation jobs stuck in "active" state for > 15 minutes.
    // IMPORTANT: threshold must exceed the Gemini hard timeout (10 min) so we
    // don't reset jobs that are legitimately still running.
    const articleResult = await neonHttpDb.execute(sql`
      UPDATE pgboss.job
      SET state = 'created',
          started_on = NULL,
          completed_on = NULL
      WHERE name = 'article-generation'
        AND state = 'active'
        AND started_on < NOW() - INTERVAL '15 minutes'
    `);
    
    const articleResetCount = (articleResult as any).rowCount || 0;
    
    if (articleResetCount > 0) {
      console.log(`🔧 AUTO-RECOVERY: Reset ${articleResetCount} stuck article-generation jobs to 'created' state`);
      console.log(`   Workers will automatically resume processing these jobs`);
    }
    
    // VIDEO JOBS: Do NOT reset to 'created' — that causes a race condition where two
    // workers process the same job simultaneously and fight over the same /tmp/video-X/ files.
    // Instead, CANCEL jobs stuck beyond 105 minutes (90-min Veo + 15-min buffer).
    // job-recovery.ts handles re-queuing with proper cancellation of active jobs first.
    const videoResult = await neonHttpDb.execute(sql`
      UPDATE pgboss.job
      SET state = 'cancelled',
          completed_on = NOW()
      WHERE name = 'social-video-generation'
        AND state = 'active'
        AND started_on < NOW() - INTERVAL '105 minutes'
    `);

    const videoResetCount = (videoResult as any).rowCount || 0;

    if (videoResetCount > 0) {
      console.log(`🔧 AUTO-RECOVERY: Cancelled ${videoResetCount} video jobs stuck > 105 minutes (will be re-queued by job-recovery)`);
    }
    
    // PERMANENT FIX: Also monitor image-generation jobs (3 min timeout for images)
    const imageResult = await neonHttpDb.execute(sql`
      UPDATE pgboss.job
      SET state = 'created',
          started_on = NULL,
          completed_on = NULL
      WHERE name = 'image-generation'
        AND state = 'active'
        AND started_on < NOW() - INTERVAL '3 minutes'
    `);
    
    const imageResetCount = (imageResult as any).rowCount || 0;
    
    if (imageResetCount > 0) {
      console.log(`🔧 AUTO-RECOVERY: Reset ${imageResetCount} stuck image-generation jobs to 'created' state`);
    }

    // CONTENT-PUBLISHING JOBS: Reset jobs stuck > 10 minutes.
    // Publishing to external CMS (WordPress etc.) should complete in well under
    // 10 minutes. Jobs stuck longer are hanging on a dead network connection.
    const publishingResult = await neonHttpDb.execute(sql`
      UPDATE pgboss.job
      SET state = 'created',
          started_on = NULL,
          completed_on = NULL
      WHERE name = 'content-publishing'
        AND state = 'active'
        AND started_on < NOW() - INTERVAL '10 minutes'
    `);
    
    const publishingResetCount = (publishingResult as any).rowCount || 0;

    if (publishingResetCount > 0) {
      console.log(`🔧 AUTO-RECOVERY: Reset ${publishingResetCount} stuck content-publishing jobs to 'created' state`);
    }
    
  } catch (error) {
    console.error("❌ Failed to reset stuck jobs:", error);
  }
}

/**
 * Reconcile batches that are stuck in RUNNING/PARTIAL_COMPLETE
 * when all their articles are in terminal states (COMPLETE/FAILED)
 */
async function reconcileStuckBatches() {
  try {
    // Use neonHttpDb (stateless HTTP) — periodic reads must not rely on a pool
    // connection that may have gone idle between 5-minute monitor cycles.
    const { jobBatches, articles } = await import("@/shared/schema");
    const { eq, inArray } = await import("drizzle-orm");
    
    // Find batches that are not in final state
    const incompleteBatches = await neonHttpDb
      .select()
      .from(jobBatches)
      .where(inArray(jobBatches.status, ["RUNNING", "PARTIAL_COMPLETE", "PENDING"]));
    
    for (const batch of incompleteBatches) {
      const batchArticles = await neonHttpDb
        .select()
        .from(articles)
        .where(eq(articles.batchId, batch.id));
      
      if (batchArticles.length === 0) {
        // No articles yet, skip
        continue;
      }
      
      const totalArticles = batchArticles.length;
      const completedArticles = batchArticles.filter(a => a.articleStatus === "COMPLETE").length;
      const failedArticles = batchArticles.filter(a => a.articleStatus === "FAILED").length;
      const terminalArticles = completedArticles + failedArticles;
      
      // Check if all articles are in terminal state
      if (terminalArticles === totalArticles) {
        let finalStatus: string;
        if (completedArticles === totalArticles) {
          finalStatus = "COMPLETE";
        } else if (completedArticles > 0) {
          finalStatus = "PARTIAL_COMPLETE";
        } else {
          finalStatus = "FAILED";
        }
        
        // Only update if status changed
        if (batch.status !== finalStatus) {
          await neonHttpDb
            .update(jobBatches)
            .set({ 
              status: finalStatus,
            })
            .where(eq(jobBatches.id, batch.id));
          
          console.log(`🔧 Reconciled batch ${batch.id}: ${batch.status} → ${finalStatus} (${completedArticles}/${totalArticles} complete, ${failedArticles} failed)`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Batch reconciliation error:", error);
  }
}
