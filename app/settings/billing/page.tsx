"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, CreditCard, Zap, Rocket, TrendingUp,
  ArrowUpRight, RefreshCw, AlertTriangle,
} from "lucide-react";

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
    allowanceRemaining: number;
    purchasedRemaining: number;
    totalRemaining: number;
    allowanceCredits: number;
    purchasedCredits: number;
  };
}

interface PlanConfig {
  id: string;
  name: string;
  priceUsd: number;
  annualPriceUsd: number;
  monthlyCredits: number;
  features: string[];
  icon: React.ReactNode;
  highlight?: boolean;
}

interface TopUpConfig {
  id: string;
  credits: number;
  priceUsd: number;
  label: string;
}

const PLANS: PlanConfig[] = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 29,
    annualPriceUsd: 290,
    monthlyCredits: 50,
    icon: <Rocket className="w-5 h-5" />,
    features: [
      "50 credits per month",
      "Article generation",
      "Social posts",
      "Podcast generation",
      "Video scripts",
      "Priority queue",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    priceUsd: 89,
    annualPriceUsd: 890,
    monthlyCredits: 200,
    icon: <TrendingUp className="w-5 h-5" />,
    highlight: true,
    features: [
      "200 credits per month",
      "Everything in Starter",
      "AI learning system",
      "Content clusters",
      "Batch generation",
      "Advanced analytics",
    ],
  },
];

