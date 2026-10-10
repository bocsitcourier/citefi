import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { ArrowRight } from "lucide-react";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { productQuestions } from "@/components/marketing/questions";

const questions = [
  ["What is Citefi?", "Citefi is a marketing workspace for small-business owners and agencies: articles, images, social media, podcasts, video, SEO/GEO, brand intelligence, campaigns, customer journeys, review, supported website publishing, agency reports and ads exports."],
  ...productQuestions.map(item => [item.question, item.answer]),
  ["How is Citefi different from a general AI writing tool?", "Citefi organizes business context, customer questions, article and campaign drafts, journeys and review in one workspace. It helps prepare work that people inspect; it does not supply unprovided business facts."],
  ["What does the free article offer include?", "The free offer is one generated article. Read an excerpt before signup, then the same full article in a watermarked reading view after signup. It is not a monthly free plan or a credit bundle. Copying and downloading require paid access."],
  ["Do new accounts get 30 credits?", "No. The free article offer is separate from the credit catalog and does not add credits or change an existing balance."],
  ["Can I use Citefi for multiple clients?", "The Agency plan includes client workspaces with separate balances. Citefi does not pool credits, calculate agency markups, or invoice your clients."],
  ["Does Citefi publish ads or spend budget?", "No. Citefi does not publish ads or spend budget autonomously. A person reviews and uploads any external advertising."],
  ["Can I plan content for more than one moment in the customer journey?", "Yes. The workspace supports planning and creating articles, social, media, personas, brand context and campaign journeys. Those are workspace capabilities, not all part of the one-article free offer."],
  ["Does Citefi guarantee rankings, citations, or sales?", "No. Citefi does not promise search rankings, citations, return on ad spend, leads, or other outcomes. Generated work should be reviewed against evidence before use."],
  ["What happens after signup?", "New accounts remain pending admin approval under the existing account policy. The trial article reader is available through its scoped access; the normal workspace, login and checkout still follow account approval."],
  ["Can I prevent screenshots of the free reading view?", "No. Browser-based reading cannot reliably prevent screenshots. The free view is watermarked and read-only, but screenshots cannot be prevented."],
];
export const metadata: Metadata = marketingMetadata("FAQ — formats, plans, setup and review", "Answers about articles, images, social media, podcasts, video, SEO/GEO, journeys, publishing, agency workspaces, free sampling and paid-plan selection.", "/faq");
export default function FAQPage() {
  const schema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) };
  return <MarketingFrame><main className="longform faq-page"><Breadcrumbs items={[{ label: "FAQ" }]} /><section className="faq-hero"><div className="eyebrow">Clear answers, no fine-print fog</div><h1>Before the first draft.</h1><p>How the article offer, ongoing work and human review actually fit together.</p><div className="faq-jump-links"><Link href="/pricing">Plans and credit costs <ArrowRight size={14} /></Link><Link href="/workflow">Article to journey workflow <ArrowRight size={14} /></Link><Link href="/solutions">Business examples <ArrowRight size={14} /></Link></div></section><div className="faq-list">{questions.map(([q, a], i) => <details key={q} open={i === 0}><summary><span>{q}</span><b>+</b></summary><p>{a}</p></details>)}</div><section className="faq-bottom"><div><div className="eyebrow">Try the work, not a promise</div><h2>Start with the question<br />your customers ask.</h2></div><Link href="/free-article" className="button-primary">Start one article <ArrowRight size={16} /></Link></section><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /></main></MarketingFrame>;
}
