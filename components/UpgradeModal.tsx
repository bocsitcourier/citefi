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
import { BILLING_PLANS } from "@/lib/billing/plans";
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
  BILLING_PLANS.pro,
  BILLING_PLANS.agency,
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
    window.addEventListener("apex:paywall", handlePaywall);
    return () => window.removeEventListener("apex:paywall", handlePaywall);
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
            {isFreePlan ? "Upgrade to continue" : "Out of credits"}
          </DialogTitle>
          <DialogDescription>
            {detail?.reason ?? detail?.message ?? "You've used all your available credits. Choose a plan to continue generating content."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4">
          {UPGRADE_PLANS.map(plan => {
            const isCurrent = detail?.planId === plan.id;
            return (
              <div
                key={plan.id}
                className="rounded-md border p-4 space-y-3 relative"
                data-testid={`upgrade-plan-${plan.id}`}
              >
                {plan.id === "pro" && (
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
                  variant={plan.id === "pro" ? "default" : "outline"}
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
