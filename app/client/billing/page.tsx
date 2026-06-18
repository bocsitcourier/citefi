"use client";

import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Zap, CheckCircle2, ArrowUpRight, ExternalLink } from "lucide-react";
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

const PLAN_ORDER: string[] = ["free", "starter", "pro", "agency"];

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

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your subscription and credits</p>
      </div>

      {/* Current plan */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Current Plan</CardTitle>
            <CardDescription>
              {plan.priceUsd === 0 ? "Free tier" : `$${plan.priceUsd}/month`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
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
            {billing.currentPeriodEnd && (
              <div>
                <p className="text-xs text-muted-foreground">Period ends</p>
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

          {billing.hasSubscription && (
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
      {plan.id !== "agency" && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Upgrade your plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.values(BILLING_PLANS)
              .filter(p => p.id !== "free" && PLAN_ORDER.indexOf(p.id) > currentPlanIndex)
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
                      Upgrade to {p.name}
                    </Button>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* Top-ups */}
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
    </div>
  );
}
