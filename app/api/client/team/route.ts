import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teamMembers, users, userInvites } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const [members, pendingInvites] = await Promise.all([
      db.select({
        memberId: teamMembers.id,
        userId: teamMembers.userId,
        role: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        email: users.email,
        fullName: users.fullName,
        profilePictureUrl: users.profilePictureUrl,
        lastLoginAt: users.lastLoginAt,
      })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(and(eq(teamMembers.teamId, teamId), isNull(users.deletedAt))),

      db.select({
        id: userInvites.id,
        email: userInvites.email,
        status: userInvites.status,
        createdAt: userInvites.createdAt,
        expiresAt: userInvites.expiresAt,
      })
        .from(userInvites)
        .where(and(eq(userInvites.teamId, teamId), eq(userInvites.status, "pending"))),
    ]);

    return NextResponse.json({ members, pendingInvites });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/team]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: err?.statusCode || 500 });
  }
}
