import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Citefi content workspace.",
  alternates: { canonical: "https://citefi.co/login" },
  robots: { index: false, follow: true },
};
export default function LoginLayout({ children }: { children: React.ReactNode }) { return children; }
