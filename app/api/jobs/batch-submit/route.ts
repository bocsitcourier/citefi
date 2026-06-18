import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobBatches, articles, clientBrandProfiles } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { addBatchGenerationJob } from "@/lib/queue";
import { debitCredits, refundCredits, CREDIT_COSTS } from "@/lib/credits";
import { requireTeamMember } from "@/lib/api/auth";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";

const batchSubmitSchema = z.object({
  batchId: z.number(),
  selectedTitles: z.array(z.string()).min(1).max(100),
  targetUrl: z.string().url(),
  tone: z.string().optional(),
  wordCountMin: z.number().min(500).max(5000).default(800),
  wordCountMax: z.number().min(500).max(5000).default(2000),
  geographicFocus: z.string().optional(),
  audience: z.string().optional(),
  // NAP Data - businessName is REQUIRED to prevent AI hallucination in images/text
  businessName: z.string().transform(str => str.trim()).pipe(z.string().min(1, "Business name is required to ensure brand consistency")),
  businessAddress: z.string().optional(),
  businessPhone: z.string().optional(),
  // Accept both absolute URLs and relative paths (e.g., /api/public-objects/...)
  companyLogoUrl: z.string().optional().transform(val => val === "" ? undefined : val).refine(
    (val) => !val || val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: "Must be a valid URL or relative path" }
  ).optional(),
  // Advanced features
  competitorUrls: z.array(z.string().url()).max(5).optional(),
  semanticClusterId: z.number().optional(),
  serpFeatureTarget: z.enum(['Featured Snippet', 'PAA', 'List', 'Q&A']).optional(),
  // Auto-publishing
  autoPublishEnabled: z.boolean().optional().default(false),
  autoPublishConnectionIds: z.array(z.number()).optional(),
  // Psychographic targeting
  personaId: z.number().optional(),
}).refine((data) => data.wordCountMin <= data.wordCountMax, {
  message: "Minimum word count must be less than or equal to maximum word count",
  path: ["wordCountMin"],
});

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId, userId } = await requireTeamMember(request);

    const body = await request.json();
    const validatedData = batchSubmitSchema.parse(body);

    const { 
      batchId, 
      selectedTitles, 
      targetUrl, 
      tone, 
      wordCountMin, 
      wordCountMax, 
      geographicFocus, 
      audience,
      // NAP Data
      businessName,
      businessAddress,
      businessPhone,
      companyLogoUrl,
      // Advanced features
      competitorUrls,
      semanticClusterId,
      serpFeatureTarget,
      // Auto-publishing
      autoPublishEnabled,
      autoPublishConnectionIds,
      // Psychographic targeting
      personaId,
    } = validatedData;

    // Atomically claim PENDING → SUBMITTING — prevents concurrent double-submit race
    const [batch] = await db
      .update(jobBatches)
      .set({ status: "SUBMITTING" })
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId),
          eq(jobBatches.status, "PENDING")
        )
      )
      .returning();

    if (!batch) {
      const [exists] = await db
        .select({ id: jobBatches.id })
        .from(jobBatches)
        .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));
      if (!exists) {
        return NextResponse.json({ error: "Batch not found or access denied" }, { status: 404 });
      }
      return NextResponse.json({ error: "Batch already submitted or in progress" }, { status: 409 });
    }

    console.log(`📦 Submitting batch ${batchId} with ${selectedTitles.length} articles`);

    // Paywall gate: block free/canceled teams with zero credits before debit attempt
    // Reset batch to PENDING on 402 so the user can retry after purchasing credits
    const paywallCheck = await checkTeamPaywall(teamId);
    if (!paywallCheck.allowed) {
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      return NextResponse.json(paywallErrorBody(paywallCheck), { status: 402 });
    }

    // Intelligence onboarding gate — block first batch if no Brand Intelligence profile exists.
    // Teams with existing completed articles are assumed to be past onboarding and are not gated.
    // Pass header X-Skip-Intelligence-Gate: 1 to proceed without a profile.
    const skipIntelGate = request.headers.get("X-Skip-Intelligence-Gate") === "1";
    if (!skipIntelGate) {
      const [intelRow] = await db
        .select({ status: clientBrandProfiles.status })
        .from(clientBrandProfiles)
        .where(eq(clientBrandProfiles.teamId, teamId))
        .limit(1);

      if (!intelRow) {
        // Only gate teams that have no previously completed articles (true first-batch scenario)
        const [articleCountRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(articles)
          .where(eq(articles.teamId, teamId));
        const isFirstBatch = !articleCountRow || (articleCountRow.count ?? 0) === 0;

        if (isFirstBatch) {
          await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
          return NextResponse.json({
            error: "Brand Intelligence not configured",
            intelligenceGate: true,
            intelligenceUrl: "/intelligence",
            message: "Set up Brand Intelligence to get brand-aware content. To proceed without it, resend with the X-Skip-Intelligence-Gate: 1 header.",
          }, { status: 428 }); // 428 Precondition Required
        }
      }
    }

    // Per-request idempotency key: stable for retries of the same request, unique per submission attempt
    const requestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();

    // Debit credits — refund + reset batch if insufficient
    const creditDebit = await debitCredits({
      teamId,
      userId,
      productType: "article",
      units: selectedTitles.length,
      idempotencyKey: `batch:${batchId}:${requestKey}`,
      sourceType: "batch",
      sourceId: batchId,
    });

    if (!creditDebit.ok) {
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      return NextResponse.json(
        {
          error: "Insufficient credits",
          balance: creditDebit.balance,
          requiredCredits: creditDebit.requiredCredits,
          upgradeUrl: "/settings/billing",
          message: `You need ${creditDebit.requiredCredits} credits to generate ${selectedTitles.length} articles. Current balance: ${creditDebit.balance}. Purchase more credits at /settings/billing.`,
        },
        { status: 402 }
      );
    }

    // Wrap all post-debit work — refund + reset batch on any failure
    let jobId: string | null = null;
    try {
      // CRITICAL: Merge with existing generationParams to preserve redditResearchCache
      const existingParams = batch.generationParams as Record<string, any> || {};
      const mergedParams = {
        ...existingParams,
        tone, wordCountMin, wordCountMax, geographicFocus, audience,
        ...(serpFeatureTarget ? { serpFeatureTarget } : {}),
      };

      await db
        .update(jobBatches)
        .set({
          generationParams: mergedParams,
          businessName: businessName,
          businessAddress: businessAddress || null,
          businessPhone: businessPhone || null,
          companyLogoUrl: companyLogoUrl || null,
          autoPublishEnabled: autoPublishEnabled ? 1 : 0,
          autoPublishConnectionIds: autoPublishConnectionIds && autoPublishConnectionIds.length > 0
            ? autoPublishConnectionIds
            : null,
          personaId: personaId || null,
        })
        .where(eq(jobBatches.id, batchId));

      jobId = await addBatchGenerationJob({
        batchId,
        userId: batch.userId,
        teamId,
        selectedTitles,
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
        personaId,
      });

      if (!jobId) throw new Error("pg-boss returned null — queue may be full or unhealthy");
    } catch (queueErr) {
      console.error(`❌ Batch ${batchId} submission failed:`, queueErr);
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      await refundCredits({
        teamId,
        userId,
        amount: CREDIT_COSTS.article * selectedTitles.length,
        reason: `Refund: batch ${batchId} queue failure`,
        sourceType: "batch",
        sourceId: batchId,
        debitLedgerRowId: creditDebit.ledgerRowId,
      }).catch(() => {});
      return NextResponse.json(
        { error: "Failed to queue batch generation job. Please try again." },
        { status: 500 }
      );
    }

    console.log(`✅ Batch ${batchId} submitted successfully with job ID: ${jobId}`);

    return NextResponse.json({
      success: true,
      batchId,
      jobId,
      articlesQueued: selectedTitles.length,
      message: `Batch submitted successfully. ${selectedTitles.length} articles will be generated.`,
    });
  } catch (error) {
    console.error("Batch submission error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to submit batch", message: String(error) },
      { status: 500 }
    );
  }
}
