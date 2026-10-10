import type { Metadata } from "next";
import { LongformPage } from "@/components/marketing/longform";
import { marketingMetadata } from "@/lib/marketing/metadata";
export const metadata: Metadata = marketingMetadata("Our approach", "Build useful articles, images, social content, podcasts and video around real customer questions, brand context, review and the next buying decision.", "/approach");
export default function Page() { return <LongformPage page="approach" />; }
