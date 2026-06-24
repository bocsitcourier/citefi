import { NextRequest, NextResponse } from "next/server";
import { db, getTxDb } from "@/lib/db";
import { 
  users, 
  sessions, 
  adminActionLogs, 
  activityLogs,
  totpSecrets,
  emailVerificationCodes,
  loginHistory,
  passwordResets,
  userQuotas,
  userInvites,
  jobBatches,
  socialPosts,
  teams,
  teamMembers,
} from "@/shared/schema";
import { eq, and, count } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { getStripeClient } from "@/lib/stripe";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userIdParam } = await params;
    const userId = parseInt(userIdParam);

    if (isNaN(userId)) {
      return NextResponse.json(
        { error: "Invalid user ID" },
        { status: 400 }
      );
    }

    const adminUserId = await requireAdmin(req);

    if (adminUserId === userId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (targetUser.role === 'admin' && targetUser.accountStatus === 'active') {
      const [result] = await db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            eq(users.role, 'admin'),
            eq(users.accountStatus, 'active')
          )
        );

      const activeAdminCount = result?.count || 0;

      if (activeAdminCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot delete the last active admin. At least one active admin must remain.' },
          { status: 400 }
        );
      }
    }

    // Block deletion if user owns content or is referenced
    const [ownedBatches] = await db.select({ count: count() }).from(jobBatches).where(eq(jobBatches.userId, userId));
    const [ownedPosts] = await db.select({ count: count() }).from(socialPosts).where(eq(socialPosts.userId, userId));
    const [createdTeams] = await db.select({ count: count() }).from(teams).where(eq(teams.createdBy, userId));
    const [sentInvites] = await db.select({ count: count() }).from(userInvites).where(eq(userInvites.invitedBy, userId));
    
    if ((ownedBatches?.count || 0) > 0 || (ownedPosts?.count || 0) > 0 || (createdTeams?.count || 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete user who owns content (batches, posts, or teams). Please reassign ownership first.' },
        { status: 400 }
      );
    }
    
    if ((sentInvites?.count || 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete user who has sent invitations. Please delete or reassign invitations first.' },
        { status: 400 }
      );
    }

    // Cancel Stripe subscription best-effort (outside transaction — external side-effect)
    try {
      const [teamMembership] = await db
        .select({ teamId: teams.id, stripeSubscriptionId: teams.stripeSubscriptionId })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(eq(teamMembers.userId, userId))
        .limit(1);

      if (teamMembership?.stripeSubscriptionId) {
        const stripe = await getStripeClient();
        await stripe.subscriptions.cancel(teamMembership.stripeSubscriptionId).catch((err: any) => {
          console.error(`[delete-user] Stripe cancel failed for sub ${teamMembership.stripeSubscriptionId}:`, err.message);
        });
        await db
          .update(teams)
          .set({ billingStatus: "canceled", cancelAtPeriodEnd: false })
          .where(eq(teams.id, teamMembership.teamId));
      }
    } catch (_stripeErr) {}

    // Wrap all sequential deletes in a transaction so a mid-sequence failure
    // cannot leave the user record orphaned with auth data partially deleted.
    const txDb = await getTxDb();
    await txDb.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(activityLogs).where(eq(activityLogs.userId, userId));
      await tx.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
      await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
      await tx.delete(loginHistory).where(eq(loginHistory.userId, userId));
      await tx.delete(passwordResets).where(eq(passwordResets.userId, userId));
      await tx.delete(userQuotas).where(eq(userQuotas.userId, userId));
      // Null out nullable FK references where this user is referenced
      await tx.update(userInvites).set({ acceptedBy: null }).where(eq(userInvites.acceptedBy, userId));
      await tx.update(sessions).set({ terminatedBy: null }).where(eq(sessions.terminatedBy, userId));
      await tx.update(passwordResets).set({ initiatedBy: null }).where(eq(passwordResets.initiatedBy, userId));
      // team_members has ON DELETE CASCADE — deleted automatically when user row is removed
      await tx.delete(users).where(eq(users.id, userId));
    });

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: 'user_deleted',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({
        targetUserEmail: targetUser.email,
        deletedUserRole: targetUser.role,
        deletedUserStatus: targetUser.accountStatus,
        deletedAt: new Date().toISOString(),
        ipAddress: clientIp,
      }),
    });

    return NextResponse.json({
      success: true,
      message: "User permanently deleted",
    });
  } catch (error: any) {
    console.error("Delete user error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete user" },
      { status: error?.statusCode || 500 }
    );
  }
}
