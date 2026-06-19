import type PgBoss from "pg-boss";
import { orchestrateVideoIdeaGeneration } from "@/lib/veo-idea-orchestrator";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { notifyVideoComplete, notifyVideoFailed } from "@/lib/notification-service";
import { logError, logCritical } from "@/lib/error-logger";

interface VideoIdeaJobData {
  videoIdeaId: number;
}

export async function registerVideoIdeaWorker(boss: PgBoss): Promise<void> {
  const queueName = "video-idea-generation";
  const concurrency = 5;
  
  console.log(`🎬 Registering video idea generation worker for queue: "${queueName}"`);

  try {
    await boss.createQueue(queueName, {
      name: queueName,
    });
    console.log(`📋 Queue created/verified: ${queueName}`);
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      console.error(`Error creating queue partition: ${error.message}`);
    }
  }

  await boss.work<VideoIdeaJobData>(
    queueName,
    { 
      teamSize: concurrency,
      newJobCheckIntervalSeconds: 2,
    } as any,
    async ([job]) => {
      if (!job || !job.data) {
        throw new Error("No job data received");
      }
      const { videoIdeaId } = job.data;
      console.log(`🎬 Processing video idea generation job: ${job.id}`);
      console.log(`   Video Idea ID: ${videoIdeaId}`);

      try {
        const [idea] = await db.select()
          .from(videoIdeas)
          .where(eq(videoIdeas.id, videoIdeaId))
          .limit(1);

        if (!idea) {
          throw new Error(`Video idea ${videoIdeaId} not found`);
        }

        const isLikeVideo = idea.isLikeVideo && !!idea.stylePrompt;
        console.log(`📋 Video idea found: "${idea.ideaTitle}" [${idea.style}/${idea.tone}]${isLikeVideo ? " (Like Video)" : ""}`);

        const result = await orchestrateVideoIdeaGeneration({
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

        // Record content generation metrics so Thompson Sampling can learn for video
        if (idea.teamId) {
          try {
            const { recordContentGenerated } = await import("@/lib/learning-integration");
            await recordContentGenerated(idea.teamId, "video", videoIdeaId, [], 75);
          } catch (metricsErr) {
            console.warn("[VIDEO_WORKER] Could not record learning metrics (non-fatal):", metricsErr);
          }
          await notifyVideoComplete(idea.teamId, videoIdeaId, idea.ideaTitle);
        }
        
        return { success: true, videoUrl: result.videoUrl };

      } catch (error) {
        console.error(`❌ Video idea generation failed for ID ${videoIdeaId}:`, error);

        const errMsg = error instanceof Error ? error.message : String(error);
        const isQuotaError = errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("429") || errMsg.includes("quota");

        await logError({
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
            status: "FAILED",
            progress: 0,
            errorMessage: displayError,
            updatedAt: new Date(),
          })
          .where(eq(videoIdeas.id, videoIdeaId));

        if (idea?.teamId) {
          await notifyVideoFailed(
            idea.teamId,
            videoIdeaId,
            idea.ideaTitle,
            displayError
          );
        }

        // Don't re-throw quota errors — they will always fail on retry.
        // For other errors, re-throw so pg-boss can retry.
        if (!isQuotaError) {
          throw error;
        }
        return; // quota errors handled — no retry needed
      }
    }
  );

  console.log(`✅ Video idea generation worker registered (${concurrency} concurrent workers)`);
}
