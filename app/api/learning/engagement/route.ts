import { NextRequest, NextResponse } from "next/server";
import { learningService } from "@/lib/learning-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const { metricId, views, clicks, shares, likes, comments, timeOnPage, bounceRate } = body;

    if (typeof metricId !== "number") {
      return NextResponse.json({ success: false, error: "metricId is required" }, { status: 400 });
    }

    await learningService.recordEngagement(teamId, metricId, {
      views,
      clicks,
      shares,
      likes,
      comments,
      timeOnPage,
      bounceRate,
    });

    return NextResponse.json({
      success: true,
      message: "Engagement recorded",
    });
  } catch (error) {
    console.error("Failed to record engagement:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to record engagement" },
      { status: 500 }
    );
  }
}
