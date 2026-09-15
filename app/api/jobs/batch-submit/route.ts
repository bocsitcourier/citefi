import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobBatches, articles, campaigns, clientBrandProfiles } from "@/shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  addBatchGenerationJob,
  AmbiguousBatchEnqueueError,
  batchGenerationJobId,
  findBatchGenerationJob,
} from "@/lib/queue";
import { getEffectiveCreditCost, getCreditCost } from "@/lib/credit-menu";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import {
  runWithAuthenticatedTeamContext,
  withAuthenticatedTeamContext,
} from "@/lib/api/auth";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { checkUsageCap, cancelCapReservation } from "@/lib/usage-caps";
import {
  compensateBatchEnqueueFailure,
  inspectBatchSubmissionReplay,
  validateBatchSubmissionKey,
} from "@/lib/batch-submission";
import {
  claimBatchForSubmission,
  recordBatchEnqueueAccepted,
} from "@/lib/batch-submission-server";
import { batchSubmitSchema } from "@/lib/batch-submission-validation";

export async function POST(request: NextRequest) {
  // Declared outside the outer try so the outer catch can cancel any pending
  // spending-cap reservation that was created before an unexpected error occurred.
  let capReservationId: number | null = null;
  // Hoisted so the outer catch can reset status to PENDING on unexpected errors
  let _batchId: number | null = null;
  let preserveDurableState = false;
  let authenticatedAuth: { userId: number; teamId: number; role: string } | null = null;
  try {
    // CRITICAL: Verify authentication and get team context
    return await withAuthenticatedTeamContext(request, async (auth) => {
      authenticatedAuth = auth;
      const { teamId, userId } = auth;

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
    const suppliedRequestKey = request.headers.get("X-Idempotency-Key");
    let requestKey: string;
    try {
      requestKey = suppliedRequestKey
        ? validateBatchSubmissionKey(suppliedRequestKey)
        : crypto.randomUUID();
    } catch {
      return NextResponse.json(
        { error: "Invalid X-Idempotency-Key header" },
        { status: 400 },
      );
    }
    _batchId = batchId; // hoist for outer catch PENDING reset

    // Atomically claim PENDING → SUBMITTING — prevents concurrent double-submit race
    const claim = await claimBatchForSubmission(batchId, teamId);
    if (claim.outcome === "not_found") {
      return NextResponse.json({ error: "Batch not found or access denied" }, { status: 404 });
    }
    if (claim.outcome === "conflict") {
      const params = (claim.batch.generationParams ?? {}) as Record<string, unknown>;
      const submission = params.submission as Record<string, unknown> | undefined;
      const replay = inspectBatchSubmissionReplay({
        batchId,
        status: claim.batch.status,
        generationParams: params,
        idempotencyKey: requestKey,
      });
      if (replay.outcome === "terminal") {
        return NextResponse.json(
          { error: `Batch is terminal (${claim.batch.status}) and cannot be resurrected` },
          { status: 409 },
        );
      }
      if (replay.outcome !== "not_match") {
        // This request is replaying an existing durable operation. Any lookup
        // failure is ambiguous and must never reset that operation or its hold.
        preserveDurableState = true;
        if (replay.outcome === "accepted") {
          return NextResponse.json({
            success: true,
            replayed: true,
            batchId,
            jobId: replay.jobId,
            articlesQueued: selectedTitles.length,
          });
        }
        const accepted = await findBatchGenerationJob(batchId);
        if (accepted) {
          const acceptedJobId = accepted.id ?? batchGenerationJobId(batchId);
          const jobState = await accepted.getState();
          if (!["waiting", "delayed", "active", "prioritized", "waiting-children"].includes(jobState)) {
            return NextResponse.json({
              success: false,
              pending: true,
              retryable: false,
              code: "BATCH_ENQUEUE_CONFIRMATION_PENDING",
              message: `The retained queue job is ${jobState}; batch reconciliation is required.`,
            }, { status: 503 });
          }
          const recorded = await recordBatchEnqueueAccepted({
            batchId,
            teamId,
            generationParams: {
              ...params,
              submission: { ...submission, state: "ACCEPTED", jobId: acceptedJobId },
            },
          });
          if (!recorded) {
            const [current] = await db.select({ status: jobBatches.status })
              .from(jobBatches)
              .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)))
              .limit(1);
            if (["CANCELLED", "FAILED"].includes(current?.status ?? "")) {
              return NextResponse.json(
                { error: `Batch is terminal (${current?.status}) and cannot be resurrected` },
                { status: 409 },
              );
            }
            if (!["RUNNING", "PARTIAL_COMPLETE", "COMPLETE"].includes(current?.status ?? "")) {
              return NextResponse.json({
                success: false,
                pending: true,
                retryable: false,
                code: "BATCH_ENQUEUE_CONFIRMATION_PENDING",
                message: "Queue acceptance is durable, but batch state reconciliation is still pending.",
              }, { status: 503 });
            }
          }
          return NextResponse.json({
            success: true,
            replayed: true,
            batchId,
            jobId: acceptedJobId,
            articlesQueued: selectedTitles.length,
          });
        }
        return NextResponse.json({
          success: false,
          pending: true,
          retryable: false,
          code: "BATCH_ENQUEUE_CONFIRMATION_PENDING",
          message: "This submission is still being reconciled. Credits remain safely held; do not resubmit.",
        }, { status: 503 });
      }
      return NextResponse.json({ error: "Batch already submitted or in progress" }, { status: 409 });
    }
    const batch = claim.batch;
    const creditRunId = `batch:${batchId}:${requestKey}`;
    await db.update(jobBatches).set({
      generationParams: {
        ...((batch.generationParams ?? {}) as Record<string, unknown>),
        submission: {
          idempotencyKey: requestKey,
          creditRunId,
          state: "CLAIMED",
        },
      },
    }).where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

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
        const [intelRow] = batch.campaignId
          ? await db
              .select({
                status: campaigns.brandStatus,
                snapshot: campaigns.brandProfileSnapshot,
              })
              .from(campaigns)
              .where(
                and(
                  eq(campaigns.id, batch.campaignId),
                  eq(campaigns.teamId, teamId)
                )
              )
              .limit(1)
          : await db
              .select({
                status: clientBrandProfiles.status,
                snapshot: clientBrandProfiles.profileJson,
              })
              .from(clientBrandProfiles)
              .where(eq(clientBrandProfiles.teamId, teamId))
              .limit(1);

        const intelComplete = batch.campaignId
          ? Boolean(
              intelRow?.snapshot &&
              ["ready", "confirmed"].includes(intelRow.status ?? "")
            )
          : intelRow?.status === "complete";
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

    // RESERVE credits — atomic two-bucket reserve; DEBIT fires per-article on success
    // Resolve per-article cost honoring DB overrides (team-specific → global → static default)
    const creditCostPerUnit = (await getEffectiveCreditCost("article", teamId)) ?? getCreditCost("article") ?? 10;

    // Spending cap gate — checked here so we can pass the real projected cost.
    // Each credit unit ≈ 1 cent (proxy for API cost estimation).
    // checkUsageCap now inserts a PENDING reservation so concurrent submissions see it.
    // The reservation is cancelled on all failure paths to release the held capacity.
    try {
      capReservationId = await checkUsageCap(
        teamId,
        creditCostPerUnit * selectedTitles.length,
        batch.campaignId ?? null
      );
    } catch (capErr: any) {
      // Only swallow typed cap-exceeded errors — rethrow infra crashes to the outer catch
      // so they are logged and don't masquerade as "spending cap exceeded" to the user.
      if (capErr.code !== "SPENDING_CAP_EXCEEDED") throw capErr;
      await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, batchId)).catch(() => {});
      return NextResponse.json(
        { error: capErr.message, code: "SPENDING_CAP_EXCEEDED", spendingCapGate: true },
        { status: 402 }
      );
    }

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
    preserveDurableState = true;
    await db.update(jobBatches).set({
      generationParams: {
        ...((batch.generationParams ?? {}) as Record<string, unknown>),
        submission: {
          idempotencyKey: requestKey,
          creditRunId,
          state: "RESERVED",
        },
      },
    }).where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    // Wrap all post-debit work — refund + reset batch on any failure
    let jobId: string | null = null;
    try {
      // CRITICAL: Merge with existing generationParams to preserve redditResearchCache
      const existingParams = batch.generationParams as Record<string, any> || {};
      const mergedParams = {
        ...existingParams,
        tone, wordCountMin, wordCountMax, geographicFocus, audience,
        ...(serpFeatureTarget ? { serpFeatureTarget } : {}),
        submission: {
          idempotencyKey: requestKey,
          creditRunId,
          state: "RESERVED",
        },
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
        // Canonical campaign association comes from the claimed batch row, never
        // from the request payload — prevents cross-campaign spoofing.
        campaignId: batch.campaignId ?? null,
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
        capReservationScope: "batch",
      });

      if (!jobId) throw new Error("pg-boss returned null — queue may be full or unhealthy");
      await recordBatchEnqueueAccepted({
        batchId,
        teamId,
        generationParams: {
          ...mergedParams,
          submission: {
            idempotencyKey: requestKey,
            creditRunId,
            state: "ACCEPTED",
            jobId,
          },
        },
      });
    } catch (queueErr) {
      console.error(`❌ Batch ${batchId} submission failed:`, queueErr);
      // Log to Admin Error Log so queue failures are always visible
      const { logError } = await import("@/lib/error-logger");
      await logError({
        errorType: "QUEUE",
        errorMessage: `Batch ${batchId} queue submission failed: ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`,
        stackTrace: queueErr instanceof Error ? queueErr.stack : undefined,
        severity: "error",
        batchId,
        component: "batch-submit",
      }).catch(() => {});
      if (queueErr instanceof AmbiguousBatchEnqueueError) {
        return NextResponse.json({
          success: false,
          pending: true,
          retryable: false,
          code: "BATCH_ENQUEUE_CONFIRMATION_PENDING",
          message: "Queue acceptance could not be confirmed. Credits remain safely held while this submission is reconciled.",
        }, { status: 503 });
      }
      const compensation = await compensateBatchEnqueueFailure({
        releaseCredits: () => releaseReservation({
          teamId,
          runId: creditRunId,
          userId,
          reason: `Release: batch ${batchId} queue failure`,
        }),
        releaseCap: () => capReservationId === null
          ? Promise.resolve()
          : cancelCapReservation(capReservationId),
        markRetryable: async () => {
          await db
            .update(jobBatches)
            .set({ status: "PENDING" })
            .where(and(
              eq(jobBatches.id, batchId),
              inArray(jobBatches.status, ["SUBMITTING", "FAILED_ENQUEUE"]),
            ));
        },
      });
      return NextResponse.json(
        compensation.retryEnabled
          ? {
              error: "Failed to queue batch generation job. Please try again.",
              code: "BATCH_ENQUEUE_FAILED",
              retryable: true,
            }
          : {
              error: "Batch could not be queued and its credit hold is awaiting reconciliation. Please do not resubmit yet.",
              code: "BATCH_ENQUEUE_CLEANUP_PENDING",
              retryable: false,
            },
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
      });
  } catch (error: any) {
    console.error("Batch submission error:", error);
    const cleanup = async () => {
      // Once credits are reserved, an unexpected post-reserve failure is
      // ambiguous. Fail closed: preserve both durable state and holds.
      if (!preserveDurableState && capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      if (!preserveDurableState && _batchId !== null) {
        await db.update(jobBatches).set({ status: "PENDING" }).where(eq(jobBatches.id, _batchId)).catch(() => {});
      }
      // Log to Admin Error Log so infra crashes are visible instead of silent
      const { logError: _logError } = await import("@/lib/error-logger");
      await _logError({
        errorType: "SYSTEM",
        errorMessage: `Batch submit unexpected error (batch ${_batchId ?? "unknown"}): ${error instanceof Error ? error.message : String(error)}`,
        stackTrace: error instanceof Error ? error.stack : undefined,
        severity: "error",
        batchId: _batchId ?? undefined,
        component: "batch-submit-outer",
      }).catch(() => {});
    };
    if (authenticatedAuth) {
      await runWithAuthenticatedTeamContext(authenticatedAuth, cleanup);
    } else {
      await cleanup();
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
