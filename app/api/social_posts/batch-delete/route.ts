import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { 
  socialPosts, 
  socialPostLogs, 
  socialPostVariants, 
  socialPostAssets, 
  socialPostJobs 
} from "@/shared/schema";
import { inArray, and, eq } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

const batchDeleteSchema = z.object({
  postIds: z.array(z.number()).min(1),
});

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const { postIds } = batchDeleteSchema.parse(body);

    // CRITICAL: Verify all posts belong to user's team before deletion
    const postsToDelete = await db
      .select({ id: socialPosts.id })
      .from(socialPosts)
      .where(
        and(
          inArray(socialPosts.id, postIds),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      );

    const verifiedPostIds = postsToDelete.map(p => p.id);

    if (verifiedPostIds.length === 0) {
      return NextResponse.json({
        error: "No posts found or access denied"
      }, { status: 404 });
    }

    // CRITICAL: Delete in correct cascade order to avoid FK violations
    // 1. Delete social post logs (depends on social_posts)
    await db.delete(socialPostLogs).where(
      inArray(socialPostLogs.socialPostId, verifiedPostIds)
    );
    
    // 2. Delete social post variants (depends on social_posts)
    await db.delete(socialPostVariants).where(
      inArray(socialPostVariants.socialPostId, verifiedPostIds)
    );
    
    // 3. Delete social post assets (depends on social_posts)
    await db.delete(socialPostAssets).where(
      inArray(socialPostAssets.socialPostId, verifiedPostIds)
    );
    
    // 4. Delete social post jobs (depends on social_posts)
    await db.delete(socialPostJobs).where(
      inArray(socialPostJobs.socialPostId, verifiedPostIds)
    );

    // 5. Delete social posts (now safe - ALL children removed)
    await db.delete(socialPosts).where(inArray(socialPosts.id, verifiedPostIds));

    return NextResponse.json({ 
      success: true,
      deletedCount: verifiedPostIds.length
    });
  } catch (error: any) {
    console.error("Error batch deleting social posts:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to batch delete social posts" },
      { status: error?.statusCode || 500 }
    );
  }
}
