import { BRAND } from "@/lib/brand";
import { productFeatures, type ProductFeature } from "@/lib/marketing/features";

export function FeatureSchema({ feature }: { feature?: ProductFeature }) {
  const path = feature ? `/features/${feature.slug}` : "/features";
  const url = `${BRAND.url}${path}`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url,
        name: feature ? `${feature.name} for small-business marketing` : "The Citefi marketing workspace",
        description: feature?.summary || "Articles, images, social media, podcasts, video and connected marketing workflows.",
        isPartOf: { "@id": `${BRAND.url}/#website` }, publisher: { "@id": BRAND.organizationId },
        about: { "@type": "SoftwareApplication", name: "Citefi", url: BRAND.url, applicationCategory: "BusinessApplication", operatingSystem: "Web", featureList: feature ? feature.outputs : productFeatures.map(item => item.name), publisher: { "@id": BRAND.organizationId } },
      },
      { "@type": "BreadcrumbList", "@id": `${url}#breadcrumbs`, itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: BRAND.url },
        { "@type": "ListItem", position: 2, name: "Features", item: `${BRAND.url}/features` },
        ...(feature ? [{ "@type": "ListItem", position: 3, name: feature.name, item: url }] : []),
      ] },
      ...(!feature ? [{ "@type": "ItemList", name: "Citefi capabilities", itemListElement: productFeatures.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, url: `${BRAND.url}/features/${item.slug}` })) }] : []),
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />;
}
