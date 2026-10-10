import Link from "next/link";
import { Breadcrumbs, MarketingFrame } from "@/components/marketing/site";
import { ProductDirectory } from "@/components/marketing/product-directory";
import { BuyerGuide } from "@/components/marketing/buyer-guide";
import { MarketingQuestions, offerQuestions } from "@/components/marketing/questions";
import { marketingMetadata } from "@/lib/marketing/metadata";
import { FeatureSchema } from "@/components/marketing/feature-schema";

export const metadata = marketingMetadata("The full Citefi marketing workspace", "Explore articles, AI images, social media, podcasts, video, SEO/GEO, campaigns, customer journeys, publishing and agency work. Compare the workflow and plans.", "/features");
export default function FeaturesPage() {
  return <MarketingFrame comprehensive={false}><main className="longform feature-catalog">
    <FeatureSchema /><Breadcrumbs items={[{ label: "Features" }]} />
    <section className="editorial-hero"><div><div className="eyebrow">Built for the whole content workflow</div><h1>Articles are the beginning.<br /><em>Your marketing goes further.</em></h1><p>Explain your business in writing, show it visually, adapt it for social, and give customers a way to listen or watch. Keep the campaign context, review and next steps connected.</p><div className="hero-actions"><Link href="/pricing#plans" className="button-primary">Compare paid plans</Link><Link href="/free-article" className="button-text">Try the free article first</Link></div></div></section>
    <ProductDirectory full />
    <BuyerGuide />
    <MarketingQuestions questions={offerQuestions} />
  </main></MarketingFrame>;
}
