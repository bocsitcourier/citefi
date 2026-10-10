import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanSelectionNotice } from "@/components/marketing/plan-selection-notice";
import Link from "next/link";
import { MarketingQuestions } from "@/components/marketing/questions";
import { CheckoutButton } from "@/components/marketing/checkout-button";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import { BILLING_PLANS, getAnnualPriceUsd, PUBLIC_PRICING_PLAN_IDS, TOP_UPS } from "@/lib/billing/plans";
import { CREDIT_MENU } from "@/lib/credit-menu-defaults";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { marketingMetadata } from "@/lib/marketing/metadata";

export const metadata: Metadata = marketingMetadata("Pricing", "Compare Citefi subscription plans, real credit costs, and account limits. The free offer is one article, not a credit bundle.", "/pricing");
const plans = PUBLIC_PRICING_PLAN_IDS.map((id) => ({ ...BILLING_PLANS[id], annualPrice: getAnnualPriceUsd(BILLING_PLANS[id]) }));
const operations = [
  ["Article", CREDIT_MENU.article, "A locally informed article draft"],
  ["Podcast", CREDIT_MENU.podcast, "Two-voice audio from an article"],
  ["Video", CREDIT_MENU.video, "A short video with narration"],
  ["Social post batch", CREDIT_MENU.social_batch, "Posts prepared for multiple channels"],
] as const;
const starterPlan = BILLING_PLANS.starter;
const growthPlan = BILLING_PLANS.growth;
const agencyPlan = BILLING_PLANS.agency;
const pricingQuestions = [
  { question: "Does the free article include monthly credits?", answer: "No. The free offer is one article, not a monthly plan or credit bundle. Existing credit balances are not changed." },
  { question: "Which plan fits an owner who creates content regularly?", answer: `${starterPlan.name} includes ${starterPlan.monthlyCredits} monthly credits at $${starterPlan.priceUsd} per month with up to ${starterPlan.maxSeats} seats. ${growthPlan.name} includes ${growthPlan.monthlyCredits} monthly credits at $${growthPlan.priceUsd} per month with up to ${growthPlan.maxSeats} seats and its additional features shown above.` },
  { question: "What does an agency subscription include?", answer: `${agencyPlan.name} is $${agencyPlan.priceUsd} per month and includes ${agencyPlan.monthlyCredits.toLocaleString()} monthly credits, up to ${agencyPlan.maxSeats} seats, and up to ${agencyPlan.maxClientWorkspaces} child client workspaces with separate balances.` },
  { question: "How does annual billing work?", answer: "Annual subscriptions charge ten monthly prices up front for twelve months of service. Credits continue to refresh monthly. The annual amount for each plan is shown with that plan above." },
  { question: "Can I buy extra credits?", answer: "One-time top-ups are available to signed-in accounts through billing. Top-up credits do not expire; current credit pack prices and amounts are listed above." },
];
export default function PricingPage() {
  return <MarketingFrame><main className="longform pricing-page">
    <Breadcrumbs items={[{ label: "Pricing" }]} />
    <section className="longform-hero"><div className="eyebrow">Plans from the live catalog</div><h1>Pay for the work<br /><em>you actually need.</em></h1><p>Clear monthly credit amounts and seat limits. The one-article free offer is separate from credits and never replaces or alters an existing balance.</p></section>
    <div className="annual-note"><b>Annual billing:</b> ten monthly prices are charged upfront for twelve months of service. Credits still refresh monthly.</div>
    <Suspense fallback={null}><PlanSelectionNotice /></Suspense>
    <section className="plans-grid" id="plans">{plans.map((plan, i) => <article className={`plan-panel ${plan.id === "growth" ? "featured" : ""}`} key={plan.id}>
      {plan.id === "growth" && <div className="plan-stamp">More room to grow</div>}
      <div className="plan-kicker">0{i + 1} / {plan.id === "free" ? "Try it" : "Subscription"}</div><h2>{plan.name}</h2>
      <div className="plan-price">{plan.priceUsd ? `$${plan.priceUsd}` : "No charge"}<small>{plan.priceUsd ? " / month" : " one article"}</small></div>
      {plan.priceUsd > 0 && <div className="annual-price">${plan.annualPrice} billed annually · effective ${(plan.annualPrice / 12).toFixed(2)}/month</div>}
      <p className="plan-credits">{plan.id === "free" ? "One free article · no credit bundle" : `${plan.monthlyCredits.toLocaleString()} credits each month`}{plan.maxSeats ? ` · up to ${plan.maxSeats} seats` : ""}</p>
      <ul>{plan.features.map((feature) => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
      {plan.id === "free" ? <Link className="plan-action" href="/free-article">Try one article<ArrowRight size={16} /></Link> : <CheckoutButton planId={plan.id} />}
    </article>)}</section>
    <section className="pricing-explainer"><div><div className="eyebrow">Credit menu</div><h2>Know the cost before you make the draft.</h2><p>Credit costs come from the current operation menu. Your plan and balance determine access.</p></div><div className="operation-list">{operations.map(([name, cost, desc]) => <div key={name}><span><b>{name}</b><small>{desc}</small></span><strong>{cost} <small>credits</small></strong></div>)}</div></section>
    <section className="topup-strip"><div><div className="eyebrow">One-time top-ups</div><h2>Keep extra credits on hand.</h2><p>Top-up credits do not expire. Purchase is available to signed-in accounts through billing.</p></div><div className="topup-options">{TOP_UPS.map((item) => <article key={item.id}><small>{item.label}</small><b>{item.credits} credits</b><span>${item.priceUsd}</span><Link href="/settings/billing">Buy in billing <ArrowRight size={13} /></Link></article>)}</div></section>
    <section className="enterprise-note"><div><div className="eyebrow">Sales-assisted</div><h2>{BILLING_PLANS.enterprise.name}</h2><p>${BILLING_PLANS.enterprise.priceUsd}/month · {BILLING_PLANS.enterprise.monthlyCredits.toLocaleString()} monthly credits · unlimited seats and client workspaces. Sales-assisted and not available through self-serve checkout.</p></div><a href="mailto:hello@citefi.co">Contact sales <ExternalLink size={14} /></a></section>
    <section className="pricing-disclaimer"><b>One article means one article.</b><p>It does not include free monthly credits, an added balance, or an automatic plan upgrade. Existing credits and balances are not affected by trying the article preview.</p><Link href="/faq">See pricing and free-offer FAQs <ArrowRight size={14} /></Link></section>
    <MarketingQuestions questions={pricingQuestions} />
  </main></MarketingFrame>;
}
