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
    await learningService.optimizeAgent(teamId, parseInt(id));

    return NextResponse.json({
      success: true,
      message: "Agent optimized successfully",
    });
  } catch (error: any) {
    console.error("Failed to optimize agent:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to optimize agent" },
      { status: error?.statusCode || 500 }
    );
  }
}
