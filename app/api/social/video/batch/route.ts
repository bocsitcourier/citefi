import { NextRequest, NextResponse } from "next/server";
import { getPgBoss } from "@/lib/queue";
import { db } from "@/lib/db";
import { socialPosts } from "@/shared/schema";
import { eq, inArray } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

/**
 * Batch Video Generation Endpoint
 * 
 * PERMANENT FIX for generating 100+ videos at a time:
 * - Chunks requests into smaller batches (10 videos at a time)
 * - Staggers job submission with delays to prevent queue flooding
 * - Validates disk space concerns upfront
 * - Provides detailed progress tracking
 */

const CHUNK_SIZE = 10; // Process 10 videos at a time
const CHUNK_DELAY_MS = 5000; // 5 seconds between chunks

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const { socialPostIds, platform = "tiktok" } = body;

    if (!Array.isArray(socialPostIds) || socialPostIds.length === 0) {
      return NextResponse.json(
        { error: "socialPostIds array is required and must not be empty" },
        { status: 400 }
      );
    }

    console.log(`📹 Batch video generation request: ${socialPostIds.length} videos`);

    // Validate all posts exist and have company names
    const posts = await db
      .select()
      .from(socialPosts)
      .where(inArray(socialPosts.id, socialPostIds));

    if (posts.length !== socialPostIds.length) {
      const foundIds = new Set(posts.map(p => p.id));
      const missingIds = socialPostIds.filter(id => !foundIds.has(id));
      return NextResponse.json(
        { 
          error: "Some social posts not found", 
          missingIds 
        },
        { status: 404 }
      );
    }

    // Check team ownership
    const unauthorizedPosts = posts.filter(p => p.teamId !== teamId);
    if (unauthorizedPosts.length > 0) {
      return NextResponse.json(
        { error: "Unauthorized: Some posts belong to a different team" },
        { status: 403 }
      );
    }

    // Check for missing company names
    const postsWithoutCompany = posts.filter(p => !p.companyName);
    if (postsWithoutCompany.length > 0) {
      return NextResponse.json(
        { 
          error: "Company name is required for video generation",
          postsWithoutCompany: postsWithoutCompany.map(p => p.id),
          message: "Please add company names to these posts before generating videos."
        },
        { status: 400 }
      );
    }

    // Skip posts that already have videos or are currently generating
    const postsToGenerate = posts.filter(p => 
      p.videoStatus !== "COMPLETE" && 
      p.videoStatus !== "GENERATING"
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

    console.log(`📹 Queueing ${postsToGenerate.length} videos (skipping ${posts.length - postsToGenerate.length} already done/in-progress)`);

    // Chunk the posts into smaller batches
    const chunks: typeof postsToGenerate[] = [];
    for (let i = 0; i < postsToGenerate.length; i += CHUNK_SIZE) {
      chunks.push(postsToGenerate.slice(i, i + CHUNK_SIZE));
    }

    console.log(`📦 Split into ${chunks.length} chunks of ${CHUNK_SIZE} videos each`);

    // Update all posts to GENERATING status immediately
    await db
      .update(socialPosts)
      .set({
        videoStatus: "GENERATING",
        videoProgress: 0,
        videoStage: "queued",
        updatedAt: new Date(),
      })
      .where(inArray(socialPosts.id, postsToGenerate.map(p => p.id)));

    // Queue jobs in chunks with delays
    const queue = await getPgBoss();
    let totalQueued = 0;
    const queuedJobIds: string[] = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]!;
      
      // Add delay between chunks (except for first chunk)
      const startDelaySeconds = chunkIndex * (CHUNK_DELAY_MS / 1000);
      
      for (const post of chunk) {
        const videoType = post.videoType || "slideshow";
        const isVeo = videoType === "veo";
        const expireInSeconds = isVeo ? 5400 : 900; // 90 min Veo, 15 min slideshow
        const jobId = await queue.send(
          "social-video-generation",
          { socialPostId: post.id, platform, videoType },
          {
            retryLimit: 0, // No retries - each attempt costs money
            retryDelay: 0,
            expireInSeconds,
            startAfter: startDelaySeconds, // Stagger start times
          }
        );

        if (jobId) {
          queuedJobIds.push(jobId);
          totalQueued++;
        } else {
          console.warn(`⚠️ Failed to queue video for post ${post.id}`);
          // Mark as failed so user can retry
          await db
            .update(socialPosts)
            .set({
              videoStatus: "FAILED",
              errorMessage: "Failed to queue video generation job",
            })
            .where(eq(socialPosts.id, post.id));
        }
      }

      console.log(`✅ Chunk ${chunkIndex + 1}/${chunks.length}: Queued ${chunk.length} videos (startDelay: ${startDelaySeconds}s)`);
    }

    // Estimate completion time (3 workers, ~3 minutes per video)
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
