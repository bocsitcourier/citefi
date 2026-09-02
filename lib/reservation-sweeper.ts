import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { releaseReservation } from "@/lib/billing";
import { protectsDeliveredReservation } from "@/lib/article-run-state";
import {
  addVideoIdeaJob,
  getQueue,
  getVideoIdeaJobIdForRunId,
  PODCAST_GENERATION_QUEUE,
  SOCIAL_POST_GENERATION_QUEUE,
  SOCIAL_VIDEO_GENERATION_QUEUE,
  VIDEO_IDEA_GENERATION_QUEUE,
} from "@/lib/queue";
import {
  articleRuns,
  articles,
  creditLedger,
  socialPosts,
  videoIdeas,
} from "@/shared/schema";

export interface VideoSettlementRecovery {
  videoIdeaId: number;
  teamId: number;
  userId: number;
  creditRunId: string;
  jobId: string;
}

export interface SweepStaleReservationsOptions {
  cutoff?: Date;
  limit?: number;
  teamId?: number;
  requeueVideoSettlement?: (
    recovery: VideoSettlementRecovery
  ) => Promise<void>;
  requeueDeliveredSettlement?: (queueName: string, jobId: string) => Promise<void>;
}

export interface SweepStaleReservationsResult {
  found: number;
  protected: number;
  requeued: number;
  released: number;
  skipped: number;
}

export async function requeueDeliveredSettlement(
  queueName: string,
  jobId: string
): Promise<void> {
  const job = await getQueue(queueName).getJob(jobId);
  if (!job) throw new Error(`Settlement recovery job ${queueName}/${jobId} is no longer retained`);
  const state = await job.getState();
  if (state === "failed" || state === "completed") {
    await job.retry(state, {
      resetAttemptsMade: true,
      resetAttemptsStarted: true,
    });
    return;
  }
  if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) {
    return;
  }
  throw new Error(`Cannot recover settlement job ${queueName}/${jobId} from ${state}`);
}

export async function requeueVideoSettlement(
  recovery: VideoSettlementRecovery
): Promise<void> {
  const queue = getQueue(VIDEO_IDEA_GENERATION_QUEUE);
  const existingJob = await queue.getJob(recovery.jobId);

  if (existingJob) {
    const state = await existingJob.getState();
    if (state === "failed" || state === "completed") {
      await existingJob.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      return;
    }
    if (
      state === "active" ||
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      return;
    }
    throw new Error(
      `Cannot recover video settlement job ${recovery.jobId} from state ${state}`
    );
  }

  const queuedJobId = await addVideoIdeaJob({
    videoIdeaId: recovery.videoIdeaId,
    teamId: recovery.teamId,
    userId: recovery.userId,
    creditRunId: recovery.creditRunId,
  });
  if (queuedJobId !== recovery.jobId) {
    throw new Error(
      `Video settlement recovery job ID mismatch: expected ${recovery.jobId}, got ${queuedJobId}`
    );
  }
}

