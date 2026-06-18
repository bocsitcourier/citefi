import type PgBoss from "pg-boss";
import {
  getPgBoss,
  BATCH_GENERATION_QUEUE,
  ARTICLE_GENERATION_QUEUE,
  SOCIAL_POST_GENERATION_QUEUE,
  IMAGE_GENERATION_QUEUE,
  REFORMAT_QUEUE,
  SOCIAL_VIDEO_GENERATION_QUEUE,
  CLEANUP_QUEUE,
  SITE_CRAWL_QUEUE,
  CONTENT_PUBLISHING_QUEUE,
  INTELLIGENCE_RESEARCH_QUEUE,
  type BatchJobData,
  type ArticleJobData,
  type SocialPostJobData,
  type ImageGenerationJobData,
  type ReformatJobData,
  type SocialVideoJobData,
  type CleanupJobData,
  type SiteCrawlJobData,
  type PublishingJobData,
  type IntelligenceResearchJobData,
  addArticleJob,
  addSocialPostJob,
  addImageGenerationJob,
  addPublishingJob,
} from "./queue";
import { db } from "./db";
import { jobBatches, articles, seoLogs, socialPosts, socialPostLogs, errorLogs, userQuotas } from "@/shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { generateArticleWithGemini } from "./gemini";
import { enhanceArticleWithGPT } from "./openai";
import { validateBrandInOutput } from "./branding";
import { applyKeywordHyperlinks, extractPhrasesFromHtml, safeApplyHyperlinks, stripShortBodyAnchorLinks } from "./keyword-hyperlink-pipeline";
import { learningService } from "./learning-service";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator } from "./generation-orchestrator";
import { createNotification } from "./notification-service";
import { auditArticle } from "./guardian-agent";
import { applySurgicalFix } from "./surgical-fix";
import { ContentType } from "@/shared/schema";
import { cleanMetaDescription, cleanSeoTitle, cleanFaqAnswers } from "./content-cleaner";

