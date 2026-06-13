"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, CreditCard, Zap, Building2, Rocket, Star, ArrowUpRight, RefreshCw, AlertTriangle } from "lucide-react";

interface BillingStatus {
  plan: {
    id: string;
    name: string;
    monthlyCredits: number;
    priceUsd: number;
    features: string[];
  };
  billing: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasActivePlan: boolean;
    hasCustomer: boolean;
    hasSubscription: boolean;
  };
  credits: {
    balance: number;
  };
}

interface PlanConfig {
  id: string;
  name: string;
  priceUsd: number;
  monthlyCredits: number;
  features: string[];
  icon: React.ReactNode;
  highlight?: boolean;
}

interface TopUpConfig {
  id: string;
  credits: number;
  priceUsd: number;
}

// Display-only — no price IDs. Server resolves prices from env vars.
const PLANS: PlanConfig[] = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 29,
    monthlyCredits: 500,
    icon: <Rocket className="w-5 h-5" />,
    features: [
      "500 credits per month",
      "Article generation",
      "Social posts",
      "Podcast generation",
      "Video scripts",
      "Priority queue",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 79,
    monthlyCredits: 2000,
    icon: <Star className="w-5 h-5" />,
    highlight: true,
    features: [
      "2,000 credits per month",
      "Everything in Starter",
      "AI learning system",
      "Content clusters",
      "Batch generation",
      "Advanced analytics",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    priceUsd: 199,
    monthlyCredits: 10000,
    icon: <Building2 className="w-5 h-5" />,
    features: [
      "10,000 credits per month",
      "Everything in Pro",
      "Multi-team management",
      "White-label exports",
      "Dedicated support",
      "Custom integrations",
    ],
  },
];

const TOP_UPS: TopUpConfig[] = [
  { id: "topup_100", credits: 100, priceUsd: 9 },
  { id: "topup_500", credits: 500, priceUsd: 39 },
  { id: "topup_1000", credits: 1000, priceUsd: 69 },
];

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchBillingStatus(): Promise<BillingStatus> {
  const res = await fetch("/api/billing/status", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to load billing status");
  return res.json();
}

/** Send planId (subscription) or topUpId (one-time) — server resolves the price ID. */
async function createCheckout(
  payload: { kind: "subscription"; planId: string } | { kind: "topup"; topUpId: string }
): Promise<{ url: string; portal?: boolean }> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Checkout failed");
  }
  return res.json();
}

async function openPortal(): Promise<{ url: string }> {
  const res = await fetch("/api/billing/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to open billing portal");
  }
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    trialing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    past_due: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    canceled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    free: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ${colors[status] ?? colors.free}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ")}
    </span>
  );
}

