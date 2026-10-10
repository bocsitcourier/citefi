"use client";
import { useSearchParams } from "next/navigation";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { marketingPlan } from "@/lib/marketing/plan-intent";
import { getProductFeature } from "@/lib/marketing/features";

export function PlanSelectionNotice() {
  const search = useSearchParams();
  const id = marketingPlan(search.get("plan"));
  const focus = getProductFeature(search.get("focus") || "");
  if (!id && !focus) return null;
  return <aside className="plan-selection-notice" aria-label="Your plan comparison" role="status">
    <strong>{id ? `Comparing ${BILLING_PLANS[id].name}: ${BILLING_PLANS[id].monthlyCredits.toLocaleString()} monthly credits. Choose monthly or annual billing on the plan card.` : `Comparing plans for ${focus!.name.toLowerCase()}.`}</strong>
    <p>Review the current catalog, workload and setup requirements below. Selecting a plan does not start billing. Create your account, wait for approval, sign in, then confirm your paid subscription through checkout.</p>
  </aside>;
}
