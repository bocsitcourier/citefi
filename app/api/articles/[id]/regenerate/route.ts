import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, jobBatches, jobEvents } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { addArticleJob } from "@/lib/queue";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const articleId = parseInt(id);
    
    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    // request.json() throws when the request body is empty (e.g. bare button POST).
    // Fall back to an empty object so customInstructions is simply undefined.
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const { customInstructions } = body as { customInstructions?: string };

    // CRITICAL: Verify article belongs to user's team
    const [article] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!article) {
      return NextResponse.json(
        { error: "Article not found or access denied" },
        { status: 404 }
      );
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.id, article.batchId));

    if (!batch) {
      return NextResponse.json(
        { error: "Batch not found" },
        { status: 404 }
      );
    }

    // Warn when businessName is missing — don't hard-block regeneration for legacy batches.
    // The worker and image-generation job will skip brand-lock if businessName is absent.
    if (!batch.businessName || batch.businessName.trim().length === 0) {
      console.warn(
        `⚠️ Regenerating article ${articleId} without businessName — ` +
        `batch ${article.batchId} was created before businessName was required. ` +
        `Brand-lock in AI prompts and image generation will be skipped.`
      );
    }

    // NOTE: Cache reuse is intentionally SKIPPED for user-triggered regeneration.
    // The cache short-circuit only makes sense for automatic pg-boss retries.
    // When a user explicitly clicks "Regenerate", they always want fresh content.

    const generationParams = batch.generationParams as any || {};
    const tone = generationParams.tone || "professional";
    const geographicFocus = generationParams.geographicFocus;
    const audience = generationParams.audience;
    const wordCountMin = generationParams.wordCountMin || 800;
    const wordCountMax = generationParams.wordCountMax || 2000;
    const personaId = generationParams.personaId || undefined;

    // CRITICAL: Reset article fields with team filter
    await db
      .update(articles)
      .set({ 
        articleStatus: "PENDING",
        finalHtmlContent: null,
        heroImageUrl: null,
        seoTitle: null,
        metaDescription: null,
        slug: null,
        keywordsJson: null,
        hashtagsJson: null,
        faqJson: null,
        wordCount: null,
        seoScore: null,
        hyperlinkedKeywordsJson: null,
        metaEnrichment: null,
        podcastUrl: null,
        podcastDuration: null,
        podcastStatus: "none",
        podcastGeneratedAt: null,
        podcastScriptJson: null,
      })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // CRITICAL TEAM FILTER ON UPDATE
        )
      );

    await db.insert(jobEvents).values({
      articleId,
      batchId: article.batchId,
      eventType: "ARTICLE_REGENERATION_REQUESTED",
      stage: "ORCHESTRATION",
      message: customInstructions 
        ? `Article regeneration requested with instructions: ${customInstructions.slice(0, 200)}`
        : "Article regeneration requested",
      payloadJson: { 
        customInstructions: customInstructions || null,
        originalTitle: article.chosenTitle,
        wordCountMin,
        wordCountMax,
      },
      severity: "info",
    });

    // Each regeneration gets a fresh run ID so the worker tracks it as a new attempt
    const runId = crypto.randomUUID();
    
    await addArticleJob({
      articleId: article.id,
      batchId: article.batchId,
      runId,
      title: article.chosenTitle,
      targetUrl: batch.targetUrl,
      tone,
      wordCountMin,
      wordCountMax,
      geographicFocus,
      audience,
      businessName: batch.businessName || undefined,
      companyLogoUrl: batch.companyLogoUrl || undefined,
      competitorUrls: batch.competitorUrlsJson as string[] || undefined,
      semanticClusterId: batch.semanticClusterId || undefined,
      serpFeatureTarget: batch.serpFeatureTarget || undefined,
      customInstructions: customInstructions || undefined,
      personaId,
      teamId, // Required for psychographic persona targeting in Gemini
    });

    console.log(`🔄 Article ${articleId} queued for regeneration${customInstructions ? ' with custom instructions' : ''}`);

    return NextResponse.json({
      success: true,
      articleId,
      status: "PENDING",
      message: customInstructions 
        ? "Article regeneration started with your custom instructions"
        : "Article regeneration started",
    });
  } catch (error) {
    console.error("❌ Article regeneration error:", error);
    return NextResponse.json(
      { 
        error: "Failed to regenerate article",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
