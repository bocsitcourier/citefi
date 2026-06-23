"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Zap,
  Shield,
  Brain,
  Menu,
  X,
  Building2,
  Store,
  Globe,
  ArrowRight,
  CheckCircle2,
  FileText,
  MessageSquare,
  Code2,
  BarChart3,
  Layers,
  ChevronRight,
  Sparkles,
} from "lucide-react";

export default function MarketingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Non-blocking redirect: page renders immediately for all unauthenticated
  // visitors. Once auth resolves (cookie or sessionStorage), logged-in users
  // are sent to /home. No loading spinner — unauthenticated users never wait.
  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/home");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── NAVBAR ─────────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
          scrolled ? "bg-background/95 backdrop-blur border-b border-border shadow-sm" : "bg-transparent"
        }`}
        data-testid="nav-header"
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center shrink-0" data-testid="nav-logo">
            <span className="font-bold text-xl text-foreground tracking-tight">citefi.co</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {[
              { label: "Features", id: "features" },
              { label: "Use Cases", id: "use-cases" },
              { label: "How It Works", id: "pipeline" },
              { label: "Pricing", id: "pricing" },
              { label: "FAQ", id: "faq" },
            ].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => { e.preventDefault(); scrollTo(item.id); }}
                className="px-4 py-2 text-sm text-muted-foreground rounded-md transition-colors hover:text-foreground hover-elevate"
                data-testid={`nav-link-${item.id}`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Link href="/login">
              <Button variant="ghost" size="sm" data-testid="nav-button-login">
                Log in
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => scrollTo("pricing")}
              data-testid="nav-button-get-started"
            >
              Get Started
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="nav-button-mobile-menu"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-background/98 backdrop-blur border-b border-border px-6 pb-4 space-y-1">
            {[
              { label: "Features", id: "features" },
              { label: "Use Cases", id: "use-cases" },
              { label: "How It Works", id: "pipeline" },
              { label: "Pricing", id: "pricing" },
              { label: "FAQ", id: "faq" },
            ].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => { e.preventDefault(); scrollTo(item.id); }}
                className="block w-full text-left px-3 py-2.5 text-sm rounded-md text-foreground hover-elevate"
                data-testid={`mobile-nav-link-${item.id}`}
              >
                {item.label}
              </a>
            ))}
            <div className="flex gap-2 pt-2">
              <Link href="/login" className="flex-1">
                <Button variant="outline" size="sm" className="w-full" data-testid="mobile-button-login">
                  Log in
                </Button>
              </Link>
              <Button
                size="sm"
                className="flex-1"
                onClick={() => scrollTo("pricing")}
                data-testid="mobile-button-get-started"
              >
                Get Started
              </Button>
            </div>
          </div>
        )}
      </header>

      <main>
      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section
        className="relative min-h-screen flex items-center justify-center text-center px-6 pt-16 bg-white"
        data-testid="section-hero"
      >
        {/* Subtle dot-grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: "radial-gradient(circle, #e2e8f0 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative max-w-4xl mx-auto space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 text-sm font-medium shadow-sm" data-testid="hero-badge">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>The Local SEO Content Powerhouse</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-slate-900 leading-[1.08] tracking-tight" data-testid="hero-headline">
            The Local SEO<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-indigo-500">
              Content Engine
            </span>
          </h1>

          {/* Sub-copy */}
          <p className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed" data-testid="hero-subtext">
            Citefi runs best-in-class AI models through a 4-stage pipeline that injects real
            ZIP-code intelligence, neighborhood context, and E-E-A-T signals into every article —
            so your content ranks where generic AI tools can&apos;t.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link href="/signup">
              <Button
                size="lg"
                className="px-8 text-base"
                data-testid="hero-button-get-demo"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="px-8 text-base"
              onClick={() => scrollTo("pipeline")}
              data-testid="hero-button-see-how"
            >
              See How It Works
            </Button>
          </div>

          {/* Metric strip */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10 pt-4 text-slate-400 text-sm">
            <span data-testid="hero-metric-1"><strong className="text-slate-700 font-semibold">2M+</strong> articles generated</span>
            <span className="hidden sm:block w-px h-4 bg-slate-200" />
            <span data-testid="hero-metric-2"><strong className="text-slate-700 font-semibold">500+</strong> agencies trust us</span>
            <span className="hidden sm:block w-px h-4 bg-slate-200" />
            <span data-testid="hero-metric-3"><strong className="text-slate-700 font-semibold">50+</strong> articles per batch</span>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ──────────────────────────────────────────────────── */}
      <section className="bg-muted/60 border-y border-border py-10 px-6" data-testid="section-stats">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-0 text-center">
          {[
            { value: "4×", label: "more local content output", sub: "vs. generic AI tools" },
            { value: "60%", label: "reduction in content costs", sub: "no agency retainers needed" },
            { value: "50+", label: "articles per batch", sub: "generated in a single run" },
          ].map((stat, i) => (
            <div key={i} className={`space-y-1 ${i > 0 ? "sm:border-l sm:border-border" : ""}`} data-testid={`stat-item-${i}`}>
              <div className="text-4xl font-bold text-foreground">{stat.value}</div>
              <div className="text-sm font-medium text-foreground">{stat.label}</div>
              <div className="text-xs text-muted-foreground">{stat.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── USE CASES ──────────────────────────────────────────────────── */}
      <section id="use-cases" className="py-24 px-6 bg-background" data-testid="section-use-cases">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Use Cases</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">Built for every local SEO workflow</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-base">
              Whether you run an agency, a local business, or a brand with dozens of locations —
              Citefi scales to your exact needs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Building2,
                title: "SEO Agencies",
                description:
                  "Manage content for tens of clients from a single dashboard. Generate location-specific article batches, schedule publishing, and deliver results without growing headcount.",
                bullets: ["Multi-client team isolation", "Batch generation for all ZIP codes", "Automated review & publishing"],
                color: "from-blue-500/10 to-indigo-500/10",
                borderColor: "border-blue-500/20",
                testId: "use-case-agencies",
              },
              {
                icon: Store,
                title: "Local Businesses",
                description:
                  "Dominate your neighborhood in search results. Generate content that references local landmarks, regulations, and authority entities — things generic AI tools never know about.",
                bullets: ["ZIP-code & neighborhood targeting", "Local entity & landmark integration", "Answer-first optimization for AI citations"],
                color: "from-emerald-500/10 to-teal-500/10",
                borderColor: "border-emerald-500/20",
                testId: "use-case-local",
              },
              {
                icon: Globe,
                title: "Multi-Location Brands",
                description:
                  "Produce city-by-city content at enterprise scale without the agency bill. Each location gets its own localized articles, social posts, and videos — automatically.",
                bullets: ["City-by-city content differentiation", "Social & video content included", "Multi-channel publishing pipeline"],
                color: "from-purple-500/10 to-fuchsia-500/10",
                borderColor: "border-purple-500/20",
                testId: "use-case-brands",
              },
            ].map((item) => (
              <div
                key={item.title}
                className={`rounded-md border ${item.borderColor} bg-gradient-to-br ${item.color} p-6 space-y-4 flex flex-col`}
                data-testid={item.testId}
              >
                <div className="w-10 h-10 rounded-md bg-background/80 border border-border flex items-center justify-center shrink-0">
                  <item.icon className="w-5 h-5 text-foreground" />
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
                <ul className="space-y-1.5">
                  {item.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-xs text-foreground/80">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                      {b}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => scrollTo("features")}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  data-testid={`${item.testId}-learn-more`}
                >
                  Learn more <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PIPELINE ───────────────────────────────────────────────────── */}
      <section id="pipeline" className="py-24 px-6 bg-muted/40" data-testid="section-pipeline">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">How It Works</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">A 4-stage dual-AI pipeline</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-base">
              Each article passes through four specialized AI stages — no stage is skipped,
              no quality gate is bypassed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                step: "01",
                icon: BarChart3,
                title: "Title Pool Generation",
                description:
                  "AI generates 50 location-optimized, answer-first SEO titles using smart topic research and Jaccard uniqueness scoring to avoid competitor duplication.",
                color: "bg-blue-500/10 border-blue-500/20",
                testId: "pipeline-step-1",
              },
              {
                step: "02",
                icon: FileText,
                title: "Content & Image Generation",
                description:
                  "AI produces 800–2000 word articles integrating deep local intelligence: ZIP codes, neighborhood entities, local regulations, and authority sources.",
                color: "bg-indigo-500/10 border-indigo-500/20",
                testId: "pipeline-step-2",
              },
              {
                step: "03",
                icon: MessageSquare,
                title: "AI Review & Enrichment",
                description:
                  "A dedicated AI reviewer performs SEO analysis, hashtag generation, social snippets, advanced content validation, and E-E-A-T scoring across every article.",
                color: "bg-purple-500/10 border-purple-500/20",
                testId: "pipeline-step-3",
              },
              {
                step: "04",
                icon: Code2,
                title: "AI Enhancement & Schema",
                description:
                  "AI applies GEO-optimized hyperlinking, embeds comprehensive JSON-LD schema markup, and finalizes with semantic HTML ready for publishing.",
                color: "bg-fuchsia-500/10 border-fuchsia-500/20",
                testId: "pipeline-step-4",
              },
            ].map((item, i) => (
              <div key={item.step} className="relative" data-testid={item.testId}>
                {i < 3 && (
                  <div className="hidden lg:block absolute top-8 -right-2 z-10">
                    <ArrowRight className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                )}
                <div className={`rounded-md border ${item.color} p-5 h-full space-y-3`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground font-mono">{item.step}</span>
                    <div className="w-8 h-8 rounded-md bg-background/80 border border-border flex items-center justify-center">
                      <item.icon className="w-4 h-4 text-foreground" />
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6 bg-background" data-testid="section-features">
        <div className="max-w-6xl mx-auto space-y-24">
          {/* Feature 1: Local Intelligence */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 order-2 lg:order-1">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Local Intelligence</div>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
                Content that knows your neighborhood
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed">
                Generic AI tools write content for "any city." Citefi generates content
                that references the specific ZIP code, surrounding neighborhoods, local regulations,
                authority entities, and community landmarks — the signals that actually earn local rankings.
              </p>
              <ul className="space-y-3">
                {[
                  "ZIP-code and neighborhood-level targeting",
                  "Local authority entity integration",
                  "Regulation and compliance-aware content",
                  "Multi-city batch generation from a single prompt",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-foreground/80">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="order-1 lg:order-2 rounded-md border border-primary/20 bg-gradient-to-br from-primary/8 to-indigo-500/8 h-72 flex flex-col items-center justify-center gap-4 p-8"
              data-testid="feature-local-visual"
            >
              <MapPin className="w-10 h-10 text-primary/60" />
              <div className="text-center space-y-1">
                <div className="text-sm font-semibold text-foreground">Local SEO Intelligence</div>
                <div className="text-xs text-muted-foreground">ZIP codes · Neighborhoods · Entities · Regulations</div>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                {["ZIP 90210", "West Hollywood", "City of LA", "CA Health Code"].map((tag) => (
                  <div key={tag} className="text-center text-xs bg-background/80 border border-border rounded px-2 py-1.5 text-foreground/70">
                    {tag}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feature 2: Quality Guardian */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div
              className="rounded-md border border-emerald-500/20 bg-gradient-to-br from-emerald-500/8 to-teal-500/8 h-72 flex flex-col items-center justify-center gap-4 p-8"
              data-testid="feature-quality-visual"
            >
              <Shield className="w-10 h-10 text-emerald-500/60" />
              <div className="text-center space-y-1">
                <div className="text-sm font-semibold text-foreground">Quality Guardian</div>
                <div className="text-xs text-muted-foreground">Every article passes 5 quality gates before publishing</div>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-xs">
                {["E-E-A-T Score", "Anti-Hallucination", "AI Disclosure", "Fact-Check", "Brand Lock"].map((tag) => (
                  <div key={tag} className="text-xs bg-background/80 border border-border rounded px-2 py-1 text-foreground/70">
                    {tag}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-6">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Quality & Compliance</div>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
                Every article is validated before it leaves the engine
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed">
                Citefi runs every article through a multi-gate quality system — catching
                hallucinations, enforcing brand name accuracy, validating E-E-A-T signals, and
                embedding AI disclosure compliance automatically.
              </p>
              <ul className="space-y-3">
                {[
                  "Anti-hallucination framework with evidence binding",
                  "Brand name accuracy enforced at every stage",
                  "E-E-A-T scoring with author entity integration",
                  "EU AI Act disclosure compliance built in",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-foreground/80">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Feature 3: Multi-channel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6 order-2 lg:order-1">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Multi-Channel Publishing</div>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
                Articles, social posts, videos, and podcasts — from one prompt
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed">
                One content batch generates articles, platform-optimized social posts, 60-second
                AI videos, and podcast episodes simultaneously. Everything publishes to your connected
                channels automatically.
              </p>
              <ul className="space-y-3">
                {[
                  "Articles, social, video & podcast from one batch",
                  "Direct publishing to Facebook, LinkedIn, TikTok",
                  "60-second AI videos with cinematic images & TTS",
                  "AI podcast with two-voice conversation format",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-foreground/80">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="order-1 lg:order-2 rounded-md border border-purple-500/20 bg-gradient-to-br from-purple-500/8 to-fuchsia-500/8 h-72 flex flex-col items-center justify-center gap-4 p-8"
              data-testid="feature-multichannel-visual"
            >
              <Layers className="w-10 h-10 text-purple-500/60" />
              <div className="text-center space-y-1">
                <div className="text-sm font-semibold text-foreground">Multi-Channel Engine</div>
                <div className="text-xs text-muted-foreground">One prompt. Every channel.</div>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
                {["Articles", "Social Posts", "AI Videos", "Podcasts"].map((tag) => (
                  <div key={tag} className="text-center text-xs bg-background/80 border border-border rounded px-2 py-1.5 text-foreground/70">
                    {tag}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── OUTPUT COMPARISON ──────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-muted/40" data-testid="section-comparison">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12 space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">The Difference</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              The difference local intelligence makes
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto text-base">
              The same topic. Two outputs. One ranks locally — one doesn&apos;t.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Generic AI */}
            <div className="rounded-md border border-border bg-background p-6 space-y-4" data-testid="comparison-generic">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Generic AI Output</span>
              </div>
              <div className="font-mono text-sm text-muted-foreground leading-relaxed space-y-3 border border-border rounded p-4 bg-muted/30">
                <p className="font-semibold text-foreground/70 text-base">Best Plumbers in Los Angeles</p>
                <p>
                  Are you looking for a reliable plumber in Los Angeles? There are many
                  plumbers in Los Angeles who can help you with your plumbing needs.
                  Los Angeles has a variety of plumbing companies to choose from...
                </p>
                <p className="text-foreground/50">
                  [No local entities. No neighborhood context. No citations.
                  No local regulations. Identical to 1,000 other articles.]
                </p>
              </div>
            </div>

            {/* Citefi */}
            <div className="rounded-md border border-primary/30 bg-background p-6 space-y-4" data-testid="comparison-apex">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">Citefi Output</span>
              </div>
              <div className="font-mono text-sm text-muted-foreground leading-relaxed space-y-3 border border-primary/20 rounded p-4 bg-primary/5">
                <p className="font-semibold text-foreground text-base">Emergency Plumbers in Silver Lake, Los Angeles (90026)</p>
                <p>
                  Silver Lake residents facing plumbing emergencies in the 90026 ZIP code have
                  access to licensed contractors who understand the area&apos;s aging pre-war pipe
                  infrastructure — a known issue across Vendome Street and Hyperion Avenue corridors.
                </p>
                <p className="text-foreground/70">
                  Per LA Department of Building &amp; Safety regulations, all plumbing work in
                  multi-unit buildings requires a licensed C-36 contractor. The LA Bureau of
                  Sanitation&apos;s 2024 infrastructure report cites Silver Lake as a priority zone...
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ───────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-white" data-testid="section-testimonials">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">What Customers Say</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Trusted by agencies and local businesses</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-base">
              Real results from teams who switched to AI-powered local SEO content.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                name: "Marcus T.",
                role: "SEO Agency Owner",
                location: "Chicago, IL",
                photo: "https://randomuser.me/api/portraits/men/32.jpg",
                quote: "We went from manually writing 8 articles a week to generating 50+ in a single batch. The ZIP-code-level detail is something none of our competitors can match.",
                stars: 5,
              },
              {
                name: "Jennifer R.",
                role: "Digital Marketing Director",
                location: "Austin, TX",
                photo: "https://randomuser.me/api/portraits/women/44.jpg",
                quote: "The quality gate is what sold me. Every article comes out validated — no hallucinations, proper brand name enforcement, E-E-A-T signals already baked in. It's like having a senior editor on staff.",
                stars: 5,
              },
              {
                name: "David K.",
                role: "Multi-Location Franchise Owner",
                location: "Phoenix, AZ",
                photo: "https://randomuser.me/api/portraits/men/67.jpg",
                quote: "We have 23 locations across Arizona. Citefi generates differentiated content for every city — local landmarks, neighborhood context, the works. Rankings are up across the board.",
                stars: 5,
              },
              {
                name: "Priya M.",
                role: "Content Strategy Lead",
                location: "New York, NY",
                photo: "https://randomuser.me/api/portraits/women/28.jpg",
                quote: "The 4-stage pipeline means I'm not babysitting the AI. By the time an article lands in our CMS, it's already been reviewed, schema-embedded, and hyperlinked. Huge time saver.",
                stars: 5,
              },
              {
                name: "Carlos V.",
                role: "Local SEO Consultant",
                location: "Miami, FL",
                photo: "https://randomuser.me/api/portraits/men/12.jpg",
                quote: "I recommended Citefi to six of my clients last quarter. The answer-first format alone gets them into AI citation results on Google — something generic tools never achieved.",
                stars: 5,
              },
              {
                name: "Sarah L.",
                role: "Agency Founder",
                location: "Denver, CO",
                photo: "https://randomuser.me/api/portraits/women/55.jpg",
                quote: "Switched from a competitor after seeing the output quality. The local intelligence — actual regulation references, neighborhood entities — makes the content genuinely useful, not just filler.",
                stars: 5,
              },
            ].map((t) => (
              <div
                key={t.name}
                className="rounded-md border border-slate-200 bg-white p-6 space-y-4 flex flex-col"
                data-testid={`testimonial-${t.name.toLowerCase().replace(/\s/g, "-")}`}
              >
                {/* Stars */}
                <div className="flex gap-0.5">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <svg key={i} className="w-4 h-4 fill-amber-400 text-amber-400" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>

                {/* Quote */}
                <p className="text-sm text-slate-600 leading-relaxed flex-1">&ldquo;{t.quote}&rdquo;</p>

                {/* Person */}
                <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                  <img
                    src={t.photo}
                    alt={t.name}
                    className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{t.name}</p>
                    <p className="text-xs text-slate-500 truncate">{t.role} · {t.location}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6 bg-background" data-testid="section-pricing">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Pricing</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Start generating. Scale when ready.
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto text-base">
              Every plan includes the full 4-stage pipeline. No article limits in the first batch.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                name: "Starter",
                price: "From $99",
                period: "/mo",
                description: "Perfect for solo operators and small local businesses.",
                features: [
                  "1 team workspace",
                  "Full 4-stage pipeline",
                  "50 articles per batch",
                  "Local SEO intelligence",
                  "Social post generation",
                ],
                cta: "Start Free Trial",
                highlighted: false,
                testId: "pricing-starter",
              },
              {
                name: "Growth",
                price: "From $299",
                period: "/mo",
                description: "The choice for growing agencies managing multiple clients.",
                features: [
                  "Up to 10 client workspaces",
                  "Unlimited batches",
                  "AI videos + podcasts",
                  "Brand Intelligence",
                  "Priority support",
                ],
                cta: "Get Started",
                highlighted: true,
                testId: "pricing-growth",
              },
              {
                name: "Agency",
                price: "Custom",
                period: "",
                description: "Built for enterprise agencies with 50+ client accounts.",
                features: [
                  "Unlimited client workspaces",
                  "White-label publishing",
                  "Dedicated account manager",
                  "Custom pipeline configuration",
                  "SLA & enterprise support",
                ],
                cta: "Contact Sales",
                highlighted: false,
                testId: "pricing-agency",
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-md border p-6 flex flex-col space-y-5 ${
                  plan.highlighted
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border bg-background"
                }`}
                data-testid={plan.testId}
              >
                {plan.highlighted && (
                  <div className="inline-flex self-start">
                    <span className="text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded px-2 py-0.5">
                      Most Popular
                    </span>
                  </div>
                )}
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-foreground">{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{plan.description}</p>
                </div>
                <ul className="space-y-2 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs text-foreground/80">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link href={plan.cta === "Contact Sales" ? "/login" : "/signup"}>
                  <Button
                    className="w-full"
                    variant={plan.highlighted ? "default" : "outline"}
                    data-testid={`${plan.testId}-cta`}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 px-6 bg-muted/40" data-testid="section-faq">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-16 space-y-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">FAQ</div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">Frequently asked questions</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-base">
              Everything you need to know about Citefi and AI-powered local SEO content.
            </p>
          </div>

          <div className="border border-border rounded-md divide-y divide-border" data-testid="faq-list">
            {[
              {
                q: "What is Citefi?",
                a: "Citefi is an AI-powered local SEO content platform that generates ZIP-code-level articles, social posts, videos, and podcasts through a 4-stage dual-AI pipeline. Every piece of content is injected with real neighborhood context, local regulations, and E-E-A-T signals — at batch scale.",
                id: "faq-what-is-citefi",
              },
              {
                q: "How does the 4-stage AI pipeline work?",
                a: "The pipeline runs four sequential stages: (1) Title Pool Generation — AI creates 50 location-optimized, answer-first SEO titles with Jaccard uniqueness scoring; (2) Content & Image Generation — articles are written with deep local intelligence including ZIP codes, neighborhood entities, and local regulations; (3) AI Review & Enrichment — a dedicated reviewer applies SEO analysis and E-E-A-T scoring; (4) AI Enhancement & Schema — JSON-LD schema markup is embedded and GEO-optimized hyperlinking is applied before publishing.",
                id: "faq-pipeline",
              },
              {
                q: "How much does Citefi cost?",
                a: "Citefi starts at $99/month for the Starter plan, which includes 1 workspace and 50 articles per batch with the full 4-stage pipeline. The Growth plan starts at $299/month for up to 10 client workspaces and includes AI videos and podcasts. Enterprise Agency plans are custom-priced for organizations with 50+ client accounts.",
                id: "faq-pricing",
              },
              {
                q: "What makes Citefi different from ChatGPT or other AI writing tools?",
                a: "Generic AI tools write content for 'any city' without location-specific data. Citefi integrates actual ZIP codes, surrounding neighborhoods, local regulations from city authorities, and named local entities — sources that ChatGPT, Jasper, and similar tools never access. Combined with an anti-hallucination framework and multi-gate E-E-A-T validation, every article is verifiably accurate and locally specific.",
                id: "faq-difference",
              },
              {
                q: "Can Citefi publish directly to my website and social media?",
                a: "Yes. Citefi includes a multi-channel publishing pipeline that posts directly to Facebook, LinkedIn, and TikTok via OAuth. The @citefi/receiver npm package can be installed on any website to automatically publish articles with locally-hosted images and JSON-LD schema. Content publishes on a schedule or on-demand.",
                id: "faq-publishing",
              },
              {
                q: "What types of content does Citefi generate from a single batch?",
                a: "From a single content batch, Citefi generates: SEO articles (800–2,000 words each) with local intelligence and schema markup; platform-optimized social posts for Facebook, LinkedIn, and TikTok; 60-second AI marketing videos with cinematic images and TTS narration; and two-voice AI podcast episodes summarizing each article.",
                id: "faq-content-types",
              },
            ].map((item) => (
              <div key={item.id} className="px-6 py-5" data-testid={item.id}>
                <h3 className="text-sm font-semibold text-foreground mb-2">{item.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BAND ───────────────────────────────────────────────────── */}
      <section
        className="py-20 px-6 text-center bg-slate-950"
        data-testid="section-cta-band"
      >
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
            Ready to own your local search rankings?
          </h2>
          <p className="text-slate-400 text-base">
            Join 500+ agencies and businesses generating local SEO content at scale.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className="bg-white text-slate-900 hover:bg-slate-100 px-8" data-testid="cta-band-start">
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 px-8"
              onClick={() => scrollTo("pipeline")}
              data-testid="cta-band-see-how"
            >
              See the Pipeline
            </Button>
          </div>
        </div>
      </section>

      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="bg-background border-t border-border px-6 py-12" data-testid="section-footer">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between gap-8 pb-10 border-b border-border">
            {/* Brand */}
            <div className="space-y-3 max-w-xs">
              <Link href="/">
                <span className="font-bold text-xl text-foreground tracking-tight">citefi.co</span>
              </Link>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The dual-AI local SEO content platform for agencies, local businesses, and multi-location brands.
              </p>
            </div>

            {/* Nav columns */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
              <div className="space-y-3">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide">Product</div>
                {[
                  { label: "Features", id: "features" },
                  { label: "Use Cases", id: "use-cases" },
                  { label: "How It Works", id: "pipeline" },
                  { label: "Pricing", id: "pricing" },
                ].map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    onClick={(e) => { e.preventDefault(); scrollTo(item.id); }}
                    className="block text-xs text-muted-foreground hover:text-foreground transition-colors"
                    data-testid={`footer-link-${item.id}`}
                  >
                    {item.label}
                  </a>
                ))}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide">Platform</div>
                {["Local SEO Intelligence", "Dual-AI Pipeline", "Multi-Channel Publishing", "Quality Guardian"].map((item) => (
                  <span key={item} className="block text-xs text-muted-foreground">{item}</span>
                ))}
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wide">Account</div>
                <Link href="/login" className="block text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-login">
                  Log in
                </Link>
                <Link href="/signup" className="block text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-signup">
                  Sign up
                </Link>
                <Link href="/forgot-password" className="block text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="footer-link-forgot">
                  Reset password
                </Link>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 text-xs text-muted-foreground">
            <span data-testid="footer-copyright">&copy; {new Date().getFullYear()} Citefi. All rights reserved.</span>
            <div className="flex items-center gap-4 flex-wrap justify-center">
              <Link href="/privacy" className="hover:text-foreground transition-colors" data-testid="footer-privacy">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors" data-testid="footer-terms">Terms of Use</Link>
            </div>
          </div>
        </div>
      </footer>

      {/* ── JSON-LD STRUCTURED DATA ────────────────────────────────────── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Citefi",
            url: "https://citefi.co",
            logo: "https://citefi.co/icon.png",
            contactPoint: {
              "@type": "ContactPoint",
              email: "info@citefi.co",
              contactType: "customer support",
            },
            address: {
              "@type": "PostalAddress",
              streetAddress: "3 Cabot Pl",
              addressLocality: "Stoughton",
              addressRegion: "MA",
              postalCode: "02072",
              addressCountry: "US",
            },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Citefi",
            url: "https://citefi.co",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "AI-powered local SEO content engine that generates ZIP-code-level articles, social posts, videos, and podcasts through a 4-stage dual-AI pipeline with E-E-A-T signals and anti-hallucination validation.",
            offers: [
              {
                "@type": "Offer",
                name: "Starter",
                price: "99",
                priceCurrency: "USD",
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  price: "99",
                  priceCurrency: "USD",
                  unitText: "MONTH",
                },
              },
              {
                "@type": "Offer",
                name: "Growth",
                price: "299",
                priceCurrency: "USD",
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  price: "299",
                  priceCurrency: "USD",
                  unitText: "MONTH",
                },
              },
            ],
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: "5",
              reviewCount: "6",
              bestRating: "5",
              worstRating: "1",
            },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Citefi",
            url: "https://citefi.co",
            potentialAction: {
              "@type": "SearchAction",
              target: {
                "@type": "EntryPoint",
                urlTemplate: "https://citefi.co/?s={search_term_string}",
              },
              "query-input": "required name=search_term_string",
            },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "What is Citefi?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Citefi is an AI-powered local SEO content platform that generates ZIP-code-level articles, social posts, videos, and podcasts through a 4-stage dual-AI pipeline. Every piece of content is injected with real neighborhood context, local regulations, and E-E-A-T signals — at batch scale.",
                },
              },
              {
                "@type": "Question",
                name: "How does the 4-stage AI pipeline work?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "The pipeline runs four sequential stages: (1) Title Pool Generation — AI creates 50 location-optimized, answer-first SEO titles with Jaccard uniqueness scoring; (2) Content & Image Generation — articles are written with deep local intelligence including ZIP codes, neighborhood entities, and local regulations; (3) AI Review & Enrichment — a dedicated reviewer applies SEO analysis and E-E-A-T scoring; (4) AI Enhancement & Schema — JSON-LD schema markup is embedded and GEO-optimized hyperlinking is applied before publishing.",
                },
              },
              {
                "@type": "Question",
                name: "How much does Citefi cost?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Citefi starts at $99/month for the Starter plan, which includes 1 workspace and 50 articles per batch with the full 4-stage pipeline. The Growth plan starts at $299/month for up to 10 client workspaces and includes AI videos and podcasts. Enterprise Agency plans are custom-priced.",
                },
              },
              {
                "@type": "Question",
                name: "What makes Citefi different from ChatGPT or other AI writing tools?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Generic AI tools write content without location-specific data. Citefi integrates actual ZIP codes, local regulations from city authorities, and named local entities — sources that ChatGPT and similar tools never access. Combined with an anti-hallucination framework and E-E-A-T validation, every article is verifiably accurate and locally specific.",
                },
              },
              {
                "@type": "Question",
                name: "Can Citefi publish directly to my website and social media?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. Citefi includes a multi-channel publishing pipeline that posts directly to Facebook, LinkedIn, and TikTok via OAuth. The @citefi/receiver npm package can be installed on any website to automatically publish articles with locally-hosted images and JSON-LD schema.",
                },
              },
              {
                "@type": "Question",
                name: "What types of content does Citefi generate from a single batch?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "From a single batch, Citefi generates: SEO articles (800–2,000 words each) with local intelligence and schema markup; platform-optimized social posts for Facebook, LinkedIn, and TikTok; 60-second AI marketing videos with cinematic images and TTS narration; and two-voice AI podcast episodes.",
                },
              },
            ],
          }),
        }}
      />

    </div>
  );
}
