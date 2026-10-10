import type { Metadata } from "next";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { MarketingQuestions } from "@/components/marketing/questions";
import CityDirectory from "@/components/marketing/city-directory";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { marketingMetadata } from "@/lib/marketing/metadata";
export const metadata: Metadata = marketingMetadata("Cities — start a locally relevant article brief", "Choose a city and start with one question customers ask before they buy. Add verified business facts; skip generic city-page filler.", "/cities");
export default function CitiesPage() {
  return <MarketingFrame><main className="longform cities-page">
    <Breadcrumbs items={[{ label: "Cities" }]} />
    <section className="city-directory-hero">
      <div><div className="eyebrow">A directory for better briefs</div><h1>Start with a place.<br /><em>Answer a real question.</em></h1><p>Choose the city you serve, then pair it with a customer question and your actual business details. This is an online content workspace—not a directory of Citefi offices or local customers.</p><div className="city-promise"><span>01 / CITY CONTEXT</span><span>02 / YOUR BUSINESS</span><span>03 / BUYER QUESTION</span></div></div>
      <aside className="city-index-card"><span>THE LOCAL BRIEF</span><b>Place is the<br />starting point.<br /><em>Not the proof.</em></b><p>Specificity comes from what your business can verify.</p></aside>
    </section>
    <section className="city-brief-preview"><div><div className="eyebrow">Make the detail count</div><h2>Local does not mean<br />adding a city name.</h2></div><p>A useful local article explains the service, process, coverage or options relevant to the person reading. Add only the facts your business can confirm. Citefi will not invent local offices, reviews, neighborhoods or demand to make a page sound specific.</p></section>
    <CityDirectory />
    <section className="city-directory-after"><div><div className="eyebrow">After you choose a place</div><h2>Give the article<br />a reason to exist.</h2></div><div><p>Ask what someone needs to know before booking or buying. Citefi can prepare the first article draft, while you add the details only your business knows: what you offer, how it works and what to do next.</p><Link href="/solutions" className="text-link">Find your business use case <ArrowRight size={15} /></Link></div></section>
    <MarketingQuestions questions={[
      { question: "What are these city pages for?", answer: "They provide city and state context for starting an article brief. They are not local office listings, market-size estimates or customer evidence." },
      { question: "Does choosing a city automatically add local facts?", answer: "No. The city can be passed into your article brief. You provide verified service-area details, hours, offers and business-specific information." },
      { question: "How can I avoid a generic city page?", answer: "Lead with a real customer question and explain your actual service, process or options. Do not rely on a city name repeated in generic claims." },
      { question: "Can I start without a subscription?", answer: "Yes. The free offer is one article, separate from monthly credits. Read an excerpt before signup and the same full article with a watermark after signup." },
    ]} />
  </main></MarketingFrame>;
}
