import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";
import { ArrowUpRight, Menu } from "lucide-react";
import { BuyerGuide } from "./buyer-guide";
import { productFeatures } from "@/lib/marketing/features";
import type { BusinessSolution } from "@/lib/marketing/solutions";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { MarketingQuestions } from "./questions";

export const marketingLinks = [
  ["Product", "/features"],
  ["Solutions", "/solutions"],
  ["Approach", "/approach"],
  ["Workflow", "/workflow"],
  ["For teams", "/for-teams"],
  ["Pricing", "/pricing"],
  ["FAQ", "/faq"],
  ["Cities", "/cities"],
] as const;

export function MarketingHeader() {
  return <header className="marketing-header">
    <div className="marketing-nav">
      <Link href="/" className="brand-lockup" aria-label="Citefi home"><BrandLogo decorative className="h-11 w-auto" /></Link>
      <nav aria-label="Main navigation" className="desktop-links">{marketingLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
      <details className="marketing-mobile-menu">
        <summary aria-label="Open navigation menu"><Menu size={18} /><span>Explore</span></summary>
        <div role="navigation" aria-label="Mobile navigation">
          {marketingLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          <Link href="/login">Log in</Link>
        </div>
      </details>
      <div className="nav-actions"><Link href="/login">Log in</Link><Link className="nav-cta" href="/free-article">Make one article <ArrowUpRight size={15} /></Link></div>
    </div>
  </header>;
}

export function MarketingFooter() {
  return <footer className="marketing-footer"><div><Link href="/" className="brand-lockup" aria-label="Citefi home"><BrandLogo decorative className="h-7 w-auto" /></Link><p>Make the answer useful before the sales call.</p><Link className="footer-start" href="/free-article">Start with one article <ArrowUpRight size={14} /></Link></div><div className="footer-links">{marketingLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}<Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/signup">Create account</Link><Link href="/login">Log in</Link></div><small>© {new Date().getFullYear()} Citefi · Every draft stays yours to review.</small></footer>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  const schema = { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://citefi.co" },
      ...items.map((item, i) => ({ "@type": "ListItem", position: i + 2, name: item.label,
        ...(item.href ? { item: `https://citefi.co${item.href}` } : {}) }))] };
  return <><nav aria-label="Breadcrumb" className="breadcrumbs"><Link href="/">Home</Link>{items.map((item, i) => <span key={`${item.label}-${i}`}><b>/</b>{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</span>)}</nav><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /></>;
}

export function MarketingFrame({ children, comprehensive = {} }: { children: React.ReactNode; comprehensive?: false | { solution?: BusinessSolution; city?: string; full?: boolean } }) {
  let body = children;
  if (comprehensive !== false) {
    const guide = <section key="buyer-guide" className="comprehensive-guide" aria-label="Marketing capabilities and choosing a plan"><BuyerGuide {...comprehensive} /></section>;
    // Keep shared selling content inside the main landmark, before objections/final CTA.
    if (isValidElement<{ children: ReactNode; className?: string }>(children) && children.type === "main") {
      const sections = Children.toArray(children.props.children);
      const faqFirst = /\bfaq-page\b/.test(children.props.className || "");
      const target = sections.findIndex(section => isValidElement<{ className?: string }>(section) &&
        (section.type === MarketingQuestions || (faqFirst ? /\bfaq-bottom\b/ : /\b(home-questions|faq-list|final-cta|faq-bottom)\b/).test(section.props.className || "")));
      const index = target < 0 ? sections.length : target;
      body = cloneElement(children, undefined, ...sections.slice(0, index), guide, ...sections.slice(index));
    } else body = <>{children}{guide}</>;
  }
  return <div className="marketing-page"><MarketingHeader />{body}
    <nav className="product-footer-links" aria-label="Explore Citefi capabilities"><h2>Explore what Citefi can do</h2><div>{productFeatures.map(feature => <Link key={feature.slug} href={`/features/${feature.slug}`}>{feature.name}</Link>)}</div></nav>
    <MarketingFooter /></div>;
}
