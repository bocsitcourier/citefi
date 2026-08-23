"use client";

import { use, useMemo, type ElementType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Download, ExternalLink, FileText, Layers3, Loader2, MapPin, PanelTop, Send, Sparkles, Target, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { BundleGlyphs, ConfirmedMark, StatusBadge } from "../components";
import { campaignId } from "../campaign-types";
import { useCampaign, useConfirmBrand } from "../use-campaigns";

function metric(value: number | undefined, label: string, detail?: string) {
  return <div className="border-l pl-3 first:border-l-0 first:pl-0"><p className="text-lg font-semibold">{value?.toLocaleString() ?? "—"}</p><p className="text-xs text-muted-foreground">{label}{detail ? ` · ${detail}` : ""}</p></div>;
}
function rows(items: Array<Record<string, any>> | undefined, title: string, icon: ElementType) {
  const Icon = icon;
  return <Card><CardHeader className="pb-3"><CardTitle className="text-sm flex gap-2 items-center"><Icon className="w-4 h-4 text-primary" />{title}<Badge variant="secondary" className="ml-auto">{items?.length || 0}</Badge></CardTitle></CardHeader><CardContent className="pt-0">{items?.length ? <div className="space-y-2">{items.slice(0, 4).map((item, index) => <div key={item.id || index} className="rounded-md bg-muted/45 px-3 py-2 text-sm flex gap-2 justify-between"><span className="truncate">{item.title || item.name || item.chosenTitle || item.idea || `${title.slice(0, -1)} ${index + 1}`}</span><span className="text-xs text-muted-foreground shrink-0">{item.status || item.articleStatus || "Ready"}</span></div>)}</div> : <p className="text-sm text-muted-foreground">No {title.toLowerCase()} are attached yet.</p>}</CardContent></Card>;
}

export default function CampaignWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { data: campaign, isLoading, isError, refetch } = useCampaign(id);
  const confirm = useConfirmBrand(id);
  const exportCampaign = async () => {
    try {
      const response = await fetch(`/api/campaigns/${id}/export`, { credentials: "include" });
      if (!response.ok) throw new Error("Export could not be prepared");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)?.[1] || `campaign-${id}.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = decodeURIComponent(filename);
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded", description: "Campaign files are ready for handoff." });
    } catch (error) { toast({ title: "Export failed", description: error instanceof Error ? error.message : "Try again shortly.", variant: "destructive" }); }
  };
  const plan = useMemo(() => campaign?.assetBundle || campaign?.recommendedAssetBundle, [campaign]);
  if (isLoading) return <div className="p-6 max-w-6xl mx-auto space-y-5"><div className="h-20 bg-muted animate-pulse rounded-lg" /><div className="grid md:grid-cols-3 gap-4">{[1,2,3].map(n => <div key={n} className="h-40 bg-muted animate-pulse rounded-lg" />)}</div></div>;
  if (isError || !campaign) return <div className="min-h-[60dvh] flex items-center justify-center p-6"><Card className="max-w-md"><CardContent className="p-8 text-center"><AlertTriangle className="mx-auto text-destructive w-7 h-7 mb-3" /><h1 className="font-semibold">Campaign unavailable</h1><p className="text-sm text-muted-foreground mt-1">The campaign record could not be loaded.</p><Button onClick={() => refetch()} variant="outline" className="mt-4">Try again</Button></CardContent></Card></div>;
  const stats = campaign.stats || {};
  const approvals = typeof stats.approvals === "number" ? stats.approvals : stats.approvals?.pending;
  const publishing = typeof stats.publishing === "number" ? stats.publishing : stats.publishing?.published;
  const profile = campaign.brandProfile || campaign.brandProfileSnapshot;
  return <div className="min-h-[100dvh] bg-background"><div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
    <header className="space-y-4"><Button asChild variant="ghost" size="sm" className="-ml-3"><Link href="/campaigns"><ArrowLeft className="w-4 h-4 mr-1" />Campaigns</Link></Button><div className="flex flex-wrap justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap gap-2 items-center"><StatusBadge status={campaign.status} /><span className="text-xs text-muted-foreground">Campaign {campaign.publicId}</span></div><h1 className="text-3xl font-bold tracking-tight mt-2">{campaign.name}</h1><p className="text-sm text-muted-foreground mt-1 truncate">{campaign.companyName} · {campaign.businessUrl}</p></div><div className="flex gap-2 items-start"><Button variant="outline" onClick={exportCampaign} data-testid="button-export-campaign"><Download className="w-4 h-4 mr-2" />Export</Button><Button type="button" onClick={() => router.push(`/dashboard?campaignId=${encodeURIComponent(campaignId(campaign))}`)} data-testid="button-open-dashboard">Create title pool <ExternalLink className="w-4 h-4 ml-2" /></Button></div></div></header>
    <Card className="bg-muted/30"><CardContent className="p-4 flex flex-wrap gap-x-7 gap-y-4">{metric(approvals, "awaiting approval")}{metric(publishing, "published")}{metric(stats.credits, "credits used")}{metric(stats.costUsd, "cost USD", stats.costUsd ? `$${stats.costUsd.toFixed(2)}` : undefined)}{metric(stats.conversions, "conversions")}{metric(stats.conversionValue, "conversion value", stats.conversionValue ? `$${stats.conversionValue.toLocaleString()}` : undefined)}</CardContent></Card>
    <div className="grid lg:grid-cols-[1.2fr_.8fr] gap-5"><div className="space-y-5"><Card className={campaign.brandConfirmedAt ? "border-emerald-500/25" : "border-amber-500/35"}><CardHeader><div className="flex justify-between gap-3"><div><CardTitle className="text-base flex gap-2 items-center"><Sparkles className="w-4 h-4 text-primary" />Brand intelligence</CardTitle><CardDescription className="mt-1">The guardrail layer behind every campaign asset.</CardDescription></div><ConfirmedMark confirmed={Boolean(campaign.brandConfirmedAt)} /></div></CardHeader><CardContent className="space-y-4">{profile ? <div className="grid sm:grid-cols-2 gap-3 text-sm"><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground mb-1">Positioning</p><p className="line-clamp-3">{profile.positioning?.uniqueValueProposition || profile.summary || "Brand profile captured and ready for campaign use."}</p></div><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground mb-1">Voice cues</p><p>{(profile.brandVoice?.toneAdjectives || profile.tone || []).slice?.(0, 4).join(" · ") || "Profile details are available for review."}</p></div></div> : <p className="text-sm text-muted-foreground">Brand analysis is still being assembled for this campaign.</p>}{!campaign.brandConfirmedAt && <Button onClick={() => confirm.mutate(undefined, { onSuccess: () => toast({ title: "Brand confirmed", description: "Campaign creation can now use this profile as its source of truth." }), onError: (e: Error) => toast({ title: "Confirmation failed", description: e.message, variant: "destructive" }) })} disabled={confirm.isPending} data-testid="button-confirm-campaign-brand">{confirm.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}Confirm brand intelligence</Button>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base flex gap-2 items-center"><Layers3 className="w-4 h-4 text-primary" />Campaign plan</CardTitle><CardDescription>{campaign.goals?.map(goal => goal.replaceAll("_", " ")).join(" · ") || "No campaign goals recorded."}</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-3 items-center"><BundleGlyphs bundle={plan} /><span className="text-xs text-muted-foreground">Estimated {campaign.creditEstimate?.totalCredits?.toLocaleString() || "—"} credits</span></div><div className="mt-4 flex flex-wrap gap-2">{campaign.locations?.map(location => <Badge variant="outline" key={location.label}><MapPin className="w-3 h-3 mr-1" />{[location.label, location.region, location.country].filter(Boolean).join(", ")}</Badge>)}</div></CardContent></Card>
      <div className="grid md:grid-cols-2 gap-5">{rows(campaign.articles, "Articles", FileText)}{rows(campaign.socialPosts, "Social posts", Send)}{rows(campaign.videoIdeas, "Video ideas", Video)}{rows(campaign.batches, "Batches", PanelTop)}</div></div>
      <div className="space-y-5">{rows(campaign.publishingJobs, "Publishing", Send)}<Card><CardHeader className="pb-3"><CardTitle className="text-sm flex gap-2 items-center"><Target className="w-4 h-4 text-primary" />Results</CardTitle></CardHeader><CardContent className="space-y-3"><div className="rounded-md bg-muted/45 p-3"><p className="text-xs text-muted-foreground">Conversions</p><p className="text-2xl font-semibold mt-1">{stats.conversions?.toLocaleString() || "—"}</p></div><div className="rounded-md bg-muted/45 p-3"><p className="text-xs text-muted-foreground">Attributed value</p><p className="text-2xl font-semibold mt-1">{stats.conversionValue ? `$${stats.conversionValue.toLocaleString()}` : "—"}</p></div><Button variant="outline" className="w-full" onClick={() => router.push(`/dashboard?campaignId=${encodeURIComponent(campaignId(campaign))}`)}><CircleDashed className="w-4 h-4 mr-2" />Continue in dashboard</Button></CardContent></Card></div>
    </div>
  </div></div>;
}