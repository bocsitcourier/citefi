"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { articleBriefHref, businessSolutions } from "@/lib/marketing/solutions";
import { CampaignExample } from "./campaign-example";

/** An editorial planning tool, not a claim about real customers or results. */
export function CustomerJourney({ city }: { city: string }) {
  const id = useId();
  const [slug, setSlug] = useState(businessSolutions[0]!.slug);
  const solution = businessSolutions.find(item => item.slug === slug) ?? businessSolutions[0]!;
  return <section className="journey-detail" aria-labelledby={`${id}-heading`}>
    <div className="journey-detail-head">
      <div className="eyebrow">From first question to next visit</div>
      <h2 id={`${id}-heading`}>Give your {city} customers<br /><em>a reason to take the next step.</em></h2>
      <p>See how useful content can support a buying decision—not just fill a blog. Choose your business type to explore an illustrative customer journey.</p>
      <label htmlFor={`${id}-industry`} className="mt-6 block text-sm font-semibold">Business type</label>
      <select id={`${id}-industry`} value={slug} onChange={event => setSlug(event.target.value)}
        className="mt-2 min-h-11 max-w-full rounded border border-current bg-transparent px-3 py-2 text-sm">
        {businessSolutions.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
      </select>
    </div>
    <div className="journey-detail-list" aria-live="polite">
      {solution.journey.map((step, index) => <article className="journey-detail-step" key={`${slug}-${step.stage}`}>
        <div className="journey-detail-stepno">0{index + 1}<span /></div>
        <div className="journey-stage"><small>BUYER STAGE</small><b>{step.stage}</b></div>
        <div className="journey-question"><small>THE CUSTOMER ASKS</small><h3>{step.question}</h3><p>{step.content}</p></div>
        <aside><small>NEXT STEP TO OFFER</small><span>{step.nextStep}</span>
          <Link className="mt-3 inline-block underline" href={articleBriefHref({ city, topic: step.question, audience: solution.audience })}>Start this article</Link>
        </aside>
      </article>)}
    </div>
    <p className="journey-caption">Illustrative planning example, not a customer result. Adapt each step to the services, policies and contact options your business actually offers.</p>
    <div className="journey-format-links"><Link href="/features/social-media">Social drafts for discovery</Link><Link href="/features/podcasts">Audio for explanation</Link><Link href="/features/video">Video for preparation</Link><Link href="/features/customer-journeys">Content for the next step</Link></div>
    <CampaignExample business={`${solution.name.toLowerCase()} serving ${city}`} question={solution.topic} />
  </section>;
}
