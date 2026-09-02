"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { BILLING_PLANS, PUBLIC_PRICING_PLAN_IDS } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BarChart3, Check, ChevronDown, ClipboardCheck, FileText,
  Globe2, Layers3, MapPin, Menu, Quote, ShieldCheck, Sparkles, X,
} from "lucide-react";

const plans = PUBLIC_PRICING_PLAN_IDS.map((id) => BILLING_PLANS[id]);
const enterprisePlan = BILLING_PLANS.enterprise;
const navItems: Array<[string, string]> = [["Approach", "approach"], ["Workflow", "workflow"], ["For teams", "teams"], ["Pricing", "pricing"], ["FAQ", "faq"]];
const questions: Array<[string, string]> = [
  ["What is Citefi?", "Citefi is a local marketing campaign engine for agencies and local businesses. It brings business context, content creation, review, and export preparation into one governed workspace."],
  ["Does Citefi publish ads or spend budget?", "No. Direct ad publishing and autonomous spend are disabled. Any future certified Ads export will remain subject to this boundary: Manual review and platform upload required."],
  ["What does the Free plan include?", "Free includes 30 one-time credits, one seat, article generation, social posts, and basic SEO tools. Credits do not refresh."],
  ["Can I use Citefi for multiple clients?", "The Agency plan includes up to 25 client workspaces with separate balances. Citefi does not pool credits, calculate markups, or invoice your clients; agencies manage client billing externally."],
  ["How are results represented?", "Citefi is designed around sourced evidence, approvals, and durable snapshots. It does not promise rankings, citations, return on ad spend, or other outcomes before the underlying evidence exists."],
];

