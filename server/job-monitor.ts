import { getPgBoss } from "../lib/queue";

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
 * This function detects jobs active for > 5 minutes and resets them
 * so workers can resume processing immediately (instead of waiting 60 minutes for expiration).
 */
async function resetStuckActiveJobs() {
  try {
    const { db } = await import("../lib/db");
    const { sql } = await import("drizzle-orm");
    
    // Reset article-generation jobs stuck in "active" state for > 5 minutes
    // This handles crash recovery without waiting for pg-boss 60-minute expiration
    const articleResult = await db.execute(sql`
      UPDATE pgboss.job
      SET state = 'created',
          started_on = NULL,
          completed_on = NULL
      WHERE name = 'article-generation'
        AND state = 'active'
        AND started_on < NOW() - INTERVAL '5 minutes'
    `);
    
    const articleResetCount = (articleResult as any).rowCount || 0;
    
    if (articleResetCount > 0) {
      console.log(`🔧 AUTO-RECOVERY: Reset ${articleResetCount} stuck article-generation jobs to 'created' state`);
      console.log(`   Workers will automatically resume processing these jobs`);
    }
    
    // PERMANENT FIX: Also monitor social-video-generation jobs (10 min timeout for videos)
    // Video jobs can hang on FFmpeg composition - reset if stuck > 10 minutes
    const videoResult = await db.execute(sql`
      UPDATE pgboss.job
      SET state = 'created',
          started_on = NULL,
          completed_on = NULL
      WHERE name = 'social-video-generation'
        AND state = 'active'
        AND started_on < NOW() - INTERVAL '10 minutes'
    `);
    
    const videoResetCount = (videoResult as any).rowCount || 0;
    
    if (videoResetCount > 0) {
      console.log(`🔧 AUTO-RECOVERY: Reset ${videoResetCount} stuck social-video-generation jobs to 'created' state`);
      console.log(`   Video workers will automatically resume processing these jobs`);
    }
    
    // PERMANENT FIX: Also monitor image-generation jobs (3 min timeout for images)
    const imageResult = await db.execute(sql`
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
    const { db } = await import("../lib/db");
    const { jobBatches, articles } = await import("@/shared/schema");
    const { eq, inArray } = await import("drizzle-orm");
    
    // Find batches that are not in final state
    const incompleteBatches = await db
      .select()
      .from(jobBatches)
      .where(inArray(jobBatches.status, ["RUNNING", "PARTIAL_COMPLETE", "PENDING"]));
    
    for (const batch of incompleteBatches) {
      const batchArticles = await db
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
          await db
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
