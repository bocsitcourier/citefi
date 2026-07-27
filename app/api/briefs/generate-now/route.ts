import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamMembers } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { addDailyBriefJob } from "@/lib/queue";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json();
    const { teamId } = body;

    if (!teamId) {
      return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    }

    const members = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));

    const today = new Date().toISOString().slice(0, 10);
    let count = 0;

    for (const member of members) {
      await addDailyBriefJob({
        userId: member.userId,
        teamId: teamId,
        localDate: today,
        force: true
      });
      count++;
    }

    return NextResponse.json({ 
      success: true, 
      message: `Enqueued daily brief jobs for ${count} users.`,
      count 
    });
  } catch (error: any) {
    console.error("Failed to generate briefs now:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
