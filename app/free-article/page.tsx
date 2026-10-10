import type { Metadata } from "next";
import TrialReader from "@/components/marketing/trial-reader";
export const metadata: Metadata = { title: "Try one local article", description: "Generate one locally grounded article. Preview an excerpt before signup.", robots: { index: false, follow: false }, alternates: { canonical: "https://citefi.co/free-article" } };
export default function FreeArticlePage() { return <TrialReader />; }
