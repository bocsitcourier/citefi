import { MetadataRoute } from "next";
import cityData from "@/lib/marketing/cities.json";
import { businessSolutions } from "@/lib/marketing/solutions";
import { BRAND } from "@/lib/brand";
import { productFeatures } from "@/lib/marketing/features";

const BASE_URL = BRAND.url;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date().toISOString();
  const core: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE_URL}/approach`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/workflow`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/for-teams`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/faq`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/cities`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/solutions`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/features`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  const cityUrls = [...new Map(cityData.cities.map((city) => [city.slug, city])).keys()].map((slug) => ({
    url: `${BASE_URL}/cities/${slug}`,
    lastModified: now,
    changeFrequency: "yearly" as const,
    priority: 0.55,
    images: [BRAND.logo.url, `${BASE_URL}${businessSolutions[0]!.image}`],
  }));
  const solutionUrls: MetadataRoute.Sitemap = businessSolutions.map(solution => ({
    url: `${BASE_URL}/solutions/${solution.slug}`,
    lastModified: now, changeFrequency: "monthly", priority: 0.8,
    images: [BRAND.logo.url, `${BASE_URL}${solution.image}`],
  }));
  const coreWithImages = core.map(page => ({
    ...page,
    images: [
      BRAND.logo.url,
      ...(page.url === BASE_URL ? [`${BASE_URL}${businessSolutions[0]!.image}`]
        : page.url === `${BASE_URL}/solutions`
          ? [...new Set(businessSolutions.map(solution => `${BASE_URL}${solution.image}`))]
          : []),
    ],
  }));
  const featureUrls: MetadataRoute.Sitemap = productFeatures.map(feature => ({
    url: `${BASE_URL}/features/${feature.slug}`, lastModified: now,
    changeFrequency: "monthly", priority: 0.85, images: [BRAND.logo.url],
  }));
  return [...coreWithImages, ...featureUrls, ...solutionUrls, ...cityUrls];
}
