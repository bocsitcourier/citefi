import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/navigation/app-shell";
import { UpgradeModal } from "@/components/UpgradeModal";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const APP_URL = "https://citefi.co";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Citefi — The Local SEO Content Engine",
    template: "%s | Citefi",
  },
  description:
    "Citefi runs best-in-class AI models through a 4-stage pipeline that injects real ZIP-code intelligence, neighborhood context, and E-E-A-T signals into every article — so your content ranks where generic AI tools can't.",
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
    title: "Citefi — The Local SEO Content Engine",
    description:
      "Generate ZIP-code-level SEO content at scale with a 4-stage AI pipeline. Built for agencies, local businesses, and multi-location brands.",
    siteName: "Citefi",
    url: APP_URL,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "Citefi — Local SEO Content Engine",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Citefi — The Local SEO Content Engine",
    description:
      "Generate ZIP-code-level SEO content at scale with a 4-stage AI pipeline. Built for agencies, local businesses, and multi-location brands.",
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
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
          <UpgradeModal />
        </Providers>
      </body>
    </html>
  );
}
