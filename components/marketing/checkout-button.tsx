"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { csrfFetch } from "@/lib/queryClient";
import { BILLING_PLANS, getAnnualPriceUsd } from "@/lib/billing/plans";
import { marketingPlan, readMarketingPlanIntent, saveMarketingPlanIntent } from "@/lib/marketing/plan-intent";
export function CheckoutButton({ planId }: { planId: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [annual, setAnnual] = useState(false);
  const id = marketingPlan(planId);
  const plan = id ? BILLING_PLANS[id] : undefined;
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const saved = readMarketingPlanIntent();
    if (search.get("plan") === planId) setAnnual(search.get("interval") === "annual");
    else if (saved?.plan === planId) setAnnual(saved.annual);
  }, [planId]);
  if (!plan) return <p role="alert">This plan is not available for self-service checkout.</p>;
  async function checkout() {
    if (busy) return;
    setBusy(true); setError("");
    saveMarketingPlanIntent(planId, annual);
    try {
      const response = await csrfFetch("/api/billing/checkout", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "subscription", planId, annual }) });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.message || data.error || "Checkout is not available.");
      window.location.assign(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout is not available."); setBusy(false); }
  }
  return <div className="marketing-checkout-choice">
    <label htmlFor={`billing-interval-${planId}`}>Billing interval for {plan.name}</label>
    <select id={`billing-interval-${planId}`} disabled={busy} value={annual ? "annual" : "monthly"} onChange={event => {
      const next = event.target.value === "annual"; setAnnual(next); saveMarketingPlanIntent(planId, next);
    }}><option value="monthly">Monthly — ${plan.priceUsd}/month</option><option value="annual">Annual — ${getAnnualPriceUsd(plan)} upfront</option></select>
    <p>{annual ? `$${getAnnualPriceUsd(plan)} billed upfront for 12 months. Credits refresh monthly.` : `$${plan.priceUsd} billed monthly. Credits refresh monthly.`}</p>
    {!user ? <Link href={`/signup?plan=${planId}&interval=${annual ? "annual" : "monthly"}`} onClick={() => saveMarketingPlanIntent(planId, annual)}>Create account for {plan.name} · {annual ? "annual" : "monthly"}</Link> : <button className="trial-submit" disabled={busy} onClick={() => void checkout()}>
    {busy ? "Opening checkout…" : `Choose ${plan.name} · ${annual ? "annual" : "monthly"}`}</button>}
    {error && <p role="alert">{error}</p>}</div>;
}
