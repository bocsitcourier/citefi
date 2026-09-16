import { type Job } from "bullmq";
import {
  BillingSettlementError,
  assertEntityTeam,
  createPipelineWorker,
  resolveJobTeamId,
  isBillingSettlementError,
  isFinalPipelineAttempt,
} from "@/lib/pipeline-worker";
import {
  orchestrateVideoIdeaGeneration,
  type VideoIdeaOrchestrationDependencies,
} from "@/lib/veo-idea-orchestrator";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { notifyVideoComplete, notifyVideoFailed } from "@/lib/notification-service";
import { logError } from "@/lib/error-logger";
import { classifyError } from "@/lib/errors";
import {
  VIDEO_IDEA_GENERATION_QUEUE,
  type VideoIdeaJobData,
} from "@/lib/queue";

export const VIDEO_IDEA_RETRY_DISPOSITIONS = ["retry"] as const;

export interface VideoIdeaGenerationDependencies {
  isMediaFeatureEnabled?: () => boolean;
  isStorageConfigured?: boolean;
  assertRunBudget?: typeof import("@/lib/cost-ceilings").assertRunBudget;
  orchestrate?: typeof orchestrateVideoIdeaGeneration;
  /** Optional provider transport seams; production workers omit these. */
  orchestrationDependencies?: VideoIdeaOrchestrationDependencies;
  debitReservation?: typeof import("@/lib/billing").debitReservation;
  completeCapReservation?: typeof import("@/lib/usage-caps").completeCapReservation;
  recordUsageEvent?: typeof import("@/lib/usage-caps").recordUsageEvent;
  recordContentGenerated?: typeof import("@/lib/learning-integration").recordContentGenerated;
  notifyVideoComplete?: typeof notifyVideoComplete;
  logError?: typeof logError;
  notifyVideoFailed?: typeof notifyVideoFailed;
}

