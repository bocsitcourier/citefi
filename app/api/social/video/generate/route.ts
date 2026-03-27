import { NextRequest, NextResponse } from "next/server";
import { getPgBoss } from "@/lib/queue";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    const { socialPostId, platform = "tiktok", videoType = "slideshow", force = false } = body;

    if (!socialPostId) {
      return NextResponse.json(
        { error: "socialPostId is required" },
        { status: 400 }
      );
    }

    // Validate videoType
    if (videoType !== "slideshow" && videoType !== "veo") {
      return NextResponse.json(
        { error: "videoType must be 'slideshow' or 'veo'" },
        { status: 400 }
      );
    }

    // Validate that the social post has a company name
    const { db } = await import("@/lib/db");
    const { socialPosts } = await import("@/shared/schema");
    const { eq } = await import("drizzle-orm");
    
    const [post] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId))
      .limit(1);

    if (!post) {
      return NextResponse.json(
        { error: "Social post not found" },
        { status: 404 }
      );
    }

    if (!post.companyName) {
      return NextResponse.json(
        { 
          error: "Company name is required for video generation",
          message: "Please edit this post to add your company name before generating a video."
        },
        { status: 400 }
      );
    }

    // Prevent duplicate queue — unless the caller explicitly forces a retry
    // (used by the "Stuck? Retry" button for stuck GENERATING jobs).
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

    // CRITICAL: Update status IMMEDIATELY before queuing to fix double-click issue
    await db
      .update(socialPosts)
      .set({
        videoType,
        videoStatus: "GENERATING",
        videoProgress: 0,
        videoStage: "queued",
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, socialPostId));

    console.log(`✅ Video status set to GENERATING (progress: 0%, stage: queued)`);

    // Queue the video generation job
    const queue = await getPgBoss();
    console.log(`📋 pg-boss instance obtained, attempting to send job...`);
    
    // Increase timeout for Veo videos (60-80 min) vs slideshow (2-3 min)
    const expireInSeconds = isVeo ? 5400 : 900; // 90 min for Veo, 15 min for slideshow
    
    let jobId: string | null = null;
    try {
      jobId = await queue.send(
        "social-video-generation",
        { socialPostId, platform, videoType },
        {
          retryLimit: 0, // No retries - each attempt costs money
          retryDelay: 0,
          expireInSeconds,
        }
      );
    } catch (sendError) {
      console.error(`❌ pg-boss.send() threw an error for post ${socialPostId}:`, sendError);
      await db
        .update(socialPosts)
        .set({ videoStatus: "FAILED", videoProgress: 0, videoStage: null,
               errorMessage: `Failed to queue video job: ${sendError instanceof Error ? sendError.message : String(sendError)}` })
        .where(eq(socialPosts.id, socialPostId));
      throw sendError; // re-throw so outer catch returns 500 with real message
    }

    if (!jobId) {
      console.error(`❌ CRITICAL: pg-boss.send() returned NULL for post ${socialPostId}`);
      await db
        .update(socialPosts)
        .set({ videoStatus: "FAILED", videoProgress: 0, videoStage: null,
               errorMessage: "Failed to queue job — pg-boss returned null" })
        .where(eq(socialPosts.id, socialPostId));
      throw new Error("Video job queue rejected the request (pg-boss returned null). Check queue health.");
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
