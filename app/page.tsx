import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleHelp, FileText } from "lucide-react";
import { articleBriefHref, businessSolutions } from "@/lib/marketing/solutions";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { MarketingFrame } from "@/components/marketing/site";
import { MarketingQuestions } from "@/components/marketing/questions";
import { MarketingImage } from "@/components/marketing/marketing-image";

export const metadata: Metadata = marketingMetadata("Citefi — articles, images, social, podcasts and video", "A marketing workspace for small businesses and agencies: create articles, images, social content, podcasts and video, then connect campaigns, customer journeys and review.", "/");

const homeServices = businessSolutions[0]!;
const homeHref = articleBriefHref({ topic: homeServices.topic, audience: homeServices.audience });

export default function MarketingPage() {
  return <MarketingFrame>
    <main className="home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-mark" />For the people doing the work</div>
          <h1>Your marketing,<br /><em>working together.</em></h1>
          <p className="hero-intro">Articles, AI images, social posts, podcasts and video—organized around your business, your customers and the action you want them to take. Develop the message, connect the campaign and keep the review in your hands, without starting every format from a blank page.</p>
          <div className="hero-actions"><Link className="button-primary" href="/free-article">Make my free article <ArrowRight size={17} /></Link><Link className="button-text" href="/pricing#plans">Compare paid plans <ArrowDownRight size={16} /></Link></div>
          <div className="hero-proofline"><span><Check size={14} /> One article to start</span><span><Check size={14} /> You review before use</span><span>No card for the article</span></div>
        </div>
        <div className="hero-proof">
          <div className="hero-index"><span>THE QUESTION FILE</span><span>FIELD NOTE 01</span></div>
          <div className="question-paper">
            <div className="paper-rule"><span>01</span><span>What a homeowner needs to know</span></div>
            <h2>What should I ask<br />before booking a<br /><em>plumbing repair?</em></h2>
            <p>A practical first draft, built around a question people ask before they decide.</p>
            <div className="paper-footer"><span>ILLUSTRATIVE ARTICLE BRIEF</span><span>REVIEW BEFORE USE</span></div>
          </div>
          <div className="proof-note"><FileText size={17} /><span><b>A real starting point.</b><small>Not a live result or customer story.</small></span></div>
          <div className="hero-scribble" aria-hidden="true">useful<br />before<br />beautiful</div>
        </div>
        <div className="hero-side-label">A LOCAL BUSINESS CONTENT WORKSPACE <span>·</span> MADE FOR REVIEW</div>
      </section>

      <section className="friction-section">
        <div className="section-heading">
          <div><div className="eyebrow">The gap is not more words</div><h2>Generic pages answer<br />the wrong question.</h2></div>
          <p>A city name dropped into a template will not explain why someone should book you. A good answer starts with the actual decision your customer is making—and what your business can truthfully say about it.</p>
        </div>
        <div className="contrast-board">
          <article className="contrast-card old"><div className="contrast-label">A familiar dead end</div><h3>“The leading choice in [City].”</h3><p>Broad promise. No buyer context. No reason to trust it.</p><span className="cross-mark">×</span></article>
          <div className="contrast-arrow"><ArrowRight /></div>
          <article className="contrast-card new"><div className="contrast-label">A question with a job to do</div><h3>“What happens during a repair visit—and how is the estimate made?”</h3><p>Specific to the decision. Easy for the owner to check. Useful even before a customer is ready to call.</p><span className="check-mark"><Check size={17} /></span></article>
        </div>
      </section>

      <section className="sample-section">
        <div className="sample-intro"><div className="eyebrow">Look inside the work</div><h2>Not another empty<br />document.</h2><p>Start with one question, shape it into a clear article outline, then inspect what needs your expertise before the draft goes anywhere.</p><Link href={homeHref} className="text-link">Try this example as your brief <ArrowUpRight size={15} /></Link></div>
        <article className="sample-article">
          <div className="sample-toolbar"><span><i /> ARTICLE DRAFT / SAMPLE OUTPUT</span><span>NOT A CUSTOMER STORY</span></div>
          <div className="sample-content">
            <div className="article-kicker">HOME SERVICES · BUYER PREPARATION</div>
            <h3>Before you book a plumbing repair: questions worth asking</h3>
            <p className="article-deck">A useful first conversation starts with the problem, the visit and what you need to know about the estimate.</p>
            <div className="sample-paragraph"><span>01</span><p><b>What should I tell the plumber?</b><br />Describe what you have noticed, when it began and whether anything has changed. If you are unsure, say so rather than guessing at the cause.</p></div>
            <div className="sample-paragraph"><span>02</span><p><b>What does the visit include?</b><br />Ask how the business assesses the issue, explains options and shares an estimate. The exact process depends on the provider—confirm it directly.</p></div>
            <div className="inspection-note"><CircleHelp size={17} /><span><b>Owner check</b> Add your actual service area, visit process and estimate policy before publishing.</span></div>
          </div>
          <div className="sample-caption">Illustrative sample text — not a published article, result or endorsement.</div>
        </article>
      </section>

      <section className="journey-section">
        <div className="journey-top"><div><div className="eyebrow">One question opens a journey</div><h2>Help at the moment<br />they need it.</h2></div><p>People do not go from stranger to customer in a single search. Build a useful sequence around what they need to understand next—from first concern to confident follow-up.</p></div>
        <div className="journey-track">
          {homeServices.journey.map((step, i) => <article className="journey-stop" key={step.stage}><div className="journey-node"><span>0{i + 1}</span></div><small>{step.stage}</small><h3>{step.question}</h3><p>{step.content}</p><div className="journey-next"><b>Next step</b><span>{step.nextStep}</span></div></article>)}
        </div>
        <p className="journey-caption">Illustrative planning example. Business-specific facts and actions need owner review.</p>
      </section>

      <section className="industry-section">
        <div className="section-heading compact"><div><div className="eyebrow">Different work. Different questions.</div><h2>Made for the way<br />your business sells.</h2></div><Link href="/solutions" className="text-link">Explore all six use cases <ArrowRight size={15} /></Link></div>
        <div className="industry-feature">
          <div className="industry-photo"><MarketingImage src={homeServices.image} alt={homeServices.imageAlt} pagePath="/" /><div className="photo-caption">Representative stock photo · not a Citefi customer</div></div>
          <div className="industry-copy"><div className="industry-number">01 / SERVICE BUSINESS</div><h3>From the job site<br />to the next booking.</h3><p>Turn the questions homeowners ask into practical explanations of your process, services and next steps. No generic “best in town” filler.</p><Link href="/solutions/home-services" className="text-link">See the home services example <ArrowUpRight size={15} /></Link></div>
        </div>
        <div className="industry-list">{businessSolutions.slice(1).map((solution, i) => <Link key={solution.slug} href={`/solutions/${solution.slug}`} className="industry-row"><span>0{i + 2}</span><b>{solution.name}</b><span>{solution.topic}</span><ArrowUpRight size={16} /></Link>)}</div>
      </section>

      <section className="review-section">
        <div className="review-mark">REVIEW<br />IS THE<br />FEATURE.</div>
        <div className="review-copy"><div className="eyebrow">The human part stays central</div><h2>Make the work.<br /><em>Keep the judgment.</em></h2><p>Citefi helps move from context to draft. Your team checks the facts, tone and fit. Drafting does not publish anything: supported connected publishing is a separate action you authorize. Ads stay export-only, without autonomous placement or spend.</p><div className="review-checks"><span><Check size={15} /> Confirm details and claims</span><span><Check size={15} /> Review every channel draft</span><span><Check size={15} /> Decide what is ready to use</span></div><Link href="/approach" className="button-light">Our approach <ArrowRight size={16} /></Link></div>
      </section>

      <section className="path-section">
        <div><div className="eyebrow">Room to grow, not pressure to upgrade</div><h2>One article is a start.<br />The workspace is next.</h2><p>Try the offer on its own. If ongoing work is a fit, paid plans add monthly credits and workspace features—at a clear price.</p><Link href="/pricing" className="text-link">Compare plans and costs <ArrowRight size={15} /></Link></div>
        <div className="path-steps"><article><span>01</span><div><b>Write a real question</b><small>No credit bundle or plan required for the one-article offer.</small></div></article><article><span>02</span><div><b>Inspect the excerpt</b><small>Sign up to read that same full draft with a watermark.</small></div></article><article><span>03</span><div><b>Choose whether to continue</b><small>Normal workspace access follows account approval. Copy and download require paid access.</small></div></article></div>
      </section>

      <section className="home-questions"><MarketingQuestions questions={[
        { question: "What does one free article mean?", answer: "One generated article, separate from monthly credits. Read an excerpt before signup, then the same full article in a watermarked reading view after signup. It is not an ongoing free plan." },
        { question: "Will creating a draft publish it?", answer: "No. Supported website receiver publishing is separately configured and authorized. Direct social-network publishing connections are currently disabled, and ads remain reviewed exports without autonomous placement or spend." },
        { question: "Can I use it for my agency clients?", answer: "The Agency plan supports up to 25 child client workspaces with separate balances. Client context and approvals remain part of the team's work; Citefi does not invoice your clients." },
      ]} /></section>

      <section className="final-cta"><div className="eyebrow">You already know the question</div><h2>Put it to work.</h2><p>Start with one customer question. Leave the blank page behind.</p><Link className="button-primary" href="/free-article">Make my free article <ArrowRight size={17} /></Link><small>One article · no credit bundle · review before use</small></section>
    </main>
  </MarketingFrame>;
}
