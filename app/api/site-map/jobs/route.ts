import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { siteCrawlJobs } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const jobs = await db.select().from(siteCrawlJobs)
      .where(eq(siteCrawlJobs.teamId, teamId))
      .orderBy(desc(siteCrawlJobs.createdAt));

    return NextResponse.json(jobs);
  } catch (error: any) {
    console.error("Error fetching crawl jobs:", error);
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { error: error?.message || "Failed to fetch crawl jobs" },
      { status: statusCode }
    );
  }
}
