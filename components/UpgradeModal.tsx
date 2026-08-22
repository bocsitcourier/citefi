"use client";

import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Zap, ArrowUpRight, X } from "lucide-react";
import { BILLING_PLANS, TOP_UPS } from "@/lib/billing/plans";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

interface PaywallDetail {
  error?: string;
  reason?: string;
  planId?: string;
  billingStatus?: string;
  creditBalance?: number;
  upgradeUrl?: string;
  message?: string;
}

const UPGRADE_PLANS = [
  BILLING_PLANS.starter,
  BILLING_PLANS.growth,
] as const;

export function UpgradeModal() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PaywallDetail | null>(null);

  useEffect(() => {
    function handlePaywall(e: Event) {
      const ce = e as CustomEvent<PaywallDetail>;
      setDetail(ce.detail ?? null);
      setOpen(true);
    }
    window.addEventListener("citefi:paywall", handlePaywall);
    return () => window.removeEventListener("citefi:paywall", handlePaywall);
  }, []);

  const checkoutMutation = useMutation({
    mutationFn: (planId: string) =>
      apiRequest("/api/billing/checkout", { method: "POST", body: JSON.stringify({ kind: "subscription", planId }) }),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url;
    },
    onError: (err: Error) => {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    },
  });

  const topUpMutation = useMutation({
    mutationFn: (topUpId: string) =>
      apiRequest("/api/billing/checkout", { method: "POST", body: JSON.stringify({ kind: "topup", topUpId }) }),
    onSuccess: (res) => {
      if (res?.url) window.location.href = res.url;
    },
    onError: (err: Error) => {
      toast({ title: "Could not start credit purchase", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const isFreePlan = !detail?.planId || detail.planId === "free";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {isFreePlan ? "Add credits or upgrade" : "Out of credits"}
          </DialogTitle>
          <DialogDescription>
            {detail?.reason ?? detail?.message ?? "You've used all your available credits. Add a pack now or choose a plan to continue."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
          {UPGRADE_PLANS.map(plan => {
            const isCurrent = detail?.planId === plan.id;
            return (
              <div
                key={plan.id}
                className="rounded-md border p-4 space-y-3 relative"
                data-testid={`upgrade-plan-${plan.id}`}
              >
                {plan.id === "growth" && (
                  <Badge className="absolute -top-2.5 left-3 text-xs">Most popular</Badge>
                )}
                <div>
                  <p className="font-semibold text-sm">{plan.name}</p>
                  <p className="text-xs text-muted-foreground">${plan.priceUsd}/month</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-medium">{plan.monthlyCredits.toLocaleString()} credits/mo</span>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  variant={plan.id === "growth" ? "default" : "outline"}
                  disabled={isCurrent || checkoutMutation.isPending}
                  onClick={() => checkoutMutation.mutate(plan.id)}
                  data-testid={`button-upgrade-to-${plan.id}`}
                >
                  {checkoutMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : isCurrent
                      ? "Current plan"
                      : <>
                          <ArrowUpRight className="h-4 w-4 mr-1" />
                          Upgrade
                        </>}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="border-t pt-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Add credits now</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              One-time packs are available whenever you run out and never expire.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TOP_UPS.map((topUp) => (
              <div key={topUp.id} className="rounded-md border p-3 space-y-2" data-testid={`upgrade-topup-${topUp.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-sm">${topUp.priceUsd}</span>
                  <span className="text-xs text-muted-foreground">{topUp.credits} credits</span>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  variant="secondary"
                  disabled={topUpMutation.isPending}
                  onClick={() => topUpMutation.mutate(topUp.id)}
                  data-testid={`button-topup-from-modal-${topUp.id}`}
                >
                  {topUpMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <>Add credits</>}
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/billing" onClick={handleClose} data-testid="link-billing-from-modal">
              View all options
            </Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClose} data-testid="button-dismiss-upgrade">
            <X className="h-4 w-4 mr-1" /> Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
