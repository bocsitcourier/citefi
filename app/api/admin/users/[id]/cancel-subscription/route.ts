import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, teamMembers, teams, adminActionLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { getStripeClient } from "@/lib/stripe";
import { deliverEmail } from "@/lib/email";
import { z } from "zod";

const bodySchema = z.object({
  immediate: z.boolean().optional().default(false),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userIdParam } = await params;
    const userId = parseInt(userIdParam);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const adminUserId = await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    const immediate = parsed.success ? parsed.data.immediate : false;

    const [membership] = await db
      .select({
        teamId: teams.id,
        userEmail: users.email,
        stripeSubscriptionId: teams.stripeSubscriptionId,
        billingStatus: teams.billingStatus,
        currentPeriodEnd: teams.currentPeriodEnd,
      })
      .from(users)
      .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: "User or team not found" }, { status: 404 });
    }
    if (!membership.stripeSubscriptionId) {
      return NextResponse.json({ error: "No active subscription found for this user" }, { status: 400 });
    }

    const stripe = await getStripeClient();

    if (immediate) {
      await stripe.subscriptions.cancel(membership.stripeSubscriptionId);
      await db
        .update(teams)
        .set({ billingStatus: "canceled", cancelAtPeriodEnd: false })
        .where(eq(teams.id, membership.teamId));
    } else {
      await stripe.subscriptions.update(membership.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      await db
        .update(teams)
        .set({ cancelAtPeriodEnd: true })
        .where(eq(teams.id, membership.teamId));
    }

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: "subscription_canceled_admin",
      targetType: "subscription",
      details: JSON.stringify({
        immediate,
        subscriptionId: membership.stripeSubscriptionId,
        targetUserId: userId,
        targetUserEmail: membership.userEmail,
        periodEnd: membership.currentPeriodEnd,
      }),
    });

    const periodEnd = membership.currentPeriodEnd
      ? new Date(membership.currentPeriodEnd).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : null;

    deliverEmail({
      to: membership.userEmail,
      subject: immediate ? "Your Citefi subscription has been cancelled" : "Your Citefi subscription is scheduled for cancellation",
      text: immediate
        ? `Your Citefi subscription has been cancelled effective immediately. If you believe this was done in error, please contact support.`
        : `Your Citefi subscription has been scheduled for cancellation${periodEnd ? ` and will remain active until ${periodEnd}` : " at the end of your current billing period"}. After that date, you will lose access to paid features.\n\nIf you did not request this, please contact support immediately.`,
      html: immediate
        ? `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Subscription Cancelled</h2><p>Your Citefi subscription has been <strong>cancelled effective immediately</strong>.</p><p style="color:#666">If you believe this was done in error, please contact support.</p></div>`
        : `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Subscription Cancellation Scheduled</h2><p>Your Citefi subscription has been scheduled for cancellation${periodEnd ? ` and will remain active until <strong>${periodEnd}</strong>` : " at the end of your current billing period"}.</p><p style="color:#666">After that date, you will lose access to paid features. If you did not request this, please contact support immediately.</p></div>`,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      immediate,
      userEmail: membership.userEmail,
      currentPeriodEnd: membership.currentPeriodEnd,
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/users/[id]/cancel-subscription]", err);
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}
