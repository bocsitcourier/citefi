import { NextRequest, NextResponse } from "next/server";
import { ContentType } from "@/shared/schema";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    await requireTeamMember(request);

    return NextResponse.json({
      success: true,
      contentTypes: Object.values(ContentType),
    });
  } catch (error: any) {
    console.error("Failed to get content types:", error);
    const statusCode = error?.statusCode || 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get content types" },
      { status: statusCode }
    );
  }
}
