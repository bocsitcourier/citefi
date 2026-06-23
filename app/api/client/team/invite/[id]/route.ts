import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { userInvites } from "@/shared/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { teamId, role: callerRole } = await requireTeamMember(req);

    if (callerRole !== "admin") {
      return NextResponse.json(
        { error: "Only team admins can cancel invites" },
        { status: 403 }
      );
    }

    const inviteId = parseInt(params.id, 10);
    if (isNaN(inviteId) || inviteId <= 0) {
      return NextResponse.json({ error: "Invalid invite ID" }, { status: 400 });
    }

    const [invite] = await db
      .select({ id: userInvites.id, status: userInvites.status })
      .from(userInvites)
      .where(
        and(
          eq(userInvites.id, inviteId),
          eq(userInvites.teamId, teamId)
        )
      )
      .limit(1);

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    if (invite.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending invites can be cancelled" },
        { status: 409 }
      );
    }

    await db
      .update(userInvites)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(userInvites.id, inviteId),
          eq(userInvites.teamId, teamId),
          eq(userInvites.status, "pending")
        )
      );

    return NextResponse.json({ success: true, message: "Invite cancelled" });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/team/invite DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
