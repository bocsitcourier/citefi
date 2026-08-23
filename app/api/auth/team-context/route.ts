import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, teamMembers, sessions } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getTokenFromRequest } from "@/lib/api/auth";
import { hashToken } from "@/lib/auth";
import { z } from "zod";
import { runWithSystemContext } from "@/lib/tenant-context";

const schema = z.object({ teamId: z.number().int().positive() });

/**
 * POST /api/auth/team-context
 * Switch the current session's active team context.
 * The user must be a member of the target team, OR the target team must be a
 * client of an agency team the user admins (agency-admin inheritance).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireTeamMember(req);
    return await runWithSystemContext("validated team-context switch", async () => {
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
        .innerJoin(
          teams,
          and(
            eq(teams.id, teamMembers.teamId),
            isNull(teams.deletedAt),
            eq(teams.clientStatus, "active")
          )
        )
        .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, targetTeamId)))
        .limit(1);

      let authorized = !!directMembership;

    // Check 2: agency-admin inheritance — target team is a client of the user's agency team
      if (!authorized) {
        const [targetTeam] = await db
          .select({ parentTeamId: teams.parentTeamId })
          .from(teams)
          .where(and(
            eq(teams.id, targetTeamId),
            isNull(teams.deletedAt),
            eq(teams.clientStatus, "active")
          ))
          .limit(1);

        if (targetTeam?.parentTeamId) {
        // Check if user is an admin of the parent agency team
          const [agencyMembership] = await db
            .select({ role: teamMembers.role })
            .from(teamMembers)
            .innerJoin(
              teams,
              and(
                eq(teams.id, teamMembers.teamId),
                isNull(teams.deletedAt),
                eq(teams.clientStatus, "active")
              )
            )
            .where(
              and(
                eq(teamMembers.userId, userId),
                eq(teamMembers.teamId, targetTeam.parentTeamId)
              )
            )
            .limit(1);

          if (agencyMembership && ["owner", "admin"].includes(agencyMembership.role)) {
            authorized = true;
          }
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
        .where(and(
          eq(teams.id, targetTeamId),
          isNull(teams.deletedAt),
          eq(teams.clientStatus, "active")
        ))
        .limit(1);

      return NextResponse.json({
        activeTeamId: targetTeamId,
        activeTeam: targetTeam,
        role: directMembership?.role ?? "admin",
      });
    });
  } catch (err: any) {
    if (err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 409) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("[auth/team-context POST]", err);
    return NextResponse.json({ error: "Failed to switch team context" }, { status: err?.statusCode || 500 });
  }
}
