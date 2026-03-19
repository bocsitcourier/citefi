import { NextRequest, NextResponse } from "next/server";
import { psychographicService } from "@/lib/psychographic-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    await requireTeamMember(request);

    const presets = await psychographicService.getPresetPersonas();

    return NextResponse.json({
      success: true,
      presets,
    });
  } catch (error: any) {
    console.error("Failed to get preset personas:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to get presets" },
      { status: error?.statusCode || 500 }
    );
  }
}
