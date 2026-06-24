import { NextRequest, NextResponse } from "next/server";
import { db, getTxDb } from "@/lib/db";
import {
  users,
  sessions,
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
import { eq, count } from "drizzle-orm";
import { requireAuth, AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { getStripeClient } from "@/lib/stripe";
import { deliverEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const [targetUser] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Block deletion if user owns content (same rule as admin delete)
    const [ownedBatches] = await db.select({ count: count() }).from(jobBatches).where(eq(jobBatches.userId, userId));
    const [ownedPosts] = await db.select({ count: count() }).from(socialPosts).where(eq(socialPosts.userId, userId));
    const [createdTeams] = await db.select({ count: count() }).from(teams).where(eq(teams.createdBy, userId));

    if ((ownedBatches?.count || 0) > 0 || (ownedPosts?.count || 0) > 0 || (createdTeams?.count || 0) > 0) {
      return NextResponse.json(
        { error: "Your account owns content (batches, posts, or teams). Please delete or reassign this content before closing your account." },
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
        await stripe.subscriptions.cancel(teamMembership.stripeSubscriptionId).catch(() => {});
        await db
          .update(teams)
          .set({ billingStatus: "canceled", cancelAtPeriodEnd: false })
          .where(eq(teams.id, teamMembership.teamId));
      }
    } catch (_) {}

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

    // Send confirmation email (fire-and-forget, outside transaction)
    deliverEmail({
      to: targetUser.email,
      subject: "Your Citefi account has been deleted",
      text: "Your Citefi account and all associated data have been permanently deleted as requested. If you did not initiate this, please contact support immediately.",
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Account Deleted</h2><p>Your Citefi account and all associated data have been permanently deleted as requested.</p><p style="color:#666">If you did not initiate this, please contact support immediately.</p></div>`,
    }).catch(() => {});

    const response = NextResponse.json({ success: true, message: "Account permanently deleted" });
    response.cookies.set(AUTH_COOKIE_NAME, "", { maxAge: 0, path: "/" });
    return response;
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[account/delete]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete account" }, { status: 500 });
  }
}
