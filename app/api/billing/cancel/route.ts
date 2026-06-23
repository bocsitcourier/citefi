import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, activityLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { getStripeClient } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamAdmin(req);

    const [team] = await db
      .select({
        id: teams.id,
        stripeSubscriptionId: teams.stripeSubscriptionId,
        currentPeriodEnd: teams.currentPeriodEnd,
        billingPlan: teams.billingPlan,
      })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (!team.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 400 }
      );
    }

    const stripe = await getStripeClient();

    const subscription = await stripe.subscriptions.update(team.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await db
      .update(teams)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(teams.id, teamId));

    await db.insert(activityLogs).values({
      userId,
      action: "subscription_cancel_requested",
      resource: "teams",
      resourceId: teamId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        plan: team.billingPlan,
        subscriptionId: team.stripeSubscriptionId,
        periodEnd: team.currentPeriodEnd,
      },
      severity: "warning",
    });

    return NextResponse.json({
      success: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: subscription.cancel_at
        ? new Date(subscription.cancel_at * 1000).toISOString()
        : team.currentPeriodEnd,
    });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[billing/cancel]", err);
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
  }
}
