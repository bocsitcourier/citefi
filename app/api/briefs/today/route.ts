import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyBriefs } from "@/shared/schema";
import { requireAuth } from "@/lib/api/auth";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const today = new Date().toISOString().slice(0, 10);

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
      return NextResponse.json({ available: false });
    }

    return NextResponse.json({
      available: true,
      brief: brief.sectionsJson,
      id: brief.id
    });
  } catch (error: any) {
    console.error("Failed to fetch today's brief:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
