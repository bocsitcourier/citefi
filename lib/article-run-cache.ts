import { db } from "./db";
import { articleRuns, articles } from "../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { cleanMetaDescription, cleanSeoTitle, cleanFaqAnswers } from "./content-cleaner";

// ============================================================================
// ARTICLE RUN CACHE REUSE SYSTEM
// Detects completed runs and reuses cached outputs to avoid redundant API calls
// ============================================================================

export interface CachedArticleRun {
  runId: string;
  geminiOutput: any;
  chatgptOutput: any;
  gpt4Output: any;
  completedAt: Date;
}

/**
 * Get the most recent completed article run with cached outputs
 * This enables cache reuse short-circuit to skip expensive regeneration
 * 
 * @param articleId - The article ID to check for cached runs
 * @returns Cached run data if available, null otherwise
 */
export async function getCompletedArticleRun(articleId: number): Promise<CachedArticleRun | null> {
  console.log(`🔍 [Article ${articleId}] Checking for completed runs with cached outputs...`);
  
  const completedRuns = await db
    .select()
    .from(articleRuns)
    .where(
      and(
        eq(articleRuns.articleId, articleId),
        eq(articleRuns.status, "completed")
      )
    )
    .orderBy(desc(articleRuns.completedAt))
    .limit(1);

  if (completedRuns.length === 0) {
    console.log(`ℹ️  [Article ${articleId}] No completed runs found - full regeneration required`);
    return null;
  }

  const run = completedRuns[0];
  
  // Verify all cached outputs exist (we need all 3 stages)
  if (!run.cachedGeminiOutput || !run.cachedChatgptOutput || !run.cachedGpt4Output) {
    console.log(`⚠️  [Article ${articleId}] Completed run ${run.runId} missing cached outputs - full regeneration required`);
    return null;
  }

  console.log(`✅ [Article ${articleId}] Found completed run ${run.runId} with full cached outputs (completed: ${run.completedAt})`);
  
  return {
    runId: run.runId,
    geminiOutput: run.cachedGeminiOutput,
    chatgptOutput: run.cachedChatgptOutput,
    gpt4Output: run.cachedGpt4Output,
    completedAt: run.completedAt!,
  };
}

/**
 * Restore article from cached run outputs
 * This short-circuits the expensive regeneration pipeline
 * 
 * Fallback Order: GPT-4 → ChatGPT → Gemini
 * 
 * @param articleId - The article ID to restore
 * @param cachedRun - The cached run data to restore from
 */
export async function restoreArticleFromCache(
  articleId: number,
  cachedRun: CachedArticleRun
): Promise<void> {
  console.log(`♻️  [Article ${articleId}] Restoring from cached run ${cachedRun.runId}...`);
  
  // Extract data from cached outputs (GPT-4 → ChatGPT → Gemini fallback)
  const gemini = cachedRun.geminiOutput as any;
  const chatgpt = cachedRun.chatgptOutput as any;
  const gpt4 = cachedRun.gpt4Output as any;

  // Validate critical fields before restoring (prevent corrupt cache from overwriting good data)
  const finalContent = gpt4.contentHtml || chatgpt.contentHtml || gemini.rawContent;
  
  if (!finalContent || typeof finalContent !== 'string' || finalContent.trim().length < 100) {
    throw new Error(
      `Cache validation failed: finalHtmlContent is missing or too short (${finalContent?.length || 0} chars). ` +
      `Full regeneration required to prevent data corruption.`
    );
  }

  // Map cached outputs to article columns with proper fallback hierarchy
  await db
    .update(articles)
    .set({
      // CRITICAL: finalHtmlContent (not rawContent or contentHtml)
      // GPT-4 polish → ChatGPT refine → Gemini base
      finalHtmlContent: finalContent,
      
      // SEO fields: GPT-4 authoritative overrides → Gemini base
      seoTitle: cleanSeoTitle(gpt4.seoTitle || gemini.seoTitle),
      metaDescription: cleanMetaDescription(gpt4.metaDescription || gemini.metaDescription),
      slug: gpt4.slug || gemini.slug, // GPT-4 reconciled slug
      
      // Keywords/Hashtags: GPT-4 reconciled → Gemini base (JSON arrays)
      keywordsJson: gpt4.keywords || gemini.keywords || [],
      hashtagsJson: gpt4.hashtags || gemini.hashtags || [],
      
      // FAQ: GPT-4 edited → Gemini base (JSON array) — clean trailing dots
      faqJson: cleanFaqAnswers(gpt4.faq || gemini.faq || []),
      
      // Metadata
      wordCount: gpt4.wordCount || gemini.wordCount,
      heroImageUrl: gpt4.heroImageUrl || chatgpt.heroImageUrl || null,
      
      // ChatGPT review layer enrichment (FIXED: correct property names)
      seoScore: chatgpt.seoScore || null,
      hyperlinkedKeywordsJson: chatgpt.hyperlinkedKeywordsJson || null,
      metaEnrichment: chatgpt.metaEnrichment || null,
      
      // Podcast fields (FIXED: correct property names)
      podcastUrl: gpt4.podcastUrl || null,
      podcastDuration: gpt4.podcastDuration || null,
      podcastStatus: gpt4.podcastStatus || "none",
      podcastGeneratedAt: gpt4.podcastGeneratedAt || null,
      podcastScriptJson: gpt4.podcastScriptJson || null,
      
      // Status
      articleStatus: "COMPLETE",
    })
    .where(eq(articles.id, articleId));

  console.log(`✅ [Article ${articleId}] Successfully restored from cache - skipped expensive API calls`);
}

/**
 * Check if cache reuse should be bypassed
 * Returns true if custom instructions are provided or force regeneration requested
 */
export function shouldBypassCache(customInstructions?: string): boolean {
  if (customInstructions && customInstructions.trim().length > 0) {
    console.log(`🔄 Custom instructions provided - bypassing cache for fresh generation`);
    return true;
  }
  return false;
}
