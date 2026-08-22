export type PlanId = "free" | "starter" | "growth" | "agency" | "enterprise";
export const SELF_SERVE_PLAN_IDS = ["starter", "growth", "agency"] as const satisfies readonly PlanId[];
export const PUBLIC_PRICING_PLAN_IDS = ["free", ...SELF_SERVE_PLAN_IDS] as const satisfies readonly PlanId[];

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
  /** Maximum number of team seats (members + pending invites). null = unlimited */
  maxSeats: number | null;
  /** Maximum active child client workspaces. null = unlimited. */
  maxClientWorkspaces: number | null;
}

/** Annual subscriptions charge for 10 months and provide 12 months of service. */
export const ANNUAL_BILLING_CHARGED_MONTHS = 10;

export const BILLING_PLANS: Record<PlanId, BillingPlan> = {
  free: {
    id: "free",
    name: "Free",
    monthlyCredits: 30,
    priceUsd: 0,
    stripePriceEnvKey: "",
    oneTime: true,
    maxSeats: 1,
    maxClientWorkspaces: 0,
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
    maxSeats: 3,
    maxClientWorkspaces: 0,
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
    maxSeats: 10,
    maxClientWorkspaces: 0,
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
    priceUsd: 249,
    stripePriceEnvKey: "STRIPE_PRICE_AGENCY",
    stripeAnnualPriceEnvKey: "STRIPE_PRICE_AGENCY_ANNUAL",
    maxSeats: 25,
    maxClientWorkspaces: 25,
    features: [
      "1,000 credits per month",
      "Everything in Growth",
      "Up to 25 client sub-teams",
      "Separate client workspace credit balances",
      "Client workspace management",
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
    maxSeats: null,
    maxClientWorkspaces: null,
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

export function getAnnualPriceUsd(plan: BillingPlan): number {
  return plan.priceUsd * ANNUAL_BILLING_CHARGED_MONTHS;
}

export interface TopUp {
  id: string;
  credits: number;
  priceUsd: number;
  stripePriceEnvKey: string;
  label: string;
}

export const TOP_UPS: TopUp[] = [
  { id: "topup_5",  credits: 10, priceUsd: 5,  stripePriceEnvKey: "STRIPE_PRICE_TOPUP_5",  label: "$5 Pack — 10 credits" },
  { id: "topup_10", credits: 20, priceUsd: 10, stripePriceEnvKey: "STRIPE_PRICE_TOPUP_10", label: "$10 Pack — 20 credits" },
  { id: "topup_25", credits: 50, priceUsd: 25, stripePriceEnvKey: "STRIPE_PRICE_TOPUP_25", label: "$25 Pack — 50 credits" },
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
