import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { productFeatures, getProductFeature } from "@/lib/marketing/features";
import { CREDIT_MENU } from "@/lib/credit-menu-defaults";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { MarketingQuestions } from "@/components/marketing/questions";
import { PlanGuide } from "@/components/marketing/buyer-guide";
import { FeatureSchema } from "@/components/marketing/feature-schema";

export function generateStaticParams() { return productFeatures.map(feature => ({ slug: feature.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const feature = getProductFeature((await params).slug);
  return feature ? marketingMetadata(`${feature.name} for small-business marketing`, feature.summary, `/features/${feature.slug}`) : {};
}
export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const feature = getProductFeature((await params).slug);
  if (!feature) notFound();
  return <MarketingFrame comprehensive={false}><main className={`longform feature-page feature-${feature.slug}`}>
    <FeatureSchema feature={feature} /><Breadcrumbs items={[{ label: "Features", href: "/features" }, { label: feature.name }]} />
    <section className="editorial-hero"><div><div className="eyebrow">{feature.name}</div><h1>{feature.summary}</h1><p>{feature.pain}</p><p><strong>Who it helps:</strong> {feature.audience}</p>
      <div className="hero-actions"><Link className="button-primary" href={`/pricing?focus=${feature.slug}#plans`}>Compare plans for this work</Link><Link className="button-text" href="/free-article">Try the article starting point</Link></div></div>
    </section>
    <section className="feature-provide-receive"><article><div className="eyebrow">What you bring</div><h2>A useful brief starts with your business.</h2><ul>{feature.inputs.map(input => <li key={input}>{input}</li>)}</ul></article><article><div className="eyebrow">What you receive</div><h2>Work you can inspect, improve and use.</h2><ul>{feature.outputs.map(output => <li key={output}>{output}</li>)}</ul></article></section>
    <section className="editorial-steps"><div className="eyebrow">How the workflow works</div>{feature.steps.map((step, index) => <article className="editorial-step" key={step.title}><span className="step-counter">0{index + 1}</span><div className="step-marker">{feature.name}</div><h3>{step.title}</h3><p>{step.body}</p></article>)}</section>
    <section className="feature-example"><div className="eyebrow">An illustrative business application</div><h2>{feature.example.business}: {feature.example.goal}</h2><ul>{feature.example.deliverables.map(output => <li key={output}>{output}</li>)}</ul><p className="example-disclosure">Planning example—not an actual customer, generated output, published campaign or performance result.</p></section>
    <section className="feature-readiness"><div className="eyebrow">Budget, setup and review</div><h2>Know what you need before you choose.</h2><p>{feature.boundary}</p>{feature.creditOperation && <p>The current default {feature.creditOperation.replaceAll("_", " ")} operation is <strong>{CREDIT_MENU[feature.creditOperation]} credits</strong>. Defaults may be overridden; additional operations use additional credits. The video menu reference is its 60-second operation, not a promise that every configuration produces that duration.</p>}<p>One free article helps you evaluate the starting workflow; it does not include a free multi-format package. Paid-workspace access and checkout require account approval and sign-in.</p></section>
    <section className="feature-related"><div className="eyebrow">Connect this to the next useful step</div><h2>Make the work fit the whole customer journey.</h2><div className="feature-related-links">{feature.related.map(slug => { const related = getProductFeature(slug)!; return <Link key={slug} href={`/features/${slug}`}><strong>{related.name}</strong><span>{related.summary}</span></Link>; })}</div></section>
    <PlanGuide agency={feature.slug === "agency-reports"} />
    <MarketingQuestions questions={feature.faqs} />
    <section className="buyer-next-step"><div><h2>Choose the workload.<br />Keep the next step clear.</h2><p>Compare the actual credit allowances, seats and setup requirements, then create an account. After approval and sign-in, you can choose a paid subscription through checkout.</p></div><div className="buyer-next-actions"><Link href={`/pricing?focus=${feature.slug}#plans`} className="button-primary">Review plans and choose</Link><Link href="/free-article" className="button-light">Start with one free article</Link></div></section>
  </main></MarketingFrame>;
}
