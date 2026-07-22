import { NextRequest, NextResponse } from "next/server";
import { addVideoGenerationJob } from "@/lib/queue";
import { db } from "@/lib/db";
import { socialPosts } from "@/shared/schema";
import { eq, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { reserveCredits, releaseReservation } from "@/lib/billing";
import { randomUUID } from "crypto";

/**
 * Batch Video Generation Endpoint
 *
 * Chunks requests into smaller batches (10 videos at a time), staggers job
 * submission with delays to prevent queue flooding, reserves credits per
 * video before queueing (two-bucket billing), and tracks per-job progress.
 */

const CHUNK_SIZE = 10;
const CHUNK_DELAY_MS = 5000;

export async function POST(request: NextRequest) {
  let teamId: number | undefined;
  const reservations: { postId: number; creditRunId: string }[] = [];

  try {
    const auth = await requireTeamMember(request);
    teamId = auth.teamId;
    const userId = auth.userId;

    const body = await request.json();
    const { socialPostIds, platform = "tiktok" } = body;

    if (!Array.isArray(socialPostIds) || socialPostIds.length === 0) {
      return NextResponse.json(
        { error: "socialPostIds array is required and must not be empty" },
        { status: 400 }
      );
    }

    console.log(`📹 Batch video generation request: ${socialPostIds.length} videos`);

    const posts = await db
      .select()
      .from(socialPosts)
      .where(inArray(socialPosts.id, socialPostIds));

    if (posts.length !== socialPostIds.length) {
      const foundIds = new Set(posts.map((p) => p.id));
      const missingIds = socialPostIds.filter((id) => !foundIds.has(id));
      return NextResponse.json({ error: "Some social posts not found", missingIds }, { status: 404 });
    }

    const unauthorizedPosts = posts.filter((p) => p.teamId !== teamId);
    if (unauthorizedPosts.length > 0) {
      return NextResponse.json(
        { error: "Unauthorized: Some posts belong to a different team" },
        { status: 403 }
      );
    }

    const postsWithoutCompany = posts.filter((p) => !p.companyName);
    if (postsWithoutCompany.length > 0) {
      return NextResponse.json(
        {
          error: "Company name is required for video generation",
          postsWithoutCompany: postsWithoutCompany.map((p) => p.id),
          message: "Please add company names to these posts before generating videos.",
        },
        { status: 400 }
      );
    }

    const postsToGenerate = posts.filter(
      (p) => p.videoStatus !== "COMPLETE" && p.videoStatus !== "GENERATING"
    );

    if (postsToGenerate.length === 0) {
      return NextResponse.json({
        success: true,
        message: "All videos are already generated or in progress",
        totalRequested: socialPostIds.length,
        queued: 0,
        skipped: socialPostIds.length,
      });
    }

    console.log(
      `📹 Queueing ${postsToGenerate.length} videos (skipping ${posts.length - postsToGenerate.length} already done/in-progress)`
    );

    const paywallResult = await checkTeamPaywall(teamId);
    if (!paywallResult.allowed) {
      return NextResponse.json(paywallErrorBody(paywallResult), { status: 402 });
    }

    for (const post of postsToGenerate) {
      const creditRunId = randomUUID();
      const reservation = await reserveCredits({
        teamId,
        userId,
        operationType: "video",
        runId: creditRunId,
      });

      if (!reservation.ok) {
        await Promise.all(
          reservations.map((r) =>
            releaseReservation({
              teamId: teamId!,
              runId: r.creditRunId,
              reason: "Batch reserve failed mid-loop",
            }).catch((e) => console.warn(`[billing] batch releaseReservation for post ${r.postId}:`, e))
          )
        );
        reservations.length = 0;

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
            message: `Insufficient credits to generate all ${postsToGenerate.length} videos. Need ${reservation.requiredCredits} per video, have ${reservation.totalRemaining} remaining.`,
            videosReservedBeforeFailure: reservations.length,
          },
          { status: 402 }
        );
      }

      reservations.push({ postId: post.id, creditRunId });
    }

    // Split into chunks
    const chunks: (typeof postsToGenerate)[] = [];
    for (let i = 0; i < postsToGenerate.length; i += CHUNK_SIZE) {
      chunks.push(postsToGenerate.slice(i, i + CHUNK_SIZE));
    }

    console.log(`📦 Split into ${chunks.length} chunks of ${CHUNK_SIZE} videos each`);

    await db
      .update(socialPosts)
      .set({ videoStatus: "GENERATING", videoProgress: 0, videoStage: "queued", updatedAt: new Date() })
      .where(inArray(socialPosts.id, postsToGenerate.map((p) => p.id)));

    let totalQueued = 0;
    const queuedJobIds: string[] = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]!;
      const delayMs = chunkIndex * CHUNK_DELAY_MS;

      for (const post of chunk) {
        const reservation = reservations.find((r) => r.postId === post.id)!;
        const videoType = post.videoType || "slideshow";

        try {
          const jobId = await addVideoGenerationJob(
            { socialPostId: post.id, platform, videoType, teamId, creditRunId: reservation.creditRunId },
            { delayMs }
          );

          if (jobId) {
            queuedJobIds.push(jobId);
            totalQueued++;
            const idx = reservations.findIndex((r) => r.postId === post.id);
            if (idx !== -1) reservations.splice(idx, 1);
          } else {
            throw new Error("BullMQ returned null job ID");
          }
        } catch (queueErr) {
          console.warn(`⚠️ Failed to queue video for post ${post.id}:`, queueErr);
          await releaseReservation({
            teamId,
            runId: reservation.creditRunId,
            reason: `Queue send failed for post ${post.id}`,
          }).catch((e) => console.warn(`[billing] releaseReservation on failed queue send for post ${post.id}:`, e));

          const idx = reservations.findIndex((r) => r.postId === post.id);
          if (idx !== -1) reservations.splice(idx, 1);

          await db
            .update(socialPosts)
            .set({ videoStatus: "FAILED", errorMessage: "Failed to queue video generation job" })
            .where(eq(socialPosts.id, post.id));
        }
      }

      console.log(`✅ Chunk ${chunkIndex + 1}/${chunks.length}: Queued ${chunk.length} videos (delay: ${delayMs}ms)`);
    }

    const estimatedMinutes = Math.ceil(totalQueued / 3) * 3;

    return NextResponse.json({
      success: true,
      message: `Queued ${totalQueued} videos for generation in ${chunks.length} chunks`,
      totalRequested: socialPostIds.length,
      queued: totalQueued,
      skipped: posts.length - postsToGenerate.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
      estimatedTime: `${estimatedMinutes}-${estimatedMinutes + 10} minutes`,
      jobIds: queuedJobIds,
    });
  } catch (error: any) {
    if (reservations.length > 0 && teamId) {
      console.warn(`[billing] batch emergency release: releasing ${reservations.length} stranded reservations`);
      await Promise.all(
        reservations.map((r) =>
          releaseReservation({
            teamId: teamId!,
            runId: r.creditRunId,
            reason: "Unexpected error in batch video route",
          }).catch((e) => console.warn(`[billing] emergency batch releaseReservation for post ${r.postId}:`, e))
        )
      );
    }
    console.error("❌ Batch video generation failed:", error);
    return NextResponse.json(
      {
        error: "Failed to start batch video generation",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: error?.statusCode || 500 }
    );
  }
}
