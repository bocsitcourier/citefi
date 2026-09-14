import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, creditReservations, jobBatches, jobEvents } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  addArticleJob,
  ArticleEnqueueUncertainError,
  findArticleGenerationJob,
} from "@/lib/queue";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import {
  markReservationForReconciliation,
  releaseReservation,
  reserveCredits,
} from "@/lib/billing";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { getCreditCost, getEffectiveCreditCost } from "@/lib/credit-menu";
import { cancelCapReservation, checkUsageCap } from "@/lib/usage-caps";
import { createHash } from "node:crypto";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    return await withAuthenticatedTeamContext(request, async (auth) => {
      const { teamId, userId } = auth;

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
    const rawRequestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();
    const requestKey = createHash("sha256").update(rawRequestKey).digest("hex");

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

    const creditCost =
      (await getEffectiveCreditCost("article", teamId)) ??
      getCreditCost("article") ??
      10;
    const creditRunId = `article-regeneration:${articleId}:${requestKey}`;
    const runId = `regeneration:${articleId}:${requestKey}`;

    // Stable request identity prevents a network retry from purchasing and
    // enqueueing a second regeneration.
    const [existingReservation] = await db
      .select({ status: creditReservations.status })
      .from(creditReservations)
      .where(and(
        eq(creditReservations.teamId, teamId),
        eq(creditReservations.runId, creditRunId),
      ))
      .limit(1);
    if (existingReservation) {
      const existingJob = await findArticleGenerationJob(runId);
      if (existingJob || existingReservation.status === "DEBITED") {
        return NextResponse.json({
          success: true,
          replayed: true,
          articleId,
          status: existingReservation.status === "DEBITED" ? "COMPLETE" : article.articleStatus,
          jobId: existingJob?.id,
        });
      }
      return NextResponse.json({
        error: "Article regeneration billing/queue state requires reconciliation",
        code: "RECONCILIATION_REQUIRED",
        articleId,
        runId: creditRunId,
      }, { status: 409 });
    }

    const [pendingReconciliation] = await db
      .select({ runId: creditReservations.runId })
      .from(creditReservations)
      .where(and(
        eq(creditReservations.teamId, teamId),
        eq(creditReservations.status, "RESERVED"),
        sql`${creditReservations.reconciliationRequiredAt} IS NOT NULL`,
        sql`${creditReservations.runId} LIKE ${`article-regeneration:${articleId}:%`}`,
      ))
      .limit(1);
    if (pendingReconciliation) {
      return NextResponse.json({
        error: "Article regeneration is pending billing/queue reconciliation",
        code: "RECONCILIATION_REQUIRED",
        articleId,
        runId: pendingReconciliation.runId,
      }, { status: 409 });
    }

    if (article.articleStatus === "PENDING" || article.articleStatus === "IN_PROGRESS") {
      return NextResponse.json({
        error: "Article regeneration is already in progress",
        articleId,
        status: article.articleStatus,
      }, { status: 409 });
    }

    const paywall = await checkTeamPaywall(teamId);
    if (!paywall.allowed) {
      return NextResponse.json(paywallErrorBody(paywall), { status: 402 });
    }

    let capReservationId: number | null = null;
    try {
      capReservationId = await checkUsageCap(teamId, creditCost, batch.campaignId ?? null);
    } catch (capError: any) {
      if (capError?.code !== "SPENDING_CAP_EXCEEDED") throw capError;
      return NextResponse.json({
        error: capError.message,
        code: "SPENDING_CAP_EXCEEDED",
        spendingCapGate: true,
      }, { status: 402 });
    }

    let reservation: Awaited<ReturnType<typeof reserveCredits>>;
    try {
      reservation = await reserveCredits({
        teamId,
        operationType: "article",
        runId: creditRunId,
        amount: creditCost,
        userId,
      });
    } catch (reservationError) {
      if (capReservationId !== null) {
        await cancelCapReservation(capReservationId).catch(() => {});
      }
      throw reservationError;
    }
    if (!reservation.ok) {
      if (capReservationId !== null) {
        await cancelCapReservation(capReservationId).catch(() => {});
      }
      return NextResponse.json({
        error: "CREDITS_EXHAUSTED",
        creditCost: reservation.requiredCredits,
        sufficient: false,
        allowanceRemaining: reservation.allowanceRemaining,
        purchasedRemaining: reservation.purchasedRemaining,
        totalRemaining: reservation.totalRemaining,
        insufficientBy: reservation.insufficientBy,
        upgradeUrl: "/settings/billing",
        message: `You need ${reservation.requiredCredits} credits to regenerate this article. Current balance: ${reservation.totalRemaining}.`,
      }, { status: 402 });
    }

    // Reset only after the canonical credit and cap reservations exist.
    try {
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
      teamId,
      creditRunId,
      creditCostPerUnit: creditCost,
      capReservationId,
      campaignId: batch.campaignId ?? null,
    });
    } catch (startError) {
      if (startError instanceof ArticleEnqueueUncertainError) {
        await markReservationForReconciliation({
          teamId,
          runId: creditRunId,
          reason: `Article ${articleId} regeneration queue acceptance is uncertain`,
        }).catch(() => {});
        return NextResponse.json({
          success: false,
          pending: true,
          retryable: false,
          code: "RECONCILIATION_REQUIRED",
          articleId,
          message: "Queue acceptance is uncertain. Credits and spending-cap capacity remain safely held.",
        }, { status: 202 });
      }

      try {
        await releaseReservation({
          teamId,
          runId: creditRunId,
          userId,
          reason: `Release: article ${articleId} regeneration failed before queue acceptance`,
        });
        if (capReservationId !== null) await cancelCapReservation(capReservationId);
      } catch (releaseError) {
        await markReservationForReconciliation({
          teamId,
          runId: creditRunId,
          reason: `Article ${articleId} regeneration setup failed and release was not durable: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`,
        }).catch(() => {});
        return NextResponse.json({
          success: false,
          code: "RECONCILIATION_REQUIRED",
          articleId,
          message: "Regeneration was not queued and its billing hold requires reconciliation.",
        }, { status: 202 });
      }
      throw startError;
    }

    console.log(`🔄 Article ${articleId} queued for regeneration${customInstructions ? ' with custom instructions' : ''}`);

    return NextResponse.json({
      success: true,
      articleId,
      status: "PENDING",
      message: customInstructions 
        ? "Article regeneration started with your custom instructions"
        : "Article regeneration started",
    });
      });
  } catch (error: any) {
    console.error("❌ Article regeneration error:", error);
    return NextResponse.json(
      { 
        error: "Failed to regenerate article",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: error?.statusCode || 500 }
    );
  }
}
