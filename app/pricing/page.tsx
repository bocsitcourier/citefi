import { CheckCircle2, Zap, Rocket, Star, Building2, ArrowRight } from "lucide-react";
import Link from "next/link";

// ── Static plan data (mirrors lib/billing/plans.ts) ──────────────────────────

const PLANS = [
  {
    id: "free",
    name: "Free",
    priceUsd: 0,
    monthlyCredits: 50,
    icon: Zap,
    features: [
      "50 one-time credits",
      "Article generation",
      "Social posts",
      "Basic SEO tools",
    ],
    cta: "Get started free",
    ctaHref: "/register",
    highlight: false,
  },
  {
    id: "starter",
    name: "Starter",
    priceUsd: 29,
    monthlyCredits: 500,
    icon: Rocket,
    features: [
      "500 credits per month",
      "Everything in Free",
      "Podcast generation",
      "Video scripts",
      "Priority queue",
    ],
    cta: "Start Starter",
    ctaHref: "/settings/billing",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 79,
    monthlyCredits: 2000,
    icon: Star,
    features: [
      "2,000 credits per month",
      "Everything in Starter",
      "AI learning system",
      "Content clusters",
      "Batch generation",
      "Advanced analytics",
    ],
    cta: "Go Pro",
    ctaHref: "/settings/billing",
    highlight: true,
    badge: "Most Popular",
  },
  {
    id: "agency",
    name: "Agency",
    priceUsd: 199,
    monthlyCredits: 10000,
    icon: Building2,
    features: [
      "10,000 credits per month",
      "Everything in Pro",
      "Multi-team management",
      "White-label exports",
      "Dedicated support",
      "Custom integrations",
    ],
    cta: "Go Agency",
    ctaHref: "/settings/billing",
    highlight: false,
  },
];

const CREDIT_MENU = [
  { operation: "Article", credits: 10, description: "Full SEO article with hyperlinking, schema, images" },
  { operation: "Podcast", credits: 8, description: "Two-voice AI podcast from any article" },
  { operation: "Video", credits: 15, description: "60-second social video with TTS narration" },
  { operation: "Social post", credits: 4, description: "Platform-optimised posts for 3–5 channels" },
];

const TOP_UPS = [
  { id: "100", credits: 100, priceUsd: 9, label: "Boost" },
  { id: "500", credits: 500, priceUsd: 39, label: "Pro" },
  { id: "1000", credits: 1000, priceUsd: 69, label: "Bulk" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export const metadata = {
  title: "Pricing — ApexContent Engine",
  description: "Simple, credit-based pricing. Generate SEO articles, podcasts, videos, and social posts. Pay only for what you use.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">

      {/* Hero */}
      <section className="px-4 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Simple, credit-based pricing
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
          Buy credits once. Use them for articles, podcasts, videos, or social posts.
          No seats. No per-word pricing. No surprises.
        </p>
      </section>

      {/* Plans */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map((plan) => {
            const Icon = plan.icon;
            return (
              <div
                key={plan.id}
                className={`relative rounded-md border bg-card p-6 flex flex-col gap-4 ${
                  plan.highlight ? "border-primary ring-1 ring-primary" : "border-border"
                }`}
                data-testid={`card-plan-${plan.id}`}
              >
                {plan.highlight && "badge" in plan && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-md">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                  <h2 className="font-semibold text-lg">{plan.name}</h2>
                </div>

                <div>
                  <span className="text-3xl font-bold">
                    {plan.priceUsd === 0 ? "Free" : `$${plan.priceUsd}`}
                  </span>
                  {plan.priceUsd > 0 && (
                    <span className="text-muted-foreground text-sm">/month</span>
                  )}
                  <p className="text-sm text-muted-foreground mt-1">
                    {plan.monthlyCredits.toLocaleString()} credits
                    {plan.id === "free" ? " (one-time)" : "/month"}
                  </p>
                </div>

                <ul className="space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.ctaHref}
                  className={`flex items-center justify-center gap-1.5 text-sm font-medium rounded-md px-4 py-2 transition-colors ${
                    plan.highlight
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border hover:bg-muted"
                  }`}
                  data-testid={`link-plan-cta-${plan.id}`}
                >
                  {plan.cta}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* Credit Menu */}
      <section className="bg-muted/40 border-y border-border py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Credit Menu</h2>
          <p className="text-muted-foreground text-center mb-8">
            Fixed cost per operation — no surprise charges.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CREDIT_MENU.map((item) => (
              <div
                key={item.operation}
                className="bg-card border border-border rounded-md p-4 flex items-start gap-3"
                data-testid={`card-credit-${item.operation.toLowerCase().replace(/\s/g, "-")}`}
              >
                <div className="flex items-center justify-center rounded-md bg-primary/10 text-primary font-bold text-sm min-w-[48px] h-10 tabular-nums">
                  {item.credits} cr
                </div>
                <div>
                  <p className="font-medium">{item.operation}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top-Ups */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center mb-2">Credit Top-Ups</h2>
        <p className="text-muted-foreground text-center mb-8">
          One-time purchases that never expire — stack them on any plan.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {TOP_UPS.map((t) => {
            const cpp = (t.priceUsd / t.credits).toFixed(2);
            return (
              <div
                key={t.id}
                className="bg-card border border-border rounded-md p-6 text-center"
                data-testid={`card-topup-${t.id}`}
              >
                <p className="text-sm font-medium text-muted-foreground mb-1">{t.label}</p>
                <p className="text-3xl font-bold">{t.credits.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">credits</p>
                <div className="my-4 border-t border-border" />
                <p className="text-2xl font-semibold">${t.priceUsd}</p>
                <p className="text-xs text-muted-foreground mb-4">${cpp}/credit</p>
                <Link
                  href="/settings/billing"
                  className="block w-full text-sm font-medium text-center rounded-md border border-border py-2 hover:bg-muted transition-colors"
                  data-testid={`link-topup-cta-${t.id}`}
                >
                  Buy now
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ strip */}
      <section className="bg-muted/40 border-t border-border py-16 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-center mb-8">Common questions</h2>
          {[
            {
              q: "Do credits roll over?",
              a: "Monthly plan credits reset each billing cycle. Top-up credits never expire and carry over indefinitely.",
            },
            {
              q: "What happens when I run out?",
              a: "Generation is paused at zero — you are never charged for failed runs. Buy a top-up or upgrade your plan to continue.",
            },
            {
              q: "Can I switch plans mid-cycle?",
              a: "Yes. Upgrade immediately via the billing portal. Credits from your new plan are granted on the next billing date.",
            },
            {
              q: "Is there a free trial?",
              a: "The Free plan gives you 50 credits to try every content type with no credit card required.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="space-y-1">
              <p className="font-medium">{q}</p>
              <p className="text-sm text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 px-4 text-center">
        <h2 className="text-2xl font-bold mb-3">Ready to generate at scale?</h2>
        <p className="text-muted-foreground mb-6">Start free — no credit card needed.</p>
        <Link
          href="/register"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-md hover:bg-primary/90 transition-colors"
          data-testid="link-bottom-cta"
        >
          Create free account
          <ArrowRight className="w-4 h-4" />
        </Link>
      </section>
    </div>
  );
}
