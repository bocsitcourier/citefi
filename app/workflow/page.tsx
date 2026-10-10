import type { Metadata } from "next";
import { LongformPage } from "@/components/marketing/longform";
import { marketingMetadata } from "@/lib/marketing/metadata";
export const metadata: Metadata = marketingMetadata("Workflow", "See how business context connects articles, images, social posts, podcasts, video, campaigns and customer journeys. Understand review, setup and paid-plan selection.", "/workflow");
export default function Page() { return <LongformPage page="workflow" />; }
