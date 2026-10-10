/** Public brand identity: one entity and one owner-supplied logo across all pages. */
export const BRAND = {
  name: "Citefi",
  url: "https://citefi.co",
  organizationId: "https://citefi.co/#organization",
  logo: {
    path: "/brand/citefi-logo.png",
    url: "https://citefi.co/brand/citefi-logo.png",
    width: 333,
    height: 191,
    alt: "Citefi logo",
  },
  socialImage: {
    url: "https://citefi.co/brand/citefi-social.png",
    width: 1200,
    height: 630,
    alt: "Citefi logo",
  },
} as const;

/** No invented offices, reviews, affiliations, ratings or third-party profiles. */
export const brandStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": BRAND.organizationId,
      name: BRAND.name,
      url: BRAND.url,
      logo: {
        "@type": "ImageObject",
        "@id": `${BRAND.url}/#logo`,
        url: BRAND.logo.url,
        contentUrl: BRAND.logo.url,
        width: BRAND.logo.width,
        height: BRAND.logo.height,
        caption: BRAND.logo.alt,
      },
    },
    {
      "@type": "WebSite",
      "@id": `${BRAND.url}/#website`,
      name: BRAND.name,
      url: BRAND.url,
      inLanguage: "en-US",
      publisher: { "@id": BRAND.organizationId },
    },
  ],
} as const;
