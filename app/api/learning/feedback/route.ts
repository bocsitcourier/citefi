import { NextRequest, NextResponse } from "next/server";
import { learningService } from "@/lib/learning-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const { metricId, isSuccess, reason } = body;

    if (typeof metricId !== "number" || typeof isSuccess !== "boolean") {
      return NextResponse.json(
        { success: false, error: "metricId (number) and isSuccess (boolean) are required" },
        { status: 400 }
      );
    }

    await learningService.markContentSuccess(teamId, metricId, isSuccess, reason);

    return NextResponse.json({
      success: true,
      message: "Feedback recorded and learning updated",
    });
  } catch (error: any) {
    console.error("Failed to record feedback:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to record feedback" },
      { status: error?.statusCode || 500 }
    );
  }
}
