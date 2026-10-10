import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/** Page-specific sharing metadata; never inherit the homepage URL on detail pages. */
export function marketingMetadata(title: string, description: string, path: string): Metadata {
  const url = `${BRAND.url}${path}`;
  return {
    title, description, alternates: { canonical: url },
    openGraph: { title, description, url, siteName: BRAND.name, type: "website", images: [{ ...BRAND.socialImage }] },
    twitter: { card: "summary_large_image", title, description, images: [{ url: BRAND.socialImage.url, alt: BRAND.socialImage.alt }] },
  };
}
