import { db } from "./db";
import { createNotification } from "./notification-service";
import { articles, articleAssets, jobBatches, ContentType } from "../shared/schema";
import { eq } from "drizzle-orm";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator } from "./generation-orchestrator";
import { logError, logCritical } from "./error-logger";
import { generatePodcastScript, type PodcastScript } from "./podcast-generator";
import { mergeAudioSegments } from "./openai-tts";
import {
  assertPodcastScriptWithinWordBudget,
  createPodcastMeasuredDurationMetadata,
  isPodcastAudioDurationWithinRange,
  parsePodcastDuration,
  preflightPodcastScriptDuration,
  probePodcastAudioDuration,
} from "./podcast-duration";
import { objectStorageClient } from "./storage";
import { validateBrandInOutput } from "./branding";
import { uploadPodcastToDrive } from "./google-drive";
import { getContentOptimizationContext, type ContentOptimizationContext } from "./persona-content-integration";
import { refundCredits, CREDIT_COSTS } from "./credits";
import {
  isNonReplayableProviderError,
  isProviderAccountingError,
  ProviderResultNotDurableError,
} from "./cost-telemetry";
import {
  BillingSettlementError,
  isBillingSettlementError,
} from "./pipeline-worker";
import { redactProviderError, redactProviderOutput } from "./provider-diagnostics";

export interface PodcastGenerationJob {
  /** Two-bucket billing: reservation runId threaded from the API route */
  creditRunId?: string;
  articleId: number;
  tone?: string;
  duration?: string;
  teamId?: number;
  personaId?: number;
  userId?: number;
  debitLedgerRowId?: number;
  capReservationId?: number | null;
}

export interface PodcastGenerationDependencies {
  generatePodcastScript?: typeof generatePodcastScript;
  mergeAudioSegments?: typeof mergeAudioSegments;
  getPromptEnhancement?: typeof getPromptEnhancement;
  runGenerationOrchestrator?: typeof runGenerationOrchestrator;
  recordContentGenerated?: typeof recordContentGenerated;
  uploadPodcastToDrive?: typeof uploadPodcastToDrive;
}

