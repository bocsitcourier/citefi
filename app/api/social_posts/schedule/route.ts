import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { socialPosts, socialPostLogs } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

const scheduleSchema = z.object({
  socialPostId: z.number(),
  scheduleAt: z.string().datetime(),
});

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const { socialPostId, scheduleAt } = scheduleSchema.parse(body);

    // CRITICAL: Verify post exists AND belongs to user's team
    const [existingPost] = await db
      .select()
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.id, socialPostId),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!existingPost) {
      return NextResponse.json(
        { error: "Social post not found or access denied" },
        { status: 404 }
      );
    }

    const [updatedPost] = await db
      .update(socialPosts)
      .set({ 
        scheduleAt: new Date(scheduleAt),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(socialPosts.id, socialPostId),
          eq(socialPosts.teamId, teamId) // TEAM ISOLATION
        )
      )
      .returning();

    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "SCHEDULED",
      stage: "API",
      message: `Post scheduled for ${scheduleAt}`,
      severity: "info",
      payloadJson: { scheduleAt },
    });

    return NextResponse.json({ 
      success: true, 
      post: updatedPost,
      message: `Post scheduled for ${scheduleAt}`
    });
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