export async function sweepStaleReservations(
  options: SweepStaleReservationsOptions = {}
): Promise<SweepStaleReservationsResult> {
  const cutoff =
    options.cutoff ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const limit = options.limit ?? 500;
  const staleFilters = [
    eq(creditLedger.eventType, "reserve"),
    eq(creditLedger.reservationStatus, "RESERVED"),
    lt(creditLedger.createdAt, cutoff),
  ];
  if (options.teamId !== undefined) {
    staleFilters.push(eq(creditLedger.teamId, options.teamId));
  }

  const stale = await db
    .select({
      id: creditLedger.id,
      teamId: creditLedger.teamId,
      runId: creditLedger.runId,
      amount: creditLedger.amount,
    })
    .from(creditLedger)
    .where(and(...staleFilters))
    .limit(limit);

  if (stale.length === 0) {
    console.log("[reservation-sweeper] No stale reservations found");
    return {
      found: 0,
      protected: 0,
      requeued: 0,
      released: 0,
      skipped: 0,
    };
  }

  console.warn(
    `[reservation-sweeper] Found ${stale.length} stale RESERVED reservation(s) — reconciling`
  );

  const staleRunIds = stale
    .map((row) => row.runId)
    .filter((runId): runId is string => Boolean(runId));

  const deliveredArticleSettlements =
    staleRunIds.length > 0
      ? await db
          .select({
            status: articleRuns.status,
            billingRunId: articleRuns.billingRunId,
            articleStatus: articles.articleStatus,
          })
          .from(articleRuns)
          .innerJoin(articles, eq(articles.id, articleRuns.articleId))
          .where(
            and(
              inArray(articleRuns.billingRunId, staleRunIds),
              inArray(articleRuns.status, ["billing_pending", "running"])
            )
          )
      : [];

  const videoRunIdByJobId = new Map(
    staleRunIds.map((runId) => [getVideoIdeaJobIdForRunId(runId), runId])
  );
  const deliveredVideoSettlements =
    videoRunIdByJobId.size > 0
      ? await db
          .select({
            id: videoIdeas.id,
            teamId: videoIdeas.teamId,
            userId: videoIdeas.userId,
            jobId: videoIdeas.jobId,
            videoUrl: videoIdeas.videoUrl,
          })
          .from(videoIdeas)
          .where(
            and(
              inArray(videoIdeas.jobId, [...videoRunIdByJobId.keys()]),
              eq(videoIdeas.status, "READY"),
              isNotNull(videoIdeas.videoUrl)
            )
          )
      : [];

  const deliveredSocialSettlements =
    staleRunIds.length > 0
      ? await db.select({
          id: socialPosts.id,
          jobId: socialPosts.jobId,
          billingRunId: socialPosts.billingRunId,
          videoCreditRunId: socialPosts.videoCreditRunId,
          status: socialPosts.status,
          videoStatus: socialPosts.videoStatus,
          videoUrl: socialPosts.videoUrl,
        }).from(socialPosts).where(or(
          inArray(socialPosts.billingRunId, staleRunIds),
          inArray(socialPosts.videoCreditRunId, staleRunIds)
        ))
      : [];

  const deliveredPodcastSettlements =
    staleRunIds.length > 0
      ? await db.select({
          id: articles.id,
          podcastCreditRunId: articles.podcastCreditRunId,
          podcastStatus: articles.podcastStatus,
          podcastUrl: articles.podcastUrl,
        }).from(articles).where(inArray(articles.podcastCreditRunId, staleRunIds))
      : [];

  const protectedRunIds = new Set(
    deliveredArticleSettlements
      .filter((run) =>
        protectsDeliveredReservation({
          articleRunStatus: run.status,
          articleStatus: run.articleStatus,
          billingRunId: run.billingRunId,
          reservationRunId: run.billingRunId,
        })
      )
      .map((run) => run.billingRunId!)
  );
  for (const video of deliveredVideoSettlements) {
    const runId = video.jobId
      ? videoRunIdByJobId.get(video.jobId)
      : undefined;
    if (runId && video.videoUrl) {
      protectedRunIds.add(runId);
    }
  }
  for (const social of deliveredSocialSettlements) {
    if (social.status === "READY" && social.billingRunId) {
      protectedRunIds.add(social.billingRunId);
    }
    if (
      social.videoStatus === "READY" &&
      social.videoUrl &&
      social.videoCreditRunId
    ) {
      protectedRunIds.add(social.videoCreditRunId);
    }
  }
  for (const podcast of deliveredPodcastSettlements) {
    if (
      podcast.podcastStatus === "ready" &&
      podcast.podcastUrl &&
      podcast.podcastCreditRunId
    ) {
      protectedRunIds.add(podcast.podcastCreditRunId);
    }
  }
  const settlementJobByRunId = new Map<string, { queueName: string; jobId: string }>();
  for (const social of deliveredSocialSettlements) {
    if (social.status === "READY" && social.billingRunId && social.jobId) {
      settlementJobByRunId.set(social.billingRunId, {
        queueName: SOCIAL_POST_GENERATION_QUEUE,
        jobId: social.jobId,
      });
    }
    if (social.videoStatus === "READY" && social.videoCreditRunId) {
      settlementJobByRunId.set(social.videoCreditRunId, {
        queueName: SOCIAL_VIDEO_GENERATION_QUEUE,
        jobId: `video:${social.videoCreditRunId}`,
      });
    }
  }
  for (const podcast of deliveredPodcastSettlements) {
    if (podcast.podcastStatus === "ready" && podcast.podcastCreditRunId) {
      settlementJobByRunId.set(podcast.podcastCreditRunId, {
        queueName: PODCAST_GENERATION_QUEUE,
        jobId: `podcast:${podcast.id}`,
      });
    }
  }
  const videoSettlementByRunId = new Map(
    deliveredVideoSettlements.flatMap((video) => {
      const runId = video.jobId
        ? videoRunIdByJobId.get(video.jobId)
        : undefined;
      return runId && video.teamId && video.jobId
        ? [[runId, {
            videoIdeaId: video.id,
            teamId: video.teamId,
            userId: video.userId,
            creditRunId: runId,
            jobId: video.jobId,
          }] as const]
        : [];
    })
  );

  let requeued = 0;
  let released = 0;
  let skipped = 0;

  for (const row of stale) {
    try {
      if (!row.runId) {
        skipped += 1;
        console.warn(
          `[reservation-sweeper] Reservation id=${row.id} has no runId; leaving it untouched`
        );
        continue;
      }

      if (protectedRunIds.has(row.runId)) {
        skipped += 1;
        const videoSettlement = videoSettlementByRunId.get(row.runId);
        if (videoSettlement) {
          const requeue =
            options.requeueVideoSettlement ?? requeueVideoSettlement;
          await requeue(videoSettlement);
          requeued += 1;
        } else {
          const settlementJob = settlementJobByRunId.get(row.runId);
          if (settlementJob) {
            const requeue =
              options.requeueDeliveredSettlement ?? requeueDeliveredSettlement;
            await requeue(settlementJob.queueName, settlementJob.jobId);
            requeued += 1;
          }
        }
        console.warn(
          `[reservation-sweeper] Protected delivered content for runId=${row.runId}; ` +
            `leaving reservation RESERVED for settlement reconciliation` +
            (videoSettlement ? " and requeueing its settlement-only job" : "")
        );
        continue;
      }

      // Compute per-reservation remaining credits instead of using the
      // team-wide reserved aggregate. Batch reservations may be partly settled.
      const events = await db
        .select({
          eventType: creditLedger.eventType,
          amount: creditLedger.amount,
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.teamId, row.teamId),
            eq(creditLedger.runId, row.runId),
            inArray(creditLedger.eventType, ["debit", "release"])
          )
        );

      const debited = events
        .filter((event) => event.eventType === "debit")
        .reduce((sum, event) => sum + Math.abs(event.amount ?? 0), 0);
      const priorReleased = events
        .filter((event) => event.eventType === "release")
        .reduce((sum, event) => sum + (event.amount ?? 0), 0);
      const remaining = (row.amount ?? 0) - debited - priorReleased;

      if (remaining <= 0) {
        await db
          .update(creditLedger)
          .set({ reservationStatus: "RELEASED" })
          .where(
            and(
              eq(creditLedger.id, row.id),
              eq(creditLedger.reservationStatus, "RESERVED")
            )
          );
        released += 1;
        console.log(
          `[reservation-sweeper] runId=${row.runId} teamId=${row.teamId} already fully settled — marked RELEASED`
        );
        continue;
      }

      await releaseReservation({
        teamId: row.teamId,
        runId: row.runId,
        amount: remaining,
        reason: "Stale reservation sweeper (>24h RESERVED, no delivered content)",
      });

      await db
        .update(creditLedger)
        .set({ reservationStatus: "RELEASED" })
        .where(
          and(
            eq(creditLedger.id, row.id),
            eq(creditLedger.reservationStatus, "RESERVED")
          )
        );

      released += 1;
      console.log(
        `[reservation-sweeper] Released runId=${row.runId} teamId=${row.teamId} ` +
          `remaining=${remaining} (original=${row.amount})`
      );
    } catch (error) {
      skipped += 1;
      console.error(
        `[reservation-sweeper] Failed to release runId=${row.runId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(
    `[reservation-sweeper] Done: protected=${protectedRunIds.size} requeued=${requeued} ` +
      `released=${released} skipped=${skipped}`
  );
  return {
    found: stale.length,
    protected: protectedRunIds.size,
    requeued,
    released,
    skipped,
  };
}