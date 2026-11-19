"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/brand-mark";

export default function FreeArticleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="trial-page">
    <div className="trial-top"><Link href="/" className="trial-brand" aria-label="Citefi home"><BrandLogo decorative className="h-7 w-auto" /><span> / ONE ARTICLE</span></Link></div>
    <div className="trial-layout">
      <section className="trial-intro"><div className="eyebrow">One article · no account required</div><h1>Your session<br /><em>didn’t open.</em></h1><p>This error screen does not send an article request. If you already submitted one, check its status before creating another.</p></section>
      <section className="trial-state" role="alert"><div className="eyebrow">Article workspace unavailable</div><h2>Retry the reader setup.</h2><p>If the problem continues, keep any support reference shown by the reader.</p><div className="article-actions"><button className="trial-submit" type="button" onClick={reset}>Retry setup</button><Link href="/">Citefi home</Link></div></section>
    </div>
  </main>;
}
