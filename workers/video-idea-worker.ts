import { type Job } from "bullmq";
import {
  BillingSettlementError,
  createPipelineWorker,
  isBillingSettlementError,
  isFinalPipelineAttempt,
} from "@/lib/pipeline-worker";
import { orchestrateVideoIdeaGeneration } from "@/lib/veo-idea-orchestrator";
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
  isStorageConfigured?: boolean;
  assertRunBudget?: typeof import("@/lib/cost-ceilings").assertRunBudget;
  orchestrate?: typeof orchestrateVideoIdeaGeneration;
  debitReservation?: typeof import("@/lib/billing").debitReservation;
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

        const workerJobId =
          job.id === undefined || job.id === null ? null : String(job.id);
        if (creditRunId && workerJobId && idea.jobId !== workerJobId) {
          await db
            .update(videoIdeas)
            .set({ jobId: workerJobId })
            .where(eq(videoIdeas.id, videoIdeaId));
        }

        const settlementOnly =
          Boolean(creditRunId) && idea.status === "READY" && Boolean(idea.videoUrl);

        if (!settlementOnly) {
          // Generation-only prerequisites must never run during settlement
          // retries: content is already durable and its reservation must remain.
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
          if (creditRunId) {
            const assertRunBudget =
              dependencies.assertRunBudget ??
              (await import("@/lib/cost-ceilings")).assertRunBudget;
            await assertRunBudget(creditRunId, "video", "video_gen");
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
              });

        console.log(`✅ Video idea generation complete: ${result.videoUrl}`);

        // Two-bucket billing: DEBIT reservation on success
        if (creditRunId && idea.teamId) {
          const debitReservation =
            dependencies.debitReservation ??
            (await import("@/lib/billing")).debitReservation;
          let debitResult;
          try {
            debitResult = await debitReservation({
              teamId: idea.teamId,
              runId: creditRunId,
              jobId: job.id,
            });
          } catch (debitError) {
            const debitMessage =
              debitError instanceof Error ? debitError.message : String(debitError);
            throw new BillingSettlementError(
              `Debit settlement threw for video idea ${videoIdeaId}: ${debitMessage}`
            );
          }
          if (!debitResult.ok) {
            console.error(
              `[billing] DEBIT_FAILED for video idea ${videoIdeaId} (teamId=${idea.teamId} runId=${creditRunId}). ` +
              `Video was generated but debit failed — throwing so BullMQ can retry the debit.`
            );
            throw new BillingSettlementError(
              `Debit settlement failed for video idea ${videoIdeaId}`
            );
          }
          console.log(`[billing] Debited ${debitResult.fromAllowance + debitResult.fromPurchased} credits for video idea ${videoIdeaId}`);
          // Record completed usage event — populates spending cap meter so caps can trip.
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

        const displayError = isQuotaError
          ? "Veo video quota exceeded. Please try again in a few minutes or switch to Slideshow mode."
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
          await (dependencies.notifyVideoFailed ?? notifyVideoFailed)(
            idea.teamId,
            videoIdeaId,
            idea.ideaTitle,
            displayError
          );
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
  if (!job.data.creditRunId) return null;
  const [ideaRow] = await db.select({ teamId: videoIdeas.teamId })
    .from(videoIdeas)
    .where(eq(videoIdeas.id, job.data.videoIdeaId))
    .limit(1);
  return {
    teamId: ideaRow?.teamId,
    runId: job.data.creditRunId,
    reason: `Video idea generation failed for ID ${job.data.videoIdeaId}`,
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
      budget: { contentType: "video", getRunId: (j) => j.data.creditRunId },
      getBilling: getVideoIdeaGenerationBilling,
      retryDispositions: VIDEO_IDEA_RETRY_DISPOSITIONS,
    }
  );

  console.log(`✅ Video idea generation worker registered (${concurrency} concurrent workers)`);
}
