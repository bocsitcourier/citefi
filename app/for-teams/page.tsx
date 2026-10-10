import type { Metadata } from "next";
import { LongformPage } from "@/components/marketing/longform";
import { marketingMetadata } from "@/lib/marketing/metadata";
export const metadata: Metadata = marketingMetadata("For teams", "Create multi-format marketing with your review team. Explore campaign context, separate agency client workspaces, client-safe reports and current seat/credit limits.", "/for-teams");
export default function Page() { return <LongformPage page="teams" />; }
