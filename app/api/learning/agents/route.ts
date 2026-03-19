import { NextRequest, NextResponse } from "next/server";
import { learningService } from "@/lib/learning-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    await learningService.initializeDefaultAgents(teamId);
    const stats = await learningService.getAgentStats(teamId);

    return NextResponse.json({
      success: true,
      agents: stats.agents,
    });
  } catch (error) {
    console.error("Failed to get learning agents:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get learning agents" },
      { status: 500 }
    );
  }
}