export async function settleDeliveredPodcast(
  job: PodcastGenerationJob,
  articleId: number,
  _deps: {
    debit?: (params: { teamId: number; runId: string; userId?: number }) => Promise<{ ok: boolean }>;
    completeCap?: (params: {
      reservationId: number;
      teamId: number;
      jobId: string;
      metadata?: Record<string, unknown>;
    }) => Promise<void>;
    markSettled?: () => Promise<unknown>;
  } = {}
): Promise<void> {
  if (!job.teamId || !job.creditRunId) return;
  try {
    const debit =
      _deps.debit ?? (await import("@/lib/billing")).debitReservation;
    const debitResult = await debit({
      teamId: job.teamId,
      runId: job.creditRunId,
      userId: job.userId,
    });
    if (!debitResult.ok) {
      throw new Error("credit reservation was not debit-settleable");
    }

    if (job.capReservationId != null) {
      const completeCap =
        _deps.completeCap ?? (await import("@/lib/usage-caps")).completeCapReservation;
      await completeCap({
        reservationId: job.capReservationId,
        teamId: job.teamId,
        jobId: job.creditRunId,
        metadata: { articleId },
      });
    }

    await (_deps.markSettled ?? (() =>
      db.update(articles).set({
        podcastBillingSettledAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(articles.id, articleId))))();
  } catch (cause) {
    throw new BillingSettlementError(
      `Settlement failed for delivered podcast article ${articleId}`,
      job.creditRunId,
      cause
    );
  }
}

export async function generateArticlePodcast(
  job: PodcastGenerationJob,
  dependencies: PodcastGenerationDependencies = {},
): Promise<void> {
  const { articleId, tone, duration, teamId, personaId } = job;
  let paidAudioCompleted = false;
  
  try {
    console.log(`[Podcast Worker] Starting podcast generation for article ${articleId}`);

    // A terminal paid-provider ambiguity keeps its reservation held for manual
    // reconciliation. Redelivery of that same run must stop before any SDK call.
    if (job.creditRunId && job.teamId) {
      const { assertReservationReadyForProvider } = await import("@/lib/billing");
      await assertReservationReadyForProvider({
        teamId: job.teamId,
        runId: job.creditRunId,
      });
    }

    // Cost ceiling gate — INSIDE the try so BUDGET_EXCEEDED flows through this
    // catch (article status write, legacy refund guard) before the pipeline
    // wrapper releases the reservation and stops retries.
    if (job.creditRunId) {
      const { assertRunBudget } = await import("@/lib/cost-ceilings");
      await assertRunBudget(job.creditRunId, "podcast", "text_gen");
    }
    
    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
      with: {
        batch: true,
      },
    });
    
    if (!article) {
      throw new Error(`Article ${articleId} not found`);
    }

    // A ready podcast is the durable delivery checkpoint. Retry only billing;
    // never regenerate script/audio or upload a second object.
    if (
      article.podcastStatus === "ready" &&
      article.podcastUrl &&
      article.podcastCreditRunId === job.creditRunId &&
      job.creditRunId &&
      job.teamId
    ) {
      if (article.podcastBillingSettledAt) return;
      await settleDeliveredPodcast(job, articleId);
      return;
    }
    
    if (!article.finalHtmlContent || !article.chosenTitle) {
      throw new Error(`Article ${articleId} missing content or title`);
    }

    const durationRange = parsePodcastDuration(duration ?? "3-4 minutes");
    if (!durationRange) {
      throw new Error(
        `Unsupported podcast duration "${duration}". Supported ranges are 1-2, 3-4, or 5-7 minutes`,
      );
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
    const script: PodcastScript = await (dependencies.generatePodcastScript ?? generatePodcastScript)(
      article.chosenTitle,
      textContent,
      { tone, duration, companyName, teamId, personaId }
    );
    
    console.log(`[Podcast Worker] Script generated with ${script.segments.length} segments`);
    assertPodcastScriptWithinWordBudget(script, durationRange, "initial generation");
    
    // BRAND NAME VALIDATION: Ensure correct brand spelling in podcast script
    if (companyName && companyName !== "our company") {
      const scriptText = script.segments.map(s => s.text).join(' ');
      const brandValidation = validateBrandInOutput(scriptText, companyName);
      if (!brandValidation.valid) {
        console.error(
          `❌ Podcast script failed brand validation for article ${articleId} ` +
            `(${brandValidation.errors.length} error(s); ${redactProviderOutput(scriptText, "podcast_script_brand_validation")})`,
        );
        await db.update(articles)
          .set({ podcastStatus: 'failed' })
          .where(eq(articles.id, articleId));
        throw new Error("Podcast script failed brand validation");
      }
      console.log(`✅ Podcast script brand name validation passed: "${companyName}"`);
    }

    // Critic loop on script text — best-effort; failure does not abort audio generation
    // requireJudge=false: podcast scripts are audio artifacts; GPT judge cost not justified
    let capturedPodcastPatternIds: number[] = [];
    let podcastQualityScore = 75;
    let podcastArmId: number | undefined;
    let podcastVariantArmId: number | undefined;
    if (teamId) {
      try {
        // Thread terminalKpi from batch generationParams for per-journey KPI weighting.
        const podcastTerminalKpi = (article.batch?.generationParams as Record<string, unknown> | null)?.terminalKpi as string | undefined;
        const podcastEnhancement = await (dependencies.getPromptEnhancement ?? getPromptEnhancement)(teamId, ContentType.PODCAST, {
          stableId: String(articleId),
          terminalKpi: podcastTerminalKpi,
          campaignId: article.campaignId ?? null,
        })
          .catch(() => ({ patternsUsed: [] as number[], variantArmId: undefined }));
        capturedPodcastPatternIds = podcastEnhancement.patternsUsed;
        podcastVariantArmId = podcastEnhancement.variantArmId;

        const scriptText = script.segments.map(s => s.text).join(' ');
        const orchResult = await (dependencies.runGenerationOrchestrator ?? runGenerationOrchestrator)({
          teamId,
          campaignId: article.campaignId ?? null,
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
        if (isProviderAccountingError(orchErr)) throw orchErr;
        console.warn(
          "[Podcast Worker] Orchestrator failed, continuing:",
          redactProviderError(orchErr, undefined, "podcast_orchestrator"),
        );
      }
    }

    // Reviews/repairs may expand the script after the initial guard. Validate
    // again immediately before TTS; never silently cut paid narration. The
    // duration preflight includes every segment and must pass before the first
    // paid TTS request.
    assertPodcastScriptWithinWordBudget(script, durationRange, "post-review");
    const durationPlan = preflightPodcastScriptDuration(
      script,
      durationRange,
      "post-review",
    );

    console.log(`[Podcast Worker] Generating audio for article ${articleId}`);
    const audioSegments = script.segments.map(seg => ({
      voice: seg.voice,
      text: seg.text,
    }));
    
    const audioBuffer = await (dependencies.mergeAudioSegments ?? mergeAudioSegments)(audioSegments, {
      operationType: "podcast_tts",
      teamId: teamId ?? article.teamId,
      userId: job.userId,
      articleId,
      jobId: job.creditRunId,
    });
    paidAudioCompleted = true;
    console.log(`[Podcast Worker] Audio generated, size: ${audioBuffer.length} bytes`);
    
    const actualDuration = await probePodcastAudioDuration(audioBuffer);
    if (!isPodcastAudioDurationWithinRange(actualDuration, durationRange)) {
      throw new Error(
        `Podcast audio duration ${actualDuration.toFixed(3)}s is outside the requested ` +
          `${durationRange.label} range (${durationRange.minSeconds}-${durationRange.maxSeconds}s)`,
      );
    }
    
    const measuredDurationMetadata = createPodcastMeasuredDurationMetadata(
      actualDuration,
      durationRange,
      durationPlan,
    );
    const scriptSummary = {
      title: script.title,
      segmentCount: script.segments.length,
      ...measuredDurationMetadata,
      generatedAt: new Date().toISOString(),
    };
    
    const fileName = `podcast-article-${articleId}-${Date.now()}.mp3`;
    const objectPath = `private/teams/${article.teamId}/articles/${articleId}/podcasts/${fileName}`;
    const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    const storageUrl = `/api/public-objects/private/teams/${article.teamId}/articles/${articleId}/podcasts/${fileName}`;
    
    let uploadedFile: any = null;
    
    try {
      await db.update(articles)
        .set({
          podcastDuration: Math.round(actualDuration),
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
          cacheControl: "private, no-store",
        },
      });
      
      console.log(`[Podcast Worker] Object storage upload complete`);
      
      // Google Drive backup (non-blocking - don't fail if this fails)
      try {
        const driveFileId = await (dependencies.uploadPodcastToDrive ?? uploadPodcastToDrive)(
          audioBuffer,
          fileName,
          {
            articleTitle: article.chosenTitle,
            articleId: String(articleId),
            duration: actualDuration,
          }
        );
        if (driveFileId) {
          console.log(`[Podcast Worker] ✓ Google Drive backup successful (File ID: ${driveFileId})`);
        }
      } catch (driveError) {
        console.warn(
          `[Podcast Worker] Google Drive backup failed (non-fatal):`,
          redactProviderError(driveError, undefined, "podcast_drive_backup"),
        );
      }
      
      let assetInserted = false;
      
      try {
        await db.insert(articleAssets).values({
          articleId: articleId,
          teamId: article.teamId,
          assetType: 'audio',
          storageUrl: storageUrl,
          altText: `Podcast: ${article.chosenTitle}`,
          fileFormat: 'mp3',
          metadataJson: {
            ...measuredDurationMetadata,
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
            podcastCreditRunId: job.creditRunId ?? null,
          })
          .where(eq(articles.id, articleId));

        // Two-bucket billing: DEBIT on success
        if (job.teamId && job.creditRunId) {
          await settleDeliveredPodcast(job, articleId);
          // Without a pending cap row, retain the legacy completed usage event.
          const { recordUsageEvent } = await import("@/lib/usage-caps");
          if (job.capReservationId == null) {
            await recordUsageEvent({
              teamId: job.teamId,
              action: "podcast",
              units: 1,
              costEstimateCents: CREDIT_COSTS.podcast ?? 8,
              jobId: job.creditRunId,
              metadata: { articleId },
            }).catch((err) => console.warn(`[usage-caps] recordUsageEvent failed (non-fatal): ${err?.message}`));
          }
        }

        // Close the learning loop: record this podcast in the learning pipeline
        // so the engagement scorer can label it and Wilson attribution can fire.
        const effectiveTeamId = teamId ?? article.teamId;
        if (effectiveTeamId) {
          (dependencies.recordContentGenerated ?? recordContentGenerated)(effectiveTeamId, ContentType.PODCAST, articleId, capturedPodcastPatternIds, podcastQualityScore, { armId: podcastArmId, variantArmId: podcastVariantArmId })
            .catch(err => console.warn('[Podcast Worker] Non-fatal: could not record learning:', err));
        }
      } catch (dbError) {
        if (isBillingSettlementError(dbError)) throw dbError;
        console.error(
          `[Podcast Worker] DB write failed after upload, cleaning up:`,
          redactProviderError(dbError, undefined, "podcast_db_write"),
        );
        
        if (assetInserted) {
          try {
            await db.delete(articleAssets)
              .where(eq(articleAssets.storageUrl, storageUrl));
            console.log(`[Podcast Worker] Cleaned up orphaned asset record`);
          } catch (assetCleanupError) {
            console.error(
              `[Podcast Worker] Failed to cleanup asset record:`,
              redactProviderError(assetCleanupError, undefined, "podcast_asset_cleanup"),
            );
          }
        }
        
        if (uploadedFile) {
          try {
            await uploadedFile.delete();
            console.log(`[Podcast Worker] Cleaned up orphaned file: ${objectPath}`);
          } catch (fileCleanupError) {
            console.error(
              `[Podcast Worker] Failed to cleanup orphaned file:`,
              redactProviderError(fileCleanupError, undefined, "podcast_file_cleanup"),
            );
          }
        }
        
        throw dbError;
      }
    } catch (dbOrStorageError) {
      if (isBillingSettlementError(dbOrStorageError)) throw dbOrStorageError;
      const diagnostic = redactProviderError(
        dbOrStorageError,
        undefined,
        "podcast_db_storage",
      );
      console.error(`[Podcast Worker] DB/Storage error for article ${articleId}:`, diagnostic);
      await db.update(articles)
        .set({ podcastStatus: 'failed' })
        .where(eq(articles.id, articleId));
      await logError({
        errorType: "PODCAST",
        errorMessage: `DB/Storage error during podcast generation (${diagnostic})`,
        stackTrace: undefined,
        severity: "error",
        articleId,
        component: "PodcastWorker",
        context: { articleId, stage: "db_storage" },
      });
      throw dbOrStorageError;
    }
    
    console.log(`[Podcast Worker] Podcast generated successfully for article ${articleId}`);

    void createNotification({
      teamId: teamId ?? article?.teamId ?? undefined,
      type: "success",
      category: "article",
      title: "Podcast Ready",
      message: `Podcast for "${article?.chosenTitle?.slice(0, 80) ?? `article ${articleId}`}" is ready to play.`,
      entityId: articleId,
      entityType: "article",
      actionUrl: `/content/${articleId}`,
    }).catch(() => {});
  } catch (error) {
    if (isBillingSettlementError(error)) throw error;
    const finalError =
      paidAudioCompleted && !isNonReplayableProviderError(error)
        ? new ProviderResultNotDurableError(
            `Podcast audio completed for article ${articleId}, but durable delivery failed; refusing automatic replay`,
            null,
            error
          )
        : error;
    const requiresReconciliation = isNonReplayableProviderError(finalError);
    const diagnostic = redactProviderError(finalError, undefined, "podcast_generation");
    console.error(`[Podcast Worker] Error generating podcast for article ${articleId}:`, diagnostic);

    const statusWrite = db.update(articles)
      .set({
        podcastStatus: requiresReconciliation ? "reconciliation_required" : "failed",
        errorMessage: requiresReconciliation
          ? `Provider/billing reconciliation required (${diagnostic})`.slice(0, 1000)
          : diagnostic.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(articles.id, articleId));
    if (requiresReconciliation) {
      await statusWrite.catch((statusError) => {
        console.error(
          `[Podcast Worker] Failed to persist reconciliation status for article ${articleId}:`,
          redactProviderError(statusError, undefined, "podcast_reconciliation_status"),
        );
      });
    } else {
      await statusWrite;
    }

    // Two-bucket billing: reservation release on final failure is handled by
    // createPipelineWorker (registration in lib/worker.ts). Only the legacy
    // pre-reservation refund path remains here.
    if (!requiresReconciliation && !job.creditRunId && job.userId && job.debitLedgerRowId && job.teamId) {
      // Legacy fallback: refund via old debitLedgerRowId path
      await refundCredits({
        teamId: job.teamId,
        userId: job.userId,
        amount: CREDIT_COSTS.podcast,
        reason: `Refund: podcast generation failure for article ${articleId}`,
        sourceType: "article",
        sourceId: articleId,
        debitLedgerRowId: job.debitLedgerRowId,
      }).catch((refundErr) => {
        console.error(
          `[Podcast Worker] Failed to refund credits for article ${articleId}:`,
          redactProviderError(refundErr, undefined, "podcast_refund"),
        );
      });
    }

    void createNotification({
      teamId: job.teamId,
      type: "error",
      category: "article",
      title: requiresReconciliation
        ? "Podcast Generation Needs Reconciliation"
        : "Podcast Generation Failed",
      message: requiresReconciliation
        ? `Podcast generation for article ${articleId} has an uncertain provider outcome and is paused for reconciliation.`
          : `Podcast generation failed for article ${articleId}; see redacted diagnostics (${diagnostic.slice(0, 200)}).`,
      entityId: articleId,
      entityType: "article",
      actionUrl: `/content/${articleId}`,
    }).catch(() => {});

    const errorLog = logError({
      errorType: "PODCAST",
      errorMessage: diagnostic,
      stackTrace: undefined,
      severity: requiresReconciliation ? "critical" : "error",
      articleId,
      component: "PodcastWorker",
      context: {
        articleId,
        reconciliationRequired: requiresReconciliation,
        creditRunId: job.creditRunId ?? null,
      },
    });
    if (requiresReconciliation) {
      await errorLog.catch((loggingError) => {
        console.error(
          `[Podcast Worker] Failed to persist reconciliation error log for article ${articleId}:`,
          loggingError
        );
      });
    } else {
      await errorLog;
    }

    // Rethrow — createPipelineWorker classifies and applies retry/billing policy.
    throw finalError;
  }
}
