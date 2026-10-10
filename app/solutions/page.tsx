import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { businessSolutions } from "@/lib/marketing/solutions";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { MarketingQuestions } from "@/components/marketing/questions";
import { MarketingImage } from "@/components/marketing/marketing-image";

export const metadata = marketingMetadata("Solutions for local businesses and agencies", "See how owner-operators and agencies can turn buyer questions into reviewable articles and customer journeys—with examples for six kinds of business.", "/solutions");

export default function SolutionsPage() {
  return <MarketingFrame><main className="longform solutions-page">
    <Breadcrumbs items={[{ label: "Solutions" }]} />
    <section className="solutions-hero"><div><div className="eyebrow">Useful work, shaped around your business</div><h1>Different businesses.<br /><em>Different reasons to choose.</em></h1><p>People need more than a list of services before they buy. Explore specific ways to answer the questions they ask at each step—from first concern to follow-up.</p><Link className="button-primary" href="/free-article">Start with one free article <ArrowRight size={16} /></Link></div><aside><span>ONE QUESTION</span><b>One clear answer<br />can start a<br /><em>better journey.</em></b><small>Examples below are planning scenarios, not customer stories.</small></aside></section>
    <section className="solutions-intro"><div className="eyebrow">Choose your kind of work</div><h2>Start where your buyer<br />is trying to get.</h2><p>Each example is grounded in business-specific questions. The article brief passes the topic and audience forward, so you start closer to the work.</p></section>
    <section className="solutions-list">{businessSolutions.map((solution, index) => <article className="solution-preview" key={solution.slug}>
      <div className="solution-preview-image"><MarketingImage src={solution.image} alt={solution.imageAlt} pagePath="/solutions" /><span>Representative stock photography · not a customer</span><b>0{index + 1}</b></div>
      <div className="solution-preview-copy"><div className="eyebrow">{solution.name}</div><h3>{solution.promise}</h3><p>{solution.pain}</p><div className="solution-example"><small>STARTING QUESTION</small><b>{solution.topic}</b></div><Link href={`/solutions/${solution.slug}`} className="text-link">See the journey <ArrowRight size={15} /></Link></div>
    </article>)}</section>
    <section className="solution-workflow-band"><div><div className="eyebrow">From page to practice</div><h2>Useful from first search<br />to next conversation.</h2></div><div><p>The examples are a starting point, not pre-approved content. Bring in your real policies, coverage, expertise and next steps. Then review each draft before external use.</p><Link href="/workflow" className="text-link">How the workflow works <ArrowUpRight size={15} /></Link></div></section>
    <MarketingQuestions questions={[
      { question: "Are these examples real customer campaigns?", answer: "No. They are illustrative planning scenarios based on the business-use-case data. They are not customers, published work or evidence of performance." },
      { question: "Will Citefi know my services and policies automatically?", answer: "No. Provide your actual services, audience, process and verified details in the brief. Review generated copy and correct anything that does not fit your business." },
      { question: "Can I start with an article before buying a plan?", answer: "Yes. The offer is one free article, separate from paid monthly credits. Read an excerpt before signup and the same full article with a watermark after signup." },
      { question: "Can agencies use different examples for each client?", answer: "Yes. Agency workspaces keep client context and credit balances distinct. The Agency plan includes up to 25 child client workspaces." },
    ]} />
  </main></MarketingFrame>;
}
