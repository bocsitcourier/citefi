import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    // CRITICAL: Fetch batches filtered by team_id
    const batches = await db
      .select()
      .from(jobBatches)
      .where(eq(jobBatches.teamId, teamId)) // TEAM ISOLATION
      .orderBy(desc(jobBatches.createdAt));

    return NextResponse.json(
      batches.map(batch => ({
        id: batch.id,
        coreTopic: batch.coreTopic,
        status: batch.status,
        numArticlesRequested: batch.numArticlesRequested,
        createdAt: batch.createdAt,
      }))
    );
  } catch (error: any) {
    console.error("Error fetching batches:", error);
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch batches" },
      { status: statusCode }
    );
  }
}
