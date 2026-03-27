import { NextRequest, NextResponse } from "next/server";
import { getPgBoss } from "@/lib/queue";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { socialPosts } from "@/shared/schema";
import { and, eq } from "drizzle-orm";

const CONN_ERROR_PATTERNS = ["connection terminated", "connection refused", "ECONNRESET", "ECONNREFUSED", "fetch failed"];
function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return CONN_ERROR_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()));
}

/** Queue send with up to 2 retries + jitter on transient connection failures. */
async function resilientSend(
  queueName: string,
  data: object,
  opts: object,
  socialPostId: number
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const boss = await getPgBoss();
      const jobId = await boss.send(queueName, data, opts);
      if (!jobId) throw new Error("pg-boss returned null — queue may be full or unhealthy");
      return jobId;
    } catch (err) {
      lastErr = err;
      if (isConnectionError(err) && attempt < MAX_ATTEMPTS) {
        const jitter = Math.floor(Math.random() * 500) + 500 * attempt;
        console.warn(`⚠️ send() attempt ${attempt} failed (connection), retrying in ${jitter}ms…`);
        await new Promise((r) => setTimeout(r, jitter));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    const { socialPostId, platform = "tiktok", videoType = "slideshow", force = false } = body;

    if (!socialPostId) {
      return NextResponse.json({ error: "socialPostId is required" }, { status: 400 });
    }

    if (videoType !== "slideshow" && videoType !== "veo") {
      return NextResponse.json({ error: "videoType must be 'slideshow' or 'veo'" }, { status: 400 });
    }

    // Fetch post — scoped to this team to prevent cross-team access
    const [post] = await db
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)))
      .limit(1);

    if (!post) {
      return NextResponse.json({ error: "Social post not found" }, { status: 404 });
    }

    if (!post.companyName) {
      return NextResponse.json(
        {
          error: "Company name is required for video generation",
          message: "Please edit this post to add your company name before generating a video.",
        },
        { status: 400 }
      );
    }

    if (post.videoStatus === "GENERATING" && !force) {
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

    if (post.videoStatus === "GENERATING" && force) {
      console.log(`🔄 Force-reset requested for stuck video on social post ${socialPostId}`);
    }

    const isVeo = videoType === "veo";
    const timeEstimate = isVeo ? "60-80 minutes" : "2-3 minutes";
    console.log(`📹 Queueing ${isVeo ? "Veo AI" : "slideshow"} video generation for Social Post ${socialPostId}`);

    // Mark GENERATING immediately (prevents double-clicks)
    await db
      .update(socialPosts)
      .set({ videoType, videoStatus: "GENERATING", videoProgress: 0, videoStage: "queued", updatedAt: new Date() })
      .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)));

    console.log(`✅ Video status set to GENERATING (progress: 0%, stage: queued)`);

    // Queue with retries — rolls back to FAILED on any unrecoverable error
    const expireInSeconds = isVeo ? 5400 : 900;
    let jobId: string;
    try {
      jobId = await resilientSend(
        "social-video-generation",
        { socialPostId, platform, videoType },
        { retryLimit: 0, retryDelay: 0, expireInSeconds },
        socialPostId
      );
    } catch (sendError) {
      const errMsg = sendError instanceof Error ? sendError.message : String(sendError);
      console.error(`❌ pg-boss.send() failed for post ${socialPostId}:`, errMsg);
      await db
        .update(socialPosts)
        .set({ videoStatus: "FAILED", videoProgress: 0, videoStage: null, errorMessage: `Failed to queue video job: ${errMsg}` })
        .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamId)));
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
  } catch (error) {
    console.error("❌ Failed to queue video generation:", error);
    return NextResponse.json(
      {
        error: "Failed to start video generation",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
