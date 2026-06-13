export type PlanId = "free" | "starter" | "pro" | "agency";

export interface BillingPlan {
  id: PlanId;
  name: string;
  monthlyCredits: number;
  priceUsd: number;
  stripePriceEnvKey: string;
  features: string[];
}

export const BILLING_PLANS: Record<PlanId, BillingPlan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyCredits: 50,
    priceUsd: 0,
    stripePriceEnvKey: "",
    features: [
      "50 credits per month",
      "Article generation",
      "Social posts",
      "Basic SEO tools",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    monthlyCredits: 500,
    priceUsd: 29,
    stripePriceEnvKey: "STRIPE_PRICE_STARTER",
    features: [
      "500 credits per month",
      "Everything in Free",
      "Podcast generation",
      "Video scripts",
      "Priority queue",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyCredits: 2000,
    priceUsd: 79,
    stripePriceEnvKey: "STRIPE_PRICE_PRO",
    features: [
      "2,000 credits per month",
      "Everything in Starter",
      "AI learning system",
      "Content clusters",
      "Batch generation",
      "Advanced analytics",
    ],
  },
  agency: {
    id: "agency",
    name: "Agency",
    monthlyCredits: 10000,
    priceUsd: 199,
    stripePriceEnvKey: "STRIPE_PRICE_AGENCY",
    features: [
      "10,000 credits per month",
      "Everything in Pro",
      "Multi-team management",
      "White-label exports",
      "Dedicated support",
      "Custom integrations",
    ],
  },
};

export interface TopUp {
  id: string;
  credits: number;
  priceUsd: number;
  stripePriceEnvKey: string;
  label: string;
}

export const TOP_UPS: TopUp[] = [
  {
    id: "topup_100",
    credits: 100,
    priceUsd: 9,
    stripePriceEnvKey: "STRIPE_PRICE_TOPUP_100",
    label: "100 credits",
  },
  {
    id: "topup_500",
    credits: 500,
    priceUsd: 39,
    stripePriceEnvKey: "STRIPE_PRICE_TOPUP_500",
    label: "500 credits",
  },
  {
    id: "topup_1000",
    credits: 1000,
    priceUsd: 69,
    stripePriceEnvKey: "STRIPE_PRICE_TOPUP_1000",
    label: "1,000 credits",
  },
];

export function getPlanById(planId: string): BillingPlan | null {
  return BILLING_PLANS[planId as PlanId] ?? null;
}

export function getPlanByStripePriceId(priceId: string): BillingPlan | null {
  for (const plan of Object.values(BILLING_PLANS)) {
    if (!plan.stripePriceEnvKey) continue;
    const envPriceId = process.env[plan.stripePriceEnvKey];
    if (envPriceId === priceId) return plan;
  }
  return null;
}

export function getTopUpByStripePriceId(priceId: string): TopUp | null {
  for (const topUp of TOP_UPS) {
    const envPriceId = process.env[topUp.stripePriceEnvKey];
    if (envPriceId === priceId) return topUp;
  }
  return null;
}

export function getCreditGrantForInvoice(priceId: string): number {
  const plan = getPlanByStripePriceId(priceId);
  if (plan) return plan.monthlyCredits;
  const topUp = getTopUpByStripePriceId(priceId);
  if (topUp) return topUp.credits;
  return 0;
}
