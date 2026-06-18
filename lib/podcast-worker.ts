import { db } from "./db";
import { articles, articleAssets, jobBatches, ContentType } from "../shared/schema";
import { eq } from "drizzle-orm";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator } from "./generation-orchestrator";
import { logError, logCritical } from "./error-logger";
import { generatePodcastScript, type PodcastScript } from "./podcast-generator";
import { mergeAudioSegments, estimateAudioDuration } from "./openai-tts";
import { objectStorageClient } from "./storage";
import { validateBrandInOutput } from "./branding";
import { uploadPodcastToDrive } from "./google-drive";
import { getContentOptimizationContext, type ContentOptimizationContext } from "./persona-content-integration";
import { refundCredits, CREDIT_COSTS } from "./credits";

export interface PodcastGenerationJob {
  articleId: number;
  tone?: string;
  duration?: string;
  teamId?: number;
  personaId?: number;
  userId?: number;
  debitLedgerRowId?: number;
}

export async function generateArticlePodcast(job: PodcastGenerationJob): Promise<void> {
  const { articleId, tone, duration, teamId, personaId } = job;
  
  try {
    console.log(`[Podcast Worker] Starting podcast generation for article ${articleId}`);
    
    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
      with: {
        batch: true,
      },
    });
    
    if (!article) {
      throw new Error(`Article ${articleId} not found`);
    }
    
    if (!article.finalHtmlContent || !article.chosenTitle) {
      throw new Error(`Article ${articleId} missing content or title`);
    }
    
    const companyName = article.batch?.businessName || "our company";
    
    await db.update(articles)
      .set({ podcastStatus: 'processing' })
      .where(eq(articles.id, articleId));
    
    const textContent = article.finalHtmlContent
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`[Podcast Worker] Generating script for article ${articleId}${personaId ? ' [PERSONA TARGETED]' : ''}`);
    const script: PodcastScript = await generatePodcastScript(
      article.chosenTitle,
      textContent,
      { tone, duration, companyName, teamId, personaId }
    );
    
    console.log(`[Podcast Worker] Script generated with ${script.segments.length} segments`);
    
    // BRAND NAME VALIDATION: Ensure correct brand spelling in podcast script
    if (companyName && companyName !== "our company") {
      const scriptText = script.segments.map(s => s.text).join(' ');
      const brandValidation = validateBrandInOutput(scriptText, companyName);
      if (!brandValidation.valid) {
        console.error(`❌ Podcast script failed brand validation for article ${articleId}:`, brandValidation.errors);
        await db.update(articles)
          .set({ podcastStatus: 'failed' })
          .where(eq(articles.id, articleId));
        throw new Error(`Podcast script failed brand validation: ${brandValidation.errors.join(", ")}`);
      }
      console.log(`✅ Podcast script brand name validation passed: "${companyName}"`);
    }

    // Critic loop on script text — best-effort; failure does not abort audio generation
    // requireJudge=false: podcast scripts are audio artifacts; GPT judge cost not justified
    let capturedPodcastPatternIds: number[] = [];
    let podcastQualityScore = 75;
    let podcastArmId: number | undefined;
    if (teamId) {
      try {
        const podcastEnhancement = await getPromptEnhancement(teamId, ContentType.PODCAST)
          .catch(() => ({ patternsUsed: [] as number[] }));
        capturedPodcastPatternIds = podcastEnhancement.patternsUsed;

        const scriptText = script.segments.map(s => s.text).join(' ');
        const orchResult = await runGenerationOrchestrator({
          teamId,
          contentType: ContentType.PODCAST,
          contentId: articleId,
          content: scriptText,
          patternsUsed: capturedPodcastPatternIds,
          brief: { topic: article.chosenTitle },
          kind: "podcast",
          requireJudge: false,
        });
        if (orchResult.qualityScore > 0) podcastQualityScore = orchResult.qualityScore;
        if (orchResult.armId !== undefined) podcastArmId = orchResult.armId;
        // Apply repaired content back to script segments, preserving voice assignments.
        // Strategy: proportional redistribution by original segment character length,
        // snapping to the nearest word boundary to avoid mid-word splits.
        if (orchResult.repairs > 0 && orchResult.content.length > 50 && orchResult.orchestrated) {
          const repaired = orchResult.content;
          const totalOrigLen = script.segments.reduce((sum, s) => sum + s.text.length, 0);
          let charOffset = 0;
          script.segments = script.segments.map((seg, i) => {
            const isLast = i === script.segments.length - 1;
            const allocChars = isLast
              ? repaired.length - charOffset
              : Math.round((seg.text.length / (totalOrigLen || 1)) * repaired.length);
            let segEnd = Math.min(charOffset + allocChars, repaired.length);
            if (!isLast && segEnd < repaired.length) {
              const spaceIdx = repaired.indexOf(' ', segEnd);
              if (spaceIdx !== -1 && spaceIdx - segEnd < 40) segEnd = spaceIdx;
            }
            const newText = repaired.slice(charOffset, segEnd).trim() || seg.text;
            charOffset = segEnd;
            return { ...seg, text: newText };
          });
          console.log(`🔧 Podcast script critic: ${orchResult.repairs} repair(s), quality=${podcastQualityScore} — applied to ${script.segments.length} segments`);
        }
      } catch (orchErr) {
        console.warn('[Podcast Worker] Orchestrator failed, continuing:', (orchErr as Error).message);
      }
    }

    console.log(`[Podcast Worker] Generating audio for article ${articleId}`);
    const audioSegments = script.segments.map(seg => ({
      voice: seg.voice,
      text: seg.text,
    }));
    
    const audioBuffer = await mergeAudioSegments(audioSegments);
    console.log(`[Podcast Worker] Audio generated, size: ${audioBuffer.length} bytes`);
    
    const totalText = script.segments.map(s => s.text).join(' ');
    const estimatedDuration = estimateAudioDuration(totalText.length);
    
    const scriptSummary = {
      title: script.title,
      segmentCount: script.segments.length,
      duration: script.duration,
      generatedAt: new Date().toISOString(),
    };
    
    const fileName = `podcast-article-${articleId}-${Date.now()}.mp3`;
    const objectPath = `public/podcasts/${fileName}`;
    const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    const storageUrl = `/api/public-objects/podcasts/${fileName}`;
    
    let uploadedFile: any = null;
    
    try {
      await db.update(articles)
        .set({
          podcastDuration: estimatedDuration,
          podcastStatus: 'processing',
          podcastScriptJson: scriptSummary as any,
        })
        .where(eq(articles.id, articleId));
      
      console.log(`[Podcast Worker] Uploading to object storage: ${objectPath}`);
      const bucket = objectStorageClient.bucket(BUCKET_ID);
      const file = bucket.file(objectPath);
      uploadedFile = file;
      
      await file.save(audioBuffer, {
        contentType: "audio/mpeg",
        metadata: {
          cacheControl: "public, max-age=31536000",
        },
      });
      
      console.log(`[Podcast Worker] Object storage upload complete`);
      
      // Google Drive backup (non-blocking - don't fail if this fails)
      try {
        const driveFileId = await uploadPodcastToDrive(
          audioBuffer,
          fileName,
          {
            articleTitle: article.chosenTitle,
            articleId: String(articleId),
            duration: estimatedDuration,
          }
        );
        if (driveFileId) {
          console.log(`[Podcast Worker] ✓ Google Drive backup successful (File ID: ${driveFileId})`);
        }
      } catch (driveError) {
        console.warn(`[Podcast Worker] Google Drive backup failed (non-fatal):`, driveError);
      }
      
      let assetInserted = false;
      
      try {
        await db.insert(articleAssets).values({
          articleId: articleId,
          assetType: 'audio',
          storageUrl: storageUrl,
          altText: `Podcast: ${article.chosenTitle}`,
          fileFormat: 'mp3',
          metadataJson: {
            duration: estimatedDuration,
            segments: script.segments.length,
            generatedAt: new Date().toISOString(),
          } as any,
        });
        assetInserted = true;
        
        await db.update(articles)
          .set({
            podcastUrl: storageUrl,
            podcastStatus: 'ready',
            podcastGeneratedAt: new Date(),
          })
          .where(eq(articles.id, articleId));

        // Close the learning loop: record this podcast in the learning pipeline
        // so the engagement scorer can label it and Wilson attribution can fire.
        const effectiveTeamId = teamId ?? article.teamId;
        if (effectiveTeamId) {
          recordContentGenerated(effectiveTeamId, ContentType.PODCAST, articleId, capturedPodcastPatternIds, podcastQualityScore, { armId: podcastArmId })
            .catch(err => console.warn('[Podcast Worker] Non-fatal: could not record learning:', err));
        }
      } catch (dbError) {
        console.error(`[Podcast Worker] DB write failed after upload, cleaning up:`, dbError);
        
        if (assetInserted) {
          try {
            await db.delete(articleAssets)
              .where(eq(articleAssets.storageUrl, storageUrl));
            console.log(`[Podcast Worker] Cleaned up orphaned asset record`);
          } catch (assetCleanupError) {
            console.error(`[Podcast Worker] Failed to cleanup asset record:`, assetCleanupError);
          }
        }
        
        if (uploadedFile) {
          try {
            await uploadedFile.delete();
            console.log(`[Podcast Worker] Cleaned up orphaned file: ${objectPath}`);
          } catch (fileCleanupError) {
            console.error(`[Podcast Worker] Failed to cleanup orphaned file:`, fileCleanupError);
          }
        }
        
        throw dbError;
      }
    } catch (dbOrStorageError) {
      const errMsg = dbOrStorageError instanceof Error ? dbOrStorageError.message : String(dbOrStorageError);
      console.error(`[Podcast Worker] DB/Storage error for article ${articleId}:`, dbOrStorageError);
      await db.update(articles)
        .set({ podcastStatus: 'failed' })
        .where(eq(articles.id, articleId));
      await logError({
        errorType: "PODCAST",
        errorMessage: `DB/Storage error during podcast generation: ${errMsg}`,
        stackTrace: dbOrStorageError instanceof Error ? dbOrStorageError.stack : undefined,
        severity: "error",
        articleId,
        component: "PodcastWorker",
        context: { articleId, stage: "db_storage" },
      });
      throw dbOrStorageError;
    }
    
    console.log(`[Podcast Worker] Podcast generated successfully for article ${articleId}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Podcast Worker] Error generating podcast for article ${articleId}:`, error);
    
    await db.update(articles)
      .set({ podcastStatus: 'failed' })
      .where(eq(articles.id, articleId));

    // Refund credits if userId + ledger row were provided by the caller
    if (job.userId && job.debitLedgerRowId && job.teamId) {
      await refundCredits({
        teamId: job.teamId,
        userId: job.userId,
        amount: CREDIT_COSTS.podcast,
        reason: `Refund: podcast generation failure for article ${articleId}`,
        sourceType: "article",
        sourceId: articleId,
        debitLedgerRowId: job.debitLedgerRowId,
      }).catch((refundErr) => {
        console.error(`[Podcast Worker] Failed to refund credits for article ${articleId}:`, refundErr);
      });
    }

    await logError({
      errorType: "PODCAST",
      errorMessage: errMsg,
      stackTrace: error instanceof Error ? error.stack : undefined,
      severity: "error",
      articleId,
      component: "PodcastWorker",
      context: { articleId },
    });
    
    throw error;
  }
}
