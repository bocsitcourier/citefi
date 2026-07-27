import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyBriefs } from "@/shared/schema";
import { requireAuth } from "@/lib/api/auth";
import { eq, and } from "drizzle-orm";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await context.params;
    const briefId = parseInt(id, 10);

    if (isNaN(briefId)) {
      return NextResponse.json({ error: "Invalid brief ID" }, { status: 400 });
    }

    const [updated] = await db
      .update(dailyBriefs)
      .set({ viewedAt: new Date() })
      .where(and(eq(dailyBriefs.id, briefId), eq(dailyBriefs.userId, userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }

  return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to mark brief as viewed:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
