import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { LearningService } from "@/lib/learning-service";

/**
 * GET /api/intelligence/competitive-patterns?contentType=social|video|podcast
 *
 * Returns current external patterns and their validation status for the team.
 */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const contentType = req.nextUrl.searchParams.get("contentType") || "social";

    const learningService = LearningService.getInstance();
    const patterns = await learningService.getExternalPatterns(teamId, contentType);

    return NextResponse.json({ patterns });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("GET /api/intelligence/competitive-patterns error:", err);
    return NextResponse.json({ error: "Failed to fetch competitive patterns" }, { status: 500 });
  }
}
