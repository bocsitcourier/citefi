import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, teams, teamMembers } from "@/shared/schema";
import { verifyToken, AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { eq, and, isNull } from "drizzle-orm";

/** Clear the auth cookie from a response so stale/orphan tokens are wiped on the next 401. */
function clearAuthCookie(res: NextResponse): NextResponse {
  res.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await verifyToken(req);

    if (!authResult) {
      return clearAuthCookie(
        NextResponse.json(
          { error: "Unauthorized - Invalid or expired session" },
          { status: 401 }
        )
      );
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        profilePictureUrl: users.profilePictureUrl,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorMethod: users.twoFactorMethod,
        emailVerified: users.emailVerified,
        accountStatus: users.accountStatus,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        defaultTeamId: users.defaultTeamId,
      })
      .from(users)
      .where(eq(users.id, authResult.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.accountStatus !== "active") {
      return NextResponse.json({ error: "Account is not active" }, { status: 403 });
    }

    // Load all teams the user directly belongs to
    const directMemberships = await db
      .select({
        teamId: teamMembers.teamId,
        role: teamMembers.role,
        teamName: teams.name,
        billingPlan: teams.billingPlan,
        parentTeamId: teams.parentTeamId,
        clientStatus: teams.clientStatus,
      })
      .from(teamMembers)
      .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), isNull(teams.deletedAt)))
      .where(eq(teamMembers.userId, authResult.userId));

    // For each team where the user is an admin AND is an agency (billingPlan='agency'),
    // also load their client teams so the team switcher can populate them.
    const agencyTeamIds = directMemberships
      .filter((m) => m.role === "admin" && m.billingPlan === "agency")
      .map((m) => m.teamId);

    let clientTeams: Array<{ teamId: number; teamName: string; parentTeamId: number | null; clientStatus: string }> = [];
    for (const agencyId of agencyTeamIds) {
      const clients = await db
        .select({
          teamId: teams.id,
          teamName: teams.name,
          parentTeamId: teams.parentTeamId,
          clientStatus: teams.clientStatus,
        })
        .from(teams)
        .where(
          and(
            eq(teams.parentTeamId, agencyId),
            eq(teams.clientStatus, "active"),
            isNull(teams.deletedAt)
          )
        );
      clientTeams.push(...clients);
    }

    // The active team context for this session
    const activeTeamId = authResult.teamContextId ?? directMemberships[0]?.teamId ?? null;

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        profilePictureUrl: user.profilePictureUrl,
        twoFactorEnabled: user.twoFactorEnabled === 1,
        twoFactorMethod: user.twoFactorMethod,
        emailVerified: user.emailVerified === 1,
        accountStatus: user.accountStatus,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        defaultTeamId: user.defaultTeamId,
      },
      activeTeamId,
      teams: directMemberships.map((m) => ({
        id: m.teamId,
        name: m.teamName,
        role: m.role,
        billingPlan: m.billingPlan,
        parentTeamId: m.parentTeamId,
        isClientTeam: !!m.parentTeamId,
      })),
      clientTeams: clientTeams.map((c) => ({
        id: c.teamId,
        name: c.teamName,
        parentTeamId: c.parentTeamId,
        isClientTeam: true,
      })),
    });
  } catch (error) {
    console.error("Get current user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
