"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleDashed, FileText, MapPin, PanelTop, Send, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Campaign } from "./campaign-types";
import { bundleTotal, campaignId } from "./campaign-types";

export const goalOptions = [
  { value: "lead_generation", label: "Qualified leads" },
  { value: "brand_awareness", label: "Brand awareness" },
  { value: "local_seo", label: "Local visibility" },
  { value: "thought_leadership", label: "Thought leadership" },
  { value: "product_launch", label: "Product launch" },
];

export const bundleOptions = [
  { id: "focused", label: "Focused launch", description: "A fast local-search foundation", bundle: { articles: 4, socialPosts: 8, videos: 2 }, credits: 164 },
  { id: "momentum", label: "Momentum system", description: "The recommended agency cadence", bundle: { articles: 8, socialPosts: 18, videos: 4 }, credits: 338 },
  { id: "territory", label: "Territory takeover", description: "Build coverage across locations", bundle: { articles: 14, socialPosts: 30, videos: 8 }, credits: 622 },
];

export function StatusBadge({ status }: { status: string }) {
  const tone = /active|complete|confirmed|published/i.test(status) ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/25" : /draft|pending|review/i.test(status) ? "bg-amber-500/10 text-amber-800 border-amber-500/25" : "bg-muted text-muted-foreground";
  return <Badge variant="outline" className={cn("capitalize font-medium", tone)}>{status.replaceAll("_", " ").toLowerCase()}</Badge>;
}

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const id = campaignId(campaign);
  return (
    <Link href={`/campaigns/${id}`} className="block group" data-testid={`campaign-card-${id}`}>
      <Card className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/35">
        <CardContent className="p-4 sm:p-5">
          <div className="flex gap-4 justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><StatusBadge status={campaign.status} /><span className="text-xs text-muted-foreground">ID {campaign.publicId}</span></div>
              <h2 className="font-semibold mt-2 truncate">{campaign.name}</h2>
              <p className="text-sm text-muted-foreground truncate">{campaign.companyName} · {campaign.businessUrl}</p>
            </div>
            <ArrowRight className="w-4 h-4 mt-1 text-muted-foreground group-hover:text-primary shrink-0" />
          </div>
          <div className="mt-4 pt-3 border-t grid grid-cols-3 gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="w-3.5 h-3.5" />{campaign.locations?.length || 0} locations</span>
            <span className="flex items-center gap-1.5 text-muted-foreground"><PanelTop className="w-3.5 h-3.5" />{bundleTotal(campaign.assetBundle)} assets</span>
            <span className="text-right font-medium">{campaign.creditEstimate?.totalCredits?.toLocaleString() || "—"} credits</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function BundleGlyphs({ bundle }: { bundle?: Record<string, unknown> | null }) {
  return <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex gap-1 items-center"><FileText className="w-3.5 h-3.5" />{Number(bundle?.articles) || 0}</span><span className="inline-flex gap-1 items-center"><Send className="w-3.5 h-3.5" />{Number(bundle?.socialPosts) || 0}</span><span className="inline-flex gap-1 items-center"><Video className="w-3.5 h-3.5" />{Number(bundle?.videos) || 0}</span></div>;
}

export function EmptyCampaigns() {
  return <Card className="border-dashed"><CardContent className="py-16 text-center max-w-lg mx-auto"><CircleDashed className="w-9 h-9 text-primary mx-auto mb-4" /><h2 className="text-xl font-semibold">The campaign board is clear.</h2><p className="text-sm text-muted-foreground mt-2">Bring in a business URL and turn scattered marketing work into one traceable, reviewable operating plan.</p><Button className="mt-5" asChild><Link href="/campaigns/new">Start the first campaign <ArrowRight className="w-4 h-4 ml-2" /></Link></Button></CardContent></Card>;
}

export function ConfirmedMark({ confirmed }: { confirmed: boolean }) {
  return <span className={cn("inline-flex gap-1.5 items-center text-xs", confirmed ? "text-emerald-700" : "text-muted-foreground")}><CheckCircle2 className="w-3.5 h-3.5" />{confirmed ? "Confirmed" : "Awaiting confirmation"}</span>;
}