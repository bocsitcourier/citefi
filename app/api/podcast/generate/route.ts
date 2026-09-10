import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, creditReservations } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  addPodcastGenerationJob,
  PodcastEnqueueUncertainError,
} from "@/lib/queue";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { checkUsageCap, cancelCapReservation } from "@/lib/usage-caps";

export async function POST(request: NextRequest) {
  let capReservationId: number | null = null;
  try {
    return await withAuthenticatedTeamContext(request, async ({ userId, teamId }) => {
    try {
    const body = await request.json();
    const { articleId, tone, duration } = body;

    if (!articleId) {
      return NextResponse.json(
        { error: "Article ID is required" },
        { status: 400 }
      );
    }

    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
      .limit(1);

    if (!article) {
      return NextResponse.json(
        { error: "Article not found" },
        { status: 404 }
      );
    }

    // A prior paid podcast attempt with an unresolved outcome must be
    // reconciled before this resource can acquire a fresh runId and submit
    // another provider request.
    const [pendingReconciliation] = await db
      .select({
        runId: creditReservations.runId,
      })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.teamId, teamId),
          eq(creditReservations.status, "RESERVED"),
          sql`${creditReservations.reconciliationRequiredAt} IS NOT NULL`,
          sql`${creditReservations.runId} LIKE ${`podcast:${articleId}:%`}`
        )
      )
      .limit(1);
    if (pendingReconciliation) {
      return NextResponse.json(
        {
          error: "Podcast generation is pending billing/provider reconciliation",
          code: "RECONCILIATION_REQUIRED",
          runId: pendingReconciliation.runId,
          message: "Resolve the previous podcast attempt before generating another.",
        },
        { status: 409 }
      );
    }

    // Paywall gate — plan-level check before acquiring the generation lock
    const paywallResult = await checkTeamPaywall(teamId);
    if (!paywallResult.allowed) {
      return NextResponse.json(paywallErrorBody(paywallResult), { status: 402 });
    }

    // Spending cap gate — blocks if team's monthly dollar limit would be exceeded.
    // checkUsageCap inserts a PENDING reservation atomically so concurrent requests
    // all see each other's pending costs. cancelCapReservation() releases it on failure.
    try {
      capReservationId = await checkUsageCap(teamId, 8); // podcast ≈ 8 credits / 8¢ estimated
    } catch (capErr: any) {
      if (capErr.code !== "SPENDING_CAP_EXCEEDED") throw capErr;
      return NextResponse.json(
        { error: capErr.message, code: "SPENDING_CAP_EXCEEDED", spendingCapGate: true },
        { status: 402 }
      );
    }

    // Atomically acquire generation lock — prevents concurrent double-debit
    // Sets podcastStatus='pending' only if NOT currently in flight
    const [locked] = await db
      .update(articles)
      .set({ podcastStatus: "pending" })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId),
          sql`(${articles.podcastStatus} IS NULL OR ${articles.podcastStatus} NOT IN ('pending', 'processing'))`
        )
      )
      .returning({ id: articles.id });

    if (!locked) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      return NextResponse.json(
        { error: "Podcast generation already in progress", status: article.podcastStatus },
        { status: 409 }
      );
    }

    // Per-request idempotency key: stable for network retries, unique per generation attempt
    const requestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();

    // RESERVE credits — no charge until generation completes successfully
    const creditRunId = `podcast:${articleId}:${requestKey}`;
    const creditReserve = await reserveCredits({
      teamId,
      operationType: "podcast",
      runId: creditRunId,
      userId,
    });

    if (!creditReserve.ok) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      await db
        .update(articles)
        .set({ podcastStatus: article.podcastStatus ?? "none" })
        .where(eq(articles.id, articleId))
        .catch(() => {});
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
          message: `You need ${creditReserve.requiredCredits} credits to generate a podcast. Current balance: ${creditReserve.totalRemaining}.`,
        },
        { status: 402 }
      );
    }

    // Durable enqueue — deterministic article job identity and an ambiguity
    // lookup in addPodcastGenerationJob preserve the lock/reservation when Redis
    // accepted the job but the enqueue response was lost.
    let queuedJobId: string | null;
    try {
      queuedJobId = await addPodcastGenerationJob({
        articleId,
        tone,
        duration,
        teamId,
        userId,
        creditRunId,
      });
    } catch (startErr) {
      if (startErr instanceof PodcastEnqueueUncertainError) {
        // Redis may have accepted the deterministic job. Keep article lock,
        // credit hold, and cap reservation intact until reconciliation.
        return NextResponse.json(
          {
            success: false,
            code: "RECONCILIATION_REQUIRED",
            error: "Podcast queue acceptance is uncertain",
            message: "The request is preserved and must be reconciled before retrying.",
            articleId,
            status: "reconciliation_required",
          },
          { status: 202 }
        );
      }
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      await releaseReservation({
        teamId,
        runId: creditRunId,
        userId,
        reason: `Release: podcast start failure for article ${articleId}`,
      }).catch(() => {});
      throw startErr;
    }

    return NextResponse.json({
      success: true,
      message: "Podcast generation started",
      jobId: queuedJobId,
      articleId,
      status: "pending",
    });
    } catch (error) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      throw error;
    }
    });
  } catch (error: any) {
    console.error("Error starting podcast generation:", error);
    return NextResponse.json(
      { error: "Failed to start podcast generation" },
      { status: error?.statusCode || 500 }
    );
  }
}
