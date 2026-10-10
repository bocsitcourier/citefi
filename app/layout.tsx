import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/navigation/app-shell";
import { UpgradeModal } from "@/components/UpgradeModal";
import { BRAND, brandStructuredData } from "@/lib/brand";
import { ArticleImageAccessibility } from "@/components/article-image-accessibility";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-marketing" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-serif" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Force dynamic rendering on every route — prevents Next.js from trying to
// statically pre-render pages during `next build`, which OOMs the 2 GB droplet.
export const dynamic = "force-dynamic";

const APP_URL = BRAND.url;

export const viewport: Viewport = {
  themeColor: "#1C2B2D",
};

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Citefi — articles, images, social, podcasts and video",
    template: "%s | Citefi",
  },
  description:
    "A marketing workspace for small businesses and agencies: articles, images, social media, podcasts, video, SEO/GEO, campaigns, customer journeys and review.",
  keywords: [
    "local SEO",
    "AI content generation",
    "local SEO content",
    "SEO agency software",
    "local marketing",
    "campaign engine",
    "agency marketing software",
    "local business content",
  ],
  authors: [{ name: "Citefi", url: APP_URL }],
  creator: "Citefi",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: APP_URL,
  },
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Citefi — articles, images, social, podcasts and video",
    description:
      "Create useful marketing across formats. Connect your business context, customer questions, campaigns, review and next steps.",
    siteName: "Citefi",
    url: APP_URL,
    type: "website",
    locale: "en_US",
    images: [
      {
        ...BRAND.socialImage,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Citefi — articles, images, social, podcasts and video",
    description:
      "Articles, images, social media, podcasts and video in a connected marketing workspace for small businesses and agencies.",
    images: [{ url: BRAND.socialImage.url, alt: BRAND.socialImage.alt }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${dmSans.variable} ${fraunces.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <script
          id="citefi-brand-structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(brandStructuredData).replace(/</g, "\\u003c") }}
        />
        <Providers>
          <AppShell>{children}</AppShell>
          <UpgradeModal />
          <ArticleImageAccessibility />
        </Providers>
      </body>
    </html>
  );
}
