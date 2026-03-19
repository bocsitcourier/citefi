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
    const industry = searchParams.get("industry") || undefined;
    const audience = searchParams.get("audience") || undefined;

    const context = await learningService.getOptimizationContext(teamId, contentType, {
      industry,
      audience,
    });

    if (!context) {
      return NextResponse.json(
        { success: false, error: "No learning agent found for this content type" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      optimization: context,
    });
  } catch (error: any) {
    console.error("Failed to get optimization context:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to get optimization context" },
      { status: error?.statusCode || 500 }
    );
  }
}
