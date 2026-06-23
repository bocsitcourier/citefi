import { db } from "@/lib/db";
import { teams, creditBalances } from "@/shared/schema";
import { eq } from "drizzle-orm";

export interface PaywallResult {
  allowed: boolean;
  planId: string;
  billingStatus: string;
  creditBalance: number;
  trialExpired?: boolean;
  reason?: string;
}

/**
 * Enforce team paywall for generation endpoints.
 *
 * Rules:
 * - Any team with credits > 0: allowed (reserveCredits() is the hard floor).
 * - Free plan with 0 credits: blocked with 402 + billing CTA.
 * - Paid plan active/trialing with 0 credits: blocked (let reserveCredits return 402).
 * - Paid plan past_due: allowed with 0 credits (Stripe handles dunning).
 * - Subscription canceled, 0 credits: blocked.
 *
 * Returns `allowed: false` only when the team is on the free tier (or canceled)
 * AND has no credits. This is the plan-level gate on top of credit metering.
 *
 * Credit balance is sourced from the two-bucket engine (allowance + purchased)
 * when bucket grants exist, falling back to the legacy balance column for
 * teams that predate the two-bucket migration.
 */
export async function checkTeamPaywall(teamId: number): Promise<PaywallResult> {
  const [[team], [balanceRow]] = await Promise.all([
    db.select({
      billingPlan: teams.billingPlan,
      billingStatus: teams.billingStatus,
      currentPeriodEnd: teams.currentPeriodEnd,
      stripeSubscriptionId: teams.stripeSubscriptionId,
    }).from(teams).where(eq(teams.id, teamId)).limit(1),
    db.select({
      balance: creditBalances.balance,
      allowanceCredits: creditBalances.allowanceCredits,
      allowanceUsed: creditBalances.allowanceUsed,
      purchasedCredits: creditBalances.purchasedCredits,
      purchasedUsed: creditBalances.purchasedUsed,
      reservedCredits: creditBalances.reservedCredits,
    }).from(creditBalances).where(eq(creditBalances.teamId, teamId)).limit(1),
  ]);

  const planId = team?.billingPlan ?? "free";
  const billingStatus = team?.billingStatus ?? "active";
  const currentPeriodEnd = team?.currentPeriodEnd ?? null;
  const stripeSubscriptionId = team?.stripeSubscriptionId ?? null;

  // Trial expiry: team is still "trialing" in our DB but the period has passed
  // AND they have no active Stripe subscription (no payment method was ever added).
  // We require !stripeSubscriptionId to avoid false-positives during webhook lag —
  // a team with a subscription ID that appears in-trial is almost certainly between
  // Stripe events and should not be blocked until Stripe explicitly cancels them.
  const trialExpired =
    billingStatus === "trialing" &&
    !stripeSubscriptionId &&
    currentPeriodEnd !== null &&
    new Date(currentPeriodEnd) < new Date();

  if (trialExpired) {
    return {
      allowed: false,
      planId,
      billingStatus,
      creditBalance: 0,
      trialExpired: true,
      reason: "Your trial has ended. Add a payment method to continue generating content.",
    };
  }

  // Effective balance: prefer two-bucket total when bucket grants exist,
  // otherwise fall back to legacy balance column (pre-migration teams).
  const allowanceRemaining = Math.max(0, (balanceRow?.allowanceCredits ?? 0) - (balanceRow?.allowanceUsed ?? 0));
  const purchasedRemaining = Math.max(0, (balanceRow?.purchasedCredits ?? 0) - (balanceRow?.purchasedUsed ?? 0));
  const bucketTotal = Math.max(0, allowanceRemaining + purchasedRemaining - (balanceRow?.reservedCredits ?? 0));
  const hasBucketGrants = (balanceRow?.allowanceCredits ?? 0) > 0 || (balanceRow?.purchasedCredits ?? 0) > 0;
  const creditBalance = hasBucketGrants ? bucketTotal : (balanceRow?.balance ?? 0);

  // Always allow when there are credits — reserveCredits() is the enforcement layer
  if (creditBalance > 0) {
    return { allowed: true, planId, billingStatus, creditBalance };
  }

  // Zero credits: check plan status
  // BLOCK: payment failed states with no credits remaining.
  // Stripe dunning does not prevent enforcement — teams must resolve payment
  // or purchase a top-up to continue generating.
  const isPaymentFailed = ["past_due", "unpaid", "incomplete_expired"].includes(billingStatus);
  if (isPaymentFailed) {
    return {
      allowed: false,
      planId,
      billingStatus,
      creditBalance,
      reason: "Your payment is past due. Please update your payment method to continue generating content.",
    };
  }

  const hasActivePaidPlan =
    planId !== "free" && ["active", "trialing"].includes(billingStatus);

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
    error: result.trialExpired ? "TRIAL_EXPIRED" : "CREDITS_EXHAUSTED",
    creditBalance: result.creditBalance,
    allowanceRemaining: 0,
    purchasedRemaining: 0,
    totalRemaining: result.creditBalance,
    sufficient: false,
    planId: result.planId,
    billingStatus: result.billingStatus,
    trialExpired: result.trialExpired ?? false,
    upgradeUrl: "/client/billing",
    message: result.reason ?? "You have no credits remaining. Upgrade your plan at /client/billing.",
  };
}