export async function processVideoIdeaGenerationJob(
  job: Job<VideoIdeaJobData>,
  dependencies: VideoIdeaGenerationDependencies = {}
) {
      if (!job || !job.data) {
        throw new Error("No job data received");
      }
      const { videoIdeaId, creditRunId } = job.data;
      console.log(`🎬 Processing video idea generation job: ${job.id}`);
      console.log(`   Video Idea ID: ${videoIdeaId}${creditRunId ? ` (creditRunId: ${creditRunId})` : " (unmetered — legacy)"}`);

      try {
        const [idea] = await db.select()
          .from(videoIdeas)
          .where(eq(videoIdeas.id, videoIdeaId))
          .limit(1);

        if (!idea) {
          throw new Error(`Video idea ${videoIdeaId} not found`);
        }

        // Authoritative entity/team cross-check: the video idea must belong to
        // the tenant this job runs as before any generation/billing happens.
        assertEntityTeam({
          entity: "videoIdea",
          entityId: videoIdeaId,
          jobTeamId: resolveJobTeamId(job.data.teamId ?? idea.teamId),
          entityTeamId: idea.teamId,
        });

        const workerJobId =
          job.id === undefined || job.id === null ? null : String(job.id);
        if (creditRunId && workerJobId && idea.jobId !== workerJobId) {
          await db
            .update(videoIdeas)
            .set({ jobId: workerJobId })
            .where(eq(videoIdeas.id, videoIdeaId));
        }

        // The job payload is the fast path, while the durable idea row is the
        // recovery source of truth. Legacy/recovered jobs may omit one or both
        // billing identifiers, but must still settle the original hold.
        const effectiveCreditRunId = idea.videoCreditRunId ?? creditRunId;
        const effectiveCapReservationId =
          idea.videoCapReservationId ?? job.data.capReservationId ?? null;
        const settlementOnly =
          idea.status === "READY" && Boolean(idea.videoUrl);

        // An acknowledgement lost after settlement must not regenerate media
        // or insert another usage event. The durable timestamp is written only
        // after debit + cap/event settlement succeeds.
        if (settlementOnly && idea.videoBillingSettledAt) {
          return { success: true, videoUrl: idea.videoUrl };
        }

        if (!settlementOnly) {
          // Generation-only prerequisites must never run during settlement
          // retries: content is already durable and its reservation must remain.
          const isMediaFeatureEnabled =
            dependencies.isMediaFeatureEnabled ??
            (await import("@/lib/storage")).isMediaFeatureEnabled;
          if (!isMediaFeatureEnabled()) {
            throw new Error("FEATURE_DISABLED: Media generation disabled");
          }

          const isStorageConfigured =
            dependencies.isStorageConfigured ??
            (await import("@/lib/storage")).isStorageConfigured;
          if (!isStorageConfigured) {
            throw new Error(
              "STORAGE_NOT_CONFIGURED: Video storage (DO Spaces) is not configured. " +
              "Set DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_ENDPOINT, and DO_SPACES_BUCKET."
            );
          }

          // Cost ceiling gate stays inside the processor try/catch so a genuine
          // generation failure receives domain cleanup before wrapper policy.
          if (effectiveCreditRunId) {
            const assertRunBudget =
              dependencies.assertRunBudget ??
              (await import("@/lib/cost-ceilings")).assertRunBudget;
            await assertRunBudget(effectiveCreditRunId, "video", "video_gen");
          }
        }

        const isLikeVideo = idea.isLikeVideo && !!idea.stylePrompt;
        console.log(`📋 Video idea found: "${idea.ideaTitle}" [${idea.style}/${idea.tone}]${isLikeVideo ? " (Like Video)" : ""}`);

        // A prior attempt may have completed and persisted the video before its
        // reservation debit failed. That durable READY state is settlement-only:
        // retry the debit below, never call Veo again.
        const result =
          settlementOnly && idea.videoUrl
            ? { videoUrl: idea.videoUrl }
            : await (dependencies.orchestrate ?? orchestrateVideoIdeaGeneration)({
                videoIdeaId: idea.id,
                ideaTitle: idea.ideaTitle,
                shortIdea: idea.shortIdea,
                companyName: idea.companyName || "",
                targetAudience: idea.targetAudience || undefined,
                style: idea.style as any,
                tone: idea.tone as any,
                callToAction: idea.callToAction,
                website: idea.website || undefined,
                companyLogoUrl: idea.companyLogoUrl || undefined,
                stylePromptOverride: isLikeVideo ? (idea.stylePrompt || undefined) : undefined,
              }, undefined, dependencies.orchestrationDependencies);

        console.log(`✅ Video idea generation complete: ${result.videoUrl}`);

        // Two-bucket billing: DEBIT reservation on success
        if (effectiveCreditRunId && idea.teamId) {
          const debitReservation =
            dependencies.debitReservation ??
            (await import("@/lib/billing")).debitReservation;
          let debitResult;
          try {
            debitResult = await debitReservation({
              teamId: idea.teamId,
              runId: effectiveCreditRunId,
              jobId: job.id,
            });
          } catch (debitError) {
            const debitMessage =
              debitError instanceof Error ? debitError.message : String(debitError);
            throw new BillingSettlementError(
              `Debit settlement threw for video idea ${videoIdeaId}: ${debitMessage}`,
              effectiveCreditRunId,
              debitError
            );
          }
          if (!debitResult.ok) {
            console.error(
              `[billing] DEBIT_FAILED for video idea ${videoIdeaId} (teamId=${idea.teamId} runId=${effectiveCreditRunId}). ` +
              `Video was generated but debit failed — throwing so BullMQ can retry the debit.`
            );
            throw new BillingSettlementError(
              `Debit settlement failed for video idea ${videoIdeaId}`,
              effectiveCreditRunId
            );
          }
          console.log(`[billing] Debited ${debitResult.fromAllowance + debitResult.fromPurchased} credits for video idea ${videoIdeaId}`);
          if (effectiveCapReservationId != null) {
            // Convert the original pending hold in place. Inserting a separate
            // completed event here would double-count the same video.
            const { capReservationSettlementJobId } = await import("@/lib/usage-caps");
            const completeCapReservation =
              dependencies.completeCapReservation ??
              (await import("@/lib/usage-caps")).completeCapReservation;
            try {
              await completeCapReservation({
                reservationId: effectiveCapReservationId,
                teamId: idea.teamId,
                jobId: capReservationSettlementJobId(effectiveCapReservationId),
                metadata: { videoIdeaId, sourceJobId: String(job.id ?? "") },
              });
            } catch (cause) {
              // The video is already durable; retry only this settlement path,
              // never the provider orchestration.
              throw new BillingSettlementError(
                `Cap settlement failed for delivered video idea ${videoIdeaId}`,
                effectiveCreditRunId,
                cause
              );
            }
          } else {
            // Legacy/unlimited jobs have no pending cap row to settle.
            const recordUsageEvent =
              dependencies.recordUsageEvent ??
              (await import("@/lib/usage-caps")).recordUsageEvent;
            await recordUsageEvent({
              teamId: idea.teamId,
              action: "video",
              units: 1,
              costEstimateCents: 15,
              jobId: String(job.id ?? ""),
              metadata: { videoIdeaId },
            }).catch((err: unknown) => console.warn(`[usage-caps] recordUsageEvent failed (non-fatal):`, err));
          }
          try {
            await db.update(videoIdeas)
              .set({ videoBillingSettledAt: new Date(), updatedAt: new Date() })
              .where(eq(videoIdeas.id, videoIdeaId));
          } catch (cause) {
            throw new BillingSettlementError(
              `Billing checkpoint failed for delivered video idea ${videoIdeaId}`,
              effectiveCreditRunId,
              cause
            );
          }
        } else if (effectiveCapReservationId != null && idea.teamId) {
          const { capReservationSettlementJobId } = await import("@/lib/usage-caps");
          const completeCapReservation =
            dependencies.completeCapReservation ??
            (await import("@/lib/usage-caps")).completeCapReservation;
          try {
            await completeCapReservation({
              reservationId: effectiveCapReservationId,
              teamId: idea.teamId,
              jobId: capReservationSettlementJobId(effectiveCapReservationId),
              metadata: { videoIdeaId, sourceJobId: String(job.id ?? "") },
            });
          } catch (cause) {
            throw new BillingSettlementError(
              `Cap settlement failed for delivered video idea ${videoIdeaId}`,
              undefined,
              cause
            );
          }
          try {
            await db.update(videoIdeas)
              .set({ videoBillingSettledAt: new Date(), updatedAt: new Date() })
              .where(eq(videoIdeas.id, videoIdeaId));
          } catch (cause) {
            throw new BillingSettlementError(
              `Billing checkpoint failed for delivered video idea ${videoIdeaId}`,
              undefined,
              cause
            );
          }
        }

        // Record content generation metrics so Thompson Sampling can learn for video
        if (idea.teamId) {
          try {
            const recordContentGenerated =
              dependencies.recordContentGenerated ??
              (await import("@/lib/learning-integration")).recordContentGenerated;
            await recordContentGenerated(idea.teamId, "video", videoIdeaId, [], 75);
          } catch (metricsErr) {
            console.warn("[VIDEO_WORKER] Could not record learning metrics (non-fatal):", metricsErr);
          }
          await (dependencies.notifyVideoComplete ?? notifyVideoComplete)(
            idea.teamId,
            videoIdeaId,
            idea.ideaTitle
          );
        }

        return { success: true, videoUrl: result.videoUrl };

      } catch (error) {
        console.error(`❌ Video idea generation failed for ID ${videoIdeaId}:`, error);

        const errMsg = error instanceof Error ? error.message : String(error);
        if (isBillingSettlementError(error)) {
          await (dependencies.logError ?? logError)({
            errorType: "VIDEO",
            errorMessage: errMsg,
            stackTrace: error instanceof Error ? error.stack : undefined,
            severity: "error",
            component: "VideoIdeaWorker",
            context: { videoIdeaId, billingPending: true },
          });
          // Content is already durable. Preserve READY/videoUrl and let the
          // wrapper retry settlement without ever releasing the reservation.
          throw error;
        }

        const classified = classifyError(error, "video_gen", { provider: "veo" });
        const isQuotaError = classified.code === "RATE_LIMITED";
        const isFinalAttempt = isFinalPipelineAttempt(
          job,
          classified,
          false,
          VIDEO_IDEA_RETRY_DISPOSITIONS
        );
        const willRetry = !isFinalAttempt;

        await (dependencies.logError ?? logError)({
          errorType: "VIDEO",
          errorMessage: errMsg,
          stackTrace: error instanceof Error ? error.stack : undefined,
          severity: isQuotaError ? "warning" : "error",
          component: "VideoIdeaWorker",
          context: { videoIdeaId },
        });

        const [idea] = await db.select()
          .from(videoIdeas)
          .where(eq(videoIdeas.id, videoIdeaId))
          .limit(1);

        const isBudgetError = classified.code === "BUDGET_EXCEEDED";
        const displayError = isQuotaError
          ? "Veo video quota exceeded. Please try again in a few minutes or switch to Slideshow mode."
          : isBudgetError
          ? "Generation budget reached for this run. Credits were returned — retry with a shorter prompt or contact support."
          : errMsg;

        await db.update(videoIdeas)
          .set({
            // Every retryable failure remains queued between attempts, not
            // just quota failures. Only fatal/exhausted work is terminal.
            status: willRetry ? "EXPANDING" : "FAILED",
            progress: 0,
            currentStage: willRetry ? "retry_wait" : "error",
            errorMessage: displayError,
            updatedAt: new Date(),
          })
          .where(eq(videoIdeas.id, videoIdeaId));

        if (idea?.teamId && !willRetry) {
          if (isBudgetError) {
            // Budget-stopped: warn rather than error so users know credits were
            // returned and the failure is a ceiling, not a provider problem.
            const { createNotification } = await import("@/lib/notification-service");
            await createNotification({
              teamId: idea.teamId,
              type: "warning",
              category: "video",
              title: "Budget Limit Reached",
              message: `"${idea.ideaTitle.slice(0, 80)}" hit its generation budget. Credits were returned — retry with a shorter prompt.`,
              entityId: videoIdeaId,
              entityType: "video_idea",
              actionUrl: `/social/idea-video`,
            });
          } else {
            await (dependencies.notifyVideoFailed ?? notifyVideoFailed)(
              idea.teamId,
              videoIdeaId,
              idea.ideaTitle,
              displayError
            );
          }
        }

        // Every failure returns to the shared pipeline policy. RATE_LIMITED
        // errors use BullMQ backoff; the wrapper releases credits only after
        // the final failed attempt.
        throw error;
      }
}