// Utility to truncate strings to max length (for database varchar constraints)
function truncate(str: string | null | undefined, maxLength: number): string | null {
  if (!str) return null;
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

// Utility to enforce hard timeout on async operations
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${operation} exceeded hard timeout of ${timeoutMs / 1000}s`)),
      timeoutMs
    );
  });
  
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutHandle)),
    timeoutPromise
  ]);
}

console.log("🔧 Initializing pg-boss workers...");

// ============================================================================
// WORKER REGISTRATION
// ============================================================================

export async function registerWorkers() {
  const boss = await getPgBoss();

  // ============================================================================
  // BATCH GENERATION WORKER
  // ============================================================================

  await boss.work<BatchJobData>(
    BATCH_GENERATION_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        console.log(`📦 Processing batch generation job ${job.id}`);
        const { batchId, teamId, selectedTitles, targetUrl, tone, wordCountMin, wordCountMax, geographicFocus, audience, competitorUrls, semanticClusterId, serpFeatureTarget, businessName, companyLogoUrl, personaId } = job.data;

      try {
        await db
          .update(jobBatches)
          .set({ 
            status: "RUNNING",
            numArticlesRequested: selectedTitles.length
          })
          .where(eq(jobBatches.id, batchId));

        // Log batch start event
        const { jobEvents } = await import("@/shared/schema");
        await db.insert(jobEvents).values({
          batchId,
          eventType: "BATCH_STARTED",
          stage: "ORCHESTRATION",
          severity: "info",
          message: `Batch started with ${selectedTitles.length} articles${serpFeatureTarget ? ` targeting ${serpFeatureTarget}` : ''}`,
          payloadJson: { selectedTitles, tone, wordCountMin, wordCountMax, serpFeatureTarget, semanticClusterId }
        });

        // Statuses that mean "work is done — don't re-run"
        // GEMINI_COMPLETE / CHATGPT_REVIEWED: work is preserved at those states;
        // removing them would cause recovery jobs to re-process completed articles.
        const TERMINAL_OK_STATUSES = ["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"];
        // Statuses that mean "already queued — don't duplicate"
        const IN_PROGRESS_STATUSES = ["PENDING", "IN_PROGRESS"];

        // PREFETCH: Load all existing articles for this batch in ONE query.
        // Avoids N individual per-title queries inside the loop, which previously
        // exhausted the 20-connection pool when 20 article workers were already active.
        const existingArticles = await db
          .select({ id: articles.id, articleStatus: articles.articleStatus, chosenTitle: articles.chosenTitle })
          .from(articles)
          .where(eq(articles.batchId, batchId));
        const existingByTitle = new Map(existingArticles.map(a => [a.chosenTitle, a]));

        let spawned = 0;
        let skipped = 0;
        let retried = 0;

        for (let i = 0; i < selectedTitles.length; i++) {
          const title = selectedTitles[i];
          if (!title) { skipped++; continue; }

          // In-memory lookup — no DB query per iteration.
          const existing = existingByTitle.get(title);

          if (existing) {
            if (TERMINAL_OK_STATUSES.includes(existing.articleStatus || "")) {
              // Already succeeded — skip entirely to avoid duplicating good work
              console.log(`⏭️ Skipping "${title.slice(0, 60)}" — already ${existing.articleStatus}`);
              skipped++;
              continue;
            }

            if (IN_PROGRESS_STATUSES.includes(existing.articleStatus || "")) {
              // Already queued or running — don't double-queue
              console.log(`⏭️ Skipping "${title.slice(0, 60)}" — currently ${existing.articleStatus}`);
              skipped++;
              continue;
            }

            // FAILED article — reset it and retry using the existing row
            console.log(`🔄 Retrying FAILED article id=${existing.id} "${title.slice(0, 60)}"`);
            await db
              .update(articles)
              .set({ articleStatus: "PENDING", updatedAt: new Date() })
              .where(eq(articles.id, existing.id));

            const runId = crypto.randomUUID();
            await addArticleJob({
              articleId: existing.id,
              batchId,
              runId,
              title,
              targetUrl,
              tone,
              wordCountMin,
              wordCountMax,
              geographicFocus,
              audience,
              businessName,
              companyLogoUrl,
              competitorUrls,
              semanticClusterId,
              serpFeatureTarget,
              teamId,
              personaId,
            });
            retried++;
            continue;
          }

          // No existing article — create a fresh one (normal first-run path)
          const [article] = await db
            .insert(articles)
            .values({
              batchId,
              teamId,
              chosenTitle: title,
              articleStatus: "PENDING",
            })
            .returning();

          if (!article) {
            throw new Error(`Failed to insert article row for title: "${title.slice(0, 80)}"`);
          }

          const runId = crypto.randomUUID();
          await addArticleJob({
            articleId: article.id,
            batchId,
            runId,
            title,
            targetUrl,
            tone,
            wordCountMin,
            wordCountMax,
            geographicFocus,
            audience,
            businessName,
            companyLogoUrl,
            competitorUrls,
            semanticClusterId,
            serpFeatureTarget,
            teamId,
            personaId,
          });
          spawned++;
        }

        console.log(`✅ Batch ${batchId} processed: ${spawned} new, ${retried} retried, ${skipped} skipped (already complete/running)`);
      } catch (error) {
        console.error(`❌ Batch generation failed for batch ${batchId}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Log to error_logs table
        await db.insert(errorLogs).values({
          batchId,
          errorType: "QUEUE",
          errorMessage: `Batch orchestration failed: ${errorMessage}`,
          stackTrace: error instanceof Error ? error.stack : undefined,
          severity: "error",
        });
        
        // Log batch failure event
        const { jobEvents } = await import("@/shared/schema");
        await db.insert(jobEvents).values({
          batchId,
          eventType: "BATCH_FAILED",
          stage: "ORCHESTRATION",
          severity: "error",
          message: `Batch orchestration failed: ${errorMessage.slice(0, 500)}`,
          payloadJson: { 
            batchId,
            selectedTitlesCount: selectedTitles.length,
            stackTrace: error instanceof Error ? error.stack?.slice(0, 1000) : undefined
          }
        });
        
        try {
          await db
            .update(jobBatches)
            .set({ status: "FAILED" })
            .where(eq(jobBatches.id, batchId));
        } catch (dbError) {
          console.error(`❌ Failed to update batch status:`, dbError);
        }

        // Notify the team so the batch failure appears in the in-app bell
        if (teamId) {
          void createNotification({
            teamId,
            type: "error",
            category: "batch",
            title: "Batch Generation Failed",
            message: `A batch of ${selectedTitles?.length ?? 0} articles failed to start: ${errorMessage.slice(0, 200)}`,
            entityId: batchId,
            entityType: "batch",
            actionUrl: `/batches/${batchId}`,
          }).catch(() => {});
        }

        throw error;
      }
      }
    }
  );

  // ============================================================================
  // ARTICLE GENERATION WORKER
  // ============================================================================

  // CONFIGURABLE CONCURRENT PROCESSING
  // Workers match Gemini API rate limit for optimal resource usage
  // 10 workers to prevent overwhelming Gemini 30 RPM rate limit and causing 429 cascades
  const CONCURRENT_WORKERS = parseInt(process.env.ARTICLE_WORKER_CONCURRENCY || "20");
  
  for (let workerNum = 1; workerNum <= CONCURRENT_WORKERS; workerNum++) {
    boss.work<ArticleJobData>(
      ARTICLE_GENERATION_QUEUE,
      { 
        batchSize: 1,          // Each worker pulls 1 job at a time
      },
      async (jobs) => {
      // Process each job sequentially
      for (const job of jobs) {
        console.log(`📝 Processing article generation job ${job.id}`);
        const { articleId, batchId, runId, title, targetUrl, tone, wordCountMin, wordCountMax, geographicFocus, audience, competitorUrls, semanticClusterId, serpFeatureTarget, businessName, companyLogoUrl, customInstructions, teamId: articleTeamId, personaId: articlePersonaId } = job.data;

      try {
        // STEP 0: Check if the batch has been cancelled — bail out immediately if so.
        // This is the primary mechanism for stopping generation mid-batch.
        if (batchId) {
          const [batchRow] = await db
            .select({ status: jobBatches.status })
            .from(jobBatches)
            .where(eq(jobBatches.id, batchId))
            .limit(1);
          if (batchRow?.status === 'CANCELLED') {
            console.log(`🛑 Skipping article ${articleId}: batch ${batchId} was cancelled`);
            // Mark the article as FAILED so it leaves IN_PROGRESS and the UI reflects cancellation.
            await db
              .update(articles)
              .set({ articleStatus: 'FAILED', updatedAt: new Date() })
              .where(
                and(
                  eq(articles.id, articleId),
                  eq(articles.articleStatus, 'IN_PROGRESS')
                )
              );
            return;
          }
        }

        // STEP 1: Check article_runs for existing run records (duplicate detection & cache lookup)
        const { articleRuns } = await import("@/shared/schema");
        const [existingRun] = await db
          .select()
          .from(articleRuns)
          .where(and(
            eq(articleRuns.articleId, articleId),
            eq(articleRuns.runId, runId)
          ))
          .limit(1);
        
        // STEP 2: Handle existing runs based on status
        if (existingRun) {
          if (existingRun.status === 'completed') {
            // This run already finished. Check if the article itself is in a terminal state.
            // If so, there is nothing to do — return early to avoid double-generation.
            const [runArticle] = await db.select({ articleStatus: articles.articleStatus })
              .from(articles).where(eq(articles.id, articleId)).limit(1);
            const terminalStatuses = ['COMPLETE', 'GPT4_ENHANCED', 'CHATGPT_REVIEWED'];
            if (runArticle && terminalStatuses.includes(runArticle.articleStatus || '')) {
              console.log(`⏭️ SKIPPING: Article ${articleId} run ${runId.slice(0,8)} already completed and article is ${runArticle.articleStatus} — no regeneration needed`);
              return;
            }
            // Run completed but article isn't in terminal state — continue to regenerate
            console.log(`♻️ CACHE HIT: Article ${articleId} run ${runId.slice(0,8)} completed but article is ${runArticle?.articleStatus} — continuing`);
          } else if (existingRun.status === 'running') {
            // Update heartbeat timestamp to show this worker is actively processing
            // This allows legitimate pg-boss retries to resume work instead of getting stuck
            console.log(`🔄 RESUMING: Article ${articleId} run ${runId.slice(0,8)} continuing from previous attempt`);
            await db
              .update(articleRuns)
              .set({ startedAt: new Date() }) // Heartbeat update
              .where(eq(articleRuns.id, existingRun.id));
          } else if (existingRun.status === 'failed') {
            // Previous run failed - retry with fresh attempt
            console.log(`🔁 RETRY: Article ${articleId} run ${runId.slice(0,8)} retrying after previous failure`);
            await db
              .update(articleRuns)
              .set({ status: 'running', startedAt: new Date() })
              .where(eq(articleRuns.id, existingRun.id));
          }
        } else {
          // STEP 3: Create new run record
          await db.insert(articleRuns).values({
            articleId,
            runId,
            status: 'running',
            runType: customInstructions ? 'regeneration' : 'generation',
          });
          console.log(`🆕 Created article run record: article ${articleId}, runId ${runId.slice(0,8)}`);
        }
        
        // Check current article status to resume from previous stage if needed
        const [currentArticle] = await db
          .select()
          .from(articles)
          .where(eq(articles.id, articleId));

        // IDEMPOTENCY GUARD: Never regenerate an article that already completed the full
        // pipeline. The job monitor may reset stuck pg-boss jobs — if the article already
        // reached COMPLETE/GPT4_ENHANCED the reset job should be a no-op, not a re-run.
        const finalStatuses = ['COMPLETE', 'GPT4_ENHANCED'];
        if (finalStatuses.includes(currentArticle?.articleStatus || '')) {
          console.log(`⏭️ SKIPPING: Article ${articleId} is already ${currentArticle!.articleStatus} — job reset but no regeneration needed`);
          return;
        }
        
        let geminiResult: any;
        let skipGeminiUpdate = false;
        
        // RESUME LOGIC: Skip Gemini if already complete (preserve expensive work)
        if (currentArticle?.articleStatus === "GEMINI_COMPLETE" && currentArticle?.finalHtmlContent) {
          console.log(`♻️ RESUMING: Article ${articleId} already has Gemini content, skipping to ChatGPT review`);
          
          // Hydrate geminiResult from EXISTING saved metadata (reuse everything as-is)
          geminiResult = {
            rawContent: currentArticle.finalHtmlContent!,
            seoTitle: currentArticle.seoTitle!,
            metaDescription: currentArticle.metaDescription!,
            slug: currentArticle.slug!, // Always reuse existing slug - never regenerate
            keywords: (currentArticle.keywordsJson as string[]) || [],
            hashtags: (currentArticle.hashtagsJson as string[]) || [],
            faq: (currentArticle.faqJson as Array<{question: string, answer: string}>) || [],
            imagePrompts: (currentArticle.imagePromptsJson as string[]) || [],
            wordCount: currentArticle.wordCount || 0,
          };
          
          // Skip the database update since data already exists
          skipGeminiUpdate = true;
        } else {
          // Update status to IN_PROGRESS
          await db
            .update(articles)
            .set({ articleStatus: "IN_PROGRESS" })
            .where(eq(articles.id, articleId));

          // Log article generation start
          const { jobEvents } = await import("@/shared/schema");
          await db.insert(jobEvents).values({
            articleId,
            batchId,
            eventType: "ARTICLE_STARTED",
            stage: "GEMINI_GENERATION",
            severity: "info",
            message: `Generating article: "${title}"`,
            payloadJson: { title, wordCountMin, wordCountMax, tone, serpFeatureTarget }
          });

          // Guardian failure warnings are fetched and injected directly inside
          // generateArticleContent() (lib/gemini.ts) as a dedicated prompt section.
          // Do NOT fetch them here — that would cause a duplicate DB query and
          // double-inject the same warnings into the same prompt.
          const effectiveCustomInstructions = customInstructions || "";

          // THUNDERING HERD PREVENTION: When a large batch starts, all 20 workers
          // grab jobs within milliseconds of each other and simultaneously hammer
          // Gemini. A small random delay (0–5s) staggers the initial burst so the
          // API isn't saturated all at once. The existing rate limiter manages
          // sustained throughput — this jitter only absorbs the startup spike.
          // Applied here (after IN_PROGRESS status is set) so the UI updates
          // immediately and the delay is invisible to the user.
          const jitterMs = Math.floor(Math.random() * 5000);
          await new Promise((resolve) => setTimeout(resolve, jitterMs));

          // STAGE 1: Generate content with Gemini
          console.log(`🤖 Stage 1: Gemini generating article ${articleId}${businessName ? ` for ${businessName}` : ''}${customInstructions ? ' (with custom instructions)' : ''}...`);

          // SHADOW RUN PRE-FLIGHT: Build failure pattern awareness before generation
          let shadowRunPlan: any = undefined;
          try {
            const { buildArticleShadowRunPlan } = await import("./article-shadow-run");
            shadowRunPlan = await buildArticleShadowRunPlan({
              articleId,
              title,
              geographicFocus,
            });
            const { jobEvents } = await import("@/shared/schema");
            await db.insert(jobEvents).values({
              articleId,
              batchId,
              eventType: "ARTICLE_PREFLIGHT",
              stage: "SHADOW_RUN",
              severity: "info",
              message: shadowRunPlan.summary,
              payloadJson: {
                failurePatterns: shadowRunPlan.failurePatterns,
                recentErrors: shadowRunPlan.recentErrors,
              },
            });
            console.log(`🔮 [SHADOW RUN] Pre-flight complete for article ${articleId}: ${shadowRunPlan.failurePatterns.length} failure pattern(s) loaded`);
          } catch (shadowRunError) {
            console.warn(`⚠️ Shadow Run preflight failed for article ${articleId} (non-fatal):`, shadowRunError);
          }

          // HARD TIMEOUT: Force-fail if Gemini call hangs for >10 minutes
          const GEMINI_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
          
          geminiResult = await withTimeout(
            generateArticleWithGemini(
              title,
              targetUrl,
              wordCountMin || 800,
              wordCountMax || 2000,
              tone || "professional",
              geographicFocus,
              audience,
              competitorUrls,
              serpFeatureTarget,
              businessName,
              effectiveCustomInstructions || undefined,
              companyLogoUrl,
              batchId, // OPTIMIZATION: Pass batch ID for SEO cache lookup
              articleTeamId, // Psychographic targeting: team context
              articlePersonaId, // Psychographic targeting: persona for content adaptation
              shadowRunPlan // Shadow run pre-flight failure pattern awareness
            ),
            GEMINI_TIMEOUT_MS,
            `Gemini Generation (Article ${articleId})`
          );
          
          // CRITICAL: Validate image prompts for brand safety IMMEDIATELY after generation
          // Prevents generic placeholders like "company name" from entering the system
          if (geminiResult.imagePrompts && geminiResult.imagePrompts.length > 0 && businessName) {
            const { validateImagePromptBranding } = await import("@/lib/branding");
            const promptValidation = validateImagePromptBranding(
              geminiResult.imagePrompts,
              businessName
            );
            
            if (!promptValidation.valid) {
              const errorMsg = `Brand safety validation FAILED for article ${articleId}: ${promptValidation.errors.join('; ')}`;
              console.error(`❌ ${errorMsg}`);
              console.error(`📋 Invalid image prompts:`, geminiResult.imagePrompts);
              
              // Log detailed error event for debugging
              const { jobEvents } = await import("@/shared/schema");
              await db.insert(jobEvents).values({
                articleId,
                batchId,
                eventType: "ARTICLE_FAILED",
                stage: "GEMINI_GENERATION",
                severity: "error",
                message: errorMsg,
                payloadJson: { 
                  validationErrors: promptValidation.errors,
                  invalidPrompts: geminiResult.imagePrompts
                }
              });
              
              throw new Error(errorMsg);
            }
            
            console.log(`✅ Image prompt brand validation passed for article ${articleId}`);
          }
        }

        // Only update database if we generated new Gemini content (not resuming)
        if (!skipGeminiUpdate) {
          // Ensure slug uniqueness by appending article ID if duplicate
          let uniqueSlug = geminiResult.slug;
          const existingSlug = await db
            .select({ id: articles.id })
            .from(articles)
            .where(eq(articles.slug, geminiResult.slug))
            .limit(1);
          
          if (existingSlug.length > 0 && existingSlug[0]?.id !== articleId) {
            uniqueSlug = `${geminiResult.slug}-${articleId}`;
            console.log(`⚠️ Slug collision detected - using unique slug: ${uniqueSlug}`);
          }

          // Update with Gemini content
          await db
            .update(articles)
            .set({
              articleStatus: "GEMINI_COMPLETE",
              finalHtmlContent: geminiResult.rawContent,
              seoTitle: cleanSeoTitle(geminiResult.seoTitle),
              metaDescription: cleanMetaDescription(geminiResult.metaDescription),
              slug: uniqueSlug,
              keywordsJson: geminiResult.keywords || [],
              hashtagsJson: geminiResult.hashtags || [],
              faqJson: cleanFaqAnswers(geminiResult.faq || []),
              imagePromptsJson: geminiResult.imagePrompts || [],
              wordCount: geminiResult.wordCount,
            })
            .where(eq(articles.id, articleId));
        } else {
          console.log(`✓ Using existing Gemini metadata - no database update needed`);
        }

        // STAGE 1.5: REFLEXIVE VALIDATION - Check for promotional language and AI clichés
        // This ensures educational content doesn't read like an advertisement
        const disableReflexiveCheck = process.env.DISABLE_REFLEXIVE_CHECK === "true";
        
        if (!disableReflexiveCheck && businessName) {
          try {
            const { generateArticleReflexive, quickValidateContent } = await import("@/lib/article-reflexive");
            
            // Quick check first - if clean, skip rewrite
            const quickCheck = quickValidateContent(geminiResult.rawContent, businessName);
            
            if (!quickCheck.isClean) {
              console.log(`🔄 Stage 1.5: Reflexive validation - ${quickCheck.summary}`);
              
              const reflexiveResult = await generateArticleReflexive(
                geminiResult.rawContent,
                businessName,
                { maxPasses: 2, strictMode: true }
              );
              
              if (reflexiveResult.wasRewritten) {
                // Update content with reflexively cleaned version
                geminiResult.rawContent = reflexiveResult.content;
                
                // Update database with cleaned content
                await db
                  .update(articles)
                  .set({ finalHtmlContent: reflexiveResult.content })
                  .where(eq(articles.id, articleId));
                
                console.log(`✅ Reflexive rewrite complete: ${reflexiveResult.initialViolations.length} → ${reflexiveResult.finalViolations.length} violations`);
                console.log(`   Quality metrics: promo-free=${reflexiveResult.qualityMetrics.promoFreeScore}/100, educational=${reflexiveResult.qualityMetrics.educationalTone}`);
              } else {
                console.log(`✅ Article passed reflexive validation without rewrite`);
              }
            } else {
              console.log(`✅ Quick validation passed - no promotional issues detected`);
            }
          } catch (reflexiveError) {
            console.warn(`⚠️ Reflexive validation failed, continuing with original content:`, (reflexiveError as Error).message);
          }
        }

        // STAGE 1.6: GenerationOrchestrator — critic-in-the-loop + patternsUsedJson attribution
        // Runs structural, completeness, and humanness checks then patches
        // specific defects before content reaches GPT review. Bounded to 2 passes.
        // Factuality defects are flagged <mark data-unverified> for human review,
        // never blindly re-rolled into a different hallucination.
        // Guard is kept here so pattern fetching + attribution are also skipped
        // when the loop is disabled (prevents attributing patterns to a path they never ran in).
        const disableCriticLoop = process.env.DISABLE_CRITIC_LOOP === "true";
        if (!disableCriticLoop && currentArticle?.teamId) {
          try {
            // Fetch learned patterns for attribution so EMA/Wilson updates fire
            // on the real patterns that influenced this generation.
            const articleEnhancement = await getPromptEnhancement(
              currentArticle.teamId,
              ContentType.ARTICLE
            ).catch(() => ({ patternsUsed: [] as number[] }));
            // Store on the article object — read by recordContentGenerated below.
            (currentArticle as any)._patternsUsed = articleEnhancement.patternsUsed;

            const orchestratorResult = await runGenerationOrchestrator({
              teamId: currentArticle.teamId,
              contentType: ContentType.ARTICLE,
              contentId: articleId,
              content: geminiResult.rawContent,
              patternsUsed: articleEnhancement.patternsUsed,
              brief: {
                topic: title,
                location: geographicFocus || undefined,
                targetWords: Math.round((wordCountMin + wordCountMax) / 2),
              },
              kind: "article",
            });

            if (orchestratorResult.repairs > 0) {
              geminiResult.rawContent = orchestratorResult.content;
              // Persist repaired content so resume logic picks it up cleanly
              await db
                .update(articles)
                .set({ finalHtmlContent: orchestratorResult.content })
                .where(eq(articles.id, articleId));
              console.log(
                `🔧 Stage 1.6: Critic applied ${orchestratorResult.repairs} repair(s), quality=${orchestratorResult.qualityScore}, status=${orchestratorResult.status}`
              );
            } else if (orchestratorResult.orchestrated) {
              console.log(`✅ Stage 1.6: Content passed critic review (no repairs needed)`);
            }
            // Thread quality score and arm ID forward to recordContentGenerated
            if (orchestratorResult.orchestrated && orchestratorResult.qualityScore > 0) {
              (currentArticle as any)._qualityScore = orchestratorResult.qualityScore;
            }
            if (orchestratorResult.armId !== undefined) {
              (currentArticle as any)._armId = orchestratorResult.armId;
            }
          } catch (criticError) {
            console.warn(
              `⚠️ Stage 1.6 orchestrator failed, continuing with current content:`,
              (criticError as Error).message
            );
          }
        }

        // STAGE 2: ChatGPT Review & Enrichment (ENABLED BY DEFAULT)
        // Set DISABLE_CHATGPT_REVIEW=true to skip for speed testing
        const disableChatGPTReview = process.env.DISABLE_CHATGPT_REVIEW === "true";
        let hyperlinksForGPT: any[] = [];
        
        if (disableChatGPTReview) {
          console.log(`⏩ Skipping Stage 2 ChatGPT review (manually disabled) - article ${articleId}`);
          // FALLBACK: Use Gemini keywords when ChatGPT review is disabled
          hyperlinksForGPT = (geminiResult.keywords || []).map((k: string) => ({ keyword: k, category: 'primary_service' }));
          console.log(`📋 Using ${hyperlinksForGPT.length} Gemini keywords as hyperlink fallback`);
        } else {
          console.log(`🔍 Stage 2: ChatGPT reviewing article ${articleId}...`);
        
        if (!disableChatGPTReview) {
        try {
          // Import BATCHED ChatGPT review function (combines 4 API calls into 1)
          const { batchedChatGPTReview } = await import("@/lib/chatgpt-review/batched-review");

          // Execute batched ChatGPT enrichment with retry logic
          let lastError: Error | null = null;
          let batchedResult;
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(`🔍 Batched ChatGPT review attempt ${attempt}/3 for article ${articleId}...`);
              
              // HARD TIMEOUT: Force-fail if ChatGPT review hangs
              // Allow time for 3 retry attempts (90s each) + retry delays (2s + 4s)
              // Total needed: 90s × 3 + 6s = 276s, so use 5 minutes to be safe
              const CHATGPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
              
              // ULTRA-FAST: Run all 4 ChatGPT enrichment tasks in 1 API call
              // This reduces 4 API calls to 1 call (~75% reduction in API overhead)
              batchedResult = await withTimeout(
                batchedChatGPTReview({
                  content: geminiResult.rawContent,
                  title,
                  seoTitle: geminiResult.seoTitle,
                  metaDescription: geminiResult.metaDescription,
                  keywords: geminiResult.keywords || [],
                  targetUrl,
                  geographicFocus,
                  businessName,
                  audience,
                  competitorUrls,
                }),
                CHATGPT_TIMEOUT_MS,
                `ChatGPT Review (Article ${articleId})`
              );
              
              console.log(`✅ Batched ChatGPT review successful on attempt ${attempt}`);
              lastError = null;
              break;
            } catch (retryError) {
              lastError = retryError as Error;
              console.error(`❌ Batched ChatGPT review attempt ${attempt}/3 failed:`, retryError);
              
              if (attempt < 3) {
                const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s
                console.log(`⏳ Retrying in ${delayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
              }
            }
          }
          
          // If all retries failed, STOP the pipeline but PRESERVE intermediate work
          if (lastError) {
            console.error(`❌ Batched ChatGPT review failed after 3 attempts for article ${articleId}`);
            console.log(`💾 Preserving Gemini content at GEMINI_COMPLETE status for recovery`);
            
            await db.insert(errorLogs).values({
              articleId,
              batchId,
              errorType: "CHATGPT_REVIEW",
              errorMessage: `Batched ChatGPT review failed after 3 retries (work preserved at GEMINI_COMPLETE for recovery): ${lastError.message}`,
              stackTrace: lastError.stack,
              severity: "error",
            });
            
            // LEAVE STATUS AT GEMINI_COMPLETE instead of FAILED
            // This preserves the Gemini content and allows manual review/regeneration
            // The article is still queryable and the work is not lost
            
            throw new Error(`Batched ChatGPT review failed after 3 attempts: ${lastError.message}`);
          }

          console.log(`✅ Batched ChatGPT review complete for article ${articleId} - SEO Score: ${batchedResult!.seo.seoScore}/100`);
          console.log(`  📎 Generated ${batchedResult!.hyperlinks.totalLinks} hyperlinks, ${batchedResult!.hashtags.totalCount} hashtags`);
          console.log(`  💰 Saved ${batchedResult!.tokenUsage.totalTokens} tokens (${batchedResult!.tokenUsage.promptTokens}p + ${batchedResult!.tokenUsage.completionTokens}c)`);
          
          // Store hyperlinks for GPT-4 to apply
          hyperlinksForGPT = batchedResult!.hyperlinks.keywords || [];
          
          // Build meta enrichment object
          const metaEnrichment = {
            socialSnippets: batchedResult!.socialSnippets,
            hashtags: batchedResult!.hashtags.hashtags,
            hashtagCategories: batchedResult!.hashtags.categories,
            readability: batchedResult!.seo.readability,
            localSignals: batchedResult!.seo.localSignals,
          };

          await db
            .update(articles)
            .set({
              articleStatus: "CHATGPT_REVIEWED",
              seoScore: batchedResult!.seo.seoScore,
              hyperlinkedKeywordsJson: batchedResult!.hyperlinks.keywords || [],
              metaEnrichment,
            })
            .where(eq(articles.id, articleId));
        } catch (reviewError) {
          console.error(`❌ CRITICAL: ChatGPT review error for article ${articleId}:`, reviewError);
          console.log(`💾 Preserving Gemini content at GEMINI_COMPLETE status for recovery`);
          
          // Log detailed error for diagnosis
          await db.insert(errorLogs).values({
            articleId,
            batchId,
            errorType: "CHATGPT_REVIEW_CRITICAL",
            errorMessage: `ChatGPT review failed (work preserved at GEMINI_COMPLETE for recovery): ${reviewError instanceof Error ? reviewError.message : String(reviewError)}`,
            stackTrace: reviewError instanceof Error ? reviewError.stack : undefined,
            severity: "error",
          });
          
          // LEAVE STATUS AT GEMINI_COMPLETE instead of FAILED
          // This preserves the Gemini content and allows manual review/regeneration
          // The article is still queryable and the work is not lost
          
          throw reviewError; // Re-throw to stop article processing
        }
        } // End if (!disableChatGPTReview)
        } // End if (!disableChatGPTReview) else block

        // STAGE 3: GPT-4 Enhancement (ENABLED BY DEFAULT)
        // Set DISABLE_GPT_ENHANCEMENT=true to skip for speed testing
        const disableGPTEnhancement = process.env.DISABLE_GPT_ENHANCEMENT === "true";
        
        if (disableGPTEnhancement) {
          console.log(`⚡ Skipping Stage 3 GPT-4 enhancement (manually disabled) - article ${articleId}`);
          
          // Use raw Gemini content directly for blazing fast generation
          await db
            .update(articles)
            .set({
              articleStatus: "COMPLETE",
              finalHtmlContent: `<article>${geminiResult.rawContent.replace(/\n/g, '<br>')}</article>`,
            })
            .where(eq(articles.id, articleId));
          
          console.log(`⚡ Article ${articleId} completed in SPEED MODE (Gemini-only)`);
        } else {
          console.log(`🎨 Stage 3: GPT-4 enhancing article ${articleId}...`);
          
          // Note: Images will be generated in background AFTER article completes
          // So we pass empty array to GPT-4 for now (images added post-publication)
          const imageUrls: string[] = [];
          
          // HARD TIMEOUT: Force-fail if GPT-4 call hangs for >20 minutes
          // (Normal: 3 min timeout × 5 retries = ~16 min max)
          const GPT_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
          
          const gptResult = await withTimeout(
            enhanceArticleWithGPT(
              geminiResult.rawContent,
              geminiResult.seoTitle,
              geminiResult.metaDescription,
              geminiResult.keywords,
              imageUrls,
              semanticClusterId,
              hyperlinksForGPT,
              geminiResult.hashtags || [],
              geminiResult.faq || [],
              targetUrl,
              businessName,
              geographicFocus  // Pass location so local phrase extractor can find geo-relevant phrases
            ),
            GPT_TIMEOUT_MS,
            `GPT-4 Enhancement (Article ${articleId})`
          );

          // -----------------------------------------------------------------------
          // HYPERLINK APPLICATION — Global Slug Map + Cheerio DOM Engine
          //
          // Architectural principle: inject AFTER GPT-4 finalises the HTML using a
          // deterministic dictionary (slug map). No LLM extraction step, no
          // hyperlinksForGPT gate. If the word is in the final HTML and in the map,
          // it gets linked. Period.
          //
          // Flow:
          //   1. buildSlugMap → reads sitePages (crawled) for this team/domain.
          //      Falls back to batch context terms when no crawl data exists.
          //   2. injectLinksFromSlugMap → Cheerio DOM walker; skips headings/anchors/
          //      code; word-boundary regex; max 1 link per keyword.
          // -----------------------------------------------------------------------
          let finalHtmlWithLinks = gptResult.finalHtml;

          if (!targetUrl || !targetUrl.match(/^https?:\/\//i)) {
            console.log(`⚠️ No valid targetUrl for batch ${batchId} — skipping hyperlink injection for article ${articleId}`);
          } else {
            try {
              const { buildSlugMap, injectLinksWithIntent, buildFallbackTerms } = await import("./slug-map-injector");

              const fallbackTerms = buildFallbackTerms({
                coreTopic: undefined, // populated from batch record below
                geographicFocus,
                businessName,
                geminiKeywords: geminiResult.keywords || [],
              });

              // Fetch teamId from batch record (needed for sitePages query)
              const batchRecord = await db.select().from(jobBatches).where(eq(jobBatches.id, batchId)).limit(1);
              const batchTeamId = batchRecord[0]?.teamId ?? 0;
              const batchCoreTopic = batchRecord[0]?.coreTopic;
              if (batchCoreTopic) fallbackTerms.unshift(batchCoreTopic);

              const { entries, pages } = await buildSlugMap(batchTeamId, targetUrl, fallbackTerms);

              // Use intent-driven injection: AI finds semantically relevant anchor phrases
              // from the actual article text — not just literal keyword matches.
              const injection = await injectLinksWithIntent(gptResult.finalHtml, entries, pages, targetUrl, title, fallbackTerms);
              if (injection.linksInjected > 0) {
                finalHtmlWithLinks = injection.html;
              } else {
                console.warn(`⚠️ Hyperlink injection found no matches for article ${articleId} (mode: ${injection.mode})`);
              }
            } catch (hlError) {
              console.warn(`⚠️ Slug map injection failed for article ${articleId}:`, hlError instanceof Error ? hlError.message : hlError);
              // Keep gptResult.finalHtml unchanged — never block article save on link failure
            }
          }

          // GAP 3 FIX: Count actual <a> tags injected into the HTML, not just the
          // keyword intention list stored in hyperlinkedKeywordsJson.
          // hyperlinkedKeywordsJson reflects what ChatGPT *suggested*, not what was
          // actually applied. If no real <a> tags are present, log a clear warning.
          const countAnchorTags = (html: string) => {
            const matches = html.match(/<a\s[^>]*href=/gi);
            return matches ? matches.length : 0;
          };
          const anchorsBefore = countAnchorTags(gptResult.finalHtml);
          const anchorsAfter = countAnchorTags(finalHtmlWithLinks);
          const newAnchorsApplied = anchorsAfter - anchorsBefore;

          if (targetUrl && hyperlinksForGPT && hyperlinksForGPT.length > 0 && newAnchorsApplied === 0) {
            console.warn(
              `⚠️ HYPERLINK AUDIT: Article ${articleId} — ` +
              `${hyperlinksForGPT.length} keywords were suggested but 0 real <a> tags were injected. ` +
              `Possible cause: keyword phrases not found verbatim in HTML body. ` +
              `Article saved as-is; no links present.`
            );
          } else if (newAnchorsApplied > 0) {
            console.log(`🔗 HYPERLINK AUDIT: Article ${articleId} — ${newAnchorsApplied} real <a> tag(s) injected (was ${anchorsBefore}, now ${anchorsAfter})`);
          }

          // Strip any short-anchor (<3 words) body links that GPT-4 may have added
          // against instructions (e.g. "delivery solutions", "urgent logistics").
          // This runs AFTER slug-map injection so all links are in final state.
          {
            const { cleanHtml, stripped } = stripShortBodyAnchorLinks(finalHtmlWithLinks);
            if (stripped > 0) {
              finalHtmlWithLinks = cleanHtml;
              console.log(`🔗 SHORT-ANCHOR CLEANUP: Article ${articleId} — removed ${stripped} short-anchor body link(s)`);
            }
          }

          // Mark as GPT4_ENHANCED before final completion - NOW WITH HYPERLINKS APPLIED
          await db
            .update(articles)
            .set({
              articleStatus: "GPT4_ENHANCED",
              finalHtmlContent: finalHtmlWithLinks,
            })
            .where(eq(articles.id, articleId));

          console.log(`✨ Article ${articleId} GPT-4 enhancement complete (with auto-hyperlinks)`);
          
          // CRITICAL VALIDATION: Verify enrichment data before marking COMPLETE
          // NOTE: Images are generated in BACKGROUND after COMPLETE, so we don't validate them here
          const [verifyArticle] = await db
            .select()
            .from(articles)
            .where(eq(articles.id, articleId));

          if (!verifyArticle) {
            throw new Error(`Article ${articleId} not found during post-enhancement verification`);
          }

          const hasKeywords = Array.isArray(verifyArticle.keywordsJson) && verifyArticle.keywordsJson.length > 0;
          const hasHashtags = Array.isArray(verifyArticle.hashtagsJson) && verifyArticle.hashtagsJson.length > 0;
          const hasFaq = Array.isArray(verifyArticle.faqJson) && verifyArticle.faqJson.length > 0;
          // GAP 3 FIX: Validate that links were actually applied in the HTML, not just
          // that the keyword list is non-empty. If no real anchors were injected we
          // still allow the article to pass (links are optional enrichment) — but we
          // explicitly check keywords, hashtags, and FAQ which are always required.
          // A targetUrl with zero anchors is LOGGED (above) but never causes a FAILED status.
          const hasHyperlinks = Array.isArray(verifyArticle.hyperlinkedKeywordsJson) && verifyArticle.hyperlinkedKeywordsJson.length > 0;
          const hasActualLinks = !targetUrl || newAnchorsApplied > 0 || anchorsBefore > 0;

          if (!hasKeywords || !hasHashtags || !hasFaq) {
            const missing = [];
            if (!hasKeywords) missing.push("keywords");
            if (!hasHashtags) missing.push("hashtags");
            if (!hasFaq) missing.push("FAQ");
            
            console.error(`❌ Article ${articleId} missing required enrichment: ${missing.join(", ")}`);
            
            await db
              .update(articles)
              .set({ articleStatus: "FAILED", errorMessage: `Missing required fields: ${missing.join(", ")}` })
              .where(eq(articles.id, articleId));
            
            await db.insert(errorLogs).values({
              articleId,
              batchId,
              errorType: "VALIDATION",
              errorMessage: `Article missing required enrichment fields: ${missing.join(", ")}`,
              severity: "error",
            });
            
            throw new Error(`Article ${articleId} failed validation - missing: ${missing.join(", ")}`);
          }
          
          if (!hasActualLinks && hasHyperlinks) {
            console.warn(`⚠️ Article ${articleId}: hyperlinkedKeywordsJson has data but no <a> tags found in HTML. Content saved without links.`);
          }
          
          // BRAND NAME NORMALIZATION: Force correct capitalization before validation
          // This catches any remaining case variations from GPT-4, JSON-LD, or other processing
          if (businessName) {
            const brandRegex = new RegExp(businessName, 'gi');
            finalHtmlWithLinks = finalHtmlWithLinks.replace(brandRegex, businessName);
            console.log(`🔒 Final brand normalization applied before validation: "${businessName}"`);
          }
          
          // BRAND NAME VALIDATION: Ensure correct brand spelling in output
          if (businessName) {
            const brandValidation = validateBrandInOutput(finalHtmlWithLinks, businessName);
            if (!brandValidation.valid) {
              console.error(`❌ Article ${articleId} failed brand validation:`, brandValidation.errors);
              
              await db
                .update(articles)
                .set({ articleStatus: "FAILED", errorMessage: `Brand name validation failed: ${brandValidation.errors.join(", ")}` })
                .where(eq(articles.id, articleId));
              
              await db.insert(errorLogs).values({
                articleId,
                batchId,
                errorType: "BRAND_VALIDATION",
                errorMessage: `Brand name validation failed: ${brandValidation.errors.join(", ")}`,
                severity: "error",
              });
              
              throw new Error(`Article ${articleId} failed brand validation: ${brandValidation.errors.join(", ")}`);
            }
            console.log(`✅ Article ${articleId} brand name validation passed: "${businessName}"`);
          }
          
          // ====================================================================
          // GUARDIAN QUALITY GATE: Verify & self-correct before COMPLETE
          // Max 2 attempts: initial audit → surgical fix → re-audit → save
          // ====================================================================
          let guardianHtml = finalHtmlWithLinks;
          const GUARDIAN_MAX_ATTEMPTS = 2;

          for (let attempt = 1; attempt <= GUARDIAN_MAX_ATTEMPTS; attempt++) {
            const audit = await auditArticle(guardianHtml, {
              minImages: 1,
              minHyperlinks: 3,
              minFaqQuestions: 2,
              minWordCount: 600,
              persona: tone || "professional",
              businessName: businessName || "",
              skipToneCheck: attempt > 1, // skip expensive tone check on retry
            });

            console.log(`🛡️ Guardian audit attempt ${attempt} for article ${articleId}: score=${audit.score}, passed=${audit.passed}`);

            if (audit.passed || audit.score >= 70) {
              console.log(`✅ Guardian approved article ${articleId} (score: ${audit.score})`);
              guardianHtml = guardianHtml; // accepted
              break;
            }

            // Record failures to Memory Ledger for future pre-generation warnings
            const allFailures = [...audit.missingElements, ...audit.formattingIssues];
            if (allFailures.length > 0 && articleTeamId) {
              learningService.recordGuardianFailures(articleTeamId, "article", allFailures).catch(() => {});
            }

            if (attempt < GUARDIAN_MAX_ATTEMPTS) {
              console.warn(`⚠️ Guardian rejected article ${articleId} (attempt ${attempt}). Issues: ${audit.missingElements.join("; ")}`);
              const fix = await applySurgicalFix({
                html: guardianHtml,
                missingElements: audit.missingElements,
                formattingIssues: audit.formattingIssues,
                businessName: businessName || undefined,
                persona: tone || "professional",
                targetUrl: targetUrl || undefined,
                keywords: geminiResult.keywords || [],
                geographicFocus: geographicFocus || undefined,
              });
              if (!fix.unchanged) {
                guardianHtml = fix.html;
                console.log(`🔧 Surgical fix applied for article ${articleId}: ${fix.appliedFixes.join(", ")}`);
              }
            } else {
              // Final attempt failed — still save but log Guardian score
              console.warn(`⚠️ Article ${articleId} did not fully pass Guardian after ${GUARDIAN_MAX_ATTEMPTS} attempts (score: ${audit.score}). Saving best effort.`);
              if (allFailures.length > 0 && articleTeamId) {
                learningService.recordGuardianFailures(articleTeamId, "article", allFailures).catch(() => {});
              }
            }
          }
          finalHtmlWithLinks = guardianHtml;
          // ====================================================================

          // Mark article as COMPLETE and save normalized HTML
          await db
            .update(articles)
            .set({
              articleStatus: "COMPLETE",
              finalHtmlContent: finalHtmlWithLinks, // Save normalized HTML with correct brand capitalization
            })
            .where(eq(articles.id, articleId));
          
          console.log(`✅ Article ${articleId} validation passed - marked COMPLETE`);

          // Track article quota usage (fire-and-forget, non-blocking)
          void (async () => {
            try {
              const batch = await db
                .select({ userId: jobBatches.userId })
                .from(jobBatches)
                .where(eq(jobBatches.id, batchId))
                .limit(1);
              const batchUserId = batch[0]?.userId;
              if (batchUserId) {
                const now = new Date();
                await db.execute(sql`
                  UPDATE user_quotas
                  SET
                    current_usage = CASE
                      WHEN period_ends_at < ${now} THEN 1
                      ELSE current_usage + 1
                    END,
                    period_starts_at = CASE
                      WHEN period_ends_at < ${now} THEN ${now}
                      ELSE period_starts_at
                    END,
                    period_ends_at = CASE
                      WHEN period_ends_at < ${now} AND period_type = 'hour'  THEN ${now}::timestamptz + INTERVAL '1 hour'
                      WHEN period_ends_at < ${now} AND period_type = 'day'   THEN ${now}::timestamptz + INTERVAL '1 day'
                      WHEN period_ends_at < ${now} AND period_type = 'week'  THEN ${now}::timestamptz + INTERVAL '7 days'
                      WHEN period_ends_at < ${now} AND period_type = 'month' THEN ${now}::timestamptz + INTERVAL '30 days'
                      ELSE period_ends_at
                    END,
                    updated_at = ${now}
                  WHERE user_id = ${batchUserId}
                    AND quota_type IN ('articles_per_day', 'articles_per_week', 'articles_per_month', 'articles_per_hour')
                    AND enabled = 1
                `);
              }
            } catch (quotaErr) {
              console.warn(`⚠️ Quota tracking failed for article ${articleId}:`, quotaErr);
            }
          })();
        }

        // STAGE 4: Queue Images for Background Generation (non-blocking)
        // Images generate AFTER article completes, so they don't block the next article
        if (geminiResult.imagePrompts && geminiResult.imagePrompts.length > 0) {
          console.log(`📸 Queueing ${geminiResult.imagePrompts.length} images for background generation (article ${articleId})${businessName ? ` with brand lock: "${businessName}"` : ''}`);
          
          // SECONDARY VALIDATION: Soft check for legacy data or any prompts that slipped through
          // Prevents generating images from invalid prompts without failing the article
          let shouldQueueImages = true;
          if (businessName) {
            const { validateImagePromptBranding } = await import("@/lib/branding");
            const promptValidation = validateImagePromptBranding(
              geminiResult.imagePrompts,
              businessName
            );
            
            if (!promptValidation.valid) {
              console.warn(`⚠️ Secondary brand validation failed - skipping image generation for article ${articleId}`);
              console.warn(`   Validation errors:`, promptValidation.errors);
              console.warn(`   Invalid prompts:`, geminiResult.imagePrompts);
              
              // Log warning event for observability (not a hard failure)
              const { jobEvents: jobEventsSchema } = await import("@/shared/schema");
              await db.insert(jobEventsSchema).values({
                articleId,
                batchId,
                eventType: "IMAGE_VALIDATION_FAILED",
                stage: "IMAGE_GENERATION",
                severity: "warning",
                message: `Skipped image generation due to brand validation: ${promptValidation.errors.join('; ')}`,
                payloadJson: {
                  validationErrors: promptValidation.errors,
                  invalidPrompts: geminiResult.imagePrompts
                }
              });
              
              // Log to error_logs for operator visibility
              await db.insert(errorLogs).values({
                articleId,
                batchId,
                errorType: "IMAGE_BRAND_VALIDATION",
                errorMessage: `Image prompts contain brand safety violations: ${promptValidation.errors.join('; ')}`,
                severity: "warning", // warning level - article is still complete
              });
              
              shouldQueueImages = false;
            }
          }
          
          if (shouldQueueImages) {
            try {
              await addImageGenerationJob({
                articleId,
                batchId,
                imagePrompts: geminiResult.imagePrompts,
                businessName, // Pass business name for brand lock in images
              });
              console.log(`✅ Image generation job queued - article ${articleId} can continue`);
            } catch (imageError) {
              console.warn(`⚠️ Failed to queue images for article ${articleId}:`, imageError);
              // Continue even if image queueing fails
            }
          }
        } else {
          console.warn(`⚠️ No image prompts found for article ${articleId} - skipping image generation`);
        }

        console.log(`✅ Article ${articleId} completed successfully`);

        // Record generation for AI Learning System
        try {
          const articleTeamId = currentArticle?.teamId;
          if (articleTeamId) {
            const patternsUsed = (currentArticle as any)._patternsUsed as number[] | undefined;
            await recordContentGenerated(
              articleTeamId,
              ContentType.ARTICLE,
              articleId,
              patternsUsed || [],
              (currentArticle as any)._qualityScore ?? 80, // orchestrator quality; default updated by engagement labeler
              { armId: (currentArticle as any)._armId as number | undefined }
            );
            console.log(`📊 Recorded article generation for AI Learning`);
          }
        } catch (learningError) {
          console.warn(`⚠️ Failed to record learning metrics:`, learningError);
        }

        // Log completion event
        const { jobEvents: jobEventsSchema } = await import("@/shared/schema");
        await db.insert(jobEventsSchema).values({
          articleId,
          batchId,
          eventType: "ARTICLE_COMPLETED",
          stage: "GPT_ENHANCEMENT",
          severity: "info",
          message: `Article completed: "${title}"`,
          payloadJson: { articleId, wordCount: geminiResult.wordCount }
        });

        // Check if all articles in batch are complete
        await checkBatchCompletion(batchId);

      } catch (error) {
        console.error(`❌ Article generation failed for article ${articleId}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Log to error_logs table
        await db.insert(errorLogs).values({
          articleId,
          batchId,
          errorType: "GENERATION",
          errorMessage: `Article generation failed: ${errorMessage}`,
          stackTrace: error instanceof Error ? error.stack : undefined,
          severity: "error",
        });
        
        // Log article failure event
        const { jobEvents } = await import("@/shared/schema");
        await db.insert(jobEvents).values({
          articleId,
          batchId,
          eventType: "ARTICLE_FAILED",
          stage: "GENERATION",
          severity: "error",
          message: `Article failed: ${errorMessage.slice(0, 500)}`,
          payloadJson: { 
            articleId,
            title,
            stackTrace: error instanceof Error ? error.stack?.slice(0, 1000) : undefined
          }
        });
        
        try {
          await db
            .update(articles)
            .set({ articleStatus: "FAILED", errorMessage: errorMessage.slice(0, 1000) })
            .where(eq(articles.id, articleId));
        } catch (dbError) {
          console.error(`❌ Failed to update article status:`, dbError);
        }

        // Record failure in learning ledger so the AI learning center can surface it
        if (articleTeamId) {
          const lowerMsg = errorMessage.toLowerCase();
          let failureCode = "GENERATION_ERROR";
          if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
            failureCode = "GENERATION_TIMEOUT";
          } else if (lowerMsg.includes("rate limit") || lowerMsg.includes("429")) {
            failureCode = "API_RATE_LIMIT";
          } else if (lowerMsg.includes("json") || lowerMsg.includes("parse") || lowerMsg.includes("unexpected token")) {
            failureCode = "JSON_PARSE_ERROR";
          } else if (lowerMsg.includes("token") && (lowerMsg.includes("limit") || lowerMsg.includes("exceed"))) {
            failureCode = "TOKEN_LIMIT_EXCEEDED";
          }
          learningService.recordGuardianFailures(articleTeamId, "article", [failureCode]).catch(() => {});
        }

        // Notify the team via the in-app bell so the failure is visible without checking logs
        if (articleTeamId) {
          void createNotification({
            teamId: articleTeamId,
            type: "error",
            category: "article",
            title: "Article Generation Failed",
            message: `"${(title || "Article").slice(0, 80)}" failed: ${errorMessage.slice(0, 200)}`,
            entityId: articleId,
            entityType: "article",
            actionUrl: `/content/${articleId}`,
          }).catch(() => {});
        }

        // Check batch completion even on failure
        await checkBatchCompletion(batchId);

        throw error;
      }
      }  // Close for loop over jobs
    }
    );
  }  // Close for loop over workers
  
  const geminiRateLimit = parseInt(process.env.GEMINI_RATE_LIMIT || "10");
  console.log(`✅ Registered ${CONCURRENT_WORKERS} concurrent article workers (Gemini API: ${geminiRateLimit} req/min throttle)`);
  console.log(`   💡 Architecture: ${CONCURRENT_WORKERS} workers match ${geminiRateLimit} API slots for optimal concurrency`);

  // ============================================================================
  // STANDALONE SOCIAL POST GENERATION WORKER (Phase 10)
  // ============================================================================

  try {
    console.log(`🎭 Registering social post generation worker for queue: "${SOCIAL_POST_GENERATION_QUEUE}"`);
    
    const { processSocialPostGeneration } = await import("./social-worker");
    
    await boss.work<SocialPostJobData>(
      SOCIAL_POST_GENERATION_QUEUE,
      { batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await processSocialPostGeneration(job);
        }
      }
    );
    
    console.log(`✅ Social post generation worker registered successfully`);
  } catch (error) {
    console.error(`❌ CRITICAL: Failed to register social post worker:`, error);
    throw error; // Re-throw to see the error
  }

  // ============================================================================
  // IMAGE GENERATION WORKER (Background, concurrent)
  // ============================================================================
  
  // LIGHTNING-FAST: 10 concurrent image generation workers
  // Each job generates 5 images in parallel (10 concurrent DALL-E calls per job)
  const IMAGE_WORKERS = 6;
  
  try {
    console.log(`🖼️ Registering ${IMAGE_WORKERS} image generation workers for queue: "${IMAGE_GENERATION_QUEUE}"`);
    
    for (let workerNum = 1; workerNum <= IMAGE_WORKERS; workerNum++) {
      await boss.work<ImageGenerationJobData>(
        IMAGE_GENERATION_QUEUE,
        { 
          batchSize: 1,  // Each worker processes 1 article's images at a time
        },
        async (jobs) => {
          for (const job of jobs) {
            // Skip test jobs created during queue initialization
            if ((job.data as any).__test || (job.data as any).__queue_initialization) {
              console.log(`⏭️ Skipping test job ${job.id} (queue initialization)`);
              continue;
            }

            console.log(`🖼️ [Worker ${workerNum}] Processing image generation job ${job.id}`);
            const { articleId, batchId, imagePrompts, businessName: jobBusinessName } = job.data;

            try {
              // CRITICAL: Validate businessName from job data first (new batches)
              let businessName = jobBusinessName;
              let targetUrl = '';
              
              // Fallback to batch for legacy jobs (backwards compatibility)
              // Also fetch targetUrl for image captioning
              const [batch] = await db
                .select()
                .from(jobBatches)
                .where(eq(jobBatches.id, batchId));
              
              if (!businessName || businessName.trim().length === 0) {
                businessName = batch?.businessName ?? undefined;
              }
              targetUrl = batch?.targetUrl || '';
              
              // HARD STOP: Fail if still no businessName (prevents AI hallucination)
              if (!businessName || businessName.trim().length === 0) {
                const errorMsg = `CRITICAL: Cannot generate images for article ${articleId} without businessName. This prevents AI hallucination of company names.`;
                console.error(`❌ [Worker ${workerNum}] ${errorMsg}`);
                throw new Error(errorMsg);
              }
              
              console.log(`🔒 [Worker ${workerNum}] Brand lock active: "${businessName}"`);

              // Orchestrator: critic loop + arm assignment for image prompt quality
              let finalImagePrompts = imagePrompts;
              if (batch?.teamId) {
                try {
                  // Fetch learned patterns for attribution so Wilson/EMA updates fire.
                  const imageEnhancement = await getPromptEnhancement(batch.teamId, ContentType.IMAGE)
                    .catch(() => ({ patternsUsed: [] as number[] }));
                  const capturedImagePatternIds = imageEnhancement.patternsUsed;

                  const orchResult = await runGenerationOrchestrator({
                    teamId: batch.teamId,
                    contentType: ContentType.IMAGE,
                    contentId: articleId,
                    content: imagePrompts.join('\n\n---\n\n'),
                    patternsUsed: capturedImagePatternIds,
                    brief: {},
                    kind: "script",
                    requireJudge: false,
                  });
                  if (orchResult.repairs > 0 && orchResult.orchestrated) {
                    const repairedSplit = orchResult.content.split(/\n\n---\n\n/).map(p => p.trim()).filter(Boolean);
                    if (repairedSplit.length === imagePrompts.length) {
                      finalImagePrompts = repairedSplit;
                      console.log(`🔧 [Worker ${workerNum}] Image prompts critic: ${orchResult.repairs} repair(s) for article ${articleId}`);
                    }
                  }
                  await recordContentGenerated(
                    batch.teamId,
                    ContentType.IMAGE,
                    articleId,
                    capturedImagePatternIds,
                    orchResult.qualityScore > 0 ? orchResult.qualityScore : 75,
                    { armId: orchResult.armId }
                  ).catch(() => { /* non-fatal */ });
                } catch (orchErr) {
                  console.warn(`[Image Worker] Orchestrator failed, continuing:`, (orchErr as Error).message);
                }
              }

              const { generateImagesForArticle } = await import("@/lib/gemini-image-generator");
              const imageResults = await generateImagesForArticle(articleId, finalImagePrompts, businessName, targetUrl);
              console.log(`✅ [Worker ${workerNum}] Generated ${imageResults.length}/${imagePrompts.length} images for article ${articleId}`);
            } catch (error) {
              console.error(`❌ [Worker ${workerNum}] Image generation failed for article ${articleId}:`, error);
              // Don't throw - images are optional, article is already complete
            }
          }
        }
      );
    }
    
    console.log(`✅ Registered ${IMAGE_WORKERS} image generation workers successfully`);
  } catch (error) {
    console.error(`❌ CRITICAL: Failed to register image generation workers:`, error);
    throw error; // Re-throw to see the error
  }

  // ============================================================================
  // REFORMAT WORKER (Background HTML formatting)
  // ============================================================================

  try {
    console.log(`🔄 Registering reformat worker for queue: "${REFORMAT_QUEUE}"`);
    // Ensure the queue row exists in pgboss.queue BEFORE subscribing.
    // Without this, pg-boss may not route jobs to the worker subscription.
    // (All other queues follow this same pattern.)
    try { await boss.createQueue(REFORMAT_QUEUE); } catch (_) { /* already exists — ok */ }

    await boss.work<ReformatJobData>(
      REFORMAT_QUEUE,
      { batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          console.log(`🔄 Processing reformat job ${job.id} for article ${job.data.articleId}`);
          const { articleId } = job.data;

          try {
            // Get the article
            const [article] = await db
              .select()
              .from(articles)
              .where(eq(articles.id, articleId));

            if (!article) {
              console.error(`❌ Article ${articleId} not found - skipping reformat`);
              continue;
            }

            // Mark as REFORMATTING immediately so the UI shows progress
            await db
              .update(articles)
              .set({ articleStatus: "REFORMATTING" })
              .where(eq(articles.id, articleId))
              .catch(() => {}); // non-blocking — don't let a status update kill the job

            // Get the batch to retrieve targetUrl and businessName
            const [batch] = await db
              .select()
              .from(jobBatches)
              .where(eq(jobBatches.id, article.batchId));
            
            const targetUrl = batch?.targetUrl || "";
            const businessName = batch?.businessName || undefined;

            // SAFE JSONB extraction — geographicFocus is inside generationParams, not a direct column.
            // Using batch?.geographicFocus directly silently returns undefined (the "JSONB ghost" bug).
            const reformatBatchParams = (batch?.generationParams as Record<string, any>) ?? {};
            const reformatGeoFocus: string | undefined = reformatBatchParams.geographicFocus;

            // Strip any leaked placeholder tokens before passing to GPT-4
            const rawContent = (article.finalHtmlContent || "")
              .replace(/___HEADER_PROTECT_\d+___/g, "")
              .replace(/___EXISTING_LINK_\d+___/g, "");
            const rawHyperlinks = Array.isArray(article.hyperlinkedKeywordsJson) 
              ? article.hyperlinkedKeywordsJson 
              : [];

            // REFORMAT GUARDIAN: Validate any pre-stored hyperlinks against SEO policy.
            // Old articles may have bare-geo or short anchors saved before the policy existed.
            const { isHighQualityAnchor, isBareGeoAnchor } = await import("./seo-policy");
            let hadBareGeo = false;
            let hadShortAnchor = false;
            let hyperlinks: Array<{ phrase: string; url: string; type: string; anchorText: string }> =
              (rawHyperlinks as Array<{ anchorText?: string; phrase?: string; url?: string; type?: string }>)
              .filter((link) => {
                const anchor = (link.anchorText || link.phrase || "").trim();
                if (!anchor) return false;
                if (isBareGeoAnchor(anchor)) {
                  console.warn(`[ReformatGuard] Stripped bare-geo hyperlink "${anchor.slice(0, 60)}" for article ${articleId}`);
                  hadBareGeo = true;
                  return false;
                }
                if (!isHighQualityAnchor(anchor)) {
                  console.warn(`[ReformatGuard] Stripped low-quality hyperlink "${anchor.slice(0, 60)}" for article ${articleId}`);
                  hadShortAnchor = true;
                  return false;
                }
                return true;
              })
              .map((link) => ({
                phrase: link.phrase || link.anchorText || "",
                url: link.url || "",
                type: link.type || "body",
                anchorText: link.anchorText || link.phrase || "",
              }));

            if (rawHyperlinks.length !== hyperlinks.length) {
              console.log(`[ReformatGuard] Article ${articleId}: ${rawHyperlinks.length - hyperlinks.length} invalid hyperlinks removed (${hyperlinks.length} remain)`);
              // NEURAL LOOP: Record stripped anchor failures in the ledger so the AI
              // learns from this in future article generations for the same team.
              const guardianFailureCodes: string[] = [];
              if (hadBareGeo) guardianFailureCodes.push("BARE_GEO_ANCHOR");
              if (hadShortAnchor) guardianFailureCodes.push("SHORT_ANCHOR");
              if (guardianFailureCodes.length > 0 && batch?.teamId) {
                learningService.recordGuardianFailures(batch.teamId, "article", guardianFailureCodes).catch(() => {});
              }
            }

            // CRITICAL: If article has no valid hyperlinks after policy filter, generate them now
            if (!hyperlinks || hyperlinks.length === 0) {
              try {
                console.log(`🔗 Generating hyperlinks for article ${articleId} (old article missing hyperlinks)`);
                const { generateArticleBodyLinks } = await import("@/lib/chatgpt-review/gpt4-hyperlinker");
                const linkResult = await generateArticleBodyLinks(
                  rawContent,
                  targetUrl,
                  [],
                  reformatGeoFocus
                );
                // gpt4-hyperlinker already filters via isHighQualityAnchor internally
                hyperlinks = linkResult.links.map(link => ({
                  phrase: link.anchorText,
                  url: link.destinationUrl,
                  type: "body",
                  anchorText: link.anchorText,
                }));
                console.log(`✅ Generated ${hyperlinks.length} validated hyperlinks for article ${articleId}${linkResult.rejectedCount > 0 ? ` (${linkResult.rejectedCount} rejected by policy)` : ''}`);
              } catch (linkError) {
                console.warn(`⚠️ Hyperlink generation failed for article ${articleId}:`, linkError);
                // Continue without hyperlinks - don't block reformat
              }
            }

            // Extract existing image URLs from the article HTML before reformatting.
            // Without this, the GPT-4 prompt says "No images provided — skip image placement"
            // and GPT-4 actively strips every <figure>/<img> tag from the article, losing
            // all images that were injected during the original generation pipeline.
            const existingImageUrls = [...rawContent.matchAll(/<img[^>]+src="([^"]+)"/gi)]
              .map((m) => m[1])
              .filter((u): u is string => Boolean(u));

            if (existingImageUrls.length > 0) {
              console.log(`🖼️ Reformat preserving ${existingImageUrls.length} existing image(s) for article ${articleId}`);
            }

            // Re-run GPT-4 formatting with brand normalization + full SEO/GEO context
            const gptResult = await enhanceArticleWithGPT(
              rawContent,
              article.seoTitle || "",
              article.metaDescription || "",
              Array.isArray(article.keywordsJson) ? article.keywordsJson : [],
              existingImageUrls, // Pass existing images so GPT-4 re-injects rather than strips them
              undefined, // No semantic cluster
              hyperlinks,
              Array.isArray(article.hashtagsJson) ? article.hashtagsJson : [],
              Array.isArray(article.faqJson) ? article.faqJson : [],
              targetUrl,
              businessName, // Brand normalization
              reformatGeoFocus, // Geographic focus for JSON-LD schema (from generationParams JSONB)
            );

            // Apply hyperlinks via Global Slug Map (same engine as main generation pipeline)
            let finalReformatHtml = gptResult.finalHtml;
            if (targetUrl && targetUrl.match(/^https?:\/\//i)) {
              try {
                const { buildSlugMap, injectLinksWithIntent, buildFallbackTerms } = await import("./slug-map-injector");
                const fallbackTerms = buildFallbackTerms({
                  coreTopic: batch?.coreTopic,
                  geographicFocus: reformatGeoFocus, // from generationParams JSONB — not a direct column
                  businessName,
                  geminiKeywords: Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [],
                });
                const { entries, pages } = await buildSlugMap(batch?.teamId ?? 0, targetUrl, fallbackTerms);
                const injection = await injectLinksWithIntent(finalReformatHtml, entries, pages, targetUrl, article.chosenTitle || `article ${articleId}`, fallbackTerms);
                if (injection.linksInjected > 0) finalReformatHtml = injection.html;
              } catch (hlError) {
                console.warn(`⚠️ Slug map hyperlink step failed for reformat ${articleId}:`, hlError instanceof Error ? hlError.message : hlError);
              }
            }

            // Strip any short-anchor (<3 words) body links that GPT-4 may have added
            {
              const { cleanHtml: reformatCleaned, stripped: reformatStripped } = stripShortBodyAnchorLinks(finalReformatHtml);
              if (reformatStripped > 0) {
                finalReformatHtml = reformatCleaned;
                console.log(`🔗 SHORT-ANCHOR CLEANUP (reformat): Article ${articleId} — removed ${reformatStripped} short-anchor body link(s)`);
              }
            }

            // GUARDIAN GATE for reformat: run quality check + surgical fix before saving
            let finalReformatChecked = finalReformatHtml;
            try {
              const reformatAudit = await auditArticle(finalReformatChecked, {
                minImages: 1,
                minHyperlinks: 3,
                minFaqQuestions: 2,
                minWordCount: 600,
                skipToneCheck: true,
                businessName: businessName || "",
              });
              console.log(`🛡️ Guardian reformat audit for article ${articleId}: score=${reformatAudit.score}, passed=${reformatAudit.passed}`);
              const allReformatFailures = [...reformatAudit.missingElements, ...reformatAudit.formattingIssues];
              if (!reformatAudit.passed && reformatAudit.score < 70) {
                if (allReformatFailures.length > 0 && batch?.teamId) {
                  learningService.recordGuardianFailures(batch.teamId, "article", allReformatFailures).catch(() => {});
                }
                const reformatFix = await applySurgicalFix({
                  html: finalReformatChecked,
                  missingElements: reformatAudit.missingElements,
                  formattingIssues: reformatAudit.formattingIssues,
                  businessName: businessName || undefined,
                  targetUrl: targetUrl || undefined,
                  keywords: Array.isArray(article.keywordsJson) ? (article.keywordsJson as string[]) : [],
                  geographicFocus: reformatGeoFocus,
                });
                if (!reformatFix.unchanged) {
                  finalReformatChecked = reformatFix.html;
                  console.log(`🔧 Surgical fix applied for reformat ${articleId}: ${reformatFix.appliedFixes.join(", ")}`);
                }
              }
            } catch (guardianErr) {
              console.warn(`⚠️ Guardian check failed for reformat ${articleId} (non-blocking):`, guardianErr);
            }

            // Update article with formatted HTML and hyperlinks
            await db
              .update(articles)
              .set({
                finalHtmlContent: finalReformatChecked,
                hyperlinkedKeywordsJson: hyperlinks.length > 0 ? hyperlinks : null,
                articleStatus: "GPT4_ENHANCED",
              })
              .where(eq(articles.id, articleId));

            console.log(`✅ Article ${articleId} reformatted successfully with ${hyperlinks.length} hyperlinks`);

          } catch (error) {
            console.error(`❌ Reformat failed for article ${articleId}:`, error);
            const reformatErrMsg = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
            // Mark the article so the UI shows a visible failure state — don't silently do nothing
            await db
              .update(articles)
              .set({
                articleStatus: "REFORMAT_FAILED",
                errorMessage: reformatErrMsg,
              })
              .where(eq(articles.id, articleId))
              .catch(() => {}); // non-blocking — prevent cascading DB errors
            // Don't throw - let user retry if needed
          }
        }
      }
    );
    
    console.log(`✅ Reformat worker registered successfully`);
  } catch (error) {
    console.error(`❌ CRITICAL: Failed to register reformat worker:`, error);
    throw error;
  }

  // ============================================================================
  // SOCIAL VIDEO GENERATION WORKER
  // ============================================================================

  try {
    console.log(`🎬 Registering social video generation worker...`);
    
    // Health check: Verify FFmpeg and ffprobe binaries are available and executable
    const { getFFmpegPath } = await import("./social-video-compositor");
    const fs = await import("fs/promises");
    
    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      throw new Error("❌ FATAL: FFmpeg binary not found. Video generation will fail. Please ensure ffmpeg-static is installed.");
    }
    
    // Verify FFmpeg is executable
    try {
      await fs.access(ffmpegPath, (await import("fs")).constants.X_OK);
      console.log(`✅ FFmpeg health check passed: ${ffmpegPath}`);
    } catch (accessError) {
      throw new Error(`❌ FATAL: FFmpeg binary found but not executable: ${ffmpegPath}. Check file permissions.`);
    }
    
    // Verify ffprobe is available and executable
    const ffprobePackage = await import("@ffprobe-installer/ffprobe");
    const ffprobePath = ffprobePackage.default?.path;
    if (!ffprobePath) {
      throw new Error("❌ FATAL: ffprobe binary not found. Video duration detection will fail. Please ensure @ffprobe-installer/ffprobe is installed.");
    }
    
    try {
      await fs.access(ffprobePath, (await import("fs")).constants.X_OK);
      console.log(`✅ ffprobe health check passed: ${ffprobePath}`);
    } catch (accessError) {
      throw new Error(`❌ FATAL: ffprobe binary found but not executable: ${ffprobePath}. Check file permissions.`);
    }
    
    // CRITICAL FIX: Explicitly create the queue to ensure partition table exists
    console.log(`📋 Creating queue partition for: ${SOCIAL_VIDEO_GENERATION_QUEUE}`);
    await boss.createQueue(SOCIAL_VIDEO_GENERATION_QUEUE);
    console.log(`✅ Queue partition created/verified`);

    // STARTUP CLEANUP: Cancel all video jobs that were active before this process started.
    // When the worker process restarts, any "active" pg-boss jobs from the previous process
    // are orphaned — their workers are dead. Cancelling them prevents the infinite loop where
    // stuck jobs hold DB connections and exhaust the 20-connection pool.
    // job-recovery.ts will then re-enqueue any posts still showing videoStatus=GENERATING.
    //
    // HARDENED: retry up to 3 times with a 3-second backoff + SET statement_timeout so
    // the cleanup can't itself get stuck. If all retries fail, we log a CRITICAL warning
    // but still proceed — the recurring sweeper (registered below) will catch orphans.
    {
      const { db: startupDb } = await import("./db");
      const { sql: sqlTag } = await import("drizzle-orm");
      let cleanupDone = false;
      for (let attempt = 1; attempt <= 3 && !cleanupDone; attempt++) {
        try {
          // Race the UPDATE against a 6-second JS timeout so startup is never
          // blocked by a saturated pool — if it times out, we retry or fall through.
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Startup cleanup timed out after 6s")), 6000)
          );
          const query = startupDb.execute(sqlTag`
            UPDATE pgboss.job
            SET state = 'cancelled',
                completed_on = NOW()
            WHERE name = 'social-video-generation'
              AND state = 'active'
          `);
          const cancelResult = await Promise.race([query, timeout]);
          const cancelled = (cancelResult as any).rowCount || 0;
          if (cancelled > 0) {
            console.log(`🧹 Startup cleanup: cancelled ${cancelled} orphaned video job(s) (attempt ${attempt}) — job-recovery will re-enqueue eligible ones`);
          } else {
            console.log(`✅ Startup cleanup: no orphaned video jobs found`);
          }
          cleanupDone = true;
        } catch (cleanupErr) {
          if (attempt < 3) {
            console.warn(`⚠️ Startup cleanup attempt ${attempt}/3 failed, retrying in 3s:`, (cleanupErr as Error).message);
            await new Promise(r => setTimeout(r, 3000));
          } else {
            console.error(`🚨 CRITICAL: Startup cleanup failed all 3 attempts — recurring sweeper will handle orphans:`, cleanupErr);
          }
        }
      }
    }

    // RECURRING SWEEPER: Register a pg-boss scheduled job that cancels stuck active video
    // jobs every 2 minutes. This is stored in pg-boss tables and survives across all
    // future restarts — it's the permanent self-healing backstop if startup cleanup ever
    // misses orphans or if the pool is temporarily saturated during startup.
    try {
      await boss.schedule(
        "video-orphan-sweeper",
        "*/2 * * * *", // every 2 minutes
        {},
        { tz: "UTC" }
      );
      await boss.work<Record<string, never>>(
        "video-orphan-sweeper",
        { teamSize: 1, batchSize: 1 } as any,
        async () => {
          try {
            const { db: sweepDb } = await import("./db");
            const { sql: sweepSql } = await import("drizzle-orm");
            // Cancel active jobs older than their expected max runtime:
            //   slideshow: 15 min  |  Veo: 95 min
            // Use a conservative 20-min cutoff for unknown types (always slideshow in practice).
            const result = await sweepDb.execute(sweepSql`
              UPDATE pgboss.job
              SET state = 'cancelled',
                  completed_on = NOW()
              WHERE name = 'social-video-generation'
                AND state = 'active'
                AND (
                  -- slideshow / unknown: cancel after 20 min
                  (
                    (data->>'videoType' IS NULL OR data->>'videoType' = 'slideshow')
                    AND started_on < NOW() - INTERVAL '20 minutes'
                  )
                  OR
                  -- Veo: cancel after 100 min
                  (
                    data->>'videoType' = 'veo'
                    AND started_on < NOW() - INTERVAL '100 minutes'
                  )
                )
            `);
            const swept = (result as any).rowCount || 0;
            if (swept > 0) {
              console.log(`🧹 Recurring sweeper: cancelled ${swept} timed-out video job(s)`);
            }
          } catch (sweepErr) {
            console.warn(`⚠️ Recurring video sweeper error (non-fatal):`, (sweepErr as Error).message);
          }
        }
      );
      console.log(`⏱️ Recurring video orphan sweeper registered (runs every 2 min)`);
    } catch (scheduleErr) {
      console.warn(`⚠️ Could not register recurring sweeper (non-fatal):`, (scheduleErr as Error).message);
    }

    // ENGAGEMENT SCORING SCHEDULER: every 6h, label matured content and update Wilson scores
    try {
      const ENGAGEMENT_QUEUE = "engagement-scoring";
      try { await boss.createQueue(ENGAGEMENT_QUEUE); } catch (_) { /* already exists */ }
      await boss.schedule(ENGAGEMENT_QUEUE, "0 */6 * * *", {});
      await boss.work<Record<string, never>>(ENGAGEMENT_QUEUE, async (_jobs) => {
        try {
          const { engagementScoringService } = await import("./engagement-scoring-service");
          const { db: _db } = await import("./db");
          const { teams } = await import("../shared/schema");
          const { ContentType } = await import("../shared/schema");
          const allTeams = await _db.select({ id: teams.id }).from(teams);
          const contentTypes = [ContentType.ARTICLE, ContentType.SOCIAL, ContentType.VIDEO, ContentType.PODCAST];
          for (const team of allTeams) {
            for (const ct of contentTypes) {
              await engagementScoringService.labelMaturedContent(team.id, ct).catch(e =>
                console.warn(`⚠️ Engagement scoring failed for team ${team.id} ${ct}:`, (e as Error).message)
              );
            }
          }
          console.log(`✅ Engagement scoring sweep done for ${allTeams.length} teams`);
        } catch (e) {
          console.error(`🚨 Engagement scoring job failed:`, (e as Error).message);
        }
      });
      console.log(`⏱️ Engagement scoring scheduler registered (every 6h)`);
    } catch (scheduleErr) {
      console.warn(`⚠️ Could not register engagement scoring scheduler (non-fatal):`, (scheduleErr as Error).message);
    }

    // CONVERSION LABELER: nightly job — aggregates content_events into content_performance_metrics,
    // computes bounce/read/scroll/engagement rates, and fires Wilson posterior updates for decision arms.
    try {
      const CONVERSION_LABELER_QUEUE = "conversion-labeler";
      try { await boss.createQueue(CONVERSION_LABELER_QUEUE); } catch (_) { /* already exists */ }
      // Run at 02:00 UTC nightly (after engagement scoring at midnight/6h)
      await boss.schedule(CONVERSION_LABELER_QUEUE, "0 2 * * *", {});
      await boss.work<Record<string, never>>(CONVERSION_LABELER_QUEUE, async (_jobs) => {
        try {
          const { db: _db } = await import("./db");
          const { teams, contentEvents, contentPerformanceMetrics } = await import("../shared/schema");
          const { eq, and, gte, count, avg, max, sql: drizzleSql, desc: drizzleDesc, isNotNull: drizzleIsNotNull } = await import("drizzle-orm");

          const allTeams = await _db.select({ id: teams.id }).from(teams);
          const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

          let labeledCount = 0;
          for (const team of allTeams) {
            // ── Article aggregation ──────────────────────────────────────────
            const articleStats = await _db
              .select({
                articleId: contentEvents.articleId,
                // views = page_view + view events (all entry points)
                views: count(drizzleSql`CASE WHEN ${contentEvents.eventType} IN ('view','page_view') THEN 1 END`),
                // ctaClicks = intentful CTA clicks (most valuable engagement signal)
                ctaClicks: count(drizzleSql`CASE WHEN ${contentEvents.eventType} = 'cta_click' THEN 1 END`),
                // outboundClicks = all link-out clicks including non-CTA
                outboundClicks: count(drizzleSql`CASE WHEN ${contentEvents.eventType} IN ('click','cta_click') THEN 1 END`),
                shares: count(drizzleSql`CASE WHEN ${contentEvents.eventType} = 'share' THEN 1 END`),
                conversions: count(drizzleSql`CASE WHEN ${contentEvents.eventType} = 'conversion' THEN 1 END`),
                // readComplete: sessions where visitor scrolled to end and read_complete fired
                readCompletes: count(drizzleSql`CASE WHEN ${contentEvents.readComplete} = TRUE THEN 1 END`),
                bounces: count(drizzleSql`CASE WHEN ${contentEvents.bounced} = TRUE THEN 1 END`),
                // fatigueSignals: sessions where visitor showed content-fatigue behaviour
                fatigueSignals: count(drizzleSql`CASE WHEN ${contentEvents.fatigueSignal} = TRUE THEN 1 END`),
                // maxScrollPct: best scroll depth reached (not average) — spec requirement
                maxScrollPct: max(contentEvents.scrollPct),
                avgEngagedSec: avg(contentEvents.engagedSec),
              })
              .from(contentEvents)
              .where(and(
                eq(contentEvents.teamId, team.id),
                eq(contentEvents.contentType, "article"),
                gte(contentEvents.createdAt, since)
              ))
              .groupBy(contentEvents.articleId)
              .limit(500);

            for (const stat of articleStats) {
              if (!stat.articleId) continue;
              const totalViews = Number(stat.views) || 0;
              const totalClicks = Number(stat.outboundClicks) || 0;
              const totalCtaClicks = Number(stat.ctaClicks) || 0;
              // readComplete flag: rate of sessions that fired the read_complete beacon event
              const readCompleteCount = Number(stat.readCompletes) || 0;
              const readCompleteRate = totalViews > 0 ? readCompleteCount / totalViews : 0;
              const bounceRateDecimal = totalViews > 0 ? Number(stat.bounces) / totalViews : 0;
              const ctaRate = totalViews > 0 ? totalCtaClicks / totalViews : 0;
              const totalConversions = Number(stat.conversions) || 0;
              const conversionRate = totalViews > 0 ? totalConversions / totalViews : 0;
              const fatigueRate = totalViews > 0 ? Number(stat.fatigueSignals) / totalViews : 0;
              // scrollDepth = max scroll pct reached (stored in readabilityScore — best proxy for content depth engagement)
              const scrollDepth = Math.round(Number(stat.maxScrollPct) || 0);
              // qualityScore: readComplete(40) + non-bounce(20) + CTA click rate(20) + conversion rate(20)
              // fatigue signals reduce quality: each 10% fatigue rate subtracts 5 points
              const qualityScore = Math.round(Math.min(100,
                readCompleteRate * 40 +
                (1 - bounceRateDecimal) * 20 +
                ctaRate * 20 +
                conversionRate * 20 -
                fatigueRate * 5
              ));
              // eatScore: readComplete rate × 100 — measures E-E-A-T proxy (did reader trust content enough to finish?)
              const eatScore = Math.round(readCompleteRate * 100);
              // readabilityScore: max scroll depth reached — measures how far into the content readers get
              const readabilityScore = scrollDepth;
              const engagementPayload = {
                views: totalViews,
                // clicks column stores CTA clicks (intentful engagement, not all outbound)
                clicks: totalCtaClicks,
                shares: Number(stat.shares) || 0,
                bounceRate: Math.round(bounceRateDecimal * 100),
                timeOnPage: Math.round(Number(stat.avgEngagedSec) || 0),
                qualityScore,
                // eatScore = readCompleteRate × 100 (% of sessions that triggered read_complete)
                eatScore,
                // readabilityScore = max scroll depth reached in this window (0–100)
                readabilityScore,
                updatedAt: new Date(),
              };

              // Prefer updating the existing generation row (which has patternsUsedJson /
              // variantId / armId set by recordContentGenerated) so that the engagement
              // labeler can credit/blame the correct patterns. Only insert a standalone
              // snapshot if no attributed row exists (e.g. pre-orchestrator legacy content).
              const [existingRow] = await _db
                .select({ id: contentPerformanceMetrics.id })
                .from(contentPerformanceMetrics)
                .where(and(
                  eq(contentPerformanceMetrics.teamId, team.id),
                  eq(contentPerformanceMetrics.contentType, "article"),
                  eq(contentPerformanceMetrics.articleId, stat.articleId),
                  drizzleIsNotNull(contentPerformanceMetrics.patternsUsedJson)
                ))
                .orderBy(drizzleDesc(contentPerformanceMetrics.createdAt))
                .limit(1);

              if (existingRow) {
                await _db
                  .update(contentPerformanceMetrics)
                  .set(engagementPayload)
                  .where(eq(contentPerformanceMetrics.id, existingRow.id));
              } else {
                await _db
                  .insert(contentPerformanceMetrics)
                  .values({
                    teamId: team.id,
                    contentType: "article",
                    articleId: stat.articleId,
                    ...engagementPayload,
                  });
              }

              console.log(
                `[CONVERSION_LABEL] teamId=${team.id} articleId=${stat.articleId} ` +
                `views=${totalViews} readCompleteRate=${readCompleteRate.toFixed(3)} ` +
                `bounceRate=${bounceRateDecimal.toFixed(3)} scrollDepth=${scrollDepth}% ` +
                `ctaRate=${ctaRate.toFixed(3)} fatigueRate=${fatigueRate.toFixed(3)} ` +
                `convRate=${conversionRate.toFixed(4)} qualityScore=${qualityScore} ` +
                `eatScore=${eatScore} scrollDepthStored=${readabilityScore} ` +
                `${existingRow ? "updated_attribution_row" : "inserted_standalone_snapshot"}`
              );
              labeledCount++;
            }

            // ── Social post aggregation ───────────────────────────────────────
            // beacon.js uses contentType="social_post"; metrics table uses "social"
            const socialStats = await _db
              .select({
                socialPostId: contentEvents.socialPostId,
                views: count(drizzleSql`CASE WHEN ${contentEvents.eventType} IN ('view','page_view') THEN 1 END`),
                clicks: count(drizzleSql`CASE WHEN ${contentEvents.eventType} IN ('click','cta_click') THEN 1 END`),
                shares: count(drizzleSql`CASE WHEN ${contentEvents.eventType} = 'share' THEN 1 END`),
                conversions: count(drizzleSql`CASE WHEN ${contentEvents.eventType} = 'conversion' THEN 1 END`),
                avgEngagedSec: avg(contentEvents.engagedSec),
              })
              .from(contentEvents)
              .where(and(
                eq(contentEvents.teamId, team.id),
                eq(contentEvents.contentType, "social_post"),
                gte(contentEvents.createdAt, since)
              ))
              .groupBy(contentEvents.socialPostId)
              .limit(500);

            for (const stat of socialStats) {
              if (!stat.socialPostId) continue;
              const totalViews = Number(stat.views) || 0;
              const totalClicks = Number(stat.clicks) || 0;
              const totalShares = Number(stat.shares) || 0;
              const totalConversions = Number(stat.conversions) || 0;
              // Social quality: engagement-rate weighted (clicks+shares per view)
              const engagementRate = totalViews > 0 ? (totalClicks + totalShares) / totalViews : 0;
              const conversionRate = totalViews > 0 ? totalConversions / totalViews : 0;
              const qualityScore = Math.round(Math.min(100, engagementRate * 60 + conversionRate * 40));
              const socialPayload = {
                views: totalViews,
                clicks: totalClicks,
                shares: totalShares,
                timeOnPage: Math.round(Number(stat.avgEngagedSec) || 0),
                qualityScore,
                updatedAt: new Date(),
              };

              const [existingSocialRow] = await _db
                .select({ id: contentPerformanceMetrics.id })
                .from(contentPerformanceMetrics)
                .where(and(
                  eq(contentPerformanceMetrics.teamId, team.id),
                  eq(contentPerformanceMetrics.contentType, "social"),
                  eq(contentPerformanceMetrics.socialPostId, stat.socialPostId),
                  drizzleIsNotNull(contentPerformanceMetrics.patternsUsedJson)
                ))
                .orderBy(drizzleDesc(contentPerformanceMetrics.createdAt))
                .limit(1);

              if (existingSocialRow) {
                await _db
                  .update(contentPerformanceMetrics)
                  .set(socialPayload)
                  .where(eq(contentPerformanceMetrics.id, existingSocialRow.id));
              } else {
                await _db
                  .insert(contentPerformanceMetrics)
                  .values({
                    teamId: team.id,
                    contentType: "social",
                    socialPostId: stat.socialPostId,
                    ...socialPayload,
                  });
              }

              console.log(
                `[CONVERSION_LABEL] social teamId=${team.id} socialPostId=${stat.socialPostId} ` +
                `views=${totalViews} engagementRate=${engagementRate.toFixed(3)} qualityScore=${qualityScore} ` +
                `${existingSocialRow ? "updated_attribution_row" : "inserted_standalone_snapshot"}`
              );
              labeledCount++;
            }
          }

          // After snapshot aggregation, run engagement scoring to label matured content
          // as success/fail based on Wilson posterior composites (uses the rows we just inserted).
          const { EngagementScoringService } = await import("./engagement-scoring-service");
          const engagementSvc = EngagementScoringService.getInstance();
          const contentTypes = ["article", "social", "podcast", "video"];
          for (const team of allTeams) {
            for (const ct of contentTypes) {
              try {
                const result = await engagementSvc.labelMaturedContent(team.id, ct);
                if (result.labeledSuccess > 0 || result.labeledFail > 0) {
                  console.log(
                    `[CONVERSION_LABEL] scoreAndLabel teamId=${team.id} contentType=${ct} ` +
                    `cohort=${result.cohort} labeled=${result.labeledSuccess + result.labeledFail} ` +
                    `success=${result.labeledSuccess} fail=${result.labeledFail} ` +
                    `ambiguous=${result.skippedAmbiguous} lowReach=${result.skippedLowReach}`
                  );
                }
              } catch (scoringErr) {
                console.warn(`[CONVERSION_LABEL] scoring error teamId=${team.id} ct=${ct}:`, (scoringErr as Error).message);
              }
            }
          }

          console.log(`✅ ConversionLabeler: labeled ${labeledCount} content items for ${allTeams.length} teams`);
        } catch (e) {
          console.error(`🚨 ConversionLabeler job failed:`, (e as Error).message);
        }
      });
      console.log(`⏱️ ConversionLabeler scheduler registered (nightly 02:00 UTC)`);
    } catch (scheduleErr) {
      console.warn(`⚠️ Could not register ConversionLabeler scheduler (non-fatal):`, (scheduleErr as Error).message);
    }

    await boss.work<SocialVideoJobData>(
      SOCIAL_VIDEO_GENERATION_QUEUE,
      { 
        batchSize: 1,       // One job per worker invocation
        teamSize: 3,        // Max 3 concurrent (3×5 DB conns ≈ 15, safely under 20-conn pool)
      } as any,
      async (jobs) => {
        for (const job of jobs) {
          console.log(`🎬 Processing social video generation job ${job.id}`);
          const { socialPostId, platform } = job.data;

          // PERMANENT FIX: Check disk space before starting (need ~500MB per video)
          try {
            const { execSync } = await import("child_process");
            const dfOutput = execSync("df /tmp | tail -1 | awk '{print $4}'").toString().trim();
            const availableKB = parseInt(dfOutput, 10);
            const availableMB = availableKB / 1024;
            
            if (availableMB < 500) {
              console.warn(`⚠️ Low disk space: ${availableMB.toFixed(0)}MB available. Cleaning up old temp files...`);
              // Emergency cleanup of old video temp directories
              execSync("find /tmp -maxdepth 1 -name 'video-*' -type d -mmin +30 -exec rm -rf {} + 2>/dev/null || true");
              console.log(`🧹 Emergency cleanup completed`);
            } else {
              console.log(`💾 Disk space check: ${availableMB.toFixed(0)}MB available`);
            }
          } catch (diskCheckError) {
            console.warn(`⚠️ Disk check failed (continuing anyway):`, diskCheckError);
          }

          // API Jitter: stagger video worker starts (0–6s) to prevent
          // 8 concurrent workers hammering Gemini + OpenAI simultaneously.
          const videoJitterMs = Math.floor(Math.random() * 6000);
          console.log(`⏳ Video worker jitter: ${videoJitterMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, videoJitterMs));

          try {
            const { generateSocialVideo } = await import("./social-video-generator");
            const { cleanupTempFiles } = await import("./social-video-compositor");
            
            // Check video type from database
            const { db } = await import("./db");
            const { socialPosts } = await import("@/shared/schema");
            const { eq } = await import("drizzle-orm");
            
            const [post] = await db.select({ videoType: socialPosts.videoType })
              .from(socialPosts)
              .where(eq(socialPosts.id, socialPostId))
              .limit(1);
            
            const videoType = post?.videoType || "slideshow";
            
            let result;
            
            if (videoType === "veo") {
              // Veo AI video generation (~50 minutes for 5 clips)
              console.log(`🎬 Using Veo AI video generation (premium quality)`);
              const { generateVeoSocialVideo } = await import("./veo-social-video-generator");

              // Veo takes much longer - 90 minute timeout
              const VEO_TIMEOUT_MS = 90 * 60 * 1000;

              try {
                result = await withTimeout(
                  generateVeoSocialVideo({
                    socialPostId,
                    platform: platform || "facebook",
                  }),
                  VEO_TIMEOUT_MS,
                  `Veo video generation for post ${socialPostId}`
                );
              } catch (veoError) {
                const veoMsg = veoError instanceof Error ? veoError.message : String(veoError);
                const isQuotaError = veoMsg.includes("RESOURCE_EXHAUSTED") || veoMsg.includes("429") || veoMsg.includes("quota");
                // Treat model-not-found / API-version errors as non-retryable infrastructure errors
                // that should immediately fall back to slideshow rather than burning retries.
                const isModelError = veoMsg.includes("NOT_FOUND") || veoMsg.includes("not found") || veoMsg.includes("not supported for predictLongRunning") || veoMsg.includes("is not found for API version");

                if (isQuotaError || isModelError) {
                  const reason = isModelError
                    ? "Veo model unavailable — switched to Fast Slideshow automatically"
                    : "Veo quota exceeded — switched to Fast Slideshow automatically";
                  console.warn(`⚠️ Veo non-retryable error for post ${socialPostId} (${isModelError ? "model/API" : "quota"}) — falling back to slideshow`);
                  // Update videoType so the UI reflects the fallback
                  await db
                    .update(socialPosts)
                    .set({
                      videoType: "slideshow",
                      videoStage: "queued",
                      videoProgress: 0,
                      errorMessage: reason,
                      updatedAt: new Date(),
                    })
                    .where(eq(socialPosts.id, socialPostId));

                  const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;
                  result = await withTimeout(
                    generateSocialVideo({ socialPostId, platform: platform || "tiktok" }),
                    VIDEO_TIMEOUT_MS,
                    `Slideshow fallback for post ${socialPostId}`
                  );
                } else {
                  throw veoError; // Non-quota Veo error — let pg-boss retry
                }
              }
            } else {
              // Default: Fast slideshow video (2-3 minutes)
              console.log(`🎬 Using fast slideshow video generation`);

              // Slideshow takes 15 minutes max (script + images + audio + 3x FFmpeg passes)
              const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;

              result = await withTimeout(
                generateSocialVideo({
                  socialPostId,
                  platform: platform || "tiktok",
                }),
                VIDEO_TIMEOUT_MS,
                `Video generation for post ${socialPostId}`
              );
            }

            console.log(`✅ Video generated successfully for social post ${socialPostId}`);
            console.log(`   URL: ${result.videoUrl}`);
            console.log(`   Duration: ${result.duration}s`);
            console.log(`   Resolution: ${result.resolution}`);
            
            // PERMANENT FIX: Always clean up temp files after successful generation
            await cleanupTempFiles(socialPostId);
            
          } catch (error) {
            console.error(`❌ Video generation failed for social post ${socialPostId}:`, error);
            
            // PERMANENT FIX: Clean up temp files even on failure to prevent disk exhaustion
            try {
              const { cleanupTempFiles } = await import("./social-video-compositor");
              await cleanupTempFiles(socialPostId);
              console.log(`🧹 Cleaned up temp files after failure for post ${socialPostId}`);
            } catch (cleanupError) {
              console.warn(`⚠️ Cleanup after failure warning:`, cleanupError);
            }

            // Mark the social post videoStatus as FAILED so the UI reflects the error
            // (prevents posts from staying stuck at "GENERATING" when pg-boss retries are exhausted)
            try {
              const { db: failDb } = await import("./db");
              const { socialPosts: spTable, errorLogs: errLogsTable } = await import("@/shared/schema");
              const { eq: eqFail } = await import("drizzle-orm");
              const errMsg = error instanceof Error ? error.message : String(error);
              await failDb.update(spTable)
                .set({
                  videoStatus: "FAILED",
                  errorMessage: errMsg.substring(0, 1000),
                  updatedAt: new Date(),
                })
                .where(eqFail(spTable.id, socialPostId));

              // Write to error_logs so Admin Error Log panel captures video failures
              await failDb.insert(errLogsTable).values({
                errorType: "VIDEO",
                errorMessage: `Social Post #${socialPostId} video generation failed: ${errMsg}`.substring(0, 2000),
                stackTrace: error instanceof Error ? error.stack?.substring(0, 2000) : undefined,
                severity: "error",
              });
            } catch (dbUpdateError) {
              console.warn(`⚠️ Could not update videoStatus to FAILED:`, dbUpdateError);
            }
            
            throw error; // Let pg-boss handle retries
          }
        }
      }
    );

    console.log(`✅ Social video generation worker registered (8 concurrent workers, 10min timeout)`);
  } catch (error) {
    console.error(`❌ CRITICAL: Failed to register social video worker:`, error);
    throw error;
  }

  // ============================================================================
  // CLEANUP WORKER
  // ============================================================================

  // ============================================================================
  // VIDEO IDEA GENERATION WORKER
  // ============================================================================
  
  console.log("🎬 Registering video idea generation worker...");
  
  try {
    const { registerVideoIdeaWorker } = await import("@/workers/video-idea-worker");
    await registerVideoIdeaWorker(boss);
  } catch (error) {
    console.error("❌ Failed to register video idea worker:", error);
    // Non-fatal - continue with other workers
  }

  // ============================================================================
  // SITE CRAWL WORKER
  // ============================================================================

  console.log("🕷️ Registering site crawl worker for queue:", SITE_CRAWL_QUEUE);

  try {
    try { await boss.createQueue(SITE_CRAWL_QUEUE); } catch (_) { /* partition may already exist */ }
    console.log(`✅ Queue created/verified: ${SITE_CRAWL_QUEUE}`);
    await boss.work<SiteCrawlJobData>(
      SITE_CRAWL_QUEUE,
      { batchSize: 1, teamSize: 1 } as any,
      async (jobs) => {
        for (const job of jobs) {
          console.log(`🕷️ Processing site crawl job ${job.id}: ${job.data.baseUrl}`);
          try {
            const { crawlWebsite } = await import("./site-crawler");
            const result = await crawlWebsite(
              job.data.crawlJobId,
              job.data.baseUrl,
              job.data.teamId,
              job.data.maxPages,
              job.data.maxDepth
            );
            console.log(`✅ Site crawl job ${job.id} completed: ${result.pagesIndexed} pages indexed`);
          } catch (error) {
            console.error(`❌ Site crawl job ${job.id} failed:`, error);
            throw error;
          }
        }
      }
    );
    console.log("✅ Site crawl worker registered successfully");
  } catch (error) {
    console.error("❌ CRITICAL: Failed to register site crawl worker:", error);
    throw error;
  }

  // ============================================================================
  // CLEANUP WORKER
  // ============================================================================

  console.log("🧹 Registering cleanup worker for queue:", CLEANUP_QUEUE);
  
  try {
    try { await boss.createQueue(CLEANUP_QUEUE); } catch (_) { /* partition may already exist */ }
    console.log(`✅ Queue created/verified: ${CLEANUP_QUEUE}`);
    await boss.work<CleanupJobData>(
      CLEANUP_QUEUE,
      { batchSize: 1, teamSize: 1 } as any, // Process one cleanup job at a time
      async (jobs) => {
        for (const job of jobs) {
          console.log(`🧹 Processing cleanup job ${job.id}: type=${job.data.jobType}, dryRun=${job.data.dryRun || false}`);
          
          try {
            await runCleanupJob(job.data);
            console.log(`✅ Cleanup job ${job.id} completed successfully`);
          } catch (error) {
            console.error(`❌ Cleanup job ${job.id} failed:`, error);
            throw error; // Re-throw for pg-boss retry logic
          }
        }
      }
    );
    
    console.log("✅ Cleanup worker registered successfully");
  } catch (error) {
    console.error("❌ CRITICAL: Failed to register cleanup worker:", error);
    throw error;
  }

  // ============================================================================
  // CONTENT PUBLISHING WORKER
  // ============================================================================

  console.log("📤 Registering content publishing worker for queue:", CONTENT_PUBLISHING_QUEUE);

  // Ensure the queue exists in pg-boss before registering the worker
  try {
    await boss.createQueue(CONTENT_PUBLISHING_QUEUE);
    console.log(`✅ Queue created/verified: ${CONTENT_PUBLISHING_QUEUE}`);
  } catch (qErr: any) {
    // "already exists" errors are safe to ignore
    if (!qErr?.message?.includes('already exists')) {
      console.warn(`⚠️ Could not create queue ${CONTENT_PUBLISHING_QUEUE}:`, qErr?.message);
    }
  }

  try {
    await boss.work<PublishingJobData>(
      CONTENT_PUBLISHING_QUEUE,
      { batchSize: 1, teamSize: 4 } as any,
      async (jobs) => {
        for (const job of jobs) {
          const { dbJobId } = job.data;
          console.log(`📤 Processing publishing job ${job.id}: db job ${dbJobId}`);
          try {
            const { processPublishingJob } = await import("./publishing");
            const result = await processPublishingJob(dbJobId);
            if (result.success) {
              console.log(`✅ Publishing job ${dbJobId} completed successfully`);
            } else {
              console.error(`❌ Publishing job ${dbJobId} failed: ${result.error} [${result.errorCode}]`);
              // Permanent failures must NOT throw — throwing triggers pg-boss retry,
              // which would re-send the same rejected payload and get the same 400/auth error.
              // RECEIVER_REJECTED = HTTP 400 from receiver (payload validation failure)
              // AUTHENTICATION_ERROR = bad API key (retrying won't help)
              const permanentErrorCodes = ['AUTHENTICATION_ERROR', 'RECEIVER_REJECTED'];
              if (!permanentErrorCodes.includes(result.errorCode || '')) {
                throw new Error(result.error || 'Publishing failed'); // triggers pg-boss retry
              }
              console.log(`[PUBLISH] Permanent failure (${result.errorCode}) — not retrying job ${dbJobId}`);
            }
          } catch (error) {
            console.error(`❌ Publishing worker error for job ${dbJobId}:`, error);
            throw error;
          }
        }
      }
    );
    console.log("✅ Content publishing worker registered (4 concurrent workers)");
  } catch (error) {
    console.error("❌ CRITICAL: Failed to register content publishing worker:", error);
    throw error;
  }

  // ============================================================================
  // INTELLIGENCE RESEARCH WORKER
  // ============================================================================

  console.log("🧠 Registering intelligence research worker for queue:", INTELLIGENCE_RESEARCH_QUEUE);
  try {
    try { await boss.createQueue(INTELLIGENCE_RESEARCH_QUEUE); } catch (_) { /* already exists */ }
    console.log(`✅ Queue created/verified: ${INTELLIGENCE_RESEARCH_QUEUE}`);
    await boss.work<IntelligenceResearchJobData>(
      INTELLIGENCE_RESEARCH_QUEUE,
      { batchSize: 1, teamSize: 2 } as any,
      async (jobs) => {
        for (const job of jobs) {
          console.log(`🧠 Processing intelligence research job ${job.id}: team ${job.data.teamId} (${job.data.companyName})`);
          try {
            const { runIntelligenceResearch } = await import("./client-brand-profile-service");
            await runIntelligenceResearch(job.data.teamId, job.data.websiteUrl, job.data.companyName);
            console.log(`✅ Intelligence research job ${job.id} completed for team ${job.data.teamId}`);
          } catch (error) {
            console.error(`❌ Intelligence research job ${job.id} failed:`, error);
            throw error;
          }
        }
      }
    );
    console.log("✅ Intelligence research worker registered (2 concurrent workers)");
  } catch (error) {
    console.error("❌ CRITICAL: Failed to register intelligence research worker:", error);
    throw error;
  }

  // Pre-warm the public-objects route so Turbopack compiles it before publishing jobs run.
  // Without this, the first external request from a receiver gets a 404 HTML page
  // because the route isn't compiled yet, causing "Invalid request content" failures.
  try {
    const engineUrl = process.env.NEXTAUTH_URL || `http://localhost:${process.env.PORT || 5000}`;
    const warmUpUrl = `${engineUrl}/api/public-objects/warmup`;
    await fetch(warmUpUrl).catch(() => {
      // Any response (including 404 for non-existent file) confirms the route is compiled
    });
    console.log(`🔥 Pre-warmed public-objects route at ${engineUrl}`);
  } catch {
    // Non-critical — publishing will still work if warm-up fails
  }

  // Re-enqueue any publishing jobs that were created but never made it into pg-boss
  // (pg_boss_job_id IS NULL means boss.send() failed silently on a previous run)
  try {
    const { publishingJobs: pjTable } = await import("@/shared/schema");
    const { isNull } = await import("drizzle-orm");
    const allPending = await db
      .select({ id: pjTable.id, teamId: pjTable.teamId, pgBossJobId: pjTable.pgBossJobId })
      .from(pjTable)
      .where(isNull(pjTable.pgBossJobId));

    if (allPending.length > 0) {
      console.log(`🔄 Re-enqueuing ${allPending.length} stuck publishing job(s) with no pg-boss ID...`);
      const { addPublishingJob } = await import("./queue");
      const { eq: eqOp } = await import("drizzle-orm");
      for (const job of allPending) {
        try {
          const pgBossId = await addPublishingJob({ dbJobId: job.id, teamId: job.teamId });
          if (pgBossId) {
            await db.update(pjTable)
              .set({ pgBossJobId: pgBossId, status: 'queued', updatedAt: new Date() })
              .where(eqOp(pjTable.id, job.id));
          }
        } catch (reEnqueueErr) {
          console.error(`❌ Failed to re-enqueue publishing job ${job.id}:`, reEnqueueErr);
        }
      }
      console.log(`✅ Re-enqueue sweep complete`);
    }
  } catch (recoveryErr) {
    console.warn(`⚠️ Publishing job recovery sweep failed:`, recoveryErr);
  }

  console.log("✅ Workers registered - pg-boss will process jobs automatically");

  // Initialize content scheduler for autonomous generation
  try {
    const { initializeScheduler } = await import("./scheduled-content-worker");
    await initializeScheduler();
  } catch (error) {
    console.error("⚠️ Failed to initialize content scheduler:", error);
  }

  // Start comprehensive job recovery monitor
  try {
    const { startJobRecoveryMonitor } = await import("./job-recovery");
    startJobRecoveryMonitor(2); // Check every 2 minutes — halved from 5 to reduce stuck-article wait
  } catch (error) {
    console.error("⚠️ Failed to start job recovery monitor:", error);
  }
}

