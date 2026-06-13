import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, teamMembers, sessions } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getTokenFromRequest } from "@/lib/api/auth";
import { hashToken } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({ teamId: z.number().int().positive() });

/**
 * POST /api/auth/team-context
 * Switch the current session's active team context.
 * The user must be a member of the target team, OR the target team must be a
 * client of an agency team the user admins (agency-admin inheritance).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, teamId: currentTeamId } = await requireTeamMember(req);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const targetTeamId = parsed.data.teamId;

    // Check 1: direct membership in target team
    const [directMembership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, targetTeamId)))
      .limit(1);

    let authorized = !!directMembership;

    // Check 2: agency-admin inheritance — target team is a client of the user's agency team
    if (!authorized) {
      const [targetTeam] = await db
        .select({ parentTeamId: teams.parentTeamId })
        .from(teams)
        .where(and(eq(teams.id, targetTeamId), isNull(teams.deletedAt)))
        .limit(1);

      if (targetTeam?.parentTeamId) {
        // Check if user is an admin of the parent agency team
        const [agencyMembership] = await db
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.userId, userId),
              eq(teamMembers.teamId, targetTeam.parentTeamId)
            )
          )
          .limit(1);

        if (agencyMembership?.role === "admin") authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "Access denied to requested team" }, { status: 403 });
    }

    // Update the session's teamContextId
    const token = getTokenFromRequest(req);
    if (!token) return NextResponse.json({ error: "No session token" }, { status: 401 });

    const tokenHash = hashToken(token);
    await db
      .update(sessions)
      .set({ teamContextId: targetTeamId })
      .where(eq(sessions.tokenHash, tokenHash));

    const [targetTeam] = await db
      .select({ id: teams.id, name: teams.name, billingPlan: teams.billingPlan, parentTeamId: teams.parentTeamId })
      .from(teams)
      .where(eq(teams.id, targetTeamId))
      .limit(1);

    return NextResponse.json({
      activeTeamId: targetTeamId,
      activeTeam: targetTeam,
      role: directMembership?.role ?? "admin",
    });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[auth/team-context POST]", err);
    return NextResponse.json({ error: "Failed to switch team context" }, { status: 500 });
  }
}
