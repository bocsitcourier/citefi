import { NextRequest, NextResponse } from "next/server";
import { psychographicService } from "@/lib/psychographic-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    await psychographicService.initializeDefaultPersonas(teamId);

    const personas = await psychographicService.getTeamPersonas(teamId);

    return NextResponse.json({
      success: true,
      message: "Default personas initialized",
      personas,
    });
  } catch (error: any) {
    console.error("Failed to initialize personas:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to initialize personas" },
      { status: error?.statusCode || 500 }
    );
  }
}
