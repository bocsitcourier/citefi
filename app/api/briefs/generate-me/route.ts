import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyBriefPreferences, teamMembers } from "@/shared/schema";
import { requireAuth } from "@/lib/api/auth";
import { addDailyBriefJob } from "@/lib/queue";
import { eq } from "drizzle-orm";

/** Any authenticated user can trigger their own brief generation */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Get team membership
    const [membership] = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId))
      .limit(1);

    if (!membership) {
      return NextResponse.json(
        { error: "No team found for this user" },
        { status: 400 }
      );
    }

    // Get timezone from preferences
    const [prefs] = await db
      .select()
      .from(dailyBriefPreferences)
      .where(eq(dailyBriefPreferences.userId, userId))
      .limit(1);

    const timezone = prefs?.timezone || "America/New_York";
    const localDate = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    }).format(new Date());

    await addDailyBriefJob({
      userId,
      teamId: membership.teamId,
      localDate,
      force: true,
    });

    return NextResponse.json({
      success: true,
      message: "Brief generation queued. Refresh in 15-30 seconds.",
      localDate,
    });
  } catch (error: any) {
    console.error("Failed to queue self-brief generation:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
