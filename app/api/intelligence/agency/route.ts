import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, clientBrandProfiles } from "@/shared/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";

/**
 * GET /api/intelligence/agency
 * Returns brand-intelligence statuses for all client teams under the current agency.
 * The caller must be an admin of the parent agency team.
 */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);

    // Fetch all client teams under this agency
    const clientTeams = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.parentTeamId, teamId), isNull(teams.deletedAt)));

    if (clientTeams.length === 0) {
      return NextResponse.json({ statuses: {} });
    }

    const clientIds = clientTeams.map((t) => t.id);

    const profiles = await db
      .select({
        teamId: clientBrandProfiles.teamId,
        status: clientBrandProfiles.status,
        companyName: clientBrandProfiles.companyName,
        lastRunAt: clientBrandProfiles.lastRunAt,
      })
      .from(clientBrandProfiles)
      .where(inArray(clientBrandProfiles.teamId, clientIds));

    const statuses: Record<number, { status: string; companyName: string; lastRunAt: string | null }> = {};
    for (const p of profiles) {
      statuses[p.teamId] = {
        status: p.status,
        companyName: p.companyName,
        lastRunAt: p.lastRunAt ? p.lastRunAt.toISOString() : null,
      };
    }

    return NextResponse.json({ statuses });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("GET /api/intelligence/agency error:", err);
    return NextResponse.json({ error: "Failed to load intelligence statuses" }, { status: 500 });
  }
}
