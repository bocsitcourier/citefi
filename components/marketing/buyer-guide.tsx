import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { CREDIT_MENU } from "@/lib/credit-menu-defaults";
import { articleBriefHref } from "@/lib/marketing/solutions";
import type { BusinessSolution } from "@/lib/marketing/solutions";
import { CampaignExample } from "./campaign-example";
import { ProductDirectory } from "./product-directory";

export function PlanGuide({ agency = false }: { agency?: boolean }) {
  const ids = ["starter", "growth", "agency"] as const;
  const cycleCredits = CREDIT_MENU.article + CREDIT_MENU.podcast + CREDIT_MENU.social_batch + CREDIT_MENU.video;
  return <section className="buyer-plan-guide">
    <div className="eyebrow">Choose a plan around your workload</div><h2>{agency ? "Room for distinct clients and a clear handoff." : "Start with a realistic marketing cadence."}</h2>
    <p className="section-intro">Your plan sets a monthly credit allowance and team limits. Think about the work you intend to produce, the people reviewing it and whether you manage separate clients—not just the number of articles.</p>
    <div className="plan-guide-grid">{ids.map(id => {
      const plan = BILLING_PLANS[id];
      return <article className="plan-guide-card" key={id}><h3>{plan.name}</h3><p className="plan-guide-price">${plan.priceUsd}<span>/month</span></p>
        <p>{plan.monthlyCredits.toLocaleString()} monthly credits · up to {plan.maxSeats} seats</p>
        <p>{id === "starter" ? "A smaller recurring workload with a small review team." : id === "growth" ? "More credit room for regular content and a multi-format schedule." : `Up to ${plan.maxClientWorkspaces} child client workspaces, with separate balances.`}</p>
        <Link href={`/pricing?plan=${id}#plans`} className="text-link">Review {plan.name} and choose <ArrowRight size={14} /></Link>
      </article>;
    })}</div>
    <details className="credit-planning"><summary>How could a multi-format workload use credits?</summary>
      <p>Illustrative default-credit budget: one article ({CREDIT_MENU.article}), one podcast ({CREDIT_MENU.podcast}), one social batch ({CREDIT_MENU.social_batch}) and the menu's 60-second video operation ({CREDIT_MENU.video}) total <strong>{cycleCredits} credits</strong>.</p>
      <p>This is not a guaranteed bundle or output count. Image/regeneration and other additional operations are not included in that example. Current team/admin overrides, workflow settings and provider availability can change the applicable cost or output. Check Billing before planning your workload.</p>
    </details>
    <p className="example-disclosure">Recommendations help compare budgets; they do not create a feature-unlock matrix. Annual billing and full catalog details are on Pricing. Approval and sign-in are required before workspace access and checkout.</p>
  </section>;
}

export function BuyerGuide({ solution, city, full = false }: { solution?: BusinessSolution; city?: string; full?: boolean }) {
  const business = solution?.name.toLowerCase() || "a local retail shop";
  const question = solution?.topic || "How do I choose the right product and arrange collection?";
  const audience = solution?.audience;
  return <>
    <section className="buyer-question-section"><div className="eyebrow">The questions a busy owner would ask</div>
      <h2>You need useful marketing—not another blank screen.</h2>
      <div className="buyer-question-grid">
        <article><h3>“How do I explain why people should choose us?”</h3><p>{solution?.pain || "Bring your real offer, process and audience into the brief. Develop articles and clear answers around the decisions customers actually need to make."}</p><Link href="/features/brand-intelligence">Start with business context <ArrowRight size={14} /></Link></article>
        <article><h3>“Can one topic work beyond our website?”</h3><p>Develop related images, platform-shaped social drafts, article-derived podcasts and video work. A consistent message can serve readers, listeners and viewers without five disconnected briefs.</p><Link href="/features/campaigns">Connect the formats <ArrowRight size={14} /></Link></article>
        <article><h3>“What happens after someone sees the content?”</h3><p>{city ? `For your ${city} service area, ` : ""}Plan the real next action: compare options, check coverage, ask a question, book or buy. Use customer journeys to organize useful content at each stage.</p><Link href="/features/customer-journeys">Build the next-step journey <ArrowRight size={14} /></Link></article>
        <article><h3>“Will I lose control of what goes out?”</h3><p>You review the facts, imagery, voice and offer. Supported website publishing is separately authorized; direct social-network connections are not live, and ads remain reviewed exports without autonomous spend.</p><Link href="/features/publishing">Understand delivery and review <ArrowRight size={14} /></Link></article>
      </div>
    </section>
    <ProductDirectory full={full} />
    {!city && <CampaignExample business={business} question={question} />}
    <PlanGuide agency={solution?.slug === "agencies"} />
    <section className="buyer-next-step"><div><div className="eyebrow">A practical next step</div><h2>Try the starting point.<br />Plan the work beyond it.</h2>
      <p>The free offer is one article: excerpt before signup, the same full watermarked article after signup. It is not a free podcast, image, social or video package. Paid reuse and ongoing work require the applicable approved-account and subscription access.</p></div>
      <div className="buyer-next-actions"><Link className="button-primary" href={articleBriefHref({ city, topic: solution?.topic, audience })}>Try my free article <ArrowRight size={15} /></Link><Link className="button-light" href="/pricing#plans">Compare paid plans <ArrowRight size={15} /></Link></div>
    </section>
  </>;
}
