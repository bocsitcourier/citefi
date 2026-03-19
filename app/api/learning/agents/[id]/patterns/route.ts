import { NextRequest, NextResponse } from "next/server";
import { learningService } from "@/lib/learning-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);

    const { id } = await params;
    const body = await request.json();
    const { patternType, patternName, patternValue, industry, audience } = body;

    if (!patternType || !patternName || !patternValue) {
      return NextResponse.json(
        { success: false, error: "patternType, patternName, and patternValue are required" },
        { status: 400 }
      );
    }

    const patternId = await learningService.addPattern(parseInt(id), teamId, {
      patternType,
      patternName,
      patternValue,
      industry,
      audience,
    });

    return NextResponse.json({
      success: true,
      patternId,
    });
  } catch (error: any) {
    console.error("Failed to add pattern:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to add pattern" },
      { status: error?.statusCode || 500 }
    );
  }
}
