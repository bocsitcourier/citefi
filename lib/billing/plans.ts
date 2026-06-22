export type PlanId = "free" | "starter" | "growth" | "agency" | "enterprise";

export interface BillingPlan {
  id: PlanId;
  name: string;
  monthlyCredits: number;
  priceUsd: number;
  stripePriceEnvKey: string;
  stripeAnnualPriceEnvKey?: string;
  features: string[];
  oneTime?: boolean;
  /** If true, this plan is managed manually (sales-assisted) and not purchasable via self-serve checkout */
  salesAssisted?: boolean;
}

export const BILLING_PLANS: Record<PlanId, BillingPlan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyCredits: 30,
    priceUsd: 0,
    stripePriceEnvKey: "",
    oneTime: true,
    features: [
      "30 one-time credits",
      "Article generation",
      "Social posts",
      "Basic SEO tools",
    ],
  },
  starter: {
    id: "starter",
    name: "Starter",
    monthlyCredits: 50,
    priceUsd: 29,
    stripePriceEnvKey: "STRIPE_PRICE_STARTER",
    stripeAnnualPriceEnvKey: "STRIPE_PRICE_STARTER_ANNUAL",
    features: [
      "50 credits per month",
      "Everything in Free",
      "Podcast generation",
      "Video scripts",
      "Priority queue",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    monthlyCredits: 200,
    priceUsd: 89,
    stripePriceEnvKey: "STRIPE_PRICE_GROWTH",
    stripeAnnualPriceEnvKey: "STRIPE_PRICE_GROWTH_ANNUAL",
    features: [
      "200 credits per month",
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
    monthlyCredits: 1000,
    priceUsd: 299,
    stripePriceEnvKey: "STRIPE_PRICE_AGENCY",
    stripeAnnualPriceEnvKey: "STRIPE_PRICE_AGENCY_ANNUAL",
    features: [
      "1,000 credits per month",
      "Everything in Growth",
      "Up to 25 client sub-teams",
      "Client dashboard & reporting",
      "White-label content generation",
      "Agency admin console",
      "Priority support",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthlyCredits: 5000,
    priceUsd: 999,
    stripePriceEnvKey: "STRIPE_PRICE_ENTERPRISE",
    stripeAnnualPriceEnvKey: "STRIPE_PRICE_ENTERPRISE_ANNUAL",
    salesAssisted: true,
    features: [
      "5,000 credits per month",
      "Everything in Agency",
      "Unlimited client sub-teams",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantees",
      "Custom billing terms",
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
  { id: "topup_20",  credits: 20,  priceUsd: 12,  stripePriceEnvKey: "STRIPE_PRICE_TOPUP_20",  label: "Starter Pack — 20 credits" },
  { id: "topup_50",  credits: 50,  priceUsd: 25,  stripePriceEnvKey: "STRIPE_PRICE_TOPUP_50",  label: "Small Pack — 50 credits" },
  { id: "topup_100", credits: 100, priceUsd: 45,  stripePriceEnvKey: "STRIPE_PRICE_TOPUP_100", label: "Medium Pack — 100 credits" },
  { id: "topup_250", credits: 250, priceUsd: 100, stripePriceEnvKey: "STRIPE_PRICE_TOPUP_250", label: "Large Pack — 250 credits" },
  { id: "topup_500", credits: 500, priceUsd: 180, stripePriceEnvKey: "STRIPE_PRICE_TOPUP_500", label: "Bulk Pack — 500 credits" },
];

export function getPlanById(planId: string): BillingPlan | null {
  return BILLING_PLANS[planId as PlanId] ?? null;
}

export function getPlanByStripePriceId(priceId: string): BillingPlan | null {
  for (const plan of Object.values(BILLING_PLANS)) {
    if (plan.stripePriceEnvKey) {
      const monthly = process.env[plan.stripePriceEnvKey];
      if (monthly && monthly === priceId) return plan;
    }
    if (plan.stripeAnnualPriceEnvKey) {
      const annual = process.env[plan.stripeAnnualPriceEnvKey];
      if (annual && annual === priceId) return plan;
    }
  }
  return null;
}

export function getTopUpByStripePriceId(priceId: string): TopUp | null {
  for (const topUp of TOP_UPS) {
    const envPriceId = process.env[topUp.stripePriceEnvKey];
    if (envPriceId && envPriceId === priceId) return topUp;
  }
  return null;
}

export function getCreditGrantForPriceId(priceId: string): number {
  return getPlanByStripePriceId(priceId)?.monthlyCredits ?? 0;
}
