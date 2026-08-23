import { systemDb as db } from "./db";
import { articles, articleRuns, jobBatches, socialPosts, videoIdeas, errorLogs, publishingJobs } from "@/shared/schema";
import { eq, inArray, isNull, or, sql, and, lt } from "drizzle-orm";
import { addVideoGenerationJob, addVideoIdeaJob } from "./queue";
import { createNotification } from "./notification-service";
import {
  runWithSystemContext,
  runWithTenantContext,
} from "./tenant-context";

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
    // Only reset video ideas that have been stuck for >30 minutes.
    // Video generation (all stages) completes within 30 min under normal load.
    // Without this guard the 5-minute periodic scan would kill any legitimately
    // running video idea every interval.
    const THIRTY_MINUTES_AGO = new Date(Date.now() - 30 * 60 * 1000);
    const stuckVideos = await withDbRetry(
      () => db.select({ id: videoIdeas.id, status: videoIdeas.status })
        .from(videoIdeas)
        .where(and(
          or(
            eq(videoIdeas.status, "EXPANDING"),
            eq(videoIdeas.status, "SCRIPTING"),
            eq(videoIdeas.status, "GENERATING"),
            eq(videoIdeas.status, "STITCHING")
          ),
          lt(videoIdeas.updatedAt, THIRTY_MINUTES_AGO)
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
  // ─────────────────────────────────────────────────────────────────────────
  // Matches the REAL article status taxonomy written by lib/worker.ts:
  //   IN_PROGRESS     — worker is actively generating (timeout: 15 min)
  // Only pre-durable legacy IN_PROGRESS rows are eligible here. Any row with an
  // article_run, or any row with durable content, must be recovered by the
  // same-run monitor rather than forking a fresh run ID.
  // ─────────────────────────────────────────────────────────────────────────
  try {
    const FIFTEEN_MINUTES_AGO = new Date(Date.now() - 15 * 60 * 1000);
    // IN_PROGRESS articles that haven't been touched in 15+ minutes are orphaned
    const stuckInProgress = await withDbRetry(
      () => db.select({
        id: articles.id,
        articleStatus: articles.articleStatus,
        finalHtmlContent: articles.finalHtmlContent,
      })
        .from(articles)
        .where(and(
          eq(articles.articleStatus, "IN_PROGRESS"),
          lt(articles.updatedAt, FIFTEEN_MINUTES_AGO)
        )),
      "stuck-in-progress-articles"
    );

    const stuckArticles = stuckInProgress;
    const durableRunArticleIds = stuckArticles.length > 0
      ? await withDbRetry(
          () => db
            .select({ articleId: articleRuns.articleId })
            .from(articleRuns)
            .where(inArray(articleRuns.articleId, stuckArticles.map((article) => article.id))),
          "durable-article-runs"
        )
      : [];
    const durablyOwnedArticles = new Set(
      durableRunArticleIds.map((run) => run.articleId)
    );
    const legacyStuckArticles = stuckArticles.filter(
      (article) =>
        !durablyOwnedArticles.has(article.id) &&
        !(article.finalHtmlContent ?? "").trim()
    );

    for (const article of legacyStuckArticles) {
      await db.update(articles)
        .set({ 
          articleStatus: "PENDING",
          errorMessage: `Auto-recovered from ${article.articleStatus} state (orphaned after worker crash)`
        })
        .where(eq(articles.id, article.id));
    }
    
    stats.articlesRecovered = legacyStuckArticles.length;
    if (legacyStuckArticles.length > 0) {
      console.log(`  ✅ Recovered ${legacyStuckArticles.length} legacy stuck articles without durable runs`);
    }
  } catch (e) {
    console.warn("  ⚠️ Could not recover articles:", e);
  }

  // FAILED article rows are never auto-replayed on startup. A manual retry can
  // make an explicit spend decision; durable recovery belongs to article_runs.

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
    // Only reset posts that have been stuck for >15 minutes.
    // Platform variant generation (Gemini × N platforms + GPT enhancement) takes
    // up to ~10 minutes under normal load. Without this guard the 5-minute periodic
    // scan would kill any currently-running social post every interval.
    const FIFTEEN_MINUTES_AGO = new Date(Date.now() - 15 * 60 * 1000);
    const stuckPosts = await db.select({ id: socialPosts.id, status: socialPosts.status })
      .from(socialPosts)
      .where(and(
        or(
          eq(socialPosts.status, "QUEUED"),
          eq(socialPosts.status, "GENERATING")
        ),
        lt(socialPosts.updatedAt, FIFTEEN_MINUTES_AGO)
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
      () => db.select({
          id: socialPosts.id,
          videoType: socialPosts.videoType,
          updatedAt: socialPosts.updatedAt,
          teamId: socialPosts.teamId,
          videoCreditRunId: socialPosts.videoCreditRunId,
          videoCapReservationId: socialPosts.videoCapReservationId,
        })
        .from(socialPosts)
        .where(eq(socialPosts.videoStatus, "GENERATING")),
      "stuck-social-videos"
    );

    let requeued = 0;
    let failed = 0;

    if (stuckVideoPosts.length > 0) {
      // If storage is not configured, requeuing would just produce a fast
      // STORAGE_NOT_CONFIGURED failure in the worker — skip requeue and mark
      // posts FAILED immediately with a clear explanation.
      const { isStorageConfigured } = await import("./storage");

      for (const post of stuckVideoPosts) {
        if (!isStorageConfigured) {
          const storageMsg =
            "Video storage (DO Spaces) is not configured — generation cannot be retried. " +
            "Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, and DO_SPACES_BUCKET.";
          await db.update(socialPosts)
            .set({ videoStatus: "FAILED", errorMessage: storageMsg, updatedAt: new Date() })
            .where(eq(socialPosts.id, post.id));

          // Release the credit reservation so credits are not stranded indefinitely.
          if (post.videoCreditRunId && post.teamId) {
            const { releaseReservation } = await import("./billing");
            await runWithTenantContext(
              {
                actorType: "worker",
                userId: null,
                teamId: post.teamId,
                role: "worker",
              },
              () =>
                releaseReservation({
                  teamId: post.teamId!,
                  runId: post.videoCreditRunId!,
                  reason: `Recovery: STORAGE_NOT_CONFIGURED for social post ${post.id}`,
                })
            ).catch((e) => console.warn(`  ⚠️ [recovery] releaseReservation for post ${post.id}:`, e));
          }

          // Cancel the spending-cap reservation that was persisted with this post.
          // We cancel only this specific reservation (by its usageEvents.id) so
          // unrelated concurrent reservations for the same team are not affected.
          if (post.videoCapReservationId) {
            const { cancelCapReservation } = await import("./usage-caps");
            if (!post.teamId) {
              console.warn(
                `  ⚠️ [recovery] Cannot cancel cap reservation for post ${post.id}: teamId is missing`
              );
            } else {
              await runWithTenantContext(
                {
                  actorType: "worker",
                  userId: null,
                  teamId: post.teamId,
                  role: "worker",
                },
                () => cancelCapReservation(post.videoCapReservationId!)
              ).catch((e) =>
                console.warn(`  ⚠️ [recovery] cancelCapReservation(${post.videoCapReservationId}) for post ${post.id}:`, e)
              );
            }
          }

          // Release the per-user Redis concurrency slot so the user can start
          // a new video immediately rather than waiting for the 2h TTL.
          const { releaseVideoSlotForPost } = await import("./user-gate");
          await releaseVideoSlotForPost(post.id).catch((e) =>
            console.warn(`  ⚠️ [recovery] releaseVideoSlotForPost for post ${post.id}:`, e)
          );

          console.log(`  ❌ Skipped requeue for Social Post #${post.id}: storage not configured (credits + slot released)`);
          continue;
        }

        const isVeo = post.videoType === "veo";
        // Max expected generation time: Veo = 95 min, Slideshow = 20 min
        const maxMinutes = isVeo ? 95 : 20;
        const elapsedMs = Date.now() - new Date(post.updatedAt).getTime();
        const elapsedMinutes = elapsedMs / 60_000;

        if (elapsedMinutes < maxMinutes) {
          // Server likely just restarted — re-enqueue the video job automatically.
          // BullMQ handles stalled-job detection on its own; job-recovery just ensures
          // posts showing GENERATING get a new job if they have none.

          const platform = "tiktok";

          await db.update(socialPosts)
            .set({
              videoStatus: "GENERATING",
              videoStage: "queued",
              videoProgress: 0,
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(socialPosts.id, post.id));

          // Pass the original creditRunId so the pipeline worker can debit or
          // release the same reservation that was created at enqueue time.
          if (!post.teamId) {
            throw new Error(
              `Cannot recover social video ${post.id} without a positive teamId`
            );
          }
          await runWithTenantContext(
            {
              actorType: "worker",
              userId: null,
              teamId: post.teamId,
              role: "worker",
            },
            () =>
              addVideoGenerationJob({
                socialPostId: post.id,
                platform,
                videoType: post.videoType || "slideshow",
                teamId: post.teamId!,
                ...(post.videoCreditRunId ? { creditRunId: post.videoCreditRunId } : {}),
              })
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
            void runWithTenantContext(
              {
                actorType: "worker",
                userId: null,
                teamId: post.teamId,
                role: "worker",
              },
              () =>
                createNotification({
                  teamId: post.teamId!,
                  type: "error",
                  category: "video",
                  title: "Video Generation Timed Out",
                  message: `A ${post.videoType === "veo" ? "Veo AI" : "slideshow"} video timed out after ${elapsedMinutes.toFixed(0)} minutes. Open Social Media to click Regenerate Video.`,
                  entityId: post.id,
                  entityType: "social_post",
                  actionUrl: `/social/dashboard`,
                })
            ).catch(() => {});
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

  // Note: BullMQ handles stalled-job detection automatically via stalledInterval +
  // maxStalledCount on each Worker, so no manual stuck-job SQL cleanup is needed here.

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
    const pendingVideos = await db.select({ 
      id: videoIdeas.id, 
      teamId: videoIdeas.teamId,
      userId: videoIdeas.userId,
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
        const jobData = getRecoveredVideoJobData(video);
        await db.update(videoIdeas)
          .set({ 
            status: "EXPANDING",
            currentStage: "queued",
            progress: 0,
            errorMessage: null
          })
          .where(eq(videoIdeas.id, video.id));
        
        await runWithSystemContext(
          `auto-requeue recovered video idea ${video.id}`,
          () => addVideoIdeaJob(jobData)
        );
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

export function getRecoveredVideoJobData(video: {
  id: number;
  teamId: number | null;
  userId: number;
}) {
  if (!Number.isInteger(video.teamId) || (video.teamId ?? 0) <= 0) {
    throw new Error(
      `Cannot auto-requeue recovered video ${video.id} without a positive teamId`
    );
  }
  return {
    videoIdeaId: video.id,
    teamId: video.teamId!,
    userId: video.userId,
  };
}

let recoveryInterval: NodeJS.Timeout | null = null;

export function startJobRecoveryMonitor(intervalMinutes: number = 5) {
  console.log(`🔍 Starting job recovery monitor - checking every ${intervalMinutes} minutes`);
  
  // Run initial recovery
  recoverStuckJobs().then(stats => {
    console.log(`✅ [${new Date().toISOString()}] Initial recovery check complete`);
    if (stats.videoIdeasRecovered > 0) {
      void autoRequeueRecoveredVideos().then(count => {
        if (count > 0) console.log(`  🎬 Auto-requeued ${count} recovered videos`);
      });
    }
  }).catch(e => console.error("Initial recovery error:", e));
  
  // In-flight guard: prevents concurrent recovery scans if a scan takes
  // longer than the interval (e.g. DB is slow under heavy load or many
  // stuck jobs need processing). Without this guard, overlapping scans
  // can concurrently reset/re-enqueue the same articles.
  let recoveryRunning = false;

  // Set up periodic recovery
  recoveryInterval = setInterval(async () => {
    if (recoveryRunning) {
      console.log("⏭️ Recovery scan already in progress — skipping tick to prevent concurrent resets");
      return;
    }
    recoveryRunning = true;
    try {
      const stats = await recoverStuckJobs();
      console.log(`✅ [${new Date().toISOString()}] Job recovery monitor check complete`);
      
      if (stats.videoIdeasRecovered > 0) {
        const requeued = await autoRequeueRecoveredVideos();
        if (requeued > 0) console.log(`  🎬 Auto-requeued ${requeued} recovered videos`);
      }
    } catch (e) {
      console.error("Job recovery monitor error:", e);
    } finally {
      recoveryRunning = false;
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
