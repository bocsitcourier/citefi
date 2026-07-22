import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobBatches, articles, clientBrandProfiles } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { addBatchGenerationJob } from "@/lib/queue";
import { getEffectiveCreditCost, getCreditCost } from "@/lib/credit-menu";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import { requireTeamMember } from "@/lib/api/auth";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { checkUsageCap, cancelCapReservation } from "@/lib/usage-caps";

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
  // Declared outside the outer try so the outer catch can cancel any pending
  // spending-cap reservation that was created before an unexpected error occurred.
  let capReservationId: number | null = null;
  // Hoisted so the outer catch can reset status to PENDING on unexpected errors
  let _batchId: number | null = null;
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
    _batchId = batchId; // hoist for outer catch PENDING reset

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

    // Spending cap gate is deferred to after creditCostPerUnit is resolved below,
    // so we can pass the actual projected cost for the batch.

    // Intelligence onboarding gate — block first batch until Brand Intelligence is complete.
    // Teams with existing articles are assumed past onboarding and are not gated.
    // Pass header X-Skip-Intelligence-Gate: 1 to proceed without a completed profile.
    const skipIntelGate = request.headers.get("X-Skip-Intelligence-Gate") === "1";
    if (!skipIntelGate) {
      // Only gate teams with no previous articles (true first-batch scenario)
      const [articleCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(articles)
        .where(eq(articles.teamId, teamId));
      const isFirstBatch = !articleCountRow || (articleCountRow.count ?? 0) === 0;

      if (isFirstBatch) {
        const [intelRow] = await db
          .select({ status: clientBrandProfiles.status })
          .from(clientBrandProfiles)
          .where(eq(clientBrandProfiles.teamId, teamId))
          .limit(1);

        // Block if no profile exists OR profile exists but hasn't reached "complete"
        const intelComplete = intelRow?.status === "complete";
        if (!intelComplete) {
          await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
          const intelStatus = intelRow?.status ?? "not_started";
          return NextResponse.json({
            error: "Brand Intelligence not ready",
            intelligenceGate: true,
            intelligenceStatus: intelStatus,
            intelligenceUrl: "/intelligence",
            message: intelStatus === "running"
              ? "Brand Intelligence research is still running — please wait a few minutes before submitting."
              : intelStatus === "failed"
              ? "Brand Intelligence research failed. Please retry from /intelligence or skip to proceed without it."
              : "Set up Brand Intelligence to get brand-aware content. To proceed without it, resend with the X-Skip-Intelligence-Gate: 1 header.",
          }, { status: 428 }); // 428 Precondition Required
        }
      }
    }

    // Per-request idempotency key: stable for retries of the same request, unique per submission attempt
    const requestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();

    // RESERVE credits — atomic two-bucket reserve; DEBIT fires per-article on success
    // Resolve per-article cost honoring DB overrides (team-specific → global → static default)
    const creditCostPerUnit = (await getEffectiveCreditCost("article", teamId)) ?? getCreditCost("article") ?? 10;

    // Spending cap gate — checked here so we can pass the real projected cost.
    // Each credit unit ≈ 1 cent (proxy for API cost estimation).
    // checkUsageCap now inserts a PENDING reservation so concurrent submissions see it.
    // The reservation is cancelled on all failure paths to release the held capacity.
    try {
      capReservationId = await checkUsageCap(teamId, creditCostPerUnit * selectedTitles.length);
    } catch (capErr: any) {
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      return NextResponse.json(
        { error: capErr.message, code: capErr.code ?? "SPENDING_CAP_EXCEEDED", spendingCapGate: true },
        { status: 402 }
      );
    }

    const creditRunId = `batch:${batchId}:${requestKey}`;
    const creditReserve = await reserveCredits({
      teamId,
      operationType: "article",
      runId: creditRunId,
      amount: creditCostPerUnit * selectedTitles.length,
      userId,
    });

    if (!creditReserve.ok) {
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      if (capReservationId !== null) {
        cancelCapReservation(capReservationId).catch(() => {});
      }
      return NextResponse.json(
        {
          error: "CREDITS_EXHAUSTED",
          creditCost: creditReserve.requiredCredits,
          sufficient: false,
          allowanceRemaining: creditReserve.allowanceRemaining,
          purchasedRemaining: creditReserve.purchasedRemaining,
          totalRemaining: creditReserve.totalRemaining,
          insufficientBy: creditReserve.insufficientBy,
          upgradeUrl: "/settings/billing",
          message: `You need ${creditReserve.requiredCredits} credits to generate ${selectedTitles.length} articles. Current balance: ${creditReserve.totalRemaining}. Purchase more credits at /settings/billing.`,
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
        creditRunId,
        creditCostPerUnit,
        capReservationId,
      });

      if (!jobId) throw new Error("pg-boss returned null — queue may be full or unhealthy");
    } catch (queueErr) {
      console.error(`❌ Batch ${batchId} submission failed:`, queueErr);
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      await releaseReservation({
        teamId,
        runId: creditRunId,
        userId,
        reason: `Release: batch ${batchId} queue failure`,
      }).catch(() => {});
      // Cancel the spending-cap reservation so the held capacity is freed
      if (capReservationId !== null) {
        cancelCapReservation(capReservationId).catch(() => {});
      }
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
  } catch (error: any) {
    console.error("Batch submission error:", error);
    // Best-effort: release any spending-cap reservation created before the error.
    // The 2-hour auto-expiry is the safety net if this call also fails.
    if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
    // Reset batch to PENDING so the user can retry — the batch may have been
    // advanced to SUBMITTING before the unexpected error was thrown.
    if (_batchId !== null) {
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, _batchId)).catch(() => {});
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to submit batch", message: String(error) },
      { status: error?.statusCode || 500 }
    );
  }
}
