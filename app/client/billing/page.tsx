"use client";

import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Zap, CheckCircle2, ArrowUpRight, ExternalLink, AlertTriangle, Clock } from "lucide-react";
import { BILLING_PLANS, TOP_UPS } from "@/lib/billing/plans";
import { useToast } from "@/hooks/use-toast";

interface BillingStatus {
  plan: {
    id: string;
    name: string;
    monthlyCredits: number;
    priceUsd: number;
    features: string[];
  };
  billing: {
    status: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean | null;
    hasActivePlan: boolean;
    hasCustomer: boolean;
    hasSubscription: boolean;
  };
  credits: { balance: number };
}

const PLAN_ORDER: string[] = ["free", "starter", "growth", "agency", "enterprise"];

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trialing: "secondary",
  past_due: "destructive",
  canceled: "outline",
};

function isTrialExpired(billing: BillingStatus["billing"]): boolean {
  if (billing.status !== "trialing") return false;
  if (!billing.currentPeriodEnd) return false;
  return new Date(billing.currentPeriodEnd) < new Date();
}

export default function BillingPage() {
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    queryFn: () => apiRequest("/api/billing/status"),
    staleTime: 30_000,
  });

  const checkoutMutation = useMutation({
    mutationFn: ({ planId, kind = "subscription" }: { planId: string; kind?: string }) =>
      apiRequest("/api/billing/checkout", { method: "POST", body: JSON.stringify({ kind, planId }) }),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url;
    },
    onError: (err: Error) => {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  const topUpMutation = useMutation({
    mutationFn: ({ topUpId }: { topUpId: string }) =>
      apiRequest("/api/billing/checkout", { method: "POST", body: JSON.stringify({ kind: "topup", topUpId }) }),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url;
    },
    onError: (err: Error) => {
      toast({ title: "Top-up failed", description: err.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: () => apiRequest("/api/billing/portal", { method: "POST" }),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url;
    },
    onError: (err: Error) => {
      toast({ title: "Portal unavailable", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Failed to load billing info. Please refresh and try again.
      </div>
    );
  }

  const { plan, billing, credits } = data;
  const currentPlanIndex = PLAN_ORDER.indexOf(plan.id);
  const trialExpired = isTrialExpired(billing);
  const isPastDue = billing.status === "past_due";

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your subscription and credits</p>
      </div>

      {/* Trial expired banner */}
      {trialExpired && (
        <div
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          data-testid="banner-trial-expired"
        >
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              Your trial has ended
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Your trial expired on {formatDate(billing.currentPeriodEnd)}. Add a payment method to continue generating content.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => checkoutMutation.mutate({ planId: "starter", kind: "subscription" } as any)}
            disabled={checkoutMutation.isPending}
            data-testid="button-trial-expired-upgrade"
          >
            {checkoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add payment method"}
          </Button>
        </div>
      )}

      {/* Past due warning banner */}
      {isPastDue && !trialExpired && (
        <div
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
          data-testid="banner-past-due"
        >
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">Payment failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Your last payment was unsuccessful. Please update your payment method to avoid service interruption.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending}
            data-testid="button-fix-payment"
          >
            {portalMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fix payment"}
          </Button>
        </div>
      )}

      {/* Current plan */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Current Plan</CardTitle>
            <CardDescription>
              {plan.priceUsd === 0 ? "Free tier" : `$${plan.priceUsd}/month`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <Badge variant="outline" className="text-sm font-medium">{plan.name}</Badge>
            {billing.status && (
              <Badge variant={STATUS_BADGE[billing.status] ?? "outline"} data-testid="badge-billing-status">
                {billing.status}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Credits balance</p>
              <p className="text-2xl font-bold" data-testid="text-billing-credits">{credits.balance.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Monthly allowance</p>
              <p className="text-2xl font-bold">{plan.monthlyCredits.toLocaleString()}</p>
            </div>
            {billing.currentPeriodEnd && !trialExpired && (
              <div>
                <p className="text-xs text-muted-foreground">
                  {billing.status === "trialing" ? "Trial ends" : "Period ends"}
                </p>
                <p className="text-sm font-medium">{formatDate(billing.currentPeriodEnd)}</p>
              </div>
            )}
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {plan.features.map(f => (
              <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          {billing.hasSubscription && !trialExpired && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              data-testid="button-billing-portal"
            >
              {portalMutation.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <ExternalLink className="h-4 w-4 mr-2" />}
              Manage subscription
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Upgrade plans */}
      {plan.id !== "enterprise" && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {trialExpired ? "Choose a plan to continue" : "Upgrade your plan"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.values(BILLING_PLANS)
              .filter(p => p.id !== "free" && PLAN_ORDER.indexOf(p.id) > (trialExpired ? -1 : currentPlanIndex))
              .map(p => (
                <Card key={p.id} className="relative">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>${p.priceUsd}/month</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm font-medium">{p.monthlyCredits.toLocaleString()} credits/mo</p>
                    <ul className="space-y-1.5">
                      {p.features.slice(0, 4).map(f => (
                        <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={() => checkoutMutation.mutate({ planId: p.id, kind: "subscription" } as any)}
                      disabled={checkoutMutation.isPending}
                      data-testid={`button-upgrade-${p.id}`}
                    >
                      {checkoutMutation.isPending
                        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        : <ArrowUpRight className="h-4 w-4 mr-2" />}
                      {trialExpired ? `Start with ${p.name}` : `Upgrade to ${p.name}`}
                    </Button>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* Top-ups — only for active paid plans */}
      {billing.hasActivePlan && !trialExpired && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Buy extra credits</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {TOP_UPS.map(t => (
              <Card key={t.id}>
                <CardContent className="pt-5 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-primary" />
                      <span className="font-semibold">{t.credits.toLocaleString()} credits</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">${t.priceUsd} one-time</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => topUpMutation.mutate({ topUpId: t.id })}
                    disabled={topUpMutation.isPending}
                    data-testid={`button-topup-${t.id}`}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Buy
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
