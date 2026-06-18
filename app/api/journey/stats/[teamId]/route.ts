/**
 * GET /api/journey/stats/[teamId]
 * Returns team-level journey funnel stats + top cohort recommendations.
 * Requires team membership; cross-team access requires global admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { getJourneyStats } from "@/lib/journey-orchestrator-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId: authTeamId } = await requireTeamMember(req);

    const { teamId: teamIdStr } = await params;
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) {
      return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
    }

    if (authTeamId !== teamId) {
      try {
        await requireAdmin(req);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const stats = await getJourneyStats(teamId);
    return NextResponse.json(stats);
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status ?? 500;
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status }
    );
  }
}
