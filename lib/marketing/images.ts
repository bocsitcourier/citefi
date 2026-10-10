import { BRAND } from "@/lib/brand";

/** Verified public stock assets only. These images do not prove a city location or customer relationship. */
export const marketingPhotos = {
  "/marketing/photos/home-services.jpg": {
    name: "Tradesperson installing pipework",
    description: "A tradesperson installing pipework; representative stock photography, not a Citefi customer.",
    width: 960, height: 640,
    source: "https://www.pexels.com/photo/professional-plumber-installing-a-radiator-pipe-29226620/",
  },
  "/marketing/photos/hospitality.jpg": {
    name: "Barista preparing coffee",
    description: "A barista preparing coffee in a café; representative stock photography, not a Citefi customer.",
    width: 960, height: 1440,
    source: "https://www.pexels.com/photo/13737061/",
  },
  "/marketing/photos/professional.jpg": {
    name: "Professional working at a laptop",
    description: "A professional working at a laptop; representative stock photography, not a Citefi customer.",
    width: 960, height: 640,
    source: "https://www.pexels.com/photo/focused-blogger-working-on-project-at-home-6347919/",
  },
  "/marketing/photos/retail.jpg": {
    name: "Florist helping a shopper",
    description: "A florist helping a shopper in a flower shop; representative stock photography, not a Citefi customer.",
    width: 960, height: 641,
    source: "https://www.pexels.com/photo/6764299/",
  },
} as const;

export type MarketingPhotoPath = keyof typeof marketingPhotos;

export function marketingImageSchema(src: MarketingPhotoPath, pagePath: string) {
  const photo = marketingPhotos[src];
  if (!photo) throw new Error("Only verified public marketing photographs may have public image metadata.");
  if (!(pagePath === "/" || pagePath === "/solutions" || /^\/(?:solutions|cities)\/[a-z0-9-]+$/.test(pagePath))) {
    throw new Error("Public image metadata requires a public marketing page.");
  }
  const url = `${BRAND.url}${src}`;
  return {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    "@id": `${url}#image`,
    url,
    contentUrl: url,
    name: photo.name,
    description: photo.description,
    caption: photo.description,
    width: photo.width,
    height: photo.height,
    creditText: "Source: Pexels",
    license: "https://www.pexels.com/license/",
    acquireLicensePage: photo.source,
    publisher: { "@id": BRAND.organizationId },
    isPartOf: { "@type": "WebPage", "@id": `${BRAND.url}${pagePath}#webpage`, url: `${BRAND.url}${pagePath}` },
  };
}