export default function BillingPage() {
  const { toast } = useToast();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [openingPortal, setOpeningPortal] = useState(false);

  const {
    data: billing,
    isLoading,
    error,
    refetch,
  } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    queryFn: fetchBillingStatus,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  // Toast on Stripe return redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success")) {
      toast({ title: "Payment successful", description: "Your plan has been activated." });
      refetch();
      window.history.replaceState({}, "", "/settings/billing");
    }
    if (params.get("canceled")) {
      toast({
        title: "Checkout canceled",
        description: "No charge was made.",
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/settings/billing");
    }
  }, []);

  async function handleSubscribe(plan: PlanConfig) {
    setCheckingOut(plan.id);
    try {
      const result = await createCheckout({ kind: "subscription", planId: plan.id });
      if (result.portal) {
        toast({ title: "Opening billing portal", description: "You already have an active subscription. Use the portal to switch plans." });
      }
      window.location.href = result.url;
    } catch (err: any) {
      const msg: string = err.message ?? "Checkout failed";
      if (msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("seed")) {
        toast({
          title: "Billing not configured",
          description: "Stripe price IDs are not yet set up. Run: npx tsx scripts/seed-stripe-products.ts",
          variant: "destructive",
        });
      } else if (msg.toLowerCase().includes("admin")) {
        toast({
          title: "Permission denied",
          description: "Only team admins can manage billing.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setCheckingOut(null);
    }
  }

  async function handleTopUp(topUp: TopUpConfig) {
    setCheckingOut(topUp.id);
    try {
      const result = await createCheckout({ kind: "topup", topUpId: topUp.id });
      window.location.href = result.url;
    } catch (err: any) {
      const msg: string = err.message ?? "Top-up failed";
      if (msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("seed")) {
        toast({
          title: "Billing not configured",
          description: "Top-up price IDs are not yet set up. Run: npx tsx scripts/seed-stripe-products.ts",
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setCheckingOut(null);
    }
  }

  async function handlePortal() {
    setOpeningPortal(true);
    try {
      const { url } = await openPortal();
      window.location.href = url;
    } catch (err: any) {
      const msg: string = err.message ?? "Failed to open portal";
      if (msg.toLowerCase().includes("admin")) {
        toast({
          title: "Permission denied",
          description: "Only team admins can manage billing.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setOpeningPortal(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !billing) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Failed to load billing information.
      </div>
    );
  }

  const currentPlanId = billing.plan.id;
  const periodEnd = billing.billing.currentPeriodEnd
    ? new Date(billing.billing.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Billing & Credits</h1>
          <p className="text-muted-foreground mt-1">Manage your plan and credit balance.</p>
        </div>
        {billing.billing.hasSubscription && (
          <Button
            variant="outline"
            onClick={handlePortal}
            disabled={openingPortal}
            data-testid="button-manage-subscription"
          >
            {openingPortal ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4 mr-2" />
            )}
            Manage Subscription
          </Button>
        )}
      </div>

      {/* Billing status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xl font-semibold">{billing.plan.name}</span>
              <StatusBadge status={currentPlanId === "free" ? "free" : billing.billing.status} />
            </div>
            {periodEnd && (
              <p className="text-xs text-muted-foreground mt-1">
                {billing.billing.cancelAtPeriodEnd ? "Cancels" : "Renews"} {periodEnd}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Credit Balance</p>
            <div className="flex items-center gap-2 mt-1">
              <Zap className="w-5 h-5 text-yellow-500" />
              <span className="text-xl font-semibold">{billing.credits.balance.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Available credits</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Monthly Allowance</p>
            <div className="flex items-center gap-2 mt-1">
              <RefreshCw className="w-5 h-5 text-blue-500" />
              <span className="text-xl font-semibold">{billing.plan.monthlyCredits.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Credits per month</p>
          </CardContent>
        </Card>
      </div>

      {/* Paywall notice for zero credits on free plan */}
      {currentPlanId === "free" && billing.credits.balance === 0 && (
        <Card className="border-yellow-200 dark:border-yellow-900/40 bg-yellow-50/50 dark:bg-yellow-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-900 dark:text-yellow-300">
                  Free credits exhausted
                </p>
                <p className="text-sm text-yellow-800/80 dark:text-yellow-400/80 mt-1">
                  You have used all your free credits. Upgrade to a paid plan or purchase a top-up to continue generating content.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Free-plan notice (credits remaining) */}
      {currentPlanId === "free" && billing.credits.balance > 0 && (
        <Card className="border-muted bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                You are on the <strong>Free plan</strong> — {billing.credits.balance} credits remaining this month. Upgrade for more credits and advanced features.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plans */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            const isCheckingOut = checkingOut === plan.id;
            return (
              <Card key={plan.id} className={plan.highlight ? "border-primary" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {plan.icon}
                      <CardTitle className="text-base">{plan.name}</CardTitle>
                    </div>
                    {plan.highlight && (
                      <Badge variant="default" className="text-xs">
                        Most Popular
                      </Badge>
                    )}
                    {isCurrent && (
                      <Badge variant="outline" className="text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-bold">${plan.priceUsd}</span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                  <CardDescription className="text-sm">
                    {plan.monthlyCredits.toLocaleString()} credits/month
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={plan.highlight ? "default" : "outline"}
                    onClick={() => handleSubscribe(plan)}
                    disabled={isCurrent || !!checkingOut}
                    data-testid={`button-subscribe-${plan.id}`}
                  >
                    {isCheckingOut ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 mr-2" />
                    )}
                    {isCurrent
                      ? "Current Plan"
                      : billing.billing.hasSubscription
                        ? "Switch Plan"
                        : "Subscribe"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Top-ups */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Credit Top-Ups</h2>
        <p className="text-sm text-muted-foreground mb-4">One-time credit purchases — never expire.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {TOP_UPS.map((topUp) => {
            const isCheckingOut = checkingOut === topUp.id;
            const cpl = (topUp.priceUsd / topUp.credits).toFixed(2);
            return (
              <Card key={topUp.id}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <span className="font-semibold">{topUp.credits.toLocaleString()} credits</span>
                  </div>
                  <div className="text-2xl font-bold mb-0.5">${topUp.priceUsd}</div>
                  <p className="text-xs text-muted-foreground mb-4">${cpl}/credit</p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleTopUp(topUp)}
                    disabled={!!checkingOut}
                    data-testid={`button-topup-${topUp.id}`}
                  >
                    {isCheckingOut ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 mr-2" />
                    )}
                    Buy Now
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