export default function MarketingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  useEffect(() => { if (!isLoading && user) router.replace("/home"); }, [isLoading, user, router]);
  const jump = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); setMenuOpen(false); };

  return (
    <div className="marketing-page min-h-[100dvh] overflow-x-hidden bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-foreground/10 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex min-h-11 items-center gap-2" aria-label="Citefi home">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"><span className="text-sm font-bold">c</span></span>
            <span className="font-serif text-2xl tracking-tight">citefi</span><span className="eyebrow !text-[9px]">local intelligence</span>
          </Link>
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main navigation">
            {navItems.map(([label, id]) =>
              <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); jump(id); }} className="flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground">{label}</a>
            )}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <Link href="/login" className="flex min-h-11 items-center px-3 text-sm font-medium hover:text-accent">Log in</Link>
             <Button asChild className="min-h-11 rounded-full px-5"><Link href="/signup">Start with Citefi <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </div>
          <button className="grid h-11 w-11 place-items-center rounded-full lg:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && <nav id="mobile-navigation" className="border-t border-foreground/10 bg-background px-5 pb-5 pt-2 lg:hidden" aria-label="Mobile navigation">
          {navItems.map(([label, id]) =>
            <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); jump(id); }} className="flex min-h-12 items-center border-b border-foreground/10 text-base">{label}</a>
          )}
           <div className="flex gap-2 pt-4"><Button asChild variant="outline" className="min-h-11 flex-1 rounded-full"><Link href="/login">Log in</Link></Button><Button asChild className="min-h-11 flex-1 rounded-full"><Link href="/signup">Get started</Link></Button></div>
        </nav>}
      </header>

      <main>
        <section className="relative overflow-hidden px-5 pb-20 pt-36 sm:px-8 sm:pb-28 sm:pt-44">
          <div className="pointer-events-none absolute -right-24 top-24 h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
          <div className="mx-auto grid max-w-7xl items-end gap-14 lg:grid-cols-[1.15fr_.85fr]">
            <div className="max-w-4xl">
              <div className="eyebrow mb-7 flex items-center gap-3"><span className="h-px w-8 bg-accent" />Local marketing, with receipts</div>
              <h1 className="display-serif text-[clamp(3.3rem,9vw,8.2rem)] leading-[.9] tracking-[-.055em]">Make local work<br /><em className="text-accent not-italic">matter more.</em></h1>
              <p className="mt-9 max-w-xl text-lg leading-8 text-muted-foreground sm:text-xl">Citefi turns a verified business identity into thoughtful, reviewable campaign work—grounded in the places, people, and policies your audience actually knows.</p>
               <div className="mt-9 flex flex-col gap-3 sm:flex-row"><Button asChild size="lg" className="min-h-12 rounded-full px-7"><Link href="/signup">Create with Citefi <ArrowRight className="ml-2 h-4 w-4" /></Link></Button><button onClick={() => jump("workflow")} className="min-h-12 rounded-full border border-foreground/20 px-7 text-sm font-semibold transition-colors hover:bg-secondary">See the workflow</button></div>
              <p className="mt-5 text-xs text-muted-foreground">Start free with 30 one-time credits. External action remains separate.</p>
            </div>
            <div className="relative mx-auto w-full max-w-md lg:pb-3">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[45%_45%_8%_8%] bg-primary p-7 text-primary-foreground shadow-2xl shadow-primary/15">
                <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(120deg, transparent 48%, hsl(var(--accent) / .5) 49%, transparent 51%), linear-gradient(30deg, transparent 48%, hsl(var(--accent) / .35) 49%, transparent 51%)", backgroundSize: "130px 130px" }} />
                <div className="relative flex h-full flex-col justify-between">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[.2em] text-primary-foreground/65"><span>Campaign brief</span><span>01 / 04</span></div>
                  <div><MapPin className="on-dark-accent mb-6 h-9 w-9" /><p className="display-serif text-4xl leading-tight">A clearer<br />picture of<br /><span className="on-dark-accent">your place.</span></p></div>
                  <div className="border-t border-primary-foreground/20 pt-4 text-xs leading-5 text-primary-foreground/65">Business facts · local entities<br />approved assets · next decision</div>
                </div>
              </div>
               <div className="absolute -bottom-5 -left-5 rounded-2xl border border-foreground/10 bg-card p-4 shadow-xl"><div className="mb-1 flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-accent" />Context captured</div><div className="text-xs text-muted-foreground">Ready for inspection</div></div>
            </div>
          </div>
        </section>

        <section id="approach" className="border-y border-foreground/10 bg-secondary/50 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div><div className="eyebrow mb-4">The point of view</div><h2 className="display-serif max-w-md text-4xl leading-tight sm:text-5xl">Good local marketing starts with attention.</h2></div>
            <div className="grid gap-8 sm:grid-cols-3">
              {[["01", "Know the ground", "Start with a business identity, locations, services, and the evidence that makes a claim worth using."], ["02", "Make the work", "Create articles, social posts, video scripts, and podcasts from one coherent brief."], ["03", "Keep the say", "Inspect each version and collect feedback before any separate external action."]].map(([num, title, text]) => <div key={num} className="editorial-rule pt-4"><div className="font-mono text-xs text-accent">{num}</div><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p></div>)}
            </div>
          </div>
        </section>

        <section id="workflow" className="px-5 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl"><div className="max-w-2xl"><div className="eyebrow mb-5">A considered workflow</div><h2 className="display-serif text-5xl leading-[.98] sm:text-6xl">From context<br />to next decision.</h2><p className="mt-6 text-muted-foreground">The workflow keeps business context and generated work visible while external action remains separate.</p></div>
            <div className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-foreground/10 bg-foreground/10 md:grid-cols-2 lg:grid-cols-4">
              {([
                 ["Discover", "01", Globe2, "Document the business, its locations, and the context behind a grounded Brand Intelligence brief."],
                ["Plan", "02", BarChart3, "Choose locations, audiences, channels, and a campaign cadence that fits the team."],
                ["Create", "03", Layers3, "Generate local content and channel-ready assets with unified credits and clear limits."],
                ["Inspect", "04", ClipboardCheck, "Compare versions, capture feedback, and keep external action separate from generation."],
              ] as const).map(([title, num, Icon, text]) => <div key={title} className="bg-card p-6 sm:p-7"><div className="flex items-center justify-between"><Icon className="h-6 w-6 text-accent" /><span className="font-mono text-xs text-muted-foreground">{num}</span></div><h3 className="mt-16 text-xl font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p></div>)}
            </div>
          </div>
        </section>

        <section id="teams" className="bg-primary px-5 py-20 text-primary-foreground sm:px-8 sm:py-28">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[.9fr_1.1fr]"><div><div className="eyebrow !text-primary-foreground/60">For the people doing the work</div><h2 className="display-serif mt-5 text-5xl leading-none sm:text-6xl">Less handoff.<br /><span className="on-dark-accent">More judgment.</span></h2><p className="mt-7 max-w-md leading-7 text-primary-foreground/70">Give operators a calm place to move campaigns forward, and give owners the context they need to assess the work.</p></div>
            <div className="grid gap-8 sm:grid-cols-2"><div className="border-t border-primary-foreground/20 pt-5"><Sparkles className="on-dark-accent h-5 w-5" /><h3 className="mt-5 text-xl font-semibold">For agencies</h3><p className="mt-3 text-sm leading-6 text-primary-foreground/65">Separate client workspaces, shared campaign context, and client-safe views without pretending the platform bills your clients.</p></div><div className="border-t border-primary-foreground/20 pt-5"><FileText className="on-dark-accent h-5 w-5" /><h3 className="mt-5 text-xl font-semibold">For local teams</h3><p className="mt-3 text-sm leading-6 text-primary-foreground/65">Turn what you know about your service area into useful content while keeping external uploads under your control.</p></div></div>
          </div>
        </section>

         <section className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_1fr]"><div className="rounded-3xl border border-foreground/10 bg-secondary/60 p-7 sm:p-10"><Quote className="h-8 w-8 text-accent" /><p className="display-serif mt-10 text-3xl leading-tight sm:text-4xl">“The useful part is not more copy. It is knowing why this version is ready.”</p><div className="mt-10 flex items-center gap-3 text-sm"><span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-bold">C</span><span><b className="block">The Citefi principle</b><span className="text-muted-foreground">Evidence before confidence</span></span></div></div><div><div className="eyebrow mb-5">Trust needs boundaries</div><h2 className="display-serif text-5xl leading-tight">A capable engine<br />without invented certainty.</h2><ul className="mt-8 space-y-4 text-sm">{["Campaign context captured for inspection", "Feedback kept alongside campaign work", "Direct ad publishing and autonomous spend disabled", "Honest results states when evidence is unavailable"].map((x) => <li key={x} className="flex items-start gap-3"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{x}</li>)}</ul></div></div></section>

         <section id="pricing" className="border-t border-foreground/10 bg-secondary/45 px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto max-w-7xl"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="eyebrow mb-4">Pricing from the live catalog</div><h2 className="display-serif text-5xl">Start where the work is.</h2></div><p className="max-w-xs text-sm leading-6 text-muted-foreground">Annual billing charges ten monthly prices for twelve months of service. No automatic overage.</p></div><div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{plans.map((plan) => <div key={plan.id} className={`flex flex-col rounded-2xl border p-6 ${plan.id === "growth" ? "border-accent bg-card shadow-lg shadow-accent/10" : "border-foreground/10 bg-background/50"}`}><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{plan.name}</h3>{plan.id === "growth" && <span className="rounded-full bg-accent/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground">Popular</span>}</div><div className="mt-7"><span className="display-serif text-4xl">${plan.priceUsd}</span><span className="text-sm text-muted-foreground">{plan.oneTime ? " one time" : " / month"}</span></div><p className="mt-3 min-h-10 text-sm text-muted-foreground">{plan.monthlyCredits.toLocaleString()} {plan.oneTime ? "one-time" : "monthly"} credits</p><ul className="mt-5 flex-1 space-y-3 border-t border-foreground/10 pt-5 text-sm">{plan.features.slice(0, 5).map((feature) => <li key={feature} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-accent" />{feature}</li>)}</ul><Button asChild variant={plan.id === "growth" ? "default" : "outline"} className="mt-7 min-h-11 w-full rounded-full"><Link href="/signup">{plan.id === "free" ? "Start free" : `Start ${plan.name}`}</Link></Button></div>)}</div><div className="mt-4 rounded-2xl border border-foreground/10 bg-background/50 p-5 text-sm"><b>{enterprisePlan.name}</b> · ${enterprisePlan.priceUsd}/month · {enterprisePlan.monthlyCredits.toLocaleString()} monthly credits · unlimited seats and client workspaces · <a className="font-semibold underline underline-offset-4" href="mailto:hello@citefi.co">Talk to sales</a> <span className="text-muted-foreground">(sales-assisted)</span></div></div></section>

         <section id="faq" className="px-5 py-20 sm:px-8 sm:py-28"><div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[.8fr_1.2fr]"><div><div className="eyebrow mb-4">Questions worth answering</div><h2 className="display-serif text-5xl leading-tight">No fog.<br />Just the terms.</h2></div><div className="border-t border-foreground/15">{questions.map(([q, a], i) => <div key={q} className="border-b border-foreground/15"><button id={`faq-question-${i}`} className="flex min-h-16 w-full items-center justify-between gap-4 text-left font-semibold" onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i} aria-controls={`faq-answer-${i}`}><span>{q}</span><ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${openFaq === i ? "rotate-180 text-accent" : ""}`} /></button><div id={`faq-answer-${i}`} role="region" aria-labelledby={`faq-question-${i}`} hidden={openFaq !== i} className="pb-5 pr-8 text-sm leading-6 text-muted-foreground">{a}</div></div>)}</div></div></section>
        <section className="px-5 pb-24 sm:px-8 sm:pb-32"><div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 rounded-3xl bg-accent p-8 text-white sm:p-12 lg:flex-row lg:items-end"><div><div className="eyebrow !text-white">A better brief is a better beginning</div><h2 className="display-serif mt-4 max-w-xl text-5xl leading-none">Bring the local part back into marketing.</h2></div><Button asChild size="lg" className="min-h-12 rounded-full bg-primary px-7 text-primary-foreground hover:bg-primary/90"><Link href="/signup">Start free <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div></section>
      </main>
      <footer className="border-t border-foreground/10 px-5 py-8 sm:px-8"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 text-xs text-muted-foreground sm:flex-row"><span>© {new Date().getFullYear()} Citefi. Local marketing campaign engine.</span><div className="flex flex-wrap gap-5"><Link href="/privacy" className="hover:text-foreground">Privacy</Link><Link href="/terms" className="hover:text-foreground">Terms</Link><Link href="/login" className="hover:text-foreground">Log in</Link><Link href="/signup" className="hover:text-foreground">Sign up</Link><a href="mailto:hello@citefi.co" className="hover:text-foreground">Contact</a></div></div></footer>
    </div>
  );
}