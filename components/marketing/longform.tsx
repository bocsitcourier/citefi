import Link from "next/link";
import { ArrowRight, CircleAlert, ShieldCheck } from "lucide-react";
import { Breadcrumbs, MarketingFrame } from "./site";
import { MarketingQuestions, offerQuestions } from "./questions";

type PageKey = "approach" | "workflow" | "teams";
const pages: Record<PageKey, {
  label: string; eyebrow: string; title: string; intro: string;
  steps: Array<{ title: string; body: string; marker: string }>;
  heading: string; subheading: string; callout: string;
}> = {
  approach: {
    label: "Approach", eyebrow: "The question behind the content", title: "Start with what buyers need to know.", intro: "Not a city-page factory. Not a confident-sounding paragraph generator. Citefi starts with the real decision a customer is making and the business facts an owner can stand behind.",
    steps: [
      { title: "Listen for the buying question", body: "What do people ask before booking? What makes them hesitate? Which detail do you explain again and again? That is a better starting brief than a keyword list without context.", marker: "01 / CUSTOMER QUESTION" },
      { title: "Bring the business into the brief", body: "Add the services, audience, process, voice and coverage that make your answer yours. When a fact is missing, keep it visible for review instead of filling the gap with a guess.", marker: "02 / BUSINESS CONTEXT" },
      { title: "Shape useful work—not filler", body: "Turn the brief into an article and connected campaign pieces that serve distinct moments in a customer's decision. Each draft is editable work, not verified fact.", marker: "03 / PURPOSEFUL DRAFTS" },
      { title: "Let a person decide", body: "Check claims, links, tone and fit. Keep feedback with the work. The owner or client decides what is ready to use and what needs another pass.", marker: "04 / HUMAN REVIEW" },
    ],
    heading: "AI can help write the first pass.<br />It cannot know your business for you.",
    subheading: "The difference is not a louder promise. It is a better brief, visible review and honest ownership of the final decision.",
    callout: "A clean sentence is not evidence. Ask: is this true for our business, can we verify it, and does it help someone choose their next step?",
  },
  workflow: {
    label: "Workflow", eyebrow: "From customer question to connected formats", title: "One real question. A whole marketing workflow.", intro: "Start with your business context, develop an article, then choose images, social drafts, podcasts and video that help the same customer decide. Connect the work in campaigns and journeys, review each deliverable and choose its next step.",
    steps: [
      { title: "Start with one question", body: "Name the business, the people you help and the question they ask before they choose. The free offer produces one article—not a monthly credit plan.", marker: "01 / ONE FREE ARTICLE" },
      { title: "Read before you commit", body: "Create the article and read an excerpt before signup. Sign up to read that same full article in a watermarked view. Account approval is still needed for normal workspace access.", marker: "02 / INSPECT THE DRAFT" },
      { title: "Build the next useful answer", body: "For ongoing work, use business context to plan stages: understand the need, compare options, take action and stay connected. Each stage earns its place by helping a real buyer question.", marker: "03 / PLAN A JOURNEY" },
      { title: "Review, revise, hand off", body: "Check business claims, links and next steps. Share work for review where available; external use remains a human decision. Ads are not published or funded by Citefi.", marker: "04 / READY WHEN YOU ARE" },
    ],
    heading: "The first article is a proof of process,<br />not a promise of performance.",
    subheading: "See whether the draft understands the question, gives a useful answer and leaves a clear list of facts for you to check.",
    callout: "Good review questions: Is this specific to the service we actually offer? Are details sourced? Does the next step match how we work?",
  },
  teams: {
    label: "For teams", eyebrow: "Owner-led. Agency-ready.", title: "Keep client context and review in the same story.", intro: "Local owners need a practical starting point. Agencies need a repeatable way to prepare work without flattening every client into the same voice.",
    steps: [
      { title: "Owner-operators: get to the answer", body: "Start from the questions your customers already ask. Add your process and real details once, then use that context to prepare reviewable articles and campaign work.", marker: "OWNER PATH" },
      { title: "Agency teams: keep work separate", body: "Set up distinct client workspaces with their own context and balances. The Agency plan includes up to 25 child client workspaces and up to 25 seats.", marker: "AGENCY PATH" },
      { title: "Reviewers: make feedback actionable", body: "Give the right person a chance to check the brief, facts and copy. A draft is not an approval; a clear review handoff is how a team decides what can leave the workspace.", marker: "REVIEW PATH" },
      { title: "Leads: know what remains yours", body: "The client relationship, external publishing and ad spend stay with your team. Citefi does not invoice agency clients or pool balances across child workspaces.", marker: "OWNERSHIP" },
    ],
    heading: "More repeatable process.<br />Still unmistakably your client.",
    subheading: "A shared workflow creates room to do the careful work—not a reason to skip it.",
    callout: "Before handoff: check audience, client-approved claims, actual service coverage, links and the action the draft asks a customer to take.",
  },
};

