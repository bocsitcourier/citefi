import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Create your account",
  description: "Create a Citefi account to read your full watermarked trial article. Workspace access requires approval.",
  alternates: { canonical: "https://citefi.co/signup" },
  robots: { index: false, follow: true },
};
export default function SignupLayout({ children }: { children: React.ReactNode }) { return children; }
