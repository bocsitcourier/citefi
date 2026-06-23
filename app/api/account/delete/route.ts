import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

    // Cancel Stripe subscription best-effort
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

    // Delete all related records
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(activityLogs).where(eq(activityLogs.userId, userId));
    await db.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
    await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
    await db.delete(loginHistory).where(eq(loginHistory.userId, userId));
    await db.delete(passwordResets).where(eq(passwordResets.userId, userId));
    await db.delete(userQuotas).where(eq(userQuotas.userId, userId));
    // team_members has CASCADE delete
    await db.update(userInvites).set({ acceptedBy: null }).where(eq(userInvites.acceptedBy, userId));
    await db.update(sessions).set({ terminatedBy: null }).where(eq(sessions.terminatedBy, userId));
    await db.update(passwordResets).set({ initiatedBy: null }).where(eq(passwordResets.initiatedBy, userId));

    await db.delete(users).where(eq(users.id, userId));

    // Send confirmation email (fire-and-forget)
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
