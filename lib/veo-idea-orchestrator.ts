import { db } from "@/lib/db";
import { videoIdeas, ContentType, errorLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { expandVideoIdea, VideoIdeaInput, ExpandedVideoConcept } from "./veo-idea-expander";
import { generateIdeaVideoScript, IdeaVideoScript } from "./veo-idea-script-generator";
import { generateVideoFromScript, generateIdeaVideoSlideshow } from "./veo-social-video-generator";
import { learningService } from "./learning-service";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator } from "./generation-orchestrator";

export interface VideoIdeaOrchestrationRequest {
  videoIdeaId: number;
  ideaTitle: string;
  shortIdea: string;
  companyName: string;
  targetAudience?: string;
  style: "cinematic" | "comedy" | "emotional" | "tech" | "minimal" | "retro" | "luxury" | "action";
  tone: "professional" | "playful" | "inspirational" | "urgent" | "mysterious" | "friendly";
  callToAction: string;
  website?: string;
  location?: string;
  companyLogoUrl?: string;
  stylePromptOverride?: string;
}

export interface OrchestrationProgress {
  stage: "queued" | "expand_idea" | "generate_script" | "generate_tts" | "generate_clips" | "stitch_video" | "complete";
  progress: number;
  message: string;
}

type ProgressCallback = (progress: OrchestrationProgress) => Promise<void>;

async function updateVideoIdeaProgress(
  videoIdeaId: number,
  status: string,
  progress: number,
  currentStage: string,
  additionalData?: Partial<{
    expandedConceptJson: unknown;
    scriptJson: unknown;
    videoUrl: string;
    thumbnailUrl: string;
    errorMessage: string;
    generatedAt: Date;
  }>
): Promise<void> {
  await db.update(videoIdeas)
    .set({
      status,
      progress,
      currentStage,
      updatedAt: new Date(),
      ...additionalData
    })
    .where(eq(videoIdeas.id, videoIdeaId));
}

