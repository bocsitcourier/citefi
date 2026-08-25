"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Download, FileOutput, FlaskConical, Globe2, Loader2, ShieldCheck, Sparkles, Tag, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Campaign, CampaignAd, AdsPlatform } from "./campaign-types";
import { useCampaignAds, useGenerateCampaignAds } from "./use-campaigns";

const notice = "Manual review and platform upload required.";

function statusTone(status?: string) {
  if (/ready|pass|clear/i.test(status || "")) return "border-[#5B7F6F]/30 bg-[#DFE7E0] text-[#355B4A]";
  if (/review|warning|needs/i.test(status || "")) return "border-[#B8604F]/30 bg-[#B8604F]/10 text-[#8B4438]";
  return "bg-muted text-muted-foreground";
}

function PlatformPill({ platform }: { platform: AdsPlatform }) {
  return <Badge variant="outline" className="border-[#5B7F6F]/30 bg-[#DFE7E0]/70 text-[#355B4A]">{platform === "google" ? "Google Ads" : "Meta Ads"}</Badge>;
}

function AdPreview({ ad, platform }: { ad: CampaignAd; platform: AdsPlatform }) {
  const variant = platform === "google"
    ? { headline: ad.googleAssets?.headlines?.[0], primaryText: ad.googleAssets?.descriptions?.[0], description: ad.googleAssets?.descriptions?.[1] }
    : ad.metaAssets?.variants?.[0];
  const policyStatus = ad.policyJson?.blocksExport ? "needs_review" : ad.status || "internal_review";
  const utmLine = "Export supplies platform-specific UTM values.";
  return <article className="space-y-3 rounded-lg border bg-card p-4 shadow-[0_10px_28px_rgba(28,43,45,0.04)]">
    <div className="flex items-start justify-between gap-3"><PlatformPill platform={platform} /><Badge variant="outline" className={cn("capitalize", statusTone(policyStatus))}>{policyStatus.replaceAll("_", " ")}</Badge></div>
    <div><p className="font-serif text-lg font-semibold leading-snug">{variant?.headline || "Generated ad headline"}</p><p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{variant?.primaryText || variant?.description || "Copy will appear here after generation."}</p></div>
    <div className="rounded-md bg-muted/55 px-3 py-2 text-xs"><p className="flex items-center gap-1.5 font-medium"><Globe2 className="h-3.5 w-3.5" />Landing destination</p><p className="mt-1 truncate text-muted-foreground">{ad.landingUrl || ad.finalUrl || "No landing URL supplied"}</p><p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{utmLine}</p></div>
  </article>;
}

