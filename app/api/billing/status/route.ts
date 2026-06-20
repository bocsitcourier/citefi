import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, creditBalances } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { BILLING_PLANS } from "@/lib/billing/plans";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const [team] = await db
      .select({
        billingPlan: teams.billingPlan,
        billingStatus: teams.billingStatus,
        currentPeriodEnd: teams.currentPeriodEnd,
        cancelAtPeriodEnd: teams.cancelAtPeriodEnd,
        stripeCustomerId: teams.stripeCustomerId,
        stripeSubscriptionId: teams.stripeSubscriptionId,
      })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const [balance] = await db
      .select({ balance: creditBalances.balance })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId))
      .limit(1);

    const plan = BILLING_PLANS[team.billingPlan as keyof typeof BILLING_PLANS] ?? BILLING_PLANS.free;
    const hasActivePlan =
      team.billingStatus === "active" || team.billingStatus === "trialing";

    return NextResponse.json({
      plan: {
        id: plan.id,
        name: plan.name,
        monthlyCredits: plan.monthlyCredits,
        priceUsd: plan.priceUsd,
        features: plan.features,
      },
      billing: {
        status: team.billingStatus,
        currentPeriodEnd: team.currentPeriodEnd,
        cancelAtPeriodEnd: team.cancelAtPeriodEnd,
        hasActivePlan,
        hasCustomer: !!team.stripeCustomerId,
        hasSubscription: !!team.stripeSubscriptionId,
      },
      credits: {
        balance: balance?.balance ?? 0,
      },
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[billing/status]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: err?.statusCode || 500 });
  }
}
