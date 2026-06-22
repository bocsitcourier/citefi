import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teamMembers, users, userInvites } from "@/shared/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";

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

      // Only return invites that are pending AND not yet expired
      db.select({
        id: userInvites.id,
        email: userInvites.email,
        status: userInvites.status,
        createdAt: userInvites.createdAt,
        expiresAt: userInvites.expiresAt,
      })
        .from(userInvites)
        .where(and(
          eq(userInvites.teamId, teamId),
          eq(userInvites.status, "pending"),
          gt(userInvites.expiresAt, new Date()),
        )),
    ]);

    return NextResponse.json({ members, pendingInvites });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/team GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["member", "admin"]).default("member"),
  message: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { userId, teamId, role: callerRole } = await requireTeamMember(req);

    if (callerRole !== "admin") {
      return NextResponse.json({ error: "Only team admins can invite members" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { email, role, message } = parsed.data;

    // Check if user is already a team member
    const [existingMember] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingMember) {
      return NextResponse.json({ error: "This person is already a member of your team" }, { status: 409 });
    }

    // Check for an existing pending invite that has NOT expired.
    // Expired pending invites (status=pending, expiresAt < now) do NOT block re-invites —
    // the new invite supersedes the old one.
    const [existingActiveInvite] = await db
      .select({ id: userInvites.id })
      .from(userInvites)
      .where(and(
        eq(userInvites.teamId, teamId),
        eq(userInvites.email, email.toLowerCase()),
        eq(userInvites.status, "pending"),
        gt(userInvites.expiresAt, new Date()), // only block if not yet expired
      ))
      .limit(1);

    if (existingActiveInvite) {
      return NextResponse.json({ error: "An active invite for this email is already pending" }, { status: 409 });
    }

    // Generate token — raw token is returned to the caller so they can share the link.
    // We store only the SHA-256 hash in the DB; the raw token never touches the DB.
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Expire any stale pending invites for this email before creating the new one
    // (handles the case where an expired pending invite exists in the DB)
    await db.delete(userInvites).where(and(
      eq(userInvites.teamId, teamId),
      eq(userInvites.email, email.toLowerCase()),
      eq(userInvites.status, "pending"),
    ));

    await db.insert(userInvites).values({
      email: email.toLowerCase(),
      invitedBy: userId,
      teamId,
      role: role === "admin" ? "admin" : "team_member",
      tokenHash,
      expiresAt,
      status: "pending",
      message: message ?? null,
    });

    // Derive the invite URL from the request host so it works across dev + prod.
    // The accept-invite page uses the raw token (not the hash) to validate.
    const host = req.headers.get("host") ?? "";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const inviteUrl = `${proto}://${host}/accept-invite?token=${token}`;

    return NextResponse.json({
      success: true,
      inviteUrl,
      message: `Invite created for ${email}. Share the link below — it expires in 7 days.`,
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/team POST]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const removeSchema = z.object({
  memberId: z.number().int().positive(),
});

export async function DELETE(req: NextRequest) {
  try {
    const { userId, teamId, role: callerRole } = await requireTeamMember(req);

    if (callerRole !== "admin") {
      return NextResponse.json({ error: "Only team admins can remove members" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }
    const { memberId } = parsed.data;

    // Fetch the target member to validate it belongs to this team
    const [target] = await db
      .select({ userId: teamMembers.userId, role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Prevent self-removal
    if (target.userId === userId) {
      return NextResponse.json({ error: "You cannot remove yourself from the team" }, { status: 400 });
    }

    // Count remaining admins to prevent last-admin removal
    if (target.role === "admin") {
      const adminRows = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "admin")));
      if (adminRows.length <= 1) {
        return NextResponse.json({ error: "Cannot remove the last admin from the team" }, { status: 400 });
      }
    }

    await db.delete(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)));

    return NextResponse.json({ success: true, message: "Member removed" });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/team DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