export function AdsLab({ campaign }: { campaign: Campaign }) {
  const { toast } = useToast();
  const { data, isLoading, isError, refetch } = useCampaignAds(campaign.publicId);
  const generate = useGenerateCampaignAds(campaign.publicId);
  const [platform, setPlatform] = useState<AdsPlatform>("google");
  const [landingUrl, setLandingUrl] = useState(campaign.businessUrl);
  const [acknowledged, setAcknowledged] = useState(false);
  const ads = data?.ads || [];
  const platformAds = useMemo(() => ads.filter((ad) => platform === "google" ? Boolean(ad.googleAssets) : Boolean(ad.metaAssets)), [ads, platform]);
  const selectedAd = platformAds[0] || ads[0];
  const brandConfirmed = Boolean(campaign.brandConfirmedAt || data?.readiness?.brandConfirmed);
  const generationReady = brandConfirmed && landingUrl.trim().length > 0;
  const validationErrors = selectedAd?.validationJson?.filter((issue) => issue.severity === "error") || [];
  const policyBlocks = Boolean(selectedAd?.policyJson?.blocksExport);
  const generatedReady = Boolean(selectedAd) && validationErrors.length === 0 && !policyBlocks;
  const readinessChecks = [brandConfirmed, Boolean(landingUrl.trim()), Boolean(selectedAd), generatedReady];
  const readyCount = readinessChecks.filter(Boolean).length;
  const exportReady = generatedReady && acknowledged;

  const generateAds = () => generate.mutate({
    requestKey: `${campaign.publicId}-${Date.now()}`,
    landingUrl: landingUrl.trim(),
     brief: `Create a complete Google RSA and Meta creative handoff for this campaign. The reviewer is currently focused on ${platform}. Campaign goals: ${(campaign.goals || []).join(", ") || "local customer growth"}.`,
    approveUtmOverwrite: false,
  }, {
    onSuccess: () => toast({ title: "Ads drafted", description: "Drafts are ready for your human review." }),
    onError: (error: Error) => toast({ title: "Draft generation failed", description: error.message || "Try again shortly.", variant: "destructive" }),
  });

  const exportAds = async () => {
    if (!exportReady) return;
    try {
      const ad = selectedAd;
      if (!ad?.publicId) throw new Error("Select a generated ad pack before exporting");
      const acknowledgementText = "I have reviewed this export-only ad pack and will upload it manually.";
      for (const approvalType of ["client", "policy", "export"] as const) {
        const approval = await fetch(`/api/campaigns/${campaign.publicId}/ads/${ad.publicId}/approve`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalType, decision: "approved", humanAcknowledged: true, acknowledgementText }),
        });
        if (!approval.ok) {
          const body = await approval.json().catch(() => ({}));
          throw new Error(body.error || "Internal approval could not be recorded");
        }
      }
      const response = await fetch(`/api/campaigns/${campaign.publicId}/ads/${ad.publicId}/export`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Ads export could not be prepared");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${campaign.publicId}-ads.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: "Ads export downloaded", description: notice });
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Try again shortly.", variant: "destructive" });
    }
  };

  return <section aria-labelledby="ads-lab-title" className="space-y-6 rounded-2xl bg-[#F6F4EE] py-2">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5B7F6F]"><FlaskConical className="h-3.5 w-3.5" />Export-only workspace</div><h2 id="ads-lab-title" className="mt-2 font-serif text-2xl font-semibold tracking-tight">Build an ad handoff your client can trust.</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Citefi drafts both platform packs, explains every check, and leaves publishing and spend in human hands.</p></div>
      <Badge variant="outline" className="gap-1.5 border-primary/25 bg-primary/5 text-primary"><FileOutput className="h-3.5 w-3.5" />No platform connection</Badge>
    </div>

    <Card className="border-[#B8604F]/30 bg-[#B8604F]/[0.045]"><CardContent className="flex gap-3 p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#B8604F]" /><div><p className="text-sm font-semibold">{notice}</p><p className="mt-1 text-sm text-muted-foreground">Citefi checks the files before handoff. Google and Meta still make their own policy decision after you upload.</p></div></CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <Card className="shadow-[0_12px_32px_rgba(28,43,45,0.05)]">
        <CardHeader><CardTitle className="flex items-center gap-2 font-serif text-xl"><Sparkles className="h-4 w-4 text-[#5B7F6F]" />Create the handoff</CardTitle><CardDescription>One generation creates a Google RSA pack and a Meta creative pack for 5 credits.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2"><Label htmlFor="ads-platform">Review focus</Label><Select value={platform} onValueChange={(value) => setPlatform(value as AdsPlatform)}><SelectTrigger id="ads-platform" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="google">Google Ads</SelectItem><SelectItem value="meta">Meta Ads</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">This changes the preview only. Your export includes both platforms.</p></div>
          <div className="space-y-2"><Label htmlFor="ads-landing">Landing page</Label><Input id="ads-landing" value={landingUrl} onChange={(event) => setLandingUrl(event.target.value)} placeholder="https://example.com/offer" /></div>
          <div className="rounded-lg bg-[#DFE7E0]/65 p-3 text-xs text-[#355B4A]"><p className="font-semibold">Tracking stays consistent automatically.</p><p className="mt-1 font-mono">Google: google / cpc · Meta: meta / paid_social</p><p className="mt-1">Existing non-UTM parameters stay intact. Existing UTMs require explicit overwrite approval.</p></div>
          <Button className="min-h-11 w-full" onClick={generateAds} disabled={!generationReady || generate.isPending}>{generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{generate.isPending ? "Drafting both ad packs…" : "Generate complete ad handoff · 5 credits"}</Button>
          {!brandConfirmed && <p className="rounded-md border border-[#B8604F]/25 bg-[#B8604F]/[0.06] p-3 text-xs text-[#8B4438]">Confirm Brand Intelligence first. This keeps every ad tied to the voice and claims your client approved.</p>}
        </CardContent>
      </Card>

      <Card className="shadow-[0_12px_32px_rgba(28,43,45,0.05)]">
        <CardHeader><CardTitle className="flex items-center gap-2 font-serif text-xl"><ShieldCheck className="h-4 w-4 text-[#5B7F6F]" />Your next move</CardTitle><CardDescription>{readyCount} of 4 handoff checks are clear. Platform approval remains separate.</CardDescription><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#DFE7E0]" aria-label={`${readyCount} of 4 readiness checks complete`}><div className="h-full rounded-full bg-[#5B7F6F] transition-[width]" style={{ width: `${readyCount * 25}%` }} /></div></CardHeader>
        <CardContent className="space-y-3">
          <ReadinessRow label="Brand intelligence confirmed" ready={brandConfirmed} detail={brandConfirmed ? "Campaign voice is locked for this export." : "Requires campaign owner confirmation."} />
          <ReadinessRow label="Landing destination supplied" ready={Boolean(landingUrl.trim())} detail={landingUrl.trim() || "Add a final destination URL."} />
          <ReadinessRow label="Platform packs generated" ready={Boolean(selectedAd)} detail={selectedAd ? "Google and Meta assets are ready to review." : "Generate the first complete pack."} />
          <ReadinessRow label="Policy and format checks clear" ready={generatedReady} detail={policyBlocks ? "A policy or disclaimer issue blocks export." : validationErrors.length ? `${validationErrors.length} format issue${validationErrors.length === 1 ? "" : "s"} must be corrected.` : selectedAd ? "No blocking issues found." : "Checks run after generation."} />
          <div className="mt-4 rounded-lg border border-dashed p-3"><p className="flex items-center gap-2 text-sm font-medium"><UploadCloud className="h-4 w-4 text-muted-foreground" />Platform approval</p><p className="mt-1 text-sm text-muted-foreground">Not checked here. Google and Meta independently evaluate creative, targeting, destination, and account eligibility after manual upload.</p></div>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2 font-serif text-xl"><Tag className="h-4 w-4 text-[#5B7F6F]" />Review the work</CardTitle><CardDescription>See the copy, destination, status, and why the handoff is or is not ready.</CardDescription></div><div className="grid grid-cols-2 rounded-lg border bg-background p-1" aria-label="Ad platform preview">{(["google", "meta"] as AdsPlatform[]).map((value) => <Button key={value} type="button" variant={platform === value ? "default" : "ghost"} size="sm" onClick={() => setPlatform(value)} className="min-h-9">{value === "google" ? "Google" : "Meta"}</Button>)}</div></CardHeader>
      <CardContent>
        {isLoading ? <div className="grid gap-3 sm:grid-cols-2">{[1, 2].map((key) => <div key={key} className="h-48 animate-pulse rounded-lg bg-muted" />)}</div> : isError ? <div className="rounded-lg border border-destructive/25 p-5 text-center"><p className="font-medium">Ads drafts could not be loaded.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button></div> : platformAds.length ? <div className="grid gap-3 md:grid-cols-2">{platformAds.map((ad) => <AdPreview key={ad.id} ad={ad} platform={platform} />)}</div> : <div className="rounded-lg border border-dashed px-5 py-10 text-center"><p className="font-medium">No {platform === "google" ? "Google" : "Meta"} drafts yet.</p><p className="mt-1 text-sm text-muted-foreground">Set the destination, then generate a small review set.</p></div>}
      </CardContent>
    </Card>

    <Card className="border-[#5B7F6F]/30 bg-card shadow-[0_12px_32px_rgba(28,43,45,0.05)]">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Checkbox id="ads-acknowledgement" checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} className="mt-0.5 h-5 w-5" /><Label htmlFor="ads-acknowledgement" className="cursor-pointer text-sm leading-5"><span className="font-semibold">I reviewed this complete ad pack and will upload it manually.</span><span className="mt-1 block text-muted-foreground">{notice}</span></Label></div><Button onClick={exportAds} disabled={!exportReady} className="min-h-11 w-full shrink-0 sm:w-auto"><Download className="mr-2 h-4 w-4" />Export complete Ads handoff</Button></CardContent>
    </Card>
  </section>;
}

function ReadinessRow({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className="flex gap-3 rounded-lg border p-3"><div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", ready ? "bg-[#DFE7E0] text-[#355B4A]" : "bg-[#B8604F]/10 text-[#8B4438]")}>{ready ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}</div><div className="min-w-0"><p className="text-sm font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div><Badge variant="outline" className={cn("ml-auto hidden h-6 shrink-0 capitalize sm:inline-flex", statusTone(ready ? "ready" : "needs review"))}>{ready ? "ready" : "needs review"}</Badge></div>;
}