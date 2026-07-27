import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyBriefPreferences, insertDailyBriefPreferenceSchema } from "@/shared/schema";
import { requireAuth } from "@/lib/api/auth";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const [prefs] = await db
      .select()
      .from(dailyBriefPreferences)
      .where(eq(dailyBriefPreferences.userId, userId))
      .limit(1);

    if (!prefs) {
      // Return defaults if no preferences found
      return NextResponse.json({
        cadence: 'daily',
        timezone: 'America/New_York',
        sendHourLocal: 7,
        emailEnabled: 1,
        inAppEnabled: 1,
      });
    }

    return NextResponse.json(prefs);
  } catch (error: any) {
    console.error("Failed to fetch brief preferences:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId, teamId } = await requireAuth(req);
    
    if (!teamId) {
       return NextResponse.json({ error: "User must be assigned to a team" }, { status: 403 });
    }

    const body = await req.json();
    const validated = insertDailyBriefPreferenceSchema.partial().parse(body);

    const [updated] = await db
      .insert(dailyBriefPreferences)
      .values({
        ...validated,
        userId,
        teamId,
      })
      .onConflictDoUpdate({
        target: dailyBriefPreferences.userId,
        set: {
          ...validated,
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Failed to update brief preferences:", error);
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