const faqByPage = {
  approach: [
    { question: "How is Citefi different from a general AI writing tool?", answer: "Citefi is a marketing workspace centered on business context, buyer questions, connected work and review. It helps prepare drafts; it does not know unprovided facts or replace the owner's judgment." },
    { question: "Does selecting a city prove a business has local demand?", answer: "No. Place identity is only context for a brief. Business reach and demand are not inferred; include only service-area facts your business can verify." },
    offerQuestions[2]!,
  ],
  workflow: [
    { question: "Can I try an article before starting a subscription?", answer: "Yes. The free offer is one article, separate from credits. Read an excerpt before signup, then the same full article in a watermarked view after signup." },
    { question: "Does the article go live when I create it?", answer: "No. Creating an article does not publish it. Supported connected-account publishing is a separate, user-authorized workflow that requires configuration. Ads remain reviewed exports; Citefi does not place ads or spend advertising budget autonomously." },
    offerQuestions[1]!,
  ],
  teams: [
    { question: "How does client separation work for agencies?", answer: "The Agency plan includes up to 25 child client workspaces, each with a separate balance. Citefi does not pool balances or invoice the agency's clients." },
    { question: "Can clients approve work in Citefi?", answer: "Teams can use the workspace's review modules to organize draft feedback. An approval remains a human decision; confirm each client's review needs and permissions." },
    offerQuestions[2]!,
  ],
};

export function LongformPage({ page }: { page: PageKey }) {
  const data = pages[page];
  return <MarketingFrame><main className={`longform editorial-page editorial-${page}`}>
    <Breadcrumbs items={[{ label: data.label }]} />
    <section className="editorial-hero">
      <div className="editorial-hero-copy"><div className="eyebrow">{data.eyebrow}</div><h1>{data.title}</h1><p>{data.intro}</p><div className="hero-actions"><Link href="/free-article" className="button-primary">Start with one article <ArrowRight size={16} /></Link><Link href={page === "teams" ? "/pricing" : "/solutions"} className="button-text">{page === "teams" ? "Compare plans" : "See real use cases"} <ArrowRight size={15} /></Link></div></div>
      <aside className="editorial-index"><div className="index-mark">C.</div><span>THE CITEFI PRINCIPLE</span><b>Useful work<br />starts with a<br /><em>real question.</em></b><small>Brief · draft · decision</small></aside>
    </section>
    <section className="editorial-steps">
      <div className="editorial-steps-head"><div className="eyebrow">The work, in four moves</div><h2>Clarity at every handoff.</h2></div>
      {data.steps.map((step, index) => <article key={step.title} className="editorial-step"><span className="step-counter">0{index + 1}</span><div className="step-marker">{step.marker}</div><h3>{step.title}</h3><p>{step.body}</p><span className="step-rule" /></article>)}
    </section>
    <section className="decision-section"><div><div className="eyebrow">A useful distinction</div><h2>{data.heading.split("<br />").map((line, index) => <span key={line}>{line}{index === 0 && <br />}</span>)}</h2><p>{data.subheading}</p><Link className="text-link" href="/workflow">See how the workflow holds together <ArrowRight size={15} /></Link></div><aside className="decision-note"><ShieldCheck size={23} /><span>REVIEW CHECK</span><p>{data.callout}</p><small><CircleAlert size={13} /> Drafts need human review before use.</small></aside></section>
    <section className="editorial-links"><div className="eyebrow">Keep exploring</div><div><Link href="/workflow">The article-to-campaign workflow <ArrowRight size={15} /></Link><Link href="/solutions">Specific business use cases <ArrowRight size={15} /></Link><Link href="/pricing">Plans for the work ahead <ArrowRight size={15} /></Link></div></section>
    <section className="longform-questions"><MarketingQuestions questions={faqByPage[page]} /></section>
  </main></MarketingFrame>;
}
