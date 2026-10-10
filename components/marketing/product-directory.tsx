import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { productFeatures } from "@/lib/marketing/features";

export function ProductDirectory({ full = false }: { full?: boolean }) {
  const items = full ? productFeatures : productFeatures.slice(0, 6);
  return <section className="product-directory" aria-labelledby={full ? "complete-product-heading" : "marketing-formats-heading"}>
    <div className="eyebrow">More than an article generator</div>
    <h2 id={full ? "complete-product-heading" : "marketing-formats-heading"}>{full ? "The full marketing workspace." : "Choose the format your customer needs."}</h2>
    <p className="section-intro">Answer the question on your website, explain it visually, adapt it for social, or let customers listen and watch. Keep the business context and human review connected.</p>
    <div className="product-card-grid">{items.map(item => <article key={item.slug} className="product-card">
      <h3><Link href={`/features/${item.slug}`}>{item.name}</Link></h3><p>{item.summary}</p>
      <p className="product-card-detail">{item.outputs[0]}</p>
      <Link className="text-link" href={`/features/${item.slug}`}>Explore {item.name.toLowerCase()} <ArrowRight size={14} /></Link>
    </article>)}</div>
    {!full && <Link className="text-link" href="/features">See campaigns, journeys, publishing and agency tools <ArrowRight size={15} /></Link>}
  </section>;
}
