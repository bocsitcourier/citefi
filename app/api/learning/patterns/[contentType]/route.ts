import { NextRequest, NextResponse } from "next/server";
import { learningService } from "@/lib/learning-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contentType: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);

    const { contentType } = await params;
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "20");

    const patterns = await learningService.getTopPatterns(teamId, contentType, limit);

    return NextResponse.json({
      success: true,
      patterns,
    });
  } catch (error: any) {
    console.error("Failed to get patterns:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to get patterns" },
      { status: error?.statusCode || 500 }
    );
  }
}
