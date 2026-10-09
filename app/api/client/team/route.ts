import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teamMembers, users, userInvites, teams } from "@/shared/schema";
import { eq, and, isNull, gt, count, inArray } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { lockTeamAdminMembershipState } from "@/lib/admin-invariant";

export async function GET(req: NextRequest) {
  try {
    return await withAuthenticatedTeamContext(req, async ({ teamId }) => {

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
    });
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
    return await withAuthenticatedTeamContext(req, async ({ userId, teamId, role: callerRole }) => {

    if (callerRole !== "admin") {
      return NextResponse.json({ error: "Only team admins can invite members" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { email, role, message } = parsed.data;

    // ── Seat limit enforcement ──────────────────────────────────────────────
    // Count active members + pending unexpired invites against the plan's maxSeats.
    // The check runs inside the same request so a concurrent invite cannot sneak
    // past the limit (the DB unique constraint on active invites also helps).
    const [teamRow] = await db
      .select({ billingPlan: teams.billingPlan })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    const planKey = (teamRow?.billingPlan ?? "free") as keyof typeof BILLING_PLANS;
    const plan = BILLING_PLANS[planKey] ?? BILLING_PLANS.free;
    const maxSeats = plan.maxSeats;

    if (maxSeats !== null) {
      const [memberCountRow] = await db
        .select({ n: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));

      const [inviteCountRow] = await db
        .select({ n: count() })
        .from(userInvites)
        .where(and(
          eq(userInvites.teamId, teamId),
          eq(userInvites.status, "pending"),
          gt(userInvites.expiresAt, new Date()),
        ));

      const currentTotal = (memberCountRow?.n ?? 0) + (inviteCountRow?.n ?? 0);
      if (currentTotal >= maxSeats) {
        return NextResponse.json({
          error: `Your ${plan.name} plan allows up to ${maxSeats} seat${maxSeats !== 1 ? "s" : ""}. Remove a member or upgrade your plan to invite more people.`,
        }, { status: 422 });
      }
    }
    // ── End seat limit enforcement ──────────────────────────────────────────

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
    // The accept-invite page is at app/accept-invite/[token]/page.tsx (path param route).
    const host = req.headers.get("host") ?? "";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const inviteUrl = `${proto}://${host}/accept-invite/${token}`;

    return NextResponse.json({
      success: true,
      inviteUrl,
      message: `Invite created for ${email}. Share the link below — it expires in 7 days.`,
    });
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
    return await withAuthenticatedTeamContext(req, async ({ userId, teamId, role: callerRole }) => {

    if (callerRole !== "admin") {
      return NextResponse.json({ error: "Only team admins can remove members" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "memberId is required" }, { status: 400 });
    }
    const { memberId } = parsed.data;

    const outcome = await db.transaction(async (tx) => {
      // A shared team-scoped lock makes the privileged-member count and removal
      // atomic with respect to concurrent administrator removals.
      await lockTeamAdminMembershipState(tx, teamId);

      const [target] = await tx
        .select({ userId: teamMembers.userId, role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
        .limit(1);

      if (!target) return { status: 404 as const, error: "Member not found" };
      if (target.userId === userId) {
        return { status: 400 as const, error: "You cannot remove yourself from the team" };
      }

      if (target.role === "admin" || target.role === "owner") {
        const adminRows = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(and(
            eq(teamMembers.teamId, teamId),
            inArray(teamMembers.role, ["admin", "owner"]),
          ));
        if (adminRows.length <= 1) {
          return { status: 400 as const, error: "Cannot remove the last admin from the team" };
        }
      }

      const removed = await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.id, memberId), eq(teamMembers.teamId, teamId)))
        .returning({ id: teamMembers.id });
      if (removed.length === 0) return { status: 404 as const, error: "Member not found" };
      return { status: 200 as const };
    });

    if (outcome.status !== 200) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json({ success: true, message: "Member removed" });
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[client/team DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
