import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyBriefs, dailyBriefPreferences } from "@/shared/schema";
import { requireAuth } from "@/lib/api/auth";
import { eq, and } from "drizzle-orm";

/** Compute YYYY-MM-DD in the user's local timezone */
function getLocalDateForTz(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Resolve the user's local date from their timezone preference
    const [prefs] = await db
      .select()
      .from(dailyBriefPreferences)
      .where(eq(dailyBriefPreferences.userId, userId))
      .limit(1);

    const timezone = prefs?.timezone || "America/New_York";
    const today = getLocalDateForTz(timezone);

    const [brief] = await db
      .select()
      .from(dailyBriefs)
      .where(
        and(
          eq(dailyBriefs.userId, userId),
          eq(dailyBriefs.localDate, today),
          eq(dailyBriefs.status, 'generated')
        )
      )
      .limit(1);

    if (!brief) {
      return NextResponse.json({ available: false, localDate: today });
    }

    return NextResponse.json({
      available: true,
      brief: brief.sectionsJson,
      id: brief.id,
      localDate: today,
      generatedAt: brief.generatedAt,
      todayFocusType: brief.todayFocusType,
      sourceMetrics: brief.sourceMetricsJson,
    });
  } catch (error: any) {
    console.error("Failed to fetch today's brief:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
