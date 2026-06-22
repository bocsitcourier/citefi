import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { getPgBoss } from "@/lib/queue";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import { randomUUID } from "crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const { id } = await params;

    const ideaId = parseInt(id, 10);
    if (isNaN(ideaId)) {
      return NextResponse.json({ error: "Invalid idea ID" }, { status: 400 });
    }

    const [idea] = await db.select()
      .from(videoIdeas)
      .where(and(
        eq(videoIdeas.id, ideaId),
        eq(videoIdeas.teamId, teamId),
        isNull(videoIdeas.deletedAt)
      ))
      .limit(1);

    if (!idea) {
      return NextResponse.json({ error: "Video idea not found" }, { status: 404 });
    }

    if (!idea.stylePrompt) {
      return NextResponse.json(
        { error: "Video must be analyzed first before generation. Run the analyze step first." },
        { status: 400 }
      );
    }

    if (!idea.companyName) {
      return NextResponse.json(
        { error: "Company name is required for video generation" },
        { status: 400 }
      );
    }

    const activeStatuses = ["EXPANDING", "SCRIPTING", "GENERATING", "STITCHING"];
    if (activeStatuses.includes(idea.status)) {
      return NextResponse.json({
        success: true,
        message: "Video generation already in progress",
        alreadyQueued: true,
        ideaId: idea.id,
        currentStage: idea.currentStage,
        currentProgress: idea.progress,
      });
    }

    // Paywall gate: check plan and credit balance before reserving
    const paywallResult = await checkTeamPaywall(teamId);
    if (!paywallResult.allowed) {
      return NextResponse.json(paywallErrorBody(paywallResult), { status: 402 });
    }

    // Reserve credits atomically — blocks if balance insufficient
    const creditRunId = randomUUID();
    const reservation = await reserveCredits({
      teamId,
      userId,
      operationType: "video",
      runId: creditRunId,
    });

    if (!reservation.ok) {
      return NextResponse.json(
        {
          error: "CREDITS_EXHAUSTED",
          creditBalance: reservation.totalRemaining,
          allowanceRemaining: reservation.allowanceRemaining,
          purchasedRemaining: reservation.purchasedRemaining,
          totalRemaining: reservation.totalRemaining,
          sufficient: false,
          requiredCredits: reservation.requiredCredits,
          upgradeUrl: "/settings/billing",
          message: `Video generation requires ${reservation.requiredCredits} credits. You have ${reservation.totalRemaining} remaining.`,
        },
        { status: 402 }
      );
    }

    console.log(`🎬 Queueing Like Video generation for ID ${ideaId}: "${idea.ideaTitle}" (creditRunId: ${creditRunId})`);

    await db.update(videoIdeas)
      .set({
        status: "EXPANDING",
        progress: 0,
        currentStage: "queued",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(videoIdeas.id, ideaId));

    const queue = await getPgBoss();

    const jobId = await queue.send(
      "video-idea-generation",
      { videoIdeaId: ideaId, creditRunId },
      {
        retryLimit: 0, // No retries - each attempt costs money
        retryDelay: 0,
        expireInSeconds: 5400,
      }
    );

    if (!jobId) {
      // Release the reservation — job never started, so no charge
      await releaseReservation({ teamId, runId: creditRunId, reason: "Queue send failed" })
        .catch((e) => console.warn("[billing] releaseReservation on queue failure:", e));

      await db.update(videoIdeas)
        .set({
          status: "FAILED",
          progress: 0,
          errorMessage: "Failed to queue job - please try again",
        })
        .where(eq(videoIdeas.id, ideaId));

      return NextResponse.json(
        { error: "Failed to queue video generation job" },
        { status: 500 }
      );
    }

    await db.update(videoIdeas)
      .set({ jobId })
      .where(eq(videoIdeas.id, ideaId));

    console.log(`✅ Like Video generation job queued: ${jobId}`);

    return NextResponse.json({
      success: true,
      jobId,
      ideaId: idea.id,
      message: "Like Video generation started. The style from your reference video will be applied.",
      estimatedTime: "60-80 minutes",
    });

  } catch (error: any) {
    console.error("Error starting like video generation:", error);
    return NextResponse.json(
      { error: "Failed to start like video generation" },
      { status: error?.statusCode || 500 }
    );
  }
}
