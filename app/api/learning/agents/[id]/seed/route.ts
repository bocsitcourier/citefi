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
    const { contentType } = body;

    if (!contentType) {
      return NextResponse.json({ success: false, error: "contentType is required" }, { status: 400 });
    }

    await learningService.seedDefaultPatterns(parseInt(id), teamId, contentType);

    return NextResponse.json({
      success: true,
      message: "Default patterns seeded successfully",
    });
  } catch (error: any) {
    console.error("Failed to seed patterns:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to seed patterns" },
      { status: error?.statusCode || 500 }
    );
  }
}
