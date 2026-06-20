import { NextRequest, NextResponse } from "next/server";
import { getLiveBatchStatus, getBatchPerformanceMetrics } from "@/lib/monitoring";
import { requireTeamMember } from "@/lib/api/auth";

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
