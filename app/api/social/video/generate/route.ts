import { NextRequest, NextResponse } from "next/server";
import { addVideoGenerationJob } from "@/lib/queue";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { socialPosts } from "@/shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { checkUsageCap, cancelCapReservation } from "@/lib/usage-caps";

export async function POST(request: NextRequest) {
  let capReservationId: number | null = null;
  try {
    const { userId, teamId } = await requireTeamMember(request);

    const { checkTeamPaywall, paywallErrorBody } = await import("@/lib/billing/paywall");
    const paywallResult = await checkTeamPaywall(teamId);
    if (!paywallResult.allowed) {
      return NextResponse.json(paywallErrorBody(paywallResult), { status: 402 });
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
          upgradeUrl: "/client/billing",
          message: `Insufficient credits for video generation. You need ${reservation.requiredCredits} but have ${reservation.totalRemaining} available.`,
        },
        { status: 402 }
      );
    }

    let jobId: string | null;
    try {
      jobId = await addVideoGenerationJob({ socialPostId, platform, videoType, teamId, creditRunId });
      if (!jobId) throw new Error("BullMQ returned null — queue may be unhealthy");
    } catch (sendError) {
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
