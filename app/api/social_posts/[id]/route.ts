import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { 
  socialPosts, 
  socialPostLogs, 
  socialPostVariants,
  socialPostAssets,
  socialPostJobs
} from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { requireTeamMember, requireTeamResource } from "@/lib/api/auth";

const updateSocialPostSchema = z.object({
  topic: z.string().optional(),
  title: z.string().optional(),
  companyName: z.string().optional(),
  companyLogoUrl: z.string().optional().or(z.literal("")),
  location: z.string().optional(),
  tone: z.string().optional(),
  mood: z.string().optional(),
  industry: z.string().optional(),
  landingPageUrl: z.string().url().optional().or(z.literal("")),
  userEmail: z.string().email().optional().or(z.literal("")),
  status: z.string().optional(),
});

const scheduleSocialPostSchema = z.object({
  scheduleAt: z.string().datetime(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await params;
    const postId = parseInt(id);

    // CRITICAL: Check if post exists AND belongs to user's team
    const [post] = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.id, postId),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!post) {
      return NextResponse.json(
        { error: "Social post not found or access denied" },
        { status: 404 }
      );
    }
    requireTeamResource(post.teamId, teamId);

    // Fetch all platform variants for this post
    const variants = await db
      .select()
      .from(socialPostVariants)
      .where(eq(socialPostVariants.socialPostId, postId));

    return NextResponse.json({ ...post, variants });
  } catch (error: any) {
    console.error("Error fetching social post:", error);
    return NextResponse.json(
      { error: "Failed to fetch social post" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await params;
    const postId = parseInt(id);
    const body = await request.json();
    const validatedData = updateSocialPostSchema.parse(body);

    // CRITICAL: Verify post exists AND belongs to user's team
    const [existingPost] = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.id, postId),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!existingPost) {
      return NextResponse.json(
        { error: "Social post not found or access denied" },
        { status: 404 }
      );
    }
    requireTeamResource(existingPost.teamId, teamId);

    const updateData: any = { updatedAt: new Date() };
    if (validatedData.topic !== undefined) updateData.topic = validatedData.topic;
    if (validatedData.title !== undefined) updateData.title = validatedData.title;
    if (validatedData.companyName !== undefined) updateData.companyName = validatedData.companyName;
    if (validatedData.companyLogoUrl !== undefined) updateData.companyLogoUrl = validatedData.companyLogoUrl || null;
    if (validatedData.location !== undefined) updateData.location = validatedData.location;
    if (validatedData.tone !== undefined) updateData.tone = validatedData.tone;
    if (validatedData.mood !== undefined) updateData.mood = validatedData.mood;
    if (validatedData.industry !== undefined) updateData.industry = validatedData.industry;
    if (validatedData.landingPageUrl !== undefined) updateData.landingPageUrl = validatedData.landingPageUrl || null;
    if (validatedData.userEmail !== undefined) updateData.userEmail = validatedData.userEmail || null;
    if (validatedData.status !== undefined) updateData.status = validatedData.status;

    const [updatedPost] = await db
      .update(socialPosts)
      .set(updateData)
      .where(eq(socialPosts.id, postId))
      .returning();

    await db.insert(socialPostLogs).values({
      socialPostId: postId,
      eventType: "EDIT",
      stage: "API",
      message: "Post updated via API",
      severity: "info",
      payloadJson: validatedData,
    });

    return NextResponse.json({ success: true, post: updatedPost });
  } catch (error: any) {
    console.error("Error updating social post:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update social post" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await params;
    const postId = parseInt(id);
    const body = await request.json();
    const validatedData = scheduleSocialPostSchema.parse(body);

    // CRITICAL: Verify post exists AND belongs to user's team
    const [existingPost] = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.id, postId),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!existingPost) {
      return NextResponse.json(
        { error: "Social post not found" },
        { status: 404 }
      );
    }
    requireTeamResource(existingPost.teamId, teamId);

    const [updatedPost] = await db
      .update(socialPosts)
      .set({
        scheduleAt: new Date(validatedData.scheduleAt),
        status: "SCHEDULED",
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, postId))
      .returning();

    await db.insert(socialPostLogs).values({
      socialPostId: postId,
      eventType: "SCHEDULED",
      stage: "API",
      message: `Post scheduled for ${validatedData.scheduleAt}`,
      severity: "info",
      payloadJson: { scheduleAt: validatedData.scheduleAt },
    });

    return NextResponse.json({ success: true, post: updatedPost });
  } catch (error: any) {
    console.error("Error scheduling social post:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to schedule social post" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await params;
    const postId = parseInt(id);

    // CRITICAL: Verify post exists AND belongs to user's team
    const [existingPost] = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.id, postId),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!existingPost) {
      return NextResponse.json(
        { error: "Social post not found or access denied" },
        { status: 404 }
      );
    }
    requireTeamResource(existingPost.teamId, teamId);

    // HARD DELETE: Remove post and all related records in correct cascade order
    // This matches the behavior of batch-delete endpoint for consistency
    
    // CRITICAL: Delete in correct cascade order to avoid FK violations
    // 1. Delete social post logs (depends on social_posts)
    await db.delete(socialPostLogs).where(eq(socialPostLogs.socialPostId, postId));
    
    // 2. Delete social post variants (depends on social_posts)
    await db.delete(socialPostVariants).where(eq(socialPostVariants.socialPostId, postId));
    
    // 3. Delete social post assets (depends on social_posts)
    await db.delete(socialPostAssets).where(eq(socialPostAssets.socialPostId, postId));
    
    // 4. Delete social post jobs (depends on social_posts)
    await db.delete(socialPostJobs).where(eq(socialPostJobs.socialPostId, postId));

    // 5. Delete social post (now safe - ALL children removed)
    await db.delete(socialPosts).where(eq(socialPosts.id, postId));

    return NextResponse.json({ 
      success: true,
      message: "Post and all related data deleted",
    });
  } catch (error: any) {
    console.error("Error deleting social post:", error);
    return NextResponse.json(
      { error: "Failed to delete social post" },
      { status: error?.statusCode || 500 }
    );
  }
}
