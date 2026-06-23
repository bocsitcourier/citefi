import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/navigation/app-shell";
import { UpgradeModal } from "@/components/UpgradeModal";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Citefi — The Local SEO Content Engine",
  description: "Citefi blends Gemini and GPT-4 in a 4-stage pipeline that injects real ZIP-code intelligence, neighborhood context, and E-E-A-T signals into every article — so your content ranks where generic AI tools can't.",
  icons: {
    icon: "/icon.png",
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "Citefi — The Local SEO Content Engine",
    description: "Dual-AI local SEO content platform for agencies, local businesses, and multi-location brands.",
    siteName: "Citefi",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Citefi — The Local SEO Content Engine",
    description: "Dual-AI local SEO content platform for agencies, local businesses, and multi-location brands.",
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