const TOP_UPS: TopUpConfig[] = [
  { id: "topup_20",  credits: 20,  priceUsd: 12,  label: "Starter Pack" },
  { id: "topup_50",  credits: 50,  priceUsd: 25,  label: "Small Pack" },
  { id: "topup_100", credits: 100, priceUsd: 45,  label: "Medium Pack" },
  { id: "topup_250", credits: 250, priceUsd: 100, label: "Large Pack" },
  { id: "topup_500", credits: 500, priceUsd: 180, label: "Bulk Pack" },
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

async function createCheckout(
  payload: { kind: "subscription"; planId: string; annual?: boolean } | { kind: "topup"; topUpId: string }
): Promise<{ url: string; portal?: boolean }> {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? "Checkout failed");
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
    throw new Error((err as any).error ?? "Failed to open billing portal");
  }
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    trialing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    past_due: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    canceled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
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
  const [annual, setAnnual] = useState(false);

  const { data: billing, isLoading, error, refetch } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    queryFn: fetchBillingStatus,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success")) {
      toast({ title: "Payment successful", description: "Your plan has been activated." });
      refetch();
      window.history.replaceState({}, "", "/settings/billing");
    }
    if (params.get("canceled")) {
      toast({ title: "Checkout canceled", description: "No charge was made.", variant: "destructive" });
      window.history.replaceState({}, "", "/settings/billing");
    }
  }, []);

  async function handleSubscribe(plan: PlanConfig) {
    setCheckingOut(plan.id);
    try {
      const result = await createCheckout({ kind: "subscription", planId: plan.id, annual });
      if (result.portal) {
        toast({ title: "Opening billing portal", description: "Use the portal to switch plans." });
      }
      window.location.href = result.url;
    } catch (err: any) {
      const msg: string = err.message ?? "Checkout failed";
      if (msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("seed")) {
        toast({
          title: "Billing not configured",
          description: "Run: npx tsx scripts/seed-stripe-products.ts",
          variant: "destructive",
        });
      } else if (msg.toLowerCase().includes("admin")) {
        toast({ title: "Permission denied", description: "Only team admins can manage billing.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    } finally {
      setCheckingOut(null);
    }
  }

  async function handleTopUp(topUp: TopUpConfig) {
    if (billing?.plan.id === "free") {
      toast({
        title: "Upgrade required",
        description: "Top-ups are not available on the Free plan. Upgrade to Starter or Growth first.",
        variant: "destructive",
      });
      return;
    }
    setCheckingOut(topUp.id);
    try {
      const result = await createCheckout({ kind: "topup", topUpId: topUp.id });
      window.location.href = result.url;
    } catch (err: any) {
      const msg: string = err.message ?? "Top-up failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
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
        toast({ title: "Permission denied", description: "Only team admins can manage billing.", variant: "destructive" });
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
    return <div className="p-6 text-center text-muted-foreground">Failed to load billing information.</div>;
  }

  const currentPlanId = billing.plan.id;
  const periodEnd = billing.billing.currentPeriodEnd
    ? new Date(billing.billing.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
  const totalRemaining = billing.credits.totalRemaining ?? billing.credits.balance;
  const allowanceRemaining = billing.credits.allowanceRemaining ?? 0;
  const purchasedRemaining = billing.credits.purchasedRemaining ?? 0;

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
            {openingPortal ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
            Manage Subscription
          </Button>
        )}
      </div>

      {/* Status cards */}
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
            <p className="text-sm text-muted-foreground">Available Credits</p>
            <div className="flex items-center gap-2 mt-1">
              <Zap className="w-5 h-5 text-yellow-500" />
              <span className="text-xl font-semibold tabular-nums">{totalRemaining.toLocaleString()}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              <p>{allowanceRemaining} allowance</p>
              {purchasedRemaining > 0 && <p>+ {purchasedRemaining} purchased</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Monthly Allowance</p>
            <div className="flex items-center gap-2 mt-1">
              <RefreshCw className="w-5 h-5 text-blue-500" />
              <span className="text-xl font-semibold tabular-nums">{billing.plan.monthlyCredits.toLocaleString()}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {currentPlanId === "free" ? "one-time grant" : "resets each cycle"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Paywall notice */}
      {currentPlanId === "free" && totalRemaining === 0 && (
        <Card className="border-yellow-200 dark:border-yellow-900/40 bg-yellow-50/50 dark:bg-yellow-900/10">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-yellow-900 dark:text-yellow-300">Free credits exhausted</p>
                <p className="text-sm text-yellow-800/80 dark:text-yellow-400/80 mt-1">
                  You have used all your free credits. Upgrade to continue generating content.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentPlanId === "free" && totalRemaining > 0 && (
        <Card className="border-muted bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                You are on the <strong>Free plan</strong> — {totalRemaining} credits remaining. Top-ups are not available on the Free plan. Upgrade for more credits and recurring allowances.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plans */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold">Plans</h2>
          <div className="flex items-center gap-2 bg-muted rounded-md p-1">
            <button
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${!annual ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setAnnual(false)}
              data-testid="button-billing-monthly"
            >
              Monthly
            </button>
            <button
              className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${annual ? "bg-background shadow-sm" : "text-muted-foreground"}`}
              onClick={() => setAnnual(true)}
              data-testid="button-billing-annual"
            >
              Annual <span className="text-green-600 font-semibold ml-0.5">−17%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            const isCheckingOut = checkingOut === plan.id;
            const displayPrice = annual
              ? `$${(plan.annualPriceUsd / 12).toFixed(2)}`
              : `$${plan.priceUsd}`;
            return (
              <Card key={plan.id} className={plan.highlight ? "border-primary" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {plan.icon}
                      <CardTitle className="text-base">{plan.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {plan.highlight && <Badge variant="default" className="text-xs">Most Popular</Badge>}
                      {isCurrent && <Badge variant="outline" className="text-xs">Current</Badge>}
                    </div>
                  </div>
                  <div className="mt-2">
                    <span className="text-2xl font-bold tabular-nums">{displayPrice}</span>
                    <span className="text-muted-foreground text-sm">/month</span>
                    {annual && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (${plan.annualPriceUsd}/yr)
                      </span>
                    )}
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
        <p className="text-sm text-muted-foreground mb-4">
          One-time purchases — never expire.
          {currentPlanId === "free" && (
            <span className="ml-1 text-amber-600 dark:text-amber-400">Requires Starter or Growth plan.</span>
          )}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {TOP_UPS.map((topUp) => {
            const isCheckingOut = checkingOut === topUp.id;
            const cpl = (topUp.priceUsd / topUp.credits).toFixed(2);
            const disabled = currentPlanId === "free" || !!checkingOut;
            return (
              <Card key={topUp.id}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground mb-1">{topUp.label}</p>
                  <div className="flex items-center gap-1 mb-0.5">
                    <Zap className="w-3 h-3 text-yellow-500" />
                    <span className="font-semibold text-sm tabular-nums">{topUp.credits}</span>
                    <span className="text-xs text-muted-foreground">cr</span>
                  </div>
                  <div className="text-lg font-bold mb-0.5">${topUp.priceUsd}</div>
                  <p className="text-[10px] text-muted-foreground mb-3">${cpl}/credit</p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleTopUp(topUp)}
                    disabled={disabled}
                    data-testid={`button-topup-${topUp.id}`}
                  >
                    {isCheckingOut ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3 mr-1" />
                    )}
                    Buy
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
