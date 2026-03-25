import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialPosts } from "@/shared/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { socialPostId } = await request.json();

    if (!socialPostId || typeof socialPostId !== "number") {
      return NextResponse.json({ error: "socialPostId is required" }, { status: 400 });
    }

    const [post] = await db
      .select({ id: socialPosts.id, videoStatus: socialPosts.videoStatus })
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId))
      .limit(1);

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.videoStatus !== "GENERATING" && post.videoStatus !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot cancel a job with status: ${post.videoStatus}` },
        { status: 400 }
      );
    }

    await db
      .update(socialPosts)
      .set({
        videoStatus: "FAILED",
        videoProgress: 0,
        videoStage: null,
        errorMessage: "Cancelled by user",
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, socialPostId));

    console.log(`🛑 Video generation cancelled by user for social post ${socialPostId}`);

    return NextResponse.json({ success: true, message: "Video generation cancelled" });
  } catch (error) {
    console.error("❌ Failed to cancel video generation:", error);
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
