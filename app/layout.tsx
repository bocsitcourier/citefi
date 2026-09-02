import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/navigation/app-shell";
import { UpgradeModal } from "@/components/UpgradeModal";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-marketing" });
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
    default: "Citefi — Local marketing, with receipts",
    template: "%s | Citefi",
  },
  description:
    "Citefi is a local marketing campaign engine for agencies and local businesses—grounded in business context, reviewable work, and clearly separated external action.",
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
    apple: "/icon.png",
  },
  openGraph: {
    title: "Citefi — Local marketing, with receipts",
    description:
      "A local marketing campaign engine for agencies and local businesses. Create reviewable, grounded campaign work with Citefi.",
    siteName: "Citefi",
    url: APP_URL,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "Citefi — Local marketing campaign engine",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Citefi — Local marketing, with receipts",
    description:
      "Create locally informed marketing work while keeping external action separate from generation.",
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
      <body className={`${inter.variable} ${dmSans.variable} ${fraunces.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
          <UpgradeModal />
        </Providers>
      </body>
    </html>
  );
}