// ============================================================================
// CLEANUP EXECUTION
// ============================================================================

async function runCleanupJob(data: CleanupJobData) {
  const { cleanupJobs, activityLogs } = await import("@/shared/schema");
  const { getEffectiveRetention } = await import("./cleanup-policy");
  const { sub } = await import("date-fns");
  const { and, isNotNull, lt, eq, inArray } = await import("drizzle-orm");
  
  // Create cleanup job record
  const [jobRecord] = await db
    .insert(cleanupJobs)
    .values({
      jobType: data.jobType,
      status: "RUNNING",
      dryRun: data.dryRun ? 1 : 0,
    })
    .returning();

  if (!jobRecord) {
    throw new Error(`Failed to create cleanup job record for type: ${data.jobType}`);
  }

  try {
    // Get effective retention policy
    const policy = await getEffectiveRetention(
      data.teamId,
      data.jobType,
      data.retentionDays
    );

    console.log(`📋 Cleanup policy: ${policy.retentionDays} days (source: ${policy.source})`);

    // Route to appropriate cleanup handler
    let result: { itemsProcessed: number; itemsDeleted: number };

    switch (data.jobType) {
      case "media":
        result = await cleanupMedia(data, policy.retentionDays);
        break;
      case "logs":
        result = await cleanupLogs(data, policy.retentionDays);
        break;
      case "orphans":
        result = await cleanupOrphans(data, policy.retentionDays);
        break;
      case "sessions":
        result = await cleanupSessions(data, policy.retentionDays);
        break;
      default:
        throw new Error(`Unknown cleanup type: ${data.jobType}`);
    }

    const { itemsProcessed, itemsDeleted } = result;

    // Update job record as complete
    await db
      .update(cleanupJobs)
      .set({
        status: "COMPLETE",
        itemsProcessed,
        itemsDeleted,
        completedAt: new Date(),
      })
      .where(eq(cleanupJobs.id, jobRecord.id));

    // Log to activity logs for operational visibility
    await db
      .insert(activityLogs)
      .values({
        userId: null, // System-initiated
        teamId: data.teamId || null,
        action: "cleanup_executed",
        resource: "cleanup",
        targetType: data.jobType,
        details: {
          jobId: jobRecord.id,
          jobType: data.jobType,
          dryRun: data.dryRun || false,
          itemsProcessed,
          itemsDeleted,
          retentionDays: policy.retentionDays,
          policySource: policy.source,
        },
        severity: "info",
      })
      .catch((err) => {
        console.error("Failed to log cleanup to activity logs:", err);
        // Don't fail the job if activity logging fails
      });

    console.log(`✅ Cleanup ${data.jobType}: processed=${itemsProcessed}, deleted=${itemsDeleted}, dryRun=${data.dryRun || false}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Update job record as failed
    await db
      .update(cleanupJobs)
      .set({
        status: "FAILED",
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(cleanupJobs.id, jobRecord.id));

    // Log failure to activity logs
    await db
      .insert(activityLogs)
      .values({
        userId: null, // System-initiated
        teamId: data.teamId || null,
        action: "cleanup_failed",
        resource: "cleanup",
        targetType: data.jobType,
        details: {
          jobId: jobRecord.id,
          jobType: data.jobType,
          error: errorMessage,
        },
        severity: "error",
      })
      .catch((err) => {
        console.error("Failed to log cleanup failure to activity logs:", err);
        // Don't cascade failures
      });

    throw error;
  }
}

async function cleanupMedia(data: CleanupJobData, retentionDays: number) {
  const { articleAssets } = await import("@/shared/schema");
  const { sub } = await import("date-fns");
  const { and, isNotNull, lt, eq, inArray } = await import("drizzle-orm");
  
  const cutoffDate = sub(new Date(), { days: retentionDays });
  const BATCH_SIZE = 100;
  const MAX_PER_RUN = 500;
  
  let itemsProcessed = 0;
  let itemsDeleted = 0;
  let consecutiveEmptyBatches = 0;

  while (itemsProcessed < MAX_PER_RUN) {
    // Build query conditions
    const conditions = [
      isNotNull(articleAssets.deletedAt),
      lt(articleAssets.deletedAt, cutoffDate),
    ];
    
    if (data.teamId) {
      conditions.push(eq(articleAssets.teamId, data.teamId));
    }

    // Fetch batch
    const batch = await db
      .select()
      .from(articleAssets)
      .where(and(...conditions))
      .limit(BATCH_SIZE);

    if (batch.length === 0) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 2) break; // Safety: break if no records found twice
      continue;
    }

    consecutiveEmptyBatches = 0;
    itemsProcessed += batch.length;

    if (!data.dryRun) {
      // Delete from database (object storage cleanup TBD)
      const deleteResult = await db
        .delete(articleAssets)
        .where(inArray(articleAssets.id, batch.map(b => b.id)));
      
      // Safety: If delete returns 0, break to prevent infinite loop
      const rowsDeleted = (deleteResult as any)?.rowCount ?? 0;
      if (rowsDeleted === 0) {
        console.warn(`⚠️ Media cleanup: delete returned 0 rows for batch of ${batch.length}, breaking to prevent infinite loop`);
        break;
      }
      
      itemsDeleted += batch.length;
    }
  }

  return { itemsProcessed, itemsDeleted };
}

async function cleanupLogs(data: CleanupJobData, retentionDays: number) {
  const { activityLogs } = await import("@/shared/schema");
  const { sub } = await import("date-fns");
  const { and, lt, eq, inArray } = await import("drizzle-orm");
  
  const cutoffDate = sub(new Date(), { days: retentionDays });
  const BATCH_SIZE = 100;
  const MAX_PER_RUN = 500;
  
  let itemsProcessed = 0;
  let itemsDeleted = 0;
  let consecutiveEmptyBatches = 0;

  while (itemsProcessed < MAX_PER_RUN) {
    const conditions = [lt(activityLogs.createdAt, cutoffDate)];
    
    if (data.teamId) {
      conditions.push(eq(activityLogs.teamId, data.teamId));
    }

    const batch = await db
      .select()
      .from(activityLogs)
      .where(and(...conditions))
      .limit(BATCH_SIZE);

    if (batch.length === 0) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 2) break; // Safety: break if no records found twice
      continue;
    }

    consecutiveEmptyBatches = 0;
    itemsProcessed += batch.length;

    if (!data.dryRun) {
      const deleteResult = await db
        .delete(activityLogs)
        .where(inArray(activityLogs.id, batch.map(b => b.id)));
      
      // Safety: If delete returns 0, break to prevent infinite loop
      const rowsDeleted = (deleteResult as any)?.rowCount ?? 0;
      if (rowsDeleted === 0) {
        console.warn(`⚠️ Log cleanup: delete returned 0 rows for batch of ${batch.length}, breaking to prevent infinite loop`);
        break;
      }
      
      itemsDeleted += batch.length;
    }
  }

  return { itemsProcessed, itemsDeleted };
}

async function cleanupOrphans(data: CleanupJobData, retentionDays: number) {
  const { articleAssets, articles } = await import("@/shared/schema");
  const { sub } = await import("date-fns");
  const { and, lt, eq, inArray, isNull, sql } = await import("drizzle-orm");
  
  const cutoffDate = sub(new Date(), { days: retentionDays });
  const BATCH_SIZE = 100;
  const MAX_PER_RUN = 500;
  
  let itemsProcessed = 0;
  let itemsDeleted = 0;
  let consecutiveEmptyBatches = 0;

  while (itemsProcessed < MAX_PER_RUN) {
    // Use LEFT JOIN to find orphaned assets efficiently
    // This avoids loading all article IDs into memory
    const conditions = [lt(articleAssets.createdAt, cutoffDate)];
    
    if (data.teamId) {
      conditions.push(eq(articleAssets.teamId, data.teamId));
    }

    const batch = await db
      .select({
        id: articleAssets.id,
        articleId: articleAssets.articleId,
      })
      .from(articleAssets)
      .leftJoin(articles, eq(articleAssets.articleId, articles.id))
      .where(and(...conditions, isNull(articles.id))) // article doesn't exist
      .limit(BATCH_SIZE);

    if (batch.length === 0) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 2) break; // Safety: break if no records found twice
      continue;
    }

    consecutiveEmptyBatches = 0;
    itemsProcessed += batch.length;

    if (!data.dryRun) {
      const deleteResult = await db
        .delete(articleAssets)
        .where(inArray(articleAssets.id, batch.map(b => b.id)));
      
      // Safety: If delete returns 0, break to prevent infinite loop
      const rowsDeleted = (deleteResult as any)?.rowCount ?? 0;
      if (rowsDeleted === 0) {
        console.warn(`⚠️ Orphan cleanup: delete returned 0 rows for batch of ${batch.length}, breaking to prevent infinite loop`);
        break;
      }
      
      itemsDeleted += batch.length;
    }
  }

  return { itemsProcessed, itemsDeleted };
}

async function cleanupSessions(data: CleanupJobData, retentionDays: number) {
  const { sessions } = await import("@/shared/schema");
  const { sub } = await import("date-fns");
  const { and, or, lt, eq, inArray } = await import("drizzle-orm");
  
  const cutoffDate = sub(new Date(), { days: retentionDays });
  const BATCH_SIZE = 100;
  const MAX_PER_RUN = 500;
  
  let itemsProcessed = 0;
  let itemsDeleted = 0;
  let consecutiveEmptyBatches = 0;

  while (itemsProcessed < MAX_PER_RUN) {
    // Find inactive or expired sessions
    const batch = await db
      .select()
      .from(sessions)
      .where(
        or(
          and(eq(sessions.isActive, 0), lt(sessions.lastActivityAt, cutoffDate)),
          lt(sessions.expiresAt, new Date())
        )
      )
      .limit(BATCH_SIZE);

    if (batch.length === 0) {
      consecutiveEmptyBatches++;
      if (consecutiveEmptyBatches >= 2) break; // Safety: break if no records found twice
      continue;
    }

    consecutiveEmptyBatches = 0;
    itemsProcessed += batch.length;

    if (!data.dryRun) {
      const deleteResult = await db
        .delete(sessions)
        .where(inArray(sessions.id, batch.map(b => b.id)));
      
      // Safety: If delete returns 0, break to prevent infinite loop
      const rowsDeleted = (deleteResult as any)?.rowCount ?? 0;
      if (rowsDeleted === 0) {
        console.warn(`⚠️ Session cleanup: delete returned 0 rows for batch of ${batch.length}, breaking to prevent infinite loop`);
        break;
      }
      
      itemsDeleted += batch.length;
    }
  }

  return { itemsProcessed, itemsDeleted };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function checkBatchCompletion(batchId: number) {
  const batchArticles = await db
    .select()
    .from(articles)
    .where(eq(articles.batchId, batchId));

  const totalArticles = batchArticles.length;
  const completedArticles = batchArticles.filter(a => a.articleStatus === "COMPLETE").length;
  const failedArticles = batchArticles.filter(a => a.articleStatus === "FAILED").length;
  const pendingArticles = batchArticles.filter(a => a.articleStatus === "PENDING").length;
  const inProgressArticles = batchArticles.filter(a => 
    a.articleStatus === "IN_PROGRESS" || 
    a.articleStatus === "GEMINI_COMPLETE" ||
    a.articleStatus === "CHATGPT_REVIEWED" ||
    a.articleStatus === "GPT4_ENHANCED"
  ).length;

  console.log(`📊 Batch ${batchId} progress: ${completedArticles}/${totalArticles} complete, ${failedArticles} failed, ${inProgressArticles} in progress, ${pendingArticles} pending`);

  // SAFETY CHECK: Only mark batch as terminal if NO articles are pending or in progress
  const nonTerminalArticles = pendingArticles + inProgressArticles;
  
  if (nonTerminalArticles > 0) {
    console.log(`⏳ Batch ${batchId} still has ${nonTerminalArticles} unfinished articles - keeping RUNNING status`);
    // Ensure batch is in RUNNING state if it has unfinished articles
    await db
      .update(jobBatches)
      .set({ status: "RUNNING", completedAt: null })
      .where(eq(jobBatches.id, batchId));
    return;
  }

  // All articles are in terminal state (COMPLETE or FAILED)
  if (completedArticles + failedArticles === totalArticles) {
    let finalStatus: string;
    if (completedArticles === totalArticles) {
      finalStatus = "COMPLETE";
    } else if (completedArticles > 0) {
      finalStatus = "PARTIAL_COMPLETE";
    } else {
      finalStatus = "FAILED";
    }

    await db
      .update(jobBatches)
      .set({ 
        status: finalStatus,
        completedAt: new Date()
      })
      .where(eq(jobBatches.id, batchId));

    console.log(`✅ Batch ${batchId} finished with status: ${finalStatus}`);

    // Log batch completion event
    const { jobEvents } = await import("@/shared/schema");
    await db.insert(jobEvents).values({
      batchId,
      eventType: finalStatus === "COMPLETE" ? "BATCH_COMPLETED" : "BATCH_PARTIAL_COMPLETE",
      stage: "ORCHESTRATION",
      severity: finalStatus === "COMPLETE" ? "info" : "warning",
      message: `Batch finished: ${completedArticles} completed, ${failedArticles} failed`,
      payloadJson: { totalArticles, completedArticles, failedArticles }
    });

    // TRIGGER AUTO-PUBLISHING if enabled
    if (completedArticles > 0) {
      // Include all terminal-success statuses — GPT4_ENHANCED is the final state
      // for reformatted articles; COMPLETE for normal pipeline. Both are publish-ready.
      const PUBLISHABLE_STATUSES = ["COMPLETE", "GPT4_ENHANCED", "CHATGPT_REVIEWED"];
      await triggerAutoPublishing(batchId, batchArticles.filter(a => PUBLISHABLE_STATUSES.includes(a.articleStatus || "")));
    }
  }
}

async function triggerAutoPublishing(batchId: number, completedArticles: typeof articles.$inferSelect[]) {
  try {
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.id, batchId))
      .limit(1);

    if (!batch || !batch.autoPublishEnabled || !batch.autoPublishConnectionIds || !batch.teamId) {
      return;
    }

    const connectionIds = batch.autoPublishConnectionIds as number[];
    if (!Array.isArray(connectionIds) || connectionIds.length === 0) {
      return;
    }

    console.log(`🚀 Auto-publishing ${completedArticles.length} articles to ${connectionIds.length} connections`);

    const { publishingConnections } = await import("@/shared/schema");
    const { createPublishingJob } = await import("./publishing");

    // Accept 'active' or 'pending' connections — a freshly configured connection
    // may still show 'pending' if the ping hasn't been run yet.
    const connections = await db
      .select()
      .from(publishingConnections)
      .where(inArray(publishingConnections.id, connectionIds));

    const usableConnections = connections.filter(c => c.status === "active" || c.status === "pending");

    if (usableConnections.length === 0) {
      console.warn(`⚠️ No usable publishing connections found for auto-publish (${connections.length} connections found, none active/pending)`);
      return;
    }

    // Queue publishing jobs using createPublishingJob — handles DB + pg-boss in one call
    let queued = 0;
    for (const article of completedArticles) {
      for (const connection of usableConnections) {
        try {
          await createPublishingJob(batch.teamId, connection.id, "article", article.id);
          console.log(`📤 Auto-publish queued: Article ${article.id} → "${connection.name}"`);
          queued++;
        } catch (insertError) {
          console.error(`❌ Failed to queue auto-publish for article ${article.id} → connection ${connection.id}:`, insertError);
        }
      }
    }
    console.log(`✅ Auto-publish: ${queued} jobs queued for ${completedArticles.length} articles × ${usableConnections.length} connections`);

    // Log auto-publish event
    const { jobEvents } = await import("@/shared/schema");
    await db.insert(jobEvents).values({
      batchId,
      eventType: "AUTO_PUBLISH_TRIGGERED",
      stage: "PUBLISHING",
      severity: "info",
      message: `Auto-publishing ${completedArticles.length} articles to ${connections.length} connections`,
      payloadJson: { 
        articleCount: completedArticles.length, 
        connectionCount: connections.length,
        connectionIds: connections.map(c => c.id)
      }
    });

  } catch (error) {
    console.error(`❌ Auto-publishing failed for batch ${batchId}:`, error);
  }
}
