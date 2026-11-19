import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";

export default function FreeArticleLoading() {
  return <main className="trial-page">
    <div className="trial-top"><Link href="/" className="trial-brand" aria-label="Citefi home"><BrandLogo decorative className="h-7 w-auto" /><span> / ONE ARTICLE</span></Link></div>
    <div className="trial-layout">
      <section className="trial-intro"><div className="eyebrow">One article · no account required</div><h1>Opening your<br /><em>article workspace.</em></h1><p>Your private draft session starts when you submit your brief. Nothing is published, and no subscription starts.</p></section>
      <section className="trial-state" role="status" aria-live="polite" aria-label="Opening the free article workspace">
        <div className="eyebrow">Loading the reader</div><h2>Getting the brief ready.</h2>
        <div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-block" />
        <p>If this screen stays here, reload the article page or return to Citefi.</p>
        <div className="article-actions"><a href="/free-article">Reload article page</a><Link href="/">Citefi home</Link></div>
      </section>
    </div>
  </main>;
}
