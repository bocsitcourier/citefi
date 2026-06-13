import { db } from "@/lib/db";
import { teams, creditBalances } from "@/shared/schema";
import { eq } from "drizzle-orm";

export interface PaywallResult {
  allowed: boolean;
  planId: string;
  billingStatus: string;
  creditBalance: number;
  reason?: string;
}

/**
 * Enforce team paywall for generation endpoints.
 *
 * Rules:
 * - Any team with credits > 0: allowed (credit debit is the hard floor).
 * - Free plan with 0 credits: blocked with 402 + billing CTA.
 * - Paid plan active/trialing with 0 credits: blocked (let credit debit return 402).
 * - Paid plan past_due: allowed with 0 credits for a 3-day grace period
 *   (simplified: always allowed if subscription exists — Stripe handles dunning).
 * - Subscription canceled, 0 credits: blocked.
 *
 * Returns `allowed: false` only when the team is on the free tier (or canceled)
 * AND has no credits. This is the plan-level gate on top of credit metering.
 */
export async function checkTeamPaywall(teamId: number): Promise<PaywallResult> {
  const [[team], [balanceRow]] = await Promise.all([
    db.select({ billingPlan: teams.billingPlan, billingStatus: teams.billingStatus })
      .from(teams).where(eq(teams.id, teamId)).limit(1),
    db.select({ balance: creditBalances.balance })
      .from(creditBalances).where(eq(creditBalances.teamId, teamId)).limit(1),
  ]);

  const planId = team?.billingPlan ?? "free";
  const billingStatus = team?.billingStatus ?? "active";
  const creditBalance = balanceRow?.balance ?? 0;

  // Always allow when there are credits — debitCredits() is the enforcement layer
  if (creditBalance > 0) {
    return { allowed: true, planId, billingStatus, creditBalance };
  }

  // Zero credits: check plan
  const hasActivePaidPlan =
    planId !== "free" && ["active", "trialing", "past_due"].includes(billingStatus);

  if (hasActivePaidPlan) {
    // Paid subscriber with 0 credits: let debitCredits() return the 402
    return { allowed: true, planId, billingStatus, creditBalance };
  }

  // Free / canceled with 0 credits — block with billing CTA
  return {
    allowed: false,
    planId,
    billingStatus,
    creditBalance,
    reason:
      planId === "free"
        ? "Your free credits are exhausted. Upgrade to a paid plan to continue."
        : "Your subscription is inactive and you have no credits remaining. Please renew your plan.",
  };
}

/**
 * Standard 402 response body for insufficient credits / plan gate.
 */
export function paywallErrorBody(result: PaywallResult) {
  return {
    error: "Insufficient credits",
    creditBalance: result.creditBalance,
    planId: result.planId,
    billingStatus: result.billingStatus,
    upgradeUrl: "/settings/billing",
    message: result.reason ?? "You have no credits remaining. Purchase more at /settings/billing.",
  };
}
