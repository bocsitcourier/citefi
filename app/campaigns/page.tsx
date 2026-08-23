"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CampaignCard, EmptyCampaigns } from "./components";
import { useCampaigns } from "./use-campaigns";

export default function CampaignsPage() {
  const [query, setQuery] = useState("");
  const { data, isLoading, isError, refetch } = useCampaigns();
  const campaigns = useMemo(() => (data || []).filter(c => `${c.name} ${c.companyName} ${c.businessUrl} ${c.status}`.toLowerCase().includes(query.toLowerCase())), [data, query]);
  return <div className="min-h-[100dvh] bg-background"><div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
    <header className="flex flex-wrap justify-between gap-4 items-end"><div><div className="flex items-center gap-2 text-primary mb-2"><Target className="w-4 h-4" /><span className="text-xs font-semibold tracking-[.16em] uppercase">Agency command center</span></div><h1 className="text-3xl font-bold tracking-tight">Campaigns</h1><p className="text-sm text-muted-foreground mt-1">A single operating record for every client market.</p></div><Button asChild data-testid="button-new-campaign"><Link href="/campaigns/new"><Plus className="w-4 h-4 mr-2" />New campaign</Link></Button></header>
    <Card className="bg-muted/30"><CardContent className="p-3"><div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" /><Input aria-label="Search campaigns" className="pl-9 bg-background" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search client, campaign, URL, or status" data-testid="input-search-campaigns" /></div></CardContent></Card>
    {isLoading && <div className="grid md:grid-cols-2 gap-4">{[1,2,3,4].map(i => <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />)}</div>}
    {isError && <Card><CardContent className="p-8 text-center"><p className="font-medium">Campaigns could not be loaded.</p><Button onClick={() => refetch()} variant="outline" className="mt-3">Try again</Button></CardContent></Card>}
    {!isLoading && !isError && !data?.length && <EmptyCampaigns />}
    {!isLoading && !isError && !!data?.length && <><p className="text-sm text-muted-foreground">{campaigns.length} of {data.length} campaigns in view</p>{campaigns.length ? <div className="grid md:grid-cols-2 gap-4">{campaigns.map(c => <CampaignCard key={c.publicId} campaign={c} />)}</div> : <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">No campaigns match this search.</CardContent></Card>}</>}
  </div></div>;
}