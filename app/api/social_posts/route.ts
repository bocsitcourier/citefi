import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { socialPosts, socialPostVariants } from "@/shared/schema";
import { desc, ne, and, eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    console.log("📊 GET /api/social_posts - Starting...");
    
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);
    console.log(`📊 Authenticated with teamId: ${teamId}`);

    // Fetch variants with parent post data for dashboard display
    // Each variant represents one platform-specific post
    const variants = await db
      .select({
        // Variant fields
        id: socialPostVariants.id,
        socialPostId: socialPostVariants.socialPostId,
        platform: socialPostVariants.platform,
        caption: socialPostVariants.caption,
        hashtagsJson: socialPostVariants.hashtagsJson,
        status: socialPostVariants.status,
        imageUrl: socialPostVariants.imageUrl,
        createdAt: socialPostVariants.createdAt,
        // Parent post fields for context
        title: socialPosts.title,
        topic: socialPosts.topic,
        location: socialPosts.location,
        userId: socialPosts.userId,
        articleId: socialPosts.articleId,
        videoStatus: socialPosts.videoStatus,
        videoUrl: socialPosts.videoUrl,
        // scheduleAt is on parent socialPosts table
        scheduleAt: socialPosts.scheduleAt,
      })
      .from(socialPostVariants)
      .innerJoin(socialPosts, eq(socialPostVariants.socialPostId, socialPosts.id))
      .where(
        and(
          ne(socialPosts.status, "DELETED"),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      )
      .orderBy(desc(socialPostVariants.createdAt));

    console.log(`📊 Found ${variants.length} social post variants`);
    return NextResponse.json(variants);
  } catch (error: any) {
    console.error("Failed to fetch social posts:", error);
    console.error("Stack trace:", error?.stack);
    
    // Return proper status code for auth errors
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch social posts" },
      { status: statusCode }
    );
  }
}