export async function orchestrateVideoIdeaGeneration(
  request: VideoIdeaOrchestrationRequest,
  onProgress?: ProgressCallback
): Promise<{ videoUrl: string; thumbnailUrl?: string }> {
  const { videoIdeaId } = request;
  
  console.log(`🎬 Starting video idea orchestration for ID: ${videoIdeaId}`);
  console.log(`   Title: "${request.ideaTitle}"`);
  console.log(`   Style: ${request.style}, Tone: ${request.tone}`);

  try {
    await updateVideoIdeaProgress(videoIdeaId, "PROCESSING", 2, "queued");
    if (onProgress) {
      await onProgress({ stage: "queued", progress: 2, message: "Job queued, preparing to process..." });
    }

    // Fetch teamId + patterns EARLY — before script generation — so the critic loop
    // can inject the right brand context and record Wilson attribution accurately.
    let videoTeamId: number | null = null;
    let capturedVideoPatternIds: number[] = [];
    let capturedVideoQualityScore = 80;
    try {
      const [ideaRow] = await db.select({ teamId: videoIdeas.teamId })
        .from(videoIdeas)
        .where(eq(videoIdeas.id, videoIdeaId))
        .limit(1);
      videoTeamId = ideaRow?.teamId ?? null;
      if (videoTeamId) {
        const enhancement = await getPromptEnhancement(videoTeamId, ContentType.VIDEO)
          .catch(() => ({ patternsUsed: [] as number[] }));
        capturedVideoPatternIds = enhancement.patternsUsed;
      }
    } catch (earlyFetchErr) {
      console.warn('[VideoOrchestrator] Could not pre-fetch team/patterns:', (earlyFetchErr as Error).message);
    }

    await updateVideoIdeaProgress(videoIdeaId, "EXPANDING", 5, "expand_idea");
    if (onProgress) {
      await onProgress({ stage: "expand_idea", progress: 5, message: "Expanding your idea into a video concept..." });
    }

    const ideaInput: VideoIdeaInput = {
      ideaTitle: request.ideaTitle,
      shortIdea: request.shortIdea,
      companyName: request.companyName,
      targetAudience: request.targetAudience,
      style: request.style,
      tone: request.tone,
      callToAction: request.callToAction,
      website: request.website,
      location: request.location
    };

    const expandedConcept = await expandVideoIdea(ideaInput);
    
    await updateVideoIdeaProgress(videoIdeaId, "EXPANDING", 15, "expand_idea", {
      expandedConceptJson: expandedConcept
    });
    if (onProgress) {
      await onProgress({ stage: "expand_idea", progress: 15, message: "Video concept created successfully" });
    }

    console.log(`✅ Idea expanded: ${expandedConcept.overallNarrative}`);

    await updateVideoIdeaProgress(videoIdeaId, "SCRIPTING", 20, "generate_script");
    if (onProgress) {
      await onProgress({ stage: "generate_script", progress: 20, message: "Generating video script with style..." });
    }

    const script = await generateIdeaVideoScript({
      ideaTitle: request.ideaTitle,
      companyName: request.companyName,
      expandedConcept,
      style: request.style,
      tone: request.tone,
      callToAction: request.callToAction,
      location: request.location,
      website: request.website,
      stylePromptOverride: request.stylePromptOverride,
    });

    await updateVideoIdeaProgress(videoIdeaId, "SCRIPTING", 30, "generate_script", {
      scriptJson: script
    });
    if (onProgress) {
      await onProgress({ stage: "generate_script", progress: 30, message: "Script generated with 10 clips" });
    }

    console.log(`✅ Script generated: ${script.clips.length} clips`);

    // Critic loop on script narration before Veo render (requireJudge=false — audio/video script)
    if (videoTeamId) {
      try {
        const scriptNarration = script.clips
          .map(c => c.narration)
          .filter(Boolean)
          .join('\n\n');
        if (scriptNarration.length > 50) {
          const orchResult = await runGenerationOrchestrator({
            teamId: videoTeamId,
            contentType: ContentType.VIDEO,
            contentId: videoIdeaId,
            content: scriptNarration,
            patternsUsed: capturedVideoPatternIds,
            brief: { topic: request.ideaTitle, location: request.location },
            kind: "script",
            requireJudge: false,
          });
          if (orchResult.qualityScore > 0) capturedVideoQualityScore = orchResult.qualityScore;
          if (orchResult.repairs > 0) {
            console.log(`🔧 Video script critic: ${orchResult.repairs} repair(s), quality=${capturedVideoQualityScore}`);
          }
        }
      } catch (orchErr) {
        console.warn('[VideoOrchestrator] Critic loop failed, continuing:', (orchErr as Error).message);
      }
    }

    await updateVideoIdeaProgress(videoIdeaId, "GENERATING", 35, "generate_clips");
    if (onProgress) {
      await onProgress({ stage: "generate_clips", progress: 35, message: "Generating AI video clips with Veo..." });
    }

    const veoProgressCallback = async (veoProgress: { stage: string; progress: number; message: string }) => {
      const mappedProgress = 35 + Math.floor(veoProgress.progress * 0.6);
      
      let stage: OrchestrationProgress["stage"] = "generate_clips";
      if (veoProgress.stage === "tts") stage = "generate_tts";
      if (veoProgress.stage === "stitch") stage = "stitch_video";
      
      await updateVideoIdeaProgress(videoIdeaId, "GENERATING", mappedProgress, veoProgress.stage);
      if (onProgress) {
        await onProgress({ stage, progress: mappedProgress, message: veoProgress.message });
      }
    };

    const scriptPayload = {
      videoIdeaId,
      title: request.ideaTitle,
      companyName: request.companyName,
      location: request.location,
      tone: request.tone,
      companyLogoUrl: request.companyLogoUrl,
      website: request.website,
      script: {
        title: script.title,
        totalDuration: script.totalDuration,
        companyName: script.companyName,
        clips: script.clips.map(clip => ({
          sceneNumber: clip.sceneNumber,
          targetDuration: clip.targetDuration,
          prompt: clip.prompt,
          narration: clip.narration
        }))
      },
      onProgress: veoProgressCallback
    };

    let videoUrl: string;
    let usedFallback = false;

    try {
      const result = await generateVideoFromScript(scriptPayload);
      videoUrl = result.videoUrl;
    } catch (veoError) {
      const veoMsg = veoError instanceof Error ? veoError.message : String(veoError);
      const isQuotaError = veoMsg.includes("RESOURCE_EXHAUSTED") || veoMsg.includes("429") || veoMsg.includes("quota");

      if (isQuotaError) {
        console.warn(`⚠️ Veo quota exceeded for Video Idea ${videoIdeaId} — automatically switching to image slideshow`);
        await updateVideoIdeaProgress(videoIdeaId, "GENERATING", 30, "slideshow_fallback", {
          errorMessage: "Veo quota exceeded — generating image slideshow instead"
        });

        const slideshowResult = await generateIdeaVideoSlideshow(scriptPayload);
        videoUrl = slideshowResult.videoUrl;
        usedFallback = true;
      } else {
        throw veoError;
      }
    }

    await updateVideoIdeaProgress(videoIdeaId, "READY", 100, "complete", {
      videoUrl,
      generatedAt: new Date(),
      ...(usedFallback ? { errorMessage: "Generated as image slideshow (Veo quota exceeded)" } : {})
    });
    if (onProgress) {
      await onProgress({ stage: "complete", progress: 100, message: "Video generation complete!" });
    }

    console.log(`🎉 Video idea generation complete: ${videoUrl}`);

    // Record generation for AI Learning System (uses pre-captured team/patterns/quality)
    try {
      if (videoTeamId) {
        await recordContentGenerated(
          videoTeamId,
          ContentType.VIDEO,
          videoIdeaId,
          capturedVideoPatternIds,
          capturedVideoQualityScore
        );
        console.log(`📊 Recorded video generation for AI Learning (quality=${capturedVideoQualityScore})`);
      }
    } catch (learningError) {
      console.warn(`⚠️ Failed to record learning metrics:`, learningError);
    }

    return { videoUrl };

  } catch (error) {
    console.error(`❌ Video idea orchestration failed for ID ${videoIdeaId}:`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    
    await updateVideoIdeaProgress(videoIdeaId, "FAILED", 0, "error", {
      errorMessage: errMsg
    });

    // Write to error_logs so Admin Error Log panel captures Veo idea failures
    try {
      await db.insert(errorLogs).values({
        errorType: "VIDEO",
        errorMessage: `Video Idea #${videoIdeaId} generation failed: ${errMsg}`.substring(0, 2000),
        stackTrace: error instanceof Error ? error.stack?.substring(0, 2000) : undefined,
        severity: "error",
      });
    } catch (logErr) {
      console.warn(`⚠️ Could not write video idea failure to error_logs:`, logErr);
    }
    
    if (onProgress) {
      await onProgress({ 
        stage: "complete", 
        progress: 0, 
        message: `Generation failed: ${errMsg}` 
      });
    }
    
    throw error;
  }
}

export async function resumeVideoIdeaGeneration(videoIdeaId: number): Promise<{ videoUrl: string } | null> {
  const [idea] = await db.select().from(videoIdeas).where(eq(videoIdeas.id, videoIdeaId));
  
  if (!idea) {
    console.error(`Video idea ${videoIdeaId} not found`);
    return null;
  }

  if (idea.status === "READY" && idea.videoUrl) {
    console.log(`Video idea ${videoIdeaId} already complete`);
    return { videoUrl: idea.videoUrl };
  }

  if (idea.status !== "FAILED") {
    console.log(`Video idea ${videoIdeaId} is in progress (${idea.status}), not resuming`);
    return null;
  }

  console.log(`Resuming video idea ${videoIdeaId} from stage: ${idea.currentStage}`);

  return orchestrateVideoIdeaGeneration({
    videoIdeaId: idea.id,
    ideaTitle: idea.ideaTitle,
    shortIdea: idea.shortIdea,
    companyName: idea.companyName || "",
    targetAudience: idea.targetAudience || undefined,
    style: idea.style as any,
    tone: idea.tone as any,
    callToAction: idea.callToAction,
    website: idea.website || undefined,
    companyLogoUrl: idea.companyLogoUrl || undefined
  });
}
