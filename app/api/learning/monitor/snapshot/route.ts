import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { learningMonitorService } from "@/lib/learning-monitor-service";

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { searchParams } = new URL(request.url);
    const contentType = searchParams.get("contentType") || undefined;
    const snapshot = await learningMonitorService.snapshot(teamId, contentType);
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error: any) {
    if (error.message === "Unauthorized" || error.message?.includes("auth")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Learning monitor snapshot error:", error);
    return NextResponse.json({ error: "Failed to load monitor snapshot" }, { status: error?.statusCode || 500 });
  }
}
