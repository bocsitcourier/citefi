import { NextRequest, NextResponse } from "next/server";
import { addVideoGenerationJob } from "@/lib/queue";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { socialPosts } from "@/shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { checkUsageCap, cancelCapReservation } from "@/lib/usage-caps";
import { checkVideoGate, acquireVideoSlot, releaseVideoSlot } from "@/lib/user-gate";

export async function POST(request: NextRequest) {
  // ── Storage preflight ──────────────────────────────────────────────────────
  // All video generation (slideshow + Veo) uploads to Replit Object Storage
  // via DEFAULT_OBJECT_STORAGE_BUCKET_ID. Reject immediately so we don't burn
  // Veo quota generating a video that can't be stored.
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    return NextResponse.json(
      {
        error: "Video storage not configured",
        message: "Object storage is not set up. Contact your administrator.",
        code: "STORAGE_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  let capReservationId: number | null = null;
  try {
    const { userId, teamId } = await requireTeamMember(request);

    const { checkTeamPaywall, paywallErrorBody } = await import("@/lib/billing/paywall");
    const paywallResult = await checkTeamPaywall(teamId);
    if (!paywallResult.allowed) {
      return NextResponse.json(paywallErrorBody(paywallResult), { status: 402 });
    }

    // Per-user concurrency and daily quota gate — checked before spending cap so
    // the cheapest possible rejection happens first (no DB reservation needed).
    const videoGate = await checkVideoGate(userId, teamId);
    if (!videoGate.allowed) {
      return NextResponse.json(
        {
          error: videoGate.message ?? "Video generation limit reached",
          code: videoGate.code,
          scope: videoGate.scope,
          remaining: videoGate.remaining ?? 0,
          resetsAt: videoGate.resetsAt,
          upgradeUrl: videoGate.upgradeUrl,
        },
        { status: 429 }
      );
    }

    // Spending cap gate — blocks if team's monthly dollar limit would be exceeded.
    try {
      capReservationId = await checkUsageCap(teamId, 15); // video ≈ 15 credits / 15¢ estimated
    } catch (capErr: any) {
      if (capErr.code !== "SPENDING_CAP_EXCEEDED") throw capErr;
      return NextResponse.json(
        { error: capErr.message, code: "SPENDING_CAP_EXCEEDED", spendingCapGate: true },
        { status: 402 }
      );
    }

    const body = await request.json();
    const { socialPostId, platform = "tiktok", videoType = "slideshow", force = false } = body;

    if (!socialPostId) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      return NextResponse.json({ error: "socialPostId is required" }, { status: 400 });
    }

    if (videoType !== "slideshow" && videoType !== "veo") {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      return NextResponse.json({ error: "videoType must be 'slideshow' or 'veo'" }, { status: 400 });
    }

    const [post] = await db
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)))
      .limit(1);

    if (!post) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      return NextResponse.json({ error: "Social post not found" }, { status: 404 });
    }

    if (!post.companyName) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      return NextResponse.json(
        {
          error: "Company name is required for video generation",
          message: "Please edit this post to add your company name before generating a video.",
        },
        { status: 400 }
      );
    }

    const isVeo = videoType === "veo";
    const timeEstimate = isVeo ? "60-80 minutes" : "2-3 minutes";
    console.log(`📹 Queueing ${isVeo ? "Veo AI" : "slideshow"} video generation for Social Post ${socialPostId}`);

    const [locked] = await db
      .update(socialPosts)
      .set({ videoType, videoStatus: "GENERATING", videoProgress: 0, videoStage: "queued", updatedAt: new Date() })
      .where(
        and(
          eq(socialPosts.id, socialPostId),
          eq(socialPosts.teamId, teamId),
          force
            ? sql`TRUE`
            : sql`${socialPosts.videoStatus} IS DISTINCT FROM 'GENERATING'`
        )
      )
      .returning({ id: socialPosts.id });

    if (!locked) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      console.log(`⚠️ Video already generating for social post ${socialPostId}, skipping duplicate queue`);
      return NextResponse.json({
        success: true,
        message: "Video generation already in progress",
        alreadyQueued: true,
        socialPostId,
        currentStage: post.videoStage,
        currentProgress: post.videoProgress,
      });
    }

    if (force) {
      console.log(`🔄 Force-reset applied for social post ${socialPostId}`);
    }

    const requestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();
    const creditRunId = `video:${teamId}:${socialPostId}:${requestKey}`;
    const reservation = await reserveCredits({
      teamId,
      operationType: "video",
      runId: creditRunId,
      userId,
    });

    if (!reservation.ok) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      await db
        .update(socialPosts)
        .set({ videoStatus: post.videoStatus ?? null, videoProgress: post.videoProgress ?? 0, videoStage: post.videoStage ?? null })
        .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)))
        .catch(() => {});
      return NextResponse.json(
        {
          error: "CREDITS_EXHAUSTED",
          creditCost: reservation.requiredCredits,
          sufficient: false,
          allowanceRemaining: reservation.allowanceRemaining,
          purchasedRemaining: reservation.purchasedRemaining,
          totalRemaining: reservation.totalRemaining,
          insufficientBy: reservation.insufficientBy,
          upgradeUrl: "/settings/billing",
          message: `Insufficient credits for video generation. You need ${reservation.requiredCredits} but have ${reservation.totalRemaining} available.`,
        },
        { status: 402 }
      );
    }

    // Atomic concurrency slot — the advisory checkVideoGate count above is
    // race-prone; this Redis INCR is the actual enforcement. Released by the
    // video worker on terminal state (or auto-expires after 2h).
    const slotAcquired = await acquireVideoSlot(userId, teamId);
    if (!slotAcquired) {
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      await db
        .update(socialPosts)
        .set({ videoStatus: post.videoStatus ?? null, videoProgress: post.videoProgress ?? 0, videoStage: post.videoStage ?? null })
        .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)));
      await releaseReservation({
        teamId,
        runId: creditRunId,
        reason: `Concurrency slot unavailable for social post ${socialPostId}`,
      }).catch(() => {});
      return NextResponse.json(
        {
          error: "You already have the maximum number of videos generating. Wait for one to finish.",
          code: "CONCURRENCY_LIMIT",
          scope: "video_concurrent",
          remaining: 0,
        },
        { status: 429 }
      );
    }

    let jobId: string | null;
    try {
      jobId = await addVideoGenerationJob({ socialPostId, platform, videoType, teamId, creditRunId });
      if (!jobId) throw new Error("BullMQ returned null — queue may be unhealthy");
    } catch (sendError) {
      await releaseVideoSlot(userId).catch(() => {});
      const errMsg = sendError instanceof Error ? sendError.message : String(sendError);
      console.error(`❌ addVideoGenerationJob() failed for post ${socialPostId}:`, errMsg);
      if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
      await db
        .update(socialPosts)
        .set({ videoStatus: "FAILED", videoProgress: 0, videoStage: null, errorMessage: `Failed to queue video job: ${errMsg}` })
        .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)));
      await releaseReservation({
        teamId,
        runId: creditRunId,
        reason: `Video queue failure for social post ${socialPostId}`,
      }).catch(() => {});
      throw sendError;
    }

    console.log(`✅ Video generation job queued successfully: ${jobId}`);
    return NextResponse.json({
      success: true,
      jobId,
      socialPostId,
      platform,
      videoType,
      message: `${isVeo ? "Veo AI" : "Slideshow"} video generation started. This will take ${timeEstimate}.`,
      estimatedTime: timeEstimate,
      videoStatus: "GENERATING",
      videoProgress: 0,
      videoStage: "queued",
    });
  } catch (error: any) {
    if (capReservationId !== null) cancelCapReservation(capReservationId).catch(() => {});
    console.error("❌ Failed to queue video generation:", error);
    return NextResponse.json(
      {
        error: "Failed to start video generation",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: error?.statusCode || 500 }
    );
  }
}