export async function getVideoIdeaGenerationBilling(
  job: Pick<Job<VideoIdeaJobData>, "data">
) {
  const [ideaRow] = await db.select({
    teamId: videoIdeas.teamId,
    videoCreditRunId: videoIdeas.videoCreditRunId,
    videoCapReservationId: videoIdeas.videoCapReservationId,
  })
    .from(videoIdeas)
    .where(eq(videoIdeas.id, job.data.videoIdeaId))
    .limit(1);
  const runId = ideaRow?.videoCreditRunId ?? job.data.creditRunId;
  if (!runId && ideaRow?.videoCapReservationId == null && job.data.capReservationId == null) {
    return null;
  }
  return {
    teamId: ideaRow?.teamId,
    runId,
    reason: `Video idea generation failed for ID ${job.data.videoIdeaId}`,
    capReservationId: ideaRow?.videoCapReservationId ?? job.data.capReservationId ?? null,
  };
}

export async function registerVideoIdeaWorker(): Promise<void> {
  const queueName = VIDEO_IDEA_GENERATION_QUEUE;
  const concurrency = 5;

  console.log(`🎬 Registering video idea generation worker for queue: "${queueName}"`);

  createPipelineWorker<VideoIdeaJobData>(
    queueName,
    processVideoIdeaGenerationJob,
    {
      stage: "video_gen",
      concurrency,
      execution: {
        scope: "tenant",
        getTeamId: async (j) => {
          if (j.data.teamId) return j.data.teamId;
          // Resolve the owning team from the durable video idea row when the
          // payload predates teamId (legacy jobs).
          const [row] = await db
            .select({ teamId: videoIdeas.teamId })
            .from(videoIdeas)
            .where(eq(videoIdeas.id, j.data.videoIdeaId))
            .limit(1);
          return row?.teamId ?? null;
        },
        systemTeamResolutionReason:
          "legacy video idea job: resolve durable video owner",
        getUserId: (j) => j.data.userId ?? null,
      },
      budget: { contentType: "video", getRunId: (j) => j.data.creditRunId },
      getBilling: getVideoIdeaGenerationBilling,
      retryDispositions: VIDEO_IDEA_RETRY_DISPOSITIONS,
    }
  );

  console.log(`✅ Video idea generation worker registered (${concurrency} concurrent workers)`);
}
