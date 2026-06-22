import { NextRequest, NextResponse } from "next/server";
import { getLiveBatchStatus, getBatchPerformanceMetrics } from "@/lib/monitoring";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { jobBatches } from "@/shared/schema";
import { and, eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await params;
    const batchId = parseInt(id);
    
    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    // Enforce team ownership — return 404 (not 403) to prevent batch ID enumeration
    const [batch] = await db
      .select({ id: jobBatches.id })
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)))
      .limit(1);

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    
    const [liveStatus, performanceMetrics] = await Promise.all([
      getLiveBatchStatus(batchId),
      getBatchPerformanceMetrics(batchId),
    ]);
    
    return NextResponse.json({
      liveStatus,
      performanceMetrics,
    });
  } catch (error: any) {
    console.error("Error fetching batch monitoring data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch monitoring data" },
      { status: error?.statusCode || 500 }
    );
  }
}
