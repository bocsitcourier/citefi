import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { articleBriefHref, businessSolutions } from "@/lib/marketing/solutions";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { MarketingQuestions } from "@/components/marketing/questions";
import { MarketingImage } from "@/components/marketing/marketing-image";

export function generateStaticParams() { return businessSolutions.map((solution) => ({ slug: solution.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const solution = businessSolutions.find((item) => item.slug === slug);
  if (!solution) return { title: "Use case not found" };
  return marketingMetadata(`${solution.name} — buyer-question content workflows`, `${solution.promise} See an illustrative four-stage buyer journey and start a reviewable article brief for ${solution.name.toLowerCase()}.`, `/solutions/${solution.slug}`);
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = businessSolutions.find((item) => item.slug === slug);
  if (!solution) notFound();
  const faq = [
    { question: `How can Citefi help ${solution.name.toLowerCase()}?`, answer: `${solution.promise} Citefi can prepare a draft from your business brief. You supply and verify your actual services, process, claims and next steps.` },
    { question: "Are the journey and article examples customer results?", answer: "No. This is an illustrative planning scenario, not a customer, testimonial, published campaign or performance result." },
    { question: "Can I review the free article before choosing a plan?", answer: "Yes. The one-article free offer is separate from monthly credits. You can read an excerpt before signup and the same full article with a watermark after signup." },
    { question: "Does creating a draft publish it?", answer: "No. Creating a draft does not authorize publication. For supported connected accounts, Citefi provides separately authorized publishing workflows, subject to configuration and review. Ads remain export-only: a person reviews and uploads them, and Citefi does not place ads or spend advertising budget autonomously." },
  ];
  return <MarketingFrame comprehensive={{ solution }}><main className="longform solution-detail">
    <Breadcrumbs items={[{ label: "Solutions", href: "/solutions" }, { label: solution.name }]} />
    <section className="solution-hero">
      <div className="solution-hero-copy"><div className="eyebrow">A buyer-question playbook / {solution.name}</div><h1>{solution.promise}</h1><p>{solution.pain}</p><div className="solution-audience"><span>WHO IT HELPS</span><b>{solution.audience}</b></div><Link href={articleBriefHref({ topic: solution.topic, audience: solution.audience })} className="button-primary">Start this free article <ArrowRight size={16} /></Link><small className="hero-small-note">Illustrative use case · check every business detail before use</small></div>
      <figure className="solution-image"><MarketingImage src={solution.image} alt={solution.imageAlt} pagePath={`/solutions/${solution.slug}`} loading="eager" fetchPriority="high" /><figcaption>Representative stock photography · not a Citefi customer or endorsement</figcaption></figure>
    </section>
    <section className="solution-problem"><div><div className="eyebrow">The familiar friction</div><h2>Marketing time is scarce.<br />Customer questions are not.</h2></div><div><p>{solution.pain}</p><p>The useful answer starts from what a customer needs to decide and what your business can substantiate. No invented reviews, blanket claims or local detail by implication.</p></div></section>
    <section className="journey-detail"><div className="journey-detail-head"><div className="eyebrow">A sample customer journey</div><h2>Answer the next question,<br /><em>not every question at once.</em></h2><p>A planning scenario for {solution.name.toLowerCase()}. Content, policies and calls to action below are examples to adapt—not finished business copy.</p></div>
      <div className="journey-detail-list">{solution.journey.map((step, index) => <article className="journey-detail-step" key={step.stage}><div className="journey-detail-stepno">0{index + 1}<span /></div><div className="journey-stage"><small>BUYER STAGE</small><b>{step.stage}</b></div><div className="journey-question"><small>THE QUESTION</small><h3>{step.question}</h3><p>{step.content}</p></div><aside><small>POSSIBLE NEXT STEP</small><span>{step.nextStep}</span><Link href={articleBriefHref({ topic: step.question, audience: solution.audience })} aria-label={`Create an article brief for ${step.question}`}><ArrowUpRight size={17} /></Link></aside></article>)}</div>
      <p className="journey-caption">Illustrative buyer journey based on a sample use case. Confirm actual policies, availability and offers with the business.</p>
    </section>
    <section className="solution-brief"><div><div className="eyebrow">Your first brief, already closer</div><h2>Start with a question<br />your customer asks.</h2><p>{solution.topic}</p><Link className="button-light" href={articleBriefHref({ topic: solution.topic, audience: solution.audience })}>Use this article prompt <ArrowRight size={16} /></Link></div><aside><span>BEFORE IT LEAVES THE WORKSPACE</span><b><Check size={15} /> Does the copy match your actual service?</b><b><Check size={15} /> Can you verify each business claim?</b><b><Check size={15} /> Is the next action available and real?</b></aside></section>
    <section className="solution-next-links"><div className="eyebrow">More useful paths</div>{businessSolutions.filter((item) => item.slug !== solution.slug).slice(0, 3).map((item) => <Link key={item.slug} href={`/solutions/${item.slug}`}>{item.name}<ArrowRight size={14} /></Link>)}<Link href="/for-teams">For owners and agencies<ArrowRight size={14} /></Link></section>
    <MarketingQuestions questions={faq} />
  </main></MarketingFrame>;
}
