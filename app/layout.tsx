import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/navigation/app-shell";
import { UpgradeModal } from "@/components/UpgradeModal";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-serif" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

// Force dynamic rendering on every route — prevents Next.js from trying to
// statically pre-render pages during `next build`, which OOMs the 2 GB droplet.
export const dynamic = "force-dynamic";

const APP_URL = "https://citefi.co";

export const viewport: Viewport = {
  themeColor: "#1C2B2D",
};

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Local SEO Content Platform for Agencies | Citefi",
    template: "%s | Citefi",
  },
  description:
    "Generate locally grounded SEO articles, social content, videos, and podcasts with Brand Intelligence, review, and export workflows.",
  keywords: [
    "local SEO",
    "AI content generation",
    "local SEO content",
    "SEO agency software",
    "E-E-A-T content",
    "AI article generator",
    "local SEO tool",
    "multi-location SEO",
    "GEO optimization",
    "AEO content",
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
    apple: "/icon.png",
  },
  openGraph: {
    title: "Local SEO Content Engine for Agencies | Citefi",
    description:
      "Generate 50+ ZIP-code-level SEO articles per batch with a 4-stage AI pipeline. Built for agencies, local businesses, and multi-location brands.",
    siteName: "Citefi",
    url: APP_URL,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "Citefi — Local SEO Content Engine for Agencies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Local SEO Content Engine for Agencies | Citefi",
    description:
      "Generate 50+ ZIP-code-level SEO articles per batch with a 4-stage AI pipeline. Built for agencies, local businesses, and multi-location brands.",
    images: ["/icon.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
          <UpgradeModal />
        </Providers>
      </body>
    </html>
  );
}
