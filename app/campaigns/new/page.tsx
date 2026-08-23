"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { BundleGlyphs, bundleOptions, goalOptions } from "../components";
import { campaignId, type CampaignLocation } from "../campaign-types";
import { useCreateCampaign } from "../use-campaigns";

function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const { toast } = useToast();
  const create = useCreateCampaign();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [businessUrl, setBusinessUrl] = useState("");
  const [goals, setGoals] = useState<string[]>(["local_seo"]);
  const [locations, setLocations] = useState<CampaignLocation[]>([]);
  const [locationInput, setLocationInput] = useState("");
  const [selected, setSelected] = useState("momentum");
  const bundle = useMemo(() => bundleOptions.find(item => item.id === selected)!, [selected]);
  const addLocation = () => { const label = locationInput.trim(); if (label && !locations.some(location => location.label === label)) setLocations(items => [...items, { label }]); setLocationInput(""); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !companyName.trim() || !businessUrl.trim() || !locations.length) { toast({ title: "Complete campaign setup", description: "Add a campaign name, client, URL, and at least one location.", variant: "destructive" }); return; }
    create.mutate({ requestId: uuid(), name: name.trim(), businessUrl: businessUrl.trim(), companyName: companyName.trim(), goals, locations, assetBundle: bundle.bundle }, { onSuccess: (response: { campaign: import("../campaign-types").Campaign }) => { toast({ title: "Campaign created", description: "Your client command center is ready." }); router.push(`/campaigns/${campaignId(response.campaign)}`); }, onError: (error: Error) => toast({ title: "Campaign could not be created", description: error.message, variant: "destructive" }) });
  };
  return <div className="min-h-[100dvh] bg-background"><form onSubmit={submit} className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
    <header><Button asChild variant="ghost" size="sm" className="mb-4 -ml-3"><Link href="/campaigns"><ArrowLeft className="w-4 h-4 mr-1" />All campaigns</Link></Button><div className="grid lg:grid-cols-[1fr_auto] gap-3 items-end"><div><p className="text-xs font-semibold tracking-[.16em] text-primary uppercase">New operating record</p><h1 className="text-3xl font-bold tracking-tight mt-1">Build the campaign perimeter.</h1><p className="text-sm text-muted-foreground mt-1">Set the client, territory, and first asset mix. Everything created from here stays connected.</p></div><div className="text-sm rounded-lg border bg-muted/30 px-4 py-3"><span className="text-muted-foreground">Estimated launch </span><strong>{bundle.credits.toLocaleString()} credits</strong></div></div></header>
    <div className="grid lg:grid-cols-[1.05fr_.95fr] gap-5 items-start">
      <div className="space-y-5"><Card><CardHeader><CardTitle className="text-base">Client signal</CardTitle><CardDescription>Start with the source of truth for this local business.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid sm:grid-cols-2 gap-4"><div className="space-y-1.5"><Label htmlFor="campaign-name">Campaign name</Label><Input id="campaign-name" value={name} onChange={e => setName(e.target.value)} placeholder="Spring service-area launch" data-testid="input-campaign-name" /></div><div className="space-y-1.5"><Label htmlFor="company-name">Company</Label><Input id="company-name" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Client business name" data-testid="input-campaign-company" /></div></div><div className="space-y-1.5"><Label htmlFor="business-url">Business URL</Label><Input id="business-url" type="url" value={businessUrl} onChange={e => setBusinessUrl(e.target.value)} placeholder="https://clientbusiness.com" data-testid="input-campaign-url" /></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Mission parameters</CardTitle><CardDescription>Choose what success should look like in this market.</CardDescription></CardHeader><CardContent className="space-y-5"><div><Label>Goals</Label><div className="flex flex-wrap gap-2 mt-2">{goalOptions.map(goal => <button type="button" key={goal.value} onClick={() => setGoals(items => items.includes(goal.value) ? items.filter(x => x !== goal.value) : [...items, goal.value])} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${goals.includes(goal.value) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/40"}`} data-testid={`toggle-goal-${goal.value}`}>{goals.includes(goal.value) && <Check className="inline w-3 h-3 mr-1" />}{goal.label}</button>)}</div></div><div><Label htmlFor="locations">Locations</Label><div className="flex gap-2 mt-2"><Input id="locations" value={locationInput} onChange={e => setLocationInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLocation(); } }} placeholder="Add city or service area" data-testid="input-campaign-location" /><Button type="button" variant="outline" size="icon" onClick={addLocation} aria-label="Add location"><Plus className="w-4 h-4" /></Button></div><div className="flex flex-wrap gap-2 mt-2">{locations.map(location => <button type="button" key={location.label} onClick={() => setLocations(items => items.filter(x => x.label !== location.label))} className="text-xs border bg-muted px-2 py-1 rounded-md" aria-label={`Remove ${location.label}`}>{location.label} ×</button>)}</div></div></CardContent></Card></div>
      <Card className="border-primary/20"><CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4 text-primary" />Recommended asset bundle</CardTitle><CardDescription>Start with a cohesive mix, then keep every asset traceable from the workspace.</CardDescription></CardHeader><CardContent className="space-y-3">{bundleOptions.map(option => <button type="button" key={option.id} onClick={() => setSelected(option.id)} className={`w-full text-left rounded-lg border p-4 transition-colors ${selected === option.id ? "border-primary bg-primary/5" : "hover:border-primary/35"}`} data-testid={`select-bundle-${option.id}`}><div className="flex gap-3"><span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${selected === option.id ? "border-primary bg-primary" : ""}`}>{selected === option.id && <Check className="w-3 h-3 text-primary-foreground" />}</span><div className="flex-1"><div className="flex justify-between gap-2"><strong className="text-sm">{option.label}</strong><span className="text-xs font-medium">{option.credits} cr</span></div><p className="text-xs text-muted-foreground mt-1">{option.description}</p><div className="mt-3"><BundleGlyphs bundle={option.bundle} /></div></div></div></button>)}<div className="pt-3 border-t flex justify-between items-center"><span className="text-sm text-muted-foreground">Launch estimate</span><span className="text-lg font-semibold">{bundle.credits.toLocaleString()} credits</span></div><Button type="submit" className="w-full" disabled={create.isPending} data-testid="button-create-campaign">{create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}Create campaign <ArrowRight className="w-4 h-4 ml-2" /></Button></CardContent></Card>
    </div>
  </form></div>;
}