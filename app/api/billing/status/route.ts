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
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId))
      .limit(1);

    const plan = BILLING_PLANS[team.billingPlan as keyof typeof BILLING_PLANS] ?? BILLING_PLANS.free;
    const hasActivePlan =
      team.billingStatus === "active" || team.billingStatus === "trialing";

    const allowanceRemaining = balance
      ? Math.max(0, balance.allowanceCredits - balance.allowanceUsed)
      : 0;
    const purchasedRemaining = balance
      ? Math.max(0, balance.purchasedCredits - balance.purchasedUsed)
      : 0;
    const totalRemaining = Math.max(
      0,
      allowanceRemaining + purchasedRemaining - (balance?.reservedCredits ?? 0)
    );

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
        // Legacy combined balance (kept for backward compat)
        balance: balance?.balance ?? 0,
        // Two-bucket breakdown
        allowanceCredits: balance?.allowanceCredits ?? 0,
        purchasedCredits: balance?.purchasedCredits ?? 0,
        allowanceUsed: balance?.allowanceUsed ?? 0,
        purchasedUsed: balance?.purchasedUsed ?? 0,
        reservedCredits: balance?.reservedCredits ?? 0,
        allowanceRemaining,
        purchasedRemaining,
        totalRemaining,
        periodStart: balance?.periodStart ?? null,
        periodEnd: balance?.periodEnd ?? null,
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
