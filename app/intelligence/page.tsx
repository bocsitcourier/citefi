"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Pencil, Check, X, Plus, Target, ShieldCheck,
  Users, TrendingUp, MessageSquare, Lightbulb, MapPin, BookOpen,
  Search, Globe, BarChart3, ExternalLink, ShieldAlert,
} from "lucide-react";
import type { ClientBrandProfileJson } from "@/lib/client-brand-profile-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: number;
  teamId: number;
  websiteUrl: string;
  companyName: string;
  status: string;
  progressStep: string | null;
  errorMessage: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  mergedProfile: ClientBrandProfileJson | null;
}


// ---------------------------------------------------------------------------
// Progress steps display
// ---------------------------------------------------------------------------

const PROGRESS_STEPS = [
  { key: "website",     label: "Analyzing website",          icon: BookOpen },
  { key: "competitors", label: "Discovering competitors",     icon: Target },
  { key: "reddit",      label: "Mining Reddit pain points",  icon: MessageSquare },
  { key: "gaps",        label: "Analyzing competitive gaps",  icon: TrendingUp },
  { key: "policy",      label: "Building brand policy",      icon: ShieldCheck },
  { key: "assembling",  label: "Assembling profile",         icon: Sparkles },
];

function ProgressTracker({ step }: { step: string | null }) {
  const idx = PROGRESS_STEPS.findIndex(s => s.key === step);
  return (
    <div className="space-y-2">
      {PROGRESS_STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const pending = i > idx;
        return (
          <div key={s.key} className={`flex items-center gap-3 text-sm ${pending ? "opacity-40" : ""}`}>
            {done
              ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              : active
                ? <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                : <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
            }
            <span className={active ? "font-medium text-foreground" : ""}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editable tag list
// ---------------------------------------------------------------------------

function TagList({
  items, label, onSave, maxDisplay = 8,
}: { items: string[]; label: string; onSave?: (items: string[]) => void; maxDisplay?: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");

  const startEdit = () => { setDraft([...items]); setEditing(true); };
  const cancel = () => { setEditing(false); setNewItem(""); };
  const addItem = () => {
    const t = newItem.trim();
    if (t && !draft.includes(t)) setDraft(d => [...d, t]);
    setNewItem("");
  };
  const remove = (i: number) => setDraft(d => d.filter((_, idx) => idx !== i));
  const save = () => { onSave?.(draft); setEditing(false); };

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {draft.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">
              {item}
              <button onClick={() => remove(i)} className="hover:text-foreground"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder={`Add ${label.toLowerCase()}…`}
            className="h-7 text-xs"
            data-testid={`input-new-tag-${label}`}
          />
          <Button size="sm" variant="outline" onClick={addItem} className="h-7 text-xs px-2">Add</Button>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={save} className="h-7 text-xs" data-testid={`button-save-tags-${label}`}><Check className="w-3 h-3 mr-1" />Save</Button>
          <Button size="sm" variant="ghost" onClick={cancel} className="h-7 text-xs" data-testid={`button-cancel-tags-${label}`}><X className="w-3 h-3 mr-1" />Cancel</Button>
        </div>
      </div>
    );
  }

  const shown = items.slice(0, maxDisplay);
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {shown.map((item, i) => (
        <Badge key={i} variant="secondary" className="text-xs font-normal">{item}</Badge>
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest} more</span>}
      {onSave && (
        <button onClick={startEdit} className="ml-1 text-muted-foreground hover:text-foreground" data-testid={`button-edit-${label}`}>
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible intelligence section card
// ---------------------------------------------------------------------------

function IntelSection({
  title, icon: Icon, children, defaultOpen = false,
}: { title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left"
        data-testid={`toggle-section-${title}`}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
        </CardHeader>
      </button>
      {open && <CardContent className="pt-0 space-y-3">{children}</CardContent>}
    </Card>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BrandIntelligencePage() {
  const { toast } = useToast();
  const [setupUrl, setSetupUrl] = useState("");
  const [setupName, setSetupName] = useState("");

  const { data, isLoading, refetch } = useQuery<{ profile: ProfileRow | null }>({
    queryKey: ["/api/intelligence"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load intelligence profile");
      return res.json();
    },
    refetchInterval: (query) => {
      const p = query.state.data?.profile;
      return p?.status === "running" ? 3000 : false;
    },
  });

  const profile = data?.profile;
  const merged = profile?.mergedProfile;

  const runMutation = useMutation({
    mutationFn: async ({ websiteUrl, companyName }: { websiteUrl: string; companyName: string }) => {
      const res = await fetch("/api/intelligence/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl, companyName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start research");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Research started", description: "Brand intelligence analysis is running — usually takes 2–4 minutes." });
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: async (overrides: Record<string, unknown>) => {
      const res = await fetch("/api/intelligence", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "overrides", overrides }),
      });
      if (!res.ok) throw new Error("Failed to save override");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Changes saved successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleRun = (url: string, name: string) => {
    if (!url || !name) return;
    runMutation.mutate({ websiteUrl: url, companyName: name });
  };

  const saveOverride = (path: string[], value: unknown) => {
    const obj: any = {};
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) { cur[path[i]!] = {}; cur = cur[path[i]!]; }
    cur[path[path.length - 1]!] = value;
    overrideMutation.mutate(obj);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── No profile yet: Setup form ────────────────────────────────────────────
  if (!profile) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Brand Intelligence
          </h1>
          <p className="text-muted-foreground text-sm">
            Deep-research your brand once and inject the intelligence into every piece of content — automatically.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Set up your brand profile</CardTitle>
            <CardDescription>
              Enter your website and company name. The research pipeline analyzes your site, discovers competitors,
              identifies content gaps, and builds a brand policy pack — all in the background.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="setup-url">Website URL</Label>
              <Input
                id="setup-url"
                value={setupUrl}
                onChange={e => setSetupUrl(e.target.value)}
                placeholder="https://yourbusiness.com"
                data-testid="input-website-url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="setup-name">Company Name</Label>
              <Input
                id="setup-name"
                value={setupName}
                onChange={e => setSetupName(e.target.value)}
                placeholder="Acme Roofing"
                data-testid="input-company-name"
              />
            </div>
            <Button
              className="w-full"
              onClick={() => handleRun(setupUrl, setupName)}
              disabled={!setupUrl || !setupName || runMutation.isPending}
              data-testid="button-run-intelligence"
            >
              {runMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
                : <><Sparkles className="w-4 h-4 mr-2" />Run Brand Intelligence</>
              }
            </Button>
            <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">What this unlocks:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Brand voice + tone injected into every article, social post, and video</li>
                <li>Approved / prohibited claims enforced by AI on every generation</li>
                <li>Competitor gaps automatically used to angle your content</li>
                <li>Real customer pain points surfaced — not just what's on your website</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Running state ─────────────────────────────────────────────────────────
  if (profile.status === "running") {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Brand Intelligence
        </h1>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Researching {profile.companyName}…
            </CardTitle>
            <CardDescription>This takes 2–4 minutes. You can leave this page — results persist.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressTracker step={profile.progressStep} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Failed state ──────────────────────────────────────────────────────────
  if (profile.status === "failed") {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Brand Intelligence
        </h1>
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              Research failed
            </CardTitle>
            {profile.errorMessage && (
              <CardDescription className="text-destructive/80">{profile.errorMessage}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleRun(profile.websiteUrl, profile.companyName)}
              disabled={runMutation.isPending}
              data-testid="button-retry-intelligence"
            >
              {runMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Retry Research
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Complete state ─────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Brand Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            {profile.companyName} · {profile.websiteUrl}
            {profile.lastRunAt && (
              <span className="ml-2 text-xs">
                · Last updated {new Date(profile.lastRunAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-green-600 border-green-600/40 bg-green-50 dark:bg-green-950/20" data-testid="status-badge">
            <CheckCircle2 className="w-3 h-3 mr-1" />Active
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleRun(profile.websiteUrl, profile.companyName)}
            disabled={runMutation.isPending}
            data-testid="button-refresh-intelligence"
          >
            {runMutation.isPending
              ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            }
            Refresh Research
          </Button>
        </div>
      </div>

      {/* Impact callout */}
      <div className="bg-primary/5 border border-primary/10 rounded-md px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Intelligence is active.</span>{" "}
        Brand voice, policy pack, and competitive gaps are injected into every article, social post, and video you generate.
      </div>

      {merged && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* 1 — Brand Voice & Tone */}
          <IntelSection title="Brand Voice & Tone" icon={MessageSquare} defaultOpen>
            <FieldRow label="Tone">
              <TagList
                items={merged.brandVoice.toneAdjectives}
                label="Tone"
                onSave={v => saveOverride(["brandVoice", "toneAdjectives"], v)}
              />
            </FieldRow>
            <FieldRow label="Values">
              <TagList
                items={merged.brandVoice.brandValues}
                label="Values"
                onSave={v => saveOverride(["brandVoice", "brandValues"], v)}
              />
            </FieldRow>
            <FieldRow label="Personality">
              <TagList
                items={merged.brandVoice.personalityTraits}
                label="Personality"
                onSave={v => saveOverride(["brandVoice", "personalityTraits"], v)}
              />
            </FieldRow>
            {merged.brandVoice.voiceExamples.length > 0 && (
              <FieldRow label="Voice Examples">
                <ul className="text-sm space-y-1">
                  {merged.brandVoice.voiceExamples.map((e, i) => (
                    <li key={i} className="italic text-muted-foreground border-l-2 border-muted pl-2">"{e}"</li>
                  ))}
                </ul>
              </FieldRow>
            )}
            <FieldRow label="Avoided Phrases">
              <TagList
                items={merged.brandVoice.avoidedPhrases}
                label="Avoided Phrases"
                onSave={v => saveOverride(["brandVoice", "avoidedPhrases"], v)}
              />
            </FieldRow>
          </IntelSection>

          {/* 2 — Positioning & UVP */}
          <IntelSection title="Positioning & UVP" icon={Target} defaultOpen>
            <FieldRow label="Unique Value Proposition">
              <p className="text-sm leading-relaxed">{merged.positioning.uniqueValueProposition}</p>
            </FieldRow>
            <FieldRow label="Pricing Tier">
              <Badge variant="outline" className="capitalize">{merged.positioning.pricingTier}</Badge>
            </FieldRow>
            <FieldRow label="Core Services">
              <div className="space-y-1">
                {merged.positioning.coreServices.slice(0, 5).map((s, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{s.name}</span>
                    {s.differentiator && <span className="text-muted-foreground"> — {s.differentiator}</span>}
                  </div>
                ))}
              </div>
            </FieldRow>
            <FieldRow label="Trust Signals">
              <TagList
                items={merged.positioning.trustSignals}
                label="Trust Signals"
                onSave={v => saveOverride(["positioning", "trustSignals"], v)}
              />
            </FieldRow>
          </IntelSection>

          {/* 3 — Target Audience */}
          <IntelSection title="Target Audience" icon={Users}>
            <FieldRow label="Primary Persona">
              <p className="text-sm leading-relaxed">{merged.targetAudience.primaryPersona}</p>
            </FieldRow>
            <FieldRow label="Real Pain Points (unstated)">
              <TagList
                items={merged.targetAudience.actualPainPoints}
                label="Pain Points"
                onSave={v => saveOverride(["targetAudience", "actualPainPoints"], v)}
              />
            </FieldRow>
            <FieldRow label="Decision Drivers">
              <TagList
                items={merged.targetAudience.decisionDrivers}
                label="Decision Drivers"
                onSave={v => saveOverride(["targetAudience", "decisionDrivers"], v)}
              />
            </FieldRow>
            <FieldRow label="Demographics">
              <TagList items={merged.targetAudience.demographics} label="Demographics" />
            </FieldRow>
          </IntelSection>

          {/* 4 — Competitor Landscape */}
          <IntelSection title="Competitor Landscape" icon={TrendingUp}>
            {merged.competitorLandscape.length === 0 && (
              <p className="text-sm text-muted-foreground">No competitors identified yet.</p>
            )}
            {merged.competitorLandscape.map((c, i) => (
              <div key={i} className="text-sm space-y-0.5 border-b pb-2 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline truncate max-w-[160px]">
                      {c.url.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
                <p className="text-muted-foreground">{c.positioningStatement}</p>
                <div className="flex gap-1 flex-wrap">
                  {c.strengths.map((s, j) => <Badge key={j} variant="secondary" className="text-xs font-normal">{s}</Badge>)}
                </div>
              </div>
            ))}
          </IntelSection>

          {/* 5 — Competitive Gaps */}
          <IntelSection title="Competitive Gaps" icon={Lightbulb}>
            <FieldRow label="Your Undersold Advantages">
              <TagList
                items={merged.competitiveGaps.clientAdvantages}
                label="Advantages"
                onSave={v => saveOverride(["competitiveGaps", "clientAdvantages"], v)}
              />
            </FieldRow>
            <FieldRow label="Opportunity Topics">
              <TagList
                items={merged.competitiveGaps.opportunityTopics}
                label="Opportunities"
                onSave={v => saveOverride(["competitiveGaps", "opportunityTopics"], v)}
              />
            </FieldRow>
            <FieldRow label="Your Weaknesses">
              <TagList items={merged.competitiveGaps.clientWeaknesses} label="Weaknesses" />
            </FieldRow>
          </IntelSection>

          {/* 6 — Content Opportunities */}
          <IntelSection title="Content Opportunities" icon={BookOpen}>
            <FieldRow label="Uncovered Topics">
              <TagList
                items={merged.contentOpportunities.uncoveredTopics}
                label="Topics"
                onSave={v => saveOverride(["contentOpportunities", "uncoveredTopics"], v)}
              />
            </FieldRow>
            <FieldRow label="High-Value Keywords">
              <TagList
                items={merged.contentOpportunities.highValueKeywords}
                label="Keywords"
                onSave={v => saveOverride(["contentOpportunities", "highValueKeywords"], v)}
              />
            </FieldRow>
            <FieldRow label="Unanswered Questions">
              <div className="space-y-1">
                {merged.contentOpportunities.unansweredQuestions.map((q, i) => (
                  <p key={i} className="text-xs text-muted-foreground border-l-2 border-muted pl-2">{q}</p>
                ))}
              </div>
            </FieldRow>
          </IntelSection>

          {/* 7 — Brand Policy Pack */}
          <IntelSection title="Brand Policy Pack" icon={ShieldCheck}>
            <FieldRow label="Approved Claims">
              <TagList
                items={merged.brandPolicyPack.approvedClaims}
                label="Approved Claims"
                onSave={v => saveOverride(["brandPolicyPack", "approvedClaims"], v)}
              />
            </FieldRow>
            <FieldRow label="Prohibited Claims">
              <TagList
                items={merged.brandPolicyPack.prohibitedClaims}
                label="Prohibited Claims"
                onSave={v => saveOverride(["brandPolicyPack", "prohibitedClaims"], v)}
              />
            </FieldRow>
            <FieldRow label="Prohibited Phrases">
              <TagList
                items={merged.brandPolicyPack.prohibitedPhrases}
                label="Prohibited Phrases"
                onSave={v => saveOverride(["brandPolicyPack", "prohibitedPhrases"], v)}
              />
            </FieldRow>
            <FieldRow label="On-Brand Vocabulary">
              <TagList
                items={merged.brandPolicyPack.toneLexicon.approved}
                label="On-Brand"
                onSave={v => saveOverride(["brandPolicyPack", "toneLexicon", "approved"], v)}
              />
            </FieldRow>
            <FieldRow label="Off-Brand Vocabulary">
              <TagList
                items={merged.brandPolicyPack.toneLexicon.offBrand}
                label="Off-Brand"
                onSave={v => saveOverride(["brandPolicyPack", "toneLexicon", "offBrand"], v)}
              />
            </FieldRow>
          </IntelSection>

          {/* 8 — Local & Niche Intelligence */}
          <IntelSection title="Local & Niche Intelligence" icon={MapPin}>
            <FieldRow label="Service Area">
              <TagList
                items={merged.localNicheIntelligence.locationSignals}
                label="Locations"
                onSave={v => saveOverride(["localNicheIntelligence", "locationSignals"], v)}
              />
            </FieldRow>
            <FieldRow label="Local Authorities & Bodies">
              <TagList
                items={merged.localNicheIntelligence.localAuthorities}
                label="Authorities"
                onSave={v => saveOverride(["localNicheIntelligence", "localAuthorities"], v)}
              />
            </FieldRow>
            <FieldRow label="Regulatory Context">
              <TagList
                items={merged.localNicheIntelligence.regulatoryContext}
                label="Regulations"
                onSave={v => saveOverride(["localNicheIntelligence", "regulatoryContext"], v)}
              />
            </FieldRow>
            <FieldRow label="Location Pain Points">
              <TagList
                items={merged.localNicheIntelligence.locationPainPoints}
                label="Location Pain Points"
                onSave={v => saveOverride(["localNicheIntelligence", "locationPainPoints"], v)}
              />
            </FieldRow>
          </IntelSection>

          {/* Failure Analysis — full width */}
          <div className="md:col-span-2">
            <IntelSection title="Failure Analysis" icon={AlertTriangle}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label="Likely Loss Reasons">
                  <TagList
                    items={merged.failureAnalysis.likelyLossReasons}
                    label="Loss Reasons"
                    onSave={v => saveOverride(["failureAnalysis", "likelyLossReasons"], v)}
                  />
                </FieldRow>
                <FieldRow label="Messaging Problems">
                  <TagList
                    items={merged.failureAnalysis.messagingProblems}
                    label="Messaging"
                    onSave={v => saveOverride(["failureAnalysis", "messagingProblems"], v)}
                  />
                </FieldRow>
                <FieldRow label="Trust Signal Gaps">
                  <TagList items={merged.failureAnalysis.trustSignalGaps} label="Trust Gaps" />
                </FieldRow>
                <FieldRow label="Content Depth Gaps">
                  <TagList items={merged.failureAnalysis.contentDepthGaps} label="Depth Gaps" />
                </FieldRow>
              </div>
            </IntelSection>
          </div>

        </div>
      )}

      {/* Market Intelligence section */}
      <div className="md:col-span-2">
        <MarketIntelligenceSection />
      </div>

      {/* Seed Exemplars section */}
      {merged && (
        <div className="md:col-span-2">
          <IntelSection title="Seed Exemplars" icon={Sparkles}>
            <p className="text-xs text-muted-foreground mb-3">
              Paste examples of your best-performing or most on-brand content. The AI learns from these when generating new content.
            </p>
            <AddExemplarForm onSave={async (ex) => {
              const res = await fetch("/api/intelligence", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "add_exemplar", exemplar: ex }),
              });
              if (res.ok) {
                toast({ title: "Exemplar saved" });
                queryClient.invalidateQueries({ queryKey: ["/api/intelligence"] });
              }
            }} />
            {merged.seedExemplars.length > 0 && (
              <div className="space-y-2 mt-3">
                {merged.seedExemplars.map((e, i) => (
                  <div key={i} className="text-xs border rounded-md p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{e.contentType}</Badge>
                      {e.humanApproved && <Badge variant="secondary" className="text-xs">Approved</Badge>}
                      {e.source && <span className="text-muted-foreground">{e.source}</span>}
                    </div>
                    <p className="text-muted-foreground line-clamp-3">{e.text}</p>
                  </div>
                ))}
              </div>
            )}
          </IntelSection>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market Intelligence Section (Task #25)
// ---------------------------------------------------------------------------

interface CIResearchResult {
  success: boolean;
  topPerformersFound: number;
  searchesPerformed: number;
  patternsExtracted: number;
  patternsSeeded: number;
  patternsSkipped: number;
  gaps: Array<{ dimension: string; opportunity: string; urgency: string }>;
  intelContext: {
    externalHookPatterns: string[];
    gapAngles: string[];
    platformSignals: string[];
    trustNote: string;
  };
}

interface ExternalPattern {
  id: number;
  patternType: string;
  patternName: string;
  patternValue: string;
  successRate: number;
  confidence: number;
  externalUrl?: string | null;
  externalPlatform?: string | null;
  validatedByOwnAudience: boolean;
  createdAt: string;
}

function MarketIntelligenceSection() {
  const { toast } = useToast();
  const [topic, setTopic] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [contentType, setContentType] = useState<"social" | "video" | "podcast">("social");
  const [lastResult, setLastResult] = useState<CIResearchResult | null>(null);

  const researchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/intelligence/competitive-research", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, industry, location: location || undefined, contentType }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Research failed");
      }
      return res.json() as Promise<CIResearchResult>;
    },
    onSuccess: (data) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/competitive-patterns"] });
      toast({ title: "Market research complete", description: `${data.patternsSeeded} new patterns seeded, ${data.gaps.length} gaps found.` });
    },
    onError: (err: Error) => {
      toast({ title: "Research failed", description: err.message, variant: "destructive" });
    },
  });

  const patternsQuery = useQuery<{ patterns: ExternalPattern[] }>({
    queryKey: ["/api/intelligence/competitive-patterns", contentType],
    queryFn: async () => {
      const res = await fetch(`/api/intelligence/competitive-patterns?contentType=${contentType}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch patterns");
      return res.json();
    },
  });

  const patterns = patternsQuery.data?.patterns ?? [];
  const validatedPatterns = patterns.filter(p => p.validatedByOwnAudience);
  const pendingPatterns = patterns.filter(p => !p.validatedByOwnAudience);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">Market Intelligence</CardTitle>
            <Badge variant="secondary" className="text-xs">Beta</Badge>
          </div>
          <div className="flex items-center gap-2">
            {patterns.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {patterns.length} external patterns · {validatedPatterns.length} validated
              </span>
            )}
          </div>
        </div>
        <CardDescription className="text-xs mt-1">
          Research top-performing competitor content to discover market patterns and content gaps. Patterns are seeded into the learning system at a low score and graduate as your audience validates them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Research form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Topic / Niche</Label>
            <Input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="e.g. roofing services"
              className="h-8 text-sm"
              data-testid="input-ci-topic"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Industry</Label>
            <Input
              value={industry}
              onChange={e => setIndustry(e.target.value)}
              placeholder="e.g. home improvement"
              className="h-8 text-sm"
              data-testid="input-ci-industry"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Location (optional)</Label>
            <Input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Austin, TX"
              className="h-8 text-sm"
              data-testid="input-ci-location"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Content Type</Label>
            <Select value={contentType} onValueChange={v => setContentType(v as "social" | "video" | "podcast")}>
              <SelectTrigger className="h-8 text-sm" data-testid="select-ci-content-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="social">Social</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="podcast">Podcast</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => researchMutation.mutate()}
          disabled={researchMutation.isPending || !topic.trim() || !industry.trim()}
          data-testid="button-run-ci-research"
        >
          {researchMutation.isPending
            ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Researching…</>
            : <><Search className="w-3.5 h-3.5 mr-1.5" />Run Market Research</>
          }
        </Button>

        {/* Research results */}
        {lastResult && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Top performers", value: lastResult.topPerformersFound },
                { label: "Patterns extracted", value: lastResult.patternsExtracted },
                { label: "Patterns seeded", value: lastResult.patternsSeeded },
                { label: "Gaps found", value: lastResult.gaps.length },
              ].map(stat => (
                <div key={stat.label} className="bg-muted/40 rounded-md px-3 py-2 text-center">
                  <p className="text-lg font-semibold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Gap analysis */}
            {lastResult.gaps.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-primary" />
                  Gap Analysis
                </p>
                <div className="space-y-1.5">
                  {lastResult.gaps.map((gap, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs border rounded-md px-3 py-2">
                      <Badge
                        variant={gap.urgency === "high" ? "destructive" : gap.urgency === "medium" ? "outline" : "secondary"}
                        className="text-xs shrink-0 mt-0.5"
                      >
                        {gap.urgency}
                      </Badge>
                      <div>
                        <span className="font-medium text-foreground">{gap.dimension}:</span>{" "}
                        <span className="text-muted-foreground">{gap.opportunity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hook pattern previews */}
            {lastResult.intelContext.externalHookPatterns.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-primary" />
                  Top Hook Patterns (injected into next generation)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {lastResult.intelContext.externalHookPatterns.slice(0, 5).map((h, i) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">{h}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Existing external patterns */}
        {patterns.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                Seeded External Patterns — {contentType}
              </p>
              <div className="flex gap-1.5">
                {validatedPatterns.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    <CheckCircle2 className="w-3 h-3 mr-1 text-green-500" />
                    {validatedPatterns.length} validated
                  </Badge>
                )}
                {pendingPatterns.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    {pendingPatterns.length} pending
                  </Badge>
                )}
              </div>
            </div>
            {patternsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3 h-3 animate-spin" />Loading patterns…
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {patterns.slice(0, 15).map(p => (
                  <div key={p.id} className="flex items-start gap-2 text-xs border rounded-md px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-foreground truncate">{p.patternName}</span>
                        <Badge variant="outline" className="text-xs">{p.patternType}</Badge>
                        {p.externalPlatform && (
                          <Badge variant="secondary" className="text-xs">{p.externalPlatform}</Badge>
                        )}
                        {p.validatedByOwnAudience && (
                          <Badge variant="secondary" className="text-xs">
                            <CheckCircle2 className="w-3 h-3 mr-0.5 text-green-500" />Validated
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2">{p.patternValue}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-muted-foreground">{p.successRate.toFixed(0)}</span>
                      {p.externalUrl && (
                        <a href={p.externalUrl} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-muted-foreground hover:text-foreground inline-block">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" />
              External patterns compete in exploration only. They graduate to the exploitation pool once your audience validates them through engagement.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddExemplarForm({ onSave }: { onSave: (ex: { contentType: "article" | "social" | "email" | "ad"; text: string; source: string; humanApproved: boolean }) => void }) {
  const [type, setType] = useState<"article" | "social" | "email" | "ad">("article");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!text.trim()) return;
    setSaving(true);
    await onSave({ contentType: type, text: text.trim(), source: source.trim() || "manual", humanApproved: true });
    setText("");
    setSource("");
    setSaving(false);
  };

  return (
    <div className="space-y-2 border rounded-md p-3">
      <div className="flex gap-2 flex-wrap">
        {(["article", "social", "email", "ad"] as const).map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${type === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover-elevate"}`}
            data-testid={`exemplar-type-${t}`}
          >
            {t}
          </button>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste an example of your best content here…"
        className="text-sm min-h-[80px]"
        data-testid="input-exemplar-text"
      />
      <div className="flex gap-2 items-center">
        <Input
          value={source}
          onChange={e => setSource(e.target.value)}
          placeholder="Source (e.g. 'top article', 'highest engagement post')"
          className="h-7 text-xs flex-1"
          data-testid="input-exemplar-source"
        />
        <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving || !text.trim()} data-testid="button-add-exemplar">
          {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
          Add
        </Button>
      </div>
    </div>
  );
}
