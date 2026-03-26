import { db } from "./db";
import { articles, jobBatches, socialPosts, videoIdeas, errorLogs, publishingJobs } from "@/shared/schema";
import { eq, isNull, or, sql, and, lt } from "drizzle-orm";
import { getPgBoss } from "./queue";
import { createNotification } from "./notification-service";

const STUCK_JOB_TIMEOUT_MINUTES = 30;

// ---------------------------------------------------------------------------
// DB RETRY HELPER
// ---------------------------------------------------------------------------
// Neon's HTTP driver drops connections intermittently ("fetch failed").
// Rather than letting the entire recovery scan fail, each section already has
// its own try/catch.  This helper adds per-call retry so individual DB
// operations survive a transient blip without needing the caller to change.
// ---------------------------------------------------------------------------
async function withDbRetry<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const isTransient = msg.includes("fetch failed") || msg.includes("error connecting") ||
        msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("eai_again");
      if (!isTransient || attempt === retries) break;
      const delay = attempt * 2000; // 2s, 4s
      console.warn(`  ⚠️ [${label}] DB call failed (attempt ${attempt}/${retries}), retrying in ${delay / 1000}s…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

interface RecoveryStats {
  articlesRecovered: number;
  socialPostsRecovered: number;
  videoIdeasRecovered: number;
  batchesRecovered: number;
  pgBossJobsCancelled: number;
}

export async function recoverStuckJobs(): Promise<RecoveryStats> {
  console.log("🔄 Starting comprehensive job recovery scan...");
  
  const stats: RecoveryStats = {
    articlesRecovered: 0,
    socialPostsRecovered: 0,
    videoIdeasRecovered: 0,
    batchesRecovered: 0,
    pgBossJobsCancelled: 0,
  };

  // 1. Recover stuck video ideas (CRITICAL - these are expensive!)
  try {
    const stuckVideos = await withDbRetry(
      () => db.select({ id: videoIdeas.id, status: videoIdeas.status })
        .from(videoIdeas)
        .where(or(
          eq(videoIdeas.status, "EXPANDING"),
          eq(videoIdeas.status, "SCRIPTING"),
          eq(videoIdeas.status, "GENERATING"),
          eq(videoIdeas.status, "STITCHING")
        )),
      "stuck-video-ideas"
    );
    
    for (const video of stuckVideos) {
      await db.update(videoIdeas)
        .set({ 
          status: "PENDING",
          currentStage: "pending",
          progress: 0,
          errorMessage: `Auto-recovered from ${video.status} state - click Generate to retry`
        })
        .where(eq(videoIdeas.id, video.id));

      // Write to error_logs so Admin Error Log panel captures stuck idea recoveries
      try {
        await db.insert(errorLogs).values({
          errorType: "VIDEO",
          errorMessage: `Video Idea #${video.id} stuck in ${video.status} state — auto-reset to PENDING on server restart`,
          severity: "warning",
        });
      } catch (_) { /* non-fatal */ }
    }
    
    stats.videoIdeasRecovered = stuckVideos.length;
    if (stuckVideos.length > 0) {
      console.log(`  ✅ Recovered ${stuckVideos.length} stuck video ideas`);
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover video ideas:", e);
  }

  // 2. Recover stuck articles
  try {
    const stuckArticles = await db.select({ id: articles.id, articleStatus: articles.articleStatus })
      .from(articles)
      .where(or(
        eq(articles.articleStatus, "QUEUED"),
        eq(articles.articleStatus, "GEMINI_PENDING"),
        eq(articles.articleStatus, "GEMINI_PROCESSING"),
        eq(articles.articleStatus, "GPT_PENDING"),
        eq(articles.articleStatus, "GPT_PROCESSING")
      ));
    
    for (const article of stuckArticles) {
      await db.update(articles)
        .set({ 
          articleStatus: "PENDING",
          errorMessage: `Auto-recovered from ${article.articleStatus} state`
        })
        .where(eq(articles.id, article.id));
    }
    
    stats.articlesRecovered = stuckArticles.length;
    if (stuckArticles.length > 0) {
      console.log(`  ✅ Recovered ${stuckArticles.length} stuck articles`);
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover articles:", e);
  }

  // 2b. Recover FAILED articles with transient errors in RUNNING batches
  // -------------------------------------------------------------------------
  // Transient errors are retryable: network failures, DB connection drops,
  // Gemini/GPT timeouts.  Permanent errors (brand-safety, schema validation)
  // are intentionally excluded so they don't loop forever.
  // -------------------------------------------------------------------------
  try {
    const TRANSIENT_PATTERNS = [
      "fetch failed",
      "error connecting to database",
      "econnrefused",
      "econnreset",
      "etimedout",
      "exceeded hard timeout",
      "socket hang up",
      "network error",
      "eai_again",
    ];

    const failedWithBatch = await db
      .select({
        id: articles.id,
        batchId: articles.batchId,
        chosenTitle: articles.chosenTitle,
        errorMessage: articles.errorMessage,
        batchTargetUrl: jobBatches.targetUrl,
        batchGenerationParams: jobBatches.generationParams,
        batchBusinessName: jobBatches.businessName,
        batchCompanyLogoUrl: jobBatches.companyLogoUrl,
        batchPersonaId: jobBatches.personaId,
        batchTeamId: jobBatches.teamId,
      })
      .from(articles)
      .innerJoin(jobBatches, eq(articles.batchId, jobBatches.id))
      .where(and(
        eq(articles.articleStatus, "FAILED"),
        eq(jobBatches.status, "RUNNING")
      ));

    const transientFailed = failedWithBatch.filter((a) => {
      const err = (a.errorMessage || "").toLowerCase();
      return TRANSIENT_PATTERNS.some((p) => err.includes(p));
    });

    if (transientFailed.length > 0) {
      const { addArticleJob } = await import("./queue");
      for (const a of transientFailed) {
        const params = (a.batchGenerationParams || {}) as Record<string, unknown>;

        await db.update(articles)
          .set({
            articleStatus: "PENDING",
            errorMessage: `Auto-recovered from transient failure: ${(a.errorMessage || "").slice(0, 80)}`,
          })
          .where(eq(articles.id, a.id));

        await addArticleJob({
          articleId: a.id,
          batchId: a.batchId,
          runId: crypto.randomUUID(),
          title: a.chosenTitle || `Article ${a.id}`,
          targetUrl: a.batchTargetUrl || "",
          tone: params.tone as string | undefined,
          wordCountMin: params.wordCountMin as number | undefined,
          wordCountMax: params.wordCountMax as number | undefined,
          geographicFocus: params.geographicFocus as string | undefined,
          businessName: a.batchBusinessName || undefined,
          companyLogoUrl: a.batchCompanyLogoUrl || undefined,
          teamId: a.batchTeamId || undefined,
          personaId: a.batchPersonaId || undefined,
        });

        console.log(`  🔄 Re-queued transient-failed article #${a.id}: "${(a.chosenTitle || "").slice(0, 60)}" — was: ${(a.errorMessage || "").slice(0, 70)}`);
        stats.articlesRecovered++;
      }
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover transient-failed articles:", e);
  }

  // 2c. Recover failed publishing jobs with transient errors
  // -------------------------------------------------------------------------
  // Re-queues publishing_jobs that failed due to network flaps, DB drops, or
  // transient 5xx responses.  Permanent failures ("Invalid request parameters",
  // "incompatible receiver") are intentionally excluded.
  // Only retried if below max_attempts ceiling to prevent infinite loops.
  // -------------------------------------------------------------------------
  try {
    const PUBLISH_TRANSIENT_PATTERNS = [
      "fetch failed",
      "econnrefused",
      "econnreset",
      "etimedout",
      "socket hang up",
      "network error",
      "eai_again",
      "service unavailable",
      "503",
      "502",
      "504",
    ];

    const MAX_PUBLISH_RETRY_ATTEMPTS = 5;

    const failedPublishJobs = await withDbRetry(
      () => db.select({
        id: publishingJobs.id,
        teamId: publishingJobs.teamId,
        articleId: publishingJobs.articleId,
        lastError: publishingJobs.lastError,
        attempts: publishingJobs.attempts,
        maxAttempts: publishingJobs.maxAttempts,
      })
      .from(publishingJobs)
      .where(eq(publishingJobs.status, "failed")),
      "failed-publish-jobs"
    );

    const transientPublishFailed = failedPublishJobs.filter((j) => {
      const err = (j.lastError || "").toLowerCase();
      const isTransient = PUBLISH_TRANSIENT_PATTERNS.some((p) => err.includes(p));
      const belowCeiling = (j.attempts || 0) < MAX_PUBLISH_RETRY_ATTEMPTS;
      return isTransient && belowCeiling;
    });

    if (transientPublishFailed.length > 0) {
      const { addPublishingJob } = await import("./queue");
      for (const j of transientPublishFailed) {
        await db
          .update(publishingJobs)
          .set({ status: "pending" })
          .where(eq(publishingJobs.id, j.id));

        await addPublishingJob({ dbJobId: j.id, teamId: j.teamId! });
        console.log(`  🔄 Re-queued transient-failed publishing job #${j.id} (article #${j.articleId}) — was: ${(j.lastError || "").slice(0, 70)}`);
      }
      console.log(`  ✅ Recovered ${transientPublishFailed.length} transient-failed publishing job(s)`);
    } else {
      console.log("  ✓ No transient-failed publishing jobs to recover");
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover transient-failed publishing jobs:", e);
  }

  // 2d. Recover STALE-PENDING publishing jobs
  // -------------------------------------------------------------------------
  // When a job fails and shouldRetry=true, the DB is set to status='pending'
  // but the pg-boss job is already consumed. Without being re-enqueued the job
  // sits in 'pending' forever. Re-queue any pending publishing job whose last
  // attempt was >5 minutes ago (meaning pg-boss dropped it without a retry).
  // Also exclude jobs that already have a RECEIVER_REJECTED permanent error —
  // those should stay failed and not loop.
  // -------------------------------------------------------------------------
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stalePendingJobs = await withDbRetry(
      () => db.select({
        id: publishingJobs.id,
        teamId: publishingJobs.teamId,
        articleId: publishingJobs.articleId,
        attempts: publishingJobs.attempts,
        maxAttempts: publishingJobs.maxAttempts,
        lastError: publishingJobs.lastError,
      })
      .from(publishingJobs)
      .where(
        and(
          eq(publishingJobs.status, "pending"),
          lt(publishingJobs.updatedAt, fiveMinutesAgo),
        )
      ),
      "stale-pending-publish-jobs"
    );

    const eligibleStale = stalePendingJobs.filter((j) => {
      // Re-queue any stale-pending job that's below max attempts.
      // "Invalid request parameters" errors may have been caused by the old relative-URL
      // bug (now fixed) — the new payload uses absolute URLs so a fresh attempt is safe.
      // Jobs that get a 400 with the new payload will come back as 'failed' with
      // RECEIVER_REJECTED and won't be stuck in 'pending' again.
      return (j.attempts || 0) < (j.maxAttempts || 3);
    });

    if (eligibleStale.length > 0) {
      const { addPublishingJob } = await import("./queue");
      for (const j of eligibleStale) {
        await addPublishingJob({ dbJobId: j.id, teamId: j.teamId! });
        console.log(`  🔄 Re-queued stale-pending publishing job #${j.id} (article #${j.articleId}, attempts=${j.attempts})`);
      }
      console.log(`  ✅ Recovered ${eligibleStale.length} stale-pending publishing job(s)`);
    } else {
      console.log("  ✓ No stale-pending publishing jobs to recover");
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover stale-pending publishing jobs:", e);
  }

  // 3. Recover stuck social posts
  try {
    const stuckPosts = await db.select({ id: socialPosts.id, status: socialPosts.status })
      .from(socialPosts)
      .where(or(
        eq(socialPosts.status, "QUEUED"),
        eq(socialPosts.status, "GENERATING")
      ));
    
    for (const post of stuckPosts) {
      await db.update(socialPosts)
        .set({ 
          status: "PENDING",
          errorMessage: `Auto-recovered from ${post.status} state`
        })
        .where(eq(socialPosts.id, post.id));
    }
    
    stats.socialPostsRecovered = stuckPosts.length;
    if (stuckPosts.length > 0) {
      console.log(`  ✅ Recovered ${stuckPosts.length} stuck social posts`);
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover social posts:", e);
  }

  // 3b. Recover stuck social post VIDEO generation (videoStatus stuck at GENERATING)
  // Strategy: re-enqueue automatically if within max generation time, only fail if truly timed out.
  // This prevents server restarts from permanently failing in-progress videos.
  try {
    const stuckVideoPosts = await withDbRetry(
      () => db.select({ id: socialPosts.id, videoType: socialPosts.videoType, updatedAt: socialPosts.updatedAt, teamId: socialPosts.teamId })
        .from(socialPosts)
        .where(eq(socialPosts.videoStatus, "GENERATING")),
      "stuck-social-videos"
    );

    const boss = await getPgBoss();
    let requeued = 0;
    let failed = 0;

    if (stuckVideoPosts.length > 0) {
      for (const post of stuckVideoPosts) {
        const isVeo = post.videoType === "veo";
        // Max expected generation time: Veo = 95 min, Slideshow = 12 min
        const maxMinutes = isVeo ? 95 : 12;
        const elapsedMs = Date.now() - new Date(post.updatedAt).getTime();
        const elapsedMinutes = elapsedMs / 60_000;

        if (elapsedMinutes < maxMinutes) {
          // CRITICAL: If there is already an active pg-boss job for this post, it is still
          // running (e.g. FFmpeg mid-encode). Do NOT cancel it — just skip.
          // Only re-enqueue when there is NO active job (i.e. the previous process died).
          const activeCheck = await db.execute(sql`
            SELECT COUNT(*) as cnt
            FROM pgboss.job
            WHERE name = 'social-video-generation'
              AND state = 'active'
              AND (data->>'socialPostId')::int = ${post.id}
          `);
          const activeCount = Number((activeCheck as any).rows?.[0]?.cnt ?? 0);
          if (activeCount > 0) {
            console.log(`  ⏳ Social Post #${post.id} already has an active job running — skipping re-queue`);
            continue;
          }

          // No active job — server likely just restarted. Re-enqueue automatically.

          const platform = "tiktok";
          const expireInSeconds = isVeo ? 5400 : 900;

          await db.update(socialPosts)
            .set({
              videoStatus: "GENERATING",
              videoStage: "queued",
              videoProgress: 0,
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(socialPosts.id, post.id));

          await boss.send(
            "social-video-generation",
            { socialPostId: post.id, platform, videoType: post.videoType || "slideshow" },
            { retryLimit: isVeo ? 1 : 2, retryDelay: 30, expireInSeconds }
          );

          console.log(`  🔄 Re-queued Social Post #${post.id} ${isVeo ? "Veo" : "slideshow"} video (was generating ${elapsedMinutes.toFixed(1)}min, max ${maxMinutes}min)`);
          requeued++;
        } else {
          // Exceeded max time — genuinely timed out, mark as failed.
          const errorMsg = `Video generation exceeded maximum time (${maxMinutes} minutes) — click Regenerate Video to retry`;
          await db.update(socialPosts)
            .set({ videoStatus: "FAILED", errorMessage: errorMsg, updatedAt: new Date() })
            .where(eq(socialPosts.id, post.id));

          try {
            await db.insert(errorLogs).values({
              errorType: "VIDEO",
              errorMessage: `Social Post #${post.id} ${isVeo ? "Veo" : "slideshow"} video timed out after ${elapsedMinutes.toFixed(0)} minutes (max ${maxMinutes}min)`,
              severity: "error",
            });
          } catch (_) { /* non-fatal */ }

          // Notify the team via the in-app bell
          if (post.teamId) {
            void createNotification({
              teamId: post.teamId,
              type: "error",
              category: "video",
              title: "Video Generation Timed Out",
              message: `A ${post.videoType === "veo" ? "Veo AI" : "slideshow"} video timed out after ${elapsedMinutes.toFixed(0)} minutes. Open Social Media to click Regenerate Video.`,
              entityId: post.id,
              entityType: "social_post",
              actionUrl: `/social/dashboard`,
            }).catch(() => {});
          }

          console.log(`  ❌ Timed out Social Post #${post.id} after ${elapsedMinutes.toFixed(0)}min → FAILED`);
          failed++;
        }
      }

      if (requeued > 0) console.log(`  ✅ Auto-requeued ${requeued} social post video(s) after server restart`);
      if (failed > 0) console.log(`  ⚠️ Marked ${failed} social post video(s) as truly timed out → FAILED`);
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover stuck social post videos:", e);
  }

  // 4. Recover stuck batches
  try {
    const stuckBatches = await db.select({ id: jobBatches.id, status: jobBatches.status })
      .from(jobBatches)
      .where(or(
        eq(jobBatches.status, "GENERATING"),
        eq(jobBatches.status, "PROCESSING")
      ));
    
    for (const batch of stuckBatches) {
      await db.update(jobBatches)
        .set({ 
          status: "FAILED",
          errorMessage: `Auto-recovered from ${batch.status} state`
        } as any)
        .where(eq(jobBatches.id, batch.id));
    }
    
    stats.batchesRecovered = stuckBatches.length;
    if (stuckBatches.length > 0) {
      console.log(`  ✅ Recovered ${stuckBatches.length} stuck batches`);
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover batches:", e);
  }

  // 5. Cancel stuck pg-boss jobs
  try {
    await db.execute(sql`
      UPDATE pgboss.job 
      SET state = 'cancelled',
          completed_on = NOW()
      WHERE state = 'active' 
      AND started_on < NOW() - INTERVAL '30 minutes'
    `);
    console.log("  ✅ Cleaned up stuck pg-boss jobs");
  } catch (e) {
    console.warn("  ⚠️ Could not clean pg-boss jobs:", e);
  }

  const totalRecovered = stats.articlesRecovered + stats.socialPostsRecovered + 
                        stats.videoIdeasRecovered + stats.batchesRecovered;
  
  if (totalRecovered > 0) {
    console.log(`✅ Job recovery complete: ${totalRecovered} items recovered`);
  } else {
    console.log("✅ Job recovery complete: No stuck jobs found");
  }

  return stats;
}

export async function autoRequeueRecoveredVideos(): Promise<number> {
  try {
    const boss = await getPgBoss();
    
    const pendingVideos = await db.select({ 
      id: videoIdeas.id, 
      ideaTitle: videoIdeas.ideaTitle,
      errorMessage: videoIdeas.errorMessage 
    })
      .from(videoIdeas)
      .where(eq(videoIdeas.status, "PENDING"))
      .limit(5);
    
    // Only auto-requeue videos that were recently recovered (have error message)
    let queued = 0;
    for (const video of pendingVideos) {
      if (video.errorMessage?.includes("Auto-recovered")) {
        await db.update(videoIdeas)
          .set({ 
            status: "EXPANDING",
            currentStage: "queued",
            progress: 0,
            errorMessage: null
          })
          .where(eq(videoIdeas.id, video.id));
        
        await boss.send("video-idea-generation", { videoIdeaId: video.id });
        console.log(`  🎬 Auto-requeued video: "${video.ideaTitle}" (ID: ${video.id})`);
        queued++;
      }
    }
    
    return queued;
  } catch (e) {
    console.warn("  ⚠️ Auto-requeue failed:", e);
    return 0;
  }
}

let recoveryInterval: NodeJS.Timeout | null = null;

export function startJobRecoveryMonitor(intervalMinutes: number = 5) {
  console.log(`🔍 Starting job recovery monitor - checking every ${intervalMinutes} minutes`);
  
  // Run initial recovery
  recoverStuckJobs().then(stats => {
    console.log(`✅ [${new Date().toISOString()}] Initial recovery check complete`);
    if (stats.videoIdeasRecovered > 0) {
      autoRequeueRecoveredVideos().then(count => {
        if (count > 0) console.log(`  🎬 Auto-requeued ${count} recovered videos`);
      });
    }
  }).catch(e => console.error("Initial recovery error:", e));
  
  // Set up periodic recovery
  recoveryInterval = setInterval(async () => {
    try {
      const stats = await recoverStuckJobs();
      console.log(`✅ [${new Date().toISOString()}] Job recovery monitor check complete`);
      
      if (stats.videoIdeasRecovered > 0) {
        const requeued = await autoRequeueRecoveredVideos();
        if (requeued > 0) console.log(`  🎬 Auto-requeued ${requeued} recovered videos`);
      }
    } catch (e) {
      console.error("Job recovery monitor error:", e);
    }
  }, intervalMinutes * 60 * 1000);
  
  return recoveryInterval;
}

export function stopJobRecoveryMonitor() {
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
    console.log("🛑 Job recovery monitor stopped");
  }
}
