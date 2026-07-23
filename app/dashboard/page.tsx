"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Sparkles, CheckCircle2, Clock, Network, ChevronDown, ChevronUp,
  Calendar, Send, UploadCloud, X, RefreshCw, ArrowRight, FileText,
  BadgeCheck,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { GenerationProgress } from "./components/GenerationProgress";
import { Badge } from "@/components/ui/badge";
import { AdvancedOptions } from "./components/AdvancedOptions";
import Link from "next/link";
import { BrandConfirmationModal } from "@/components/BrandConfirmationModal";
import { NotificationBell } from "@/components/NotificationBell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TitlePoolData {
  titles: string[];
  primaryKeywords: string[];
  contentStrategy: string;
}

interface Batch {
  id: number;
  status: string;
  coreTopic: string;
  targetUrl: string;
  numArticlesRequested: number;
  titlePool: TitlePoolData | null;
  createdAt: string;
}

const TONE_OPTIONS = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "conversational", label: "Conversational" },
  { value: "technical", label: "Technical" },
  { value: "persuasive", label: "Persuasive" },
  { value: "educational", label: "Educational" },
  { value: "entertaining", label: "Entertaining" },
  { value: "authoritative", label: "Authoritative" },
];

const WIZARD_STEPS = [
  { id: 1, label: "Campaign Setup", desc: "Topic & location" },
  { id: 2, label: "Select Titles", desc: "Choose articles to write" },
  { id: 3, label: "Configure", desc: "Settings & cost review" },
  { id: 4, label: "Generating", desc: "AI writing your articles" },
];

const GENERATING_STATUSES = ["QUEUED", "IN_PROGRESS", "RUNNING", "PROCESSING", "SUBMITTING"];
const TERMINAL_STATUSES = ["COMPLETE", "PARTIAL_COMPLETE", "FAILED", "CANCELLED"];

// ─── Step Indicator Bar ───────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center w-full">
      {WIZARD_STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center flex-1 last:flex-none">
          <div className="flex items-center gap-2 shrink-0">
            <div className={cn(
              "flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold border-2 transition-colors",
              current === step.id
                ? "border-primary bg-primary text-primary-foreground"
                : current > step.id
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-muted-foreground/25 bg-background text-muted-foreground"
            )}>
              {current > step.id ? <CheckCircle2 className="w-4 h-4" /> : step.id}
            </div>
            <div className="hidden sm:block">
              <p className={cn(
                "text-sm font-medium leading-none",
                current === step.id ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
            </div>
          </div>
          {i < WIZARD_STEPS.length - 1 && (
            <div className={cn(
              "flex-1 h-0.5 mx-3 transition-colors",
              current > step.id ? "bg-primary/50" : "bg-muted"
            )} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Logo Dropzone ────────────────────────────────────────────────────────────

function LogoDropzone({
  url,
  busy,
  onFile,
  onClear,
  onError,
}: {
  url: string;
  busy: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  onError?: (msg: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"];

  const validate = useCallback((file: File) => {
    if (!ACCEPTED_MIME.includes(file.type)) return "Only PNG, JPG, or WebP files are accepted.";
    if (file.size > 5 * 1024 * 1024) return "File must be under 5 MB.";
    return null;
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const err = validate(file);
    if (err) { onError?.(err); return; }
    onFile(file);
  }, [onFile, onError, validate]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validate(file);
    if (err) { onError?.(err); return; }
    onFile(file);
    e.target.value = "";
  }, [onFile, onError, validate]);

  return (
    <div
      onClick={() => !url && !busy && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "rounded-lg border-2 border-dashed transition-colors",
        url ? "border-transparent p-3" : "p-8 text-center cursor-pointer",
        dragging ? "border-primary bg-primary/5" : !url && "border-muted-foreground/25 hover:border-primary/40"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={handleChange}
        disabled={busy}
        data-testid="input-company-logo"
      />

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
        </div>
      )}

      {!busy && url && (
        <div className="flex items-center gap-3">
          <img src={url} alt="Company logo" className="h-12 w-12 object-contain rounded border bg-white p-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-1">
              <BadgeCheck className="w-4 h-4 shrink-0" /> Logo uploaded
            </p>
            <p className="text-xs text-muted-foreground">AI will use this in branded image generation</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            >
              Replace
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {!busy && !url && (
        <>
          <UploadCloud className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
          <p className="text-sm font-medium">Drop your logo here, or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WebP · max 5 MB</p>
        </>
      )}
    </div>
  );
}

// ─── Credit Preview Banner ────────────────────────────────────────────────────

function CreditPreviewBanner({ units, onCanAffordChange }: {
  units: number;
  onCanAffordChange?: (canAfford: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["credit-preview", "article", units],
    queryFn: () => apiRequest(`/api/credits/preview?product=article&units=${units}`),
    enabled: units > 0,
  });

  useEffect(() => {
    if (data?.canAfford !== undefined) onCanAffordChange?.(data.canAfford);
  }, [data?.canAfford]);

  if (isLoading || !data) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Calculating cost…</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border p-4 space-y-2",
      data.canAfford
        ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
        : "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Generation cost</span>
        <span className="font-semibold">{data.creditCost.toLocaleString()} credits</span>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Your balance</span>
        <span className={data.canAfford ? "text-green-700 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"}>
          {data.currentBalance.toLocaleString()} credits
        </span>
      </div>
      <div className="border-t pt-2 mt-2">
        {data.canAfford ? (
          <p className="text-xs text-muted-foreground">
            {data.creditCostPerUnit} credit{data.creditCostPerUnit !== 1 ? "s" : ""} × {units} article{units !== 1 ? "s" : ""}
          </p>
        ) : (
          <p className="text-xs text-red-600 dark:text-red-400">
            You need {data.deficit.toLocaleString()} more credits.{" "}
            <Link href="/client/billing" className="underline font-medium">Purchase credits →</Link>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { toast } = useToast();

  // Wizard step
  const [step, setStep] = useState(1);

  // Step 1 — Campaign
  const [coreTopic, setCoreTopic] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [numTitles, setNumTitles] = useState(25);
  const [tone, setTone] = useState("professional");
  const [geographicFocus, setGeographicFocus] = useState("");
  const [audience, setAudience] = useState("");

  // Step 1 — Business profile
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");

  // Step 1 — Advanced / optional
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [competitorUrls, setCompetitorUrls] = useState<string[]>([]);
  const [serpFeatureTarget, setSerpFeatureTarget] = useState("none");
  const [semanticClusterId, setSemanticClusterId] = useState<number | undefined>();

  // Step 1 — Pillar strategy planner
  const [showPillarStrategy, setShowPillarStrategy] = useState(false);
  const [pillarTopic, setPillarTopic] = useState("");
  const [pillarIndustry, setPillarIndustry] = useState("");
  const [pillarAudience, setPillarAudience] = useState("");
  const [pillarPages, setPillarPages] = useState("8");
  const [pillarStrategy, setPillarStrategy] = useState<any>(null);

  // Step 2 — Titles
  const [currentBatch, setCurrentBatch] = useState<Batch | null>(null);
  const [selectedTitles, setSelectedTitles] = useState<Set<string>>(new Set());

  // Step 3 — Config
  const [wordCountMin, setWordCountMin] = useState(800);
  const [wordCountMax, setWordCountMax] = useState(2000);
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [creditCanAfford, setCreditCanAfford] = useState(true);

  // Step 4 — Progress
  const [generatingBatchId, setGeneratingBatchId] = useState<number | null>(null);
  const [generationComplete, setGenerationComplete] = useState(false);

  // Modals
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [confirmedBrandName, setConfirmedBrandName] = useState("");
  const [showIntelGateDialog, setShowIntelGateDialog] = useState(false);

  // ── Brand profile autofill ──────────────────────────────────────────────────
  const { data: brandProfileData } = useQuery({
    queryKey: ["intelligence"],
    queryFn: () => apiRequest("/api/intelligence"),
  });

  useEffect(() => {
    const profile = (brandProfileData as any)?.profile;
    if (!profile) return;
    if (profile.companyName && !businessName) setBusinessName(profile.companyName);
    if (profile.websiteUrl && !targetUrl) setTargetUrl(profile.websiteUrl);
  }, [brandProfileData]);

  // ── Batch resume on mount ───────────────────────────────────────────────────
  const { data: recentBatches } = useQuery({
    queryKey: ["batches"],
    queryFn: () => apiRequest("/api/batches"),
  });

  const resumeAttempted = useRef(false);
  const abandonedBatchId = useRef<number | null>(null);

  useEffect(() => {
    if (resumeAttempted.current || !recentBatches?.length || step !== 1 || currentBatch) return;
    resumeAttempted.current = true;

    const latest = (recentBatches as any[])[0];
    if (!latest || TERMINAL_STATUSES.includes(latest.status)) return;
    // Don't resume a batch the user explicitly abandoned this session
    if (latest.id === abandonedBatchId.current) return;

    if (GENERATING_STATUSES.includes(latest.status)) {
      setGeneratingBatchId(latest.id);
      setStep(4);
      return;
    }

    // Check if title pool is ready — also hydrate NAP fields saved on the batch
    apiRequest(`/api/jobs/status/${latest.id}`).then((s: any) => {
      if (s?.titlePool?.titles?.length) {
        setCurrentBatch(s);
        setCoreTopic(latest.coreTopic ?? "");
        if (s.targetUrl) setTargetUrl(s.targetUrl);
        if (s.businessName) setBusinessName(s.businessName);
        const gp = s.generationParams as any;
        if (gp?.geographicFocus) setGeographicFocus(gp.geographicFocus);
        if (gp?.tone) setTone(gp.tone);
        if (gp?.audience) setAudience(gp.audience);
        setStep(2);
        toast({ title: "Session resumed", description: "Your previous title pool is ready to select from." });
      }
    }).catch(() => {});
  }, [recentBatches]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const generateTitlesMutation = useMutation({
    mutationFn: async (data: {
      coreTopic: string;
      targetUrl: string;
      numTitles: number;
      tone: string;
      competitorUrls?: string[];
      serpFeatureTarget?: string;
      semanticClusterId?: number;
      geographicFocus?: string;
      audience?: string;
      businessName?: string;
    }) => apiRequest("/api/jobs/title-pool", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: async (data) => {
      try {
        const statusData = await apiRequest(`/api/jobs/status/${data.batchId}`);
        setCurrentBatch(statusData);
      } catch {
        // Status fetch failed but title pool was created — synthesise a minimal batch object
        setCurrentBatch({
          id: data.batchId,
          status: "PENDING",
          coreTopic,
          targetUrl,
          numArticlesRequested: data.titles?.length ?? 0,
          titlePool: { titles: data.titles ?? [], primaryKeywords: [], contentStrategy: "", isMultiCity: false },
          createdAt: new Date().toISOString(),
        } as any);
      }
      toast({ title: "Titles generated!", description: `${data.titles?.length ?? 0} titles ready to select.` });
      setStep(2);
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message || "Failed to generate titles.", variant: "destructive" });
    },
  });

  const regenerateTitlesMutation = useMutation({
    mutationFn: (batchId: number) =>
      apiRequest(`/api/batches/${batchId}/regenerate-titles`, { method: "POST" }),
    onSuccess: async (data) => {
      const statusData = await apiRequest(`/api/jobs/status/${data.batch.id}`);
      setCurrentBatch(statusData);
      setSelectedTitles(new Set());
      toast({ title: "Titles regenerated!", description: `${data.titles.length} fresh titles ready.` });
    },
    onError: (err: Error) => {
      toast({ title: "Regeneration failed", description: err.message, variant: "destructive" });
    },
  });

  const submitBatchMutation = useMutation({
    mutationFn: async (opts: {
      batchId: number;
      selectedTitles: string[];
      targetUrl: string;
      wordCountMin: number;
      wordCountMax: number;
      tone: string;
      competitorUrls?: string[];
      serpFeatureTarget?: string;
      semanticClusterId?: number;
      geographicFocus?: string;
      audience?: string;
      businessName?: string;
      businessAddress?: string;
      businessPhone?: string;
      companyLogoUrl?: string;
      skipIntelGate?: boolean;
    }) => {
      const { skipIntelGate, ...body } = opts;
      return apiRequest("/api/jobs/batch-submit", {
        method: "POST",
        headers: skipIntelGate ? { "X-Skip-Intelligence-Gate": "1" } : {},
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: any) => {
      const bid = data.batchId || currentBatch?.id || null;
      setGeneratingBatchId(bid);
      setGenerationComplete(false);
      setStep(4);
      toast({ title: "Batch submitted!", description: `${selectedTitles.size} articles queued.` });
    },
    onError: (err: Error) => {
      const e = err as any;
      if (e.status === 428 && e.data?.intelligenceGate) {
        setShowIntelGateDialog(true);
        return;
      }
      toast({ title: "Submission failed", description: err.message || "Failed to submit.", variant: "destructive" });
    },
  });

  const pillarStrategyMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/seo/pillar-cluster", {
        method: "POST",
        body: JSON.stringify({
          main_topic: pillarTopic,
          industry: pillarIndustry,
          target_audience: pillarAudience,
          num_cluster_pages: parseInt(pillarPages),
        }),
      }),
    onSuccess: (data) => {
      setPillarStrategy(data);
      toast({ title: "Strategy generated!", description: "Your pillar-cluster plan is ready." });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleLogoFile = async (file: File) => {
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch("/api/upload/logo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (res.status === 401) {
        toast({ title: "Session expired", description: "Please log in again to upload your logo.", variant: "destructive" });
        return;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Upload failed");
      setCompanyLogoUrl(d.url);
      toast({ title: "Logo uploaded", description: "Your logo will appear in AI-generated branded images." });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Failed to upload logo.",
        variant: "destructive",
      });
    } finally {
      setUploadingLogo(false);
    }
  };

  const triggerGenerate = useCallback((overrideName?: string) => {
    const name = overrideName ?? businessName;
    generateTitlesMutation.mutate({
      coreTopic: coreTopic.trim(),
      targetUrl: targetUrl.trim(),
      numTitles,
      tone,
      competitorUrls: competitorUrls.length ? competitorUrls : undefined,
      serpFeatureTarget: serpFeatureTarget !== "none" ? serpFeatureTarget : undefined,
      semanticClusterId,
      geographicFocus: geographicFocus.trim() || undefined,
      audience: audience.trim() || undefined,
      businessName: name.trim() || undefined,
    });
  }, [coreTopic, targetUrl, numTitles, tone, competitorUrls, serpFeatureTarget, semanticClusterId, geographicFocus, audience, businessName]);

  const handleGenerateTitles = () => {
    if (!coreTopic.trim()) {
      toast({ title: "Topic required", description: "Enter your content topic.", variant: "destructive" });
      return;
    }
    if (!targetUrl.trim()) {
      toast({ title: "URL required", description: "Enter your target website URL.", variant: "destructive" });
      return;
    }
    if (!geographicFocus.trim()) {
      toast({ title: "Location required", description: "Geographic focus is required for local SEO.", variant: "destructive" });
      return;
    }
    if (!businessName.trim()) {
      toast({ title: "Business name required", description: "Enter your business name to prevent AI hallucinations.", variant: "destructive" });
      return;
    }
    if (confirmedBrandName !== businessName) {
      setShowBrandModal(true);
      return;
    }
    triggerGenerate();
  };

  const handleBrandConfirm = (confirmed: string) => {
    setConfirmedBrandName(confirmed);
    setBusinessName(confirmed);
    setShowBrandModal(false);
    triggerGenerate(confirmed);
  };

  const handleSubmitBatch = (skipIntelGate = false) => {
    if (!currentBatch || selectedTitles.size === 0) return;
    submitBatchMutation.mutate({
      batchId: currentBatch.id,
      selectedTitles: Array.from(selectedTitles),
      targetUrl: currentBatch.targetUrl || targetUrl,
      wordCountMin,
      wordCountMax,
      tone,
      competitorUrls: competitorUrls.length ? competitorUrls : undefined,
      serpFeatureTarget: serpFeatureTarget !== "none" ? serpFeatureTarget : undefined,
      semanticClusterId,
      geographicFocus: geographicFocus.trim() || undefined,
      audience: audience.trim() || undefined,
      businessName: businessName.trim() || undefined,
      businessAddress: businessAddress.trim() || undefined,
      businessPhone: businessPhone.trim() || undefined,
      companyLogoUrl: companyLogoUrl || undefined,
      skipIntelGate,
    });
  };

  const handleStartNew = () => {
    // Mark the current batch as abandoned so the resume effect ignores it
    const currentId = generatingBatchId ?? currentBatch?.id ?? null;
    if (currentId !== null) abandonedBatchId.current = currentId;
    // Reset resumeAttempted so user CAN resume a different (older) batch if present,
    // but abandonedBatchId guard above prevents the current one from re-triggering.
    resumeAttempted.current = false;
    setStep(1);
    setCurrentBatch(null);
    setSelectedTitles(new Set());
    setGeneratingBatchId(null);
    setGenerationComplete(false);
    setCoreTopic("");
    setGeographicFocus("");
    setCompanyLogoUrl("");
    setCompetitorUrls([]);
    setSerpFeatureTarget("none");
    setSemanticClusterId(undefined);
    queryClient.invalidateQueries({ queryKey: ["batches"] });
  };

  const titles = currentBatch?.titlePool?.titles ?? [];
  const selectAll = () => setSelectedTitles(new Set(titles));
  const deselectAll = () => setSelectedTitles(new Set());
  const toggleTitle = (t: string) => {
    const next = new Set(selectedTitles);
    next.has(t) ? next.delete(t) : next.add(t);
    setSelectedTitles(next);
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Content Generator</h1>
            <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-page-description">
              Generate SEO-optimized local content with dual-AI orchestration
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <NotificationBell />
            <Link href="/settings/schedules">
              <Button variant="outline" size="sm" data-testid="button-schedules">
                <Calendar className="w-4 h-4 mr-1.5" /> Schedules
              </Button>
            </Link>
            <Link href="/settings/publishing">
              <Button variant="outline" size="sm" data-testid="button-publishing">
                <Send className="w-4 h-4 mr-1.5" /> Publishing
              </Button>
            </Link>
            <Link href="/content">
              <Button variant="outline" size="sm">
                <FileText className="w-4 h-4 mr-1.5" /> Library
              </Button>
            </Link>
          </div>
        </div>

        {/* Step indicator (hidden on progress step) */}
        {step < 4 && (
          <Card className="p-5">
            <StepBar current={step} />
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 1 — Campaign Setup
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="space-y-5">

            {/* Optional: SEO Strategy Planner */}
            <Card>
              <CardHeader
                className="cursor-pointer"
                onClick={() => setShowPillarStrategy(!showPillarStrategy)}
              >
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Network className="w-4 h-4 text-primary" />
                      SEO Strategy Planner
                      <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Build a pillar-cluster content map first, then use those topics below.
                    </CardDescription>
                  </div>
                  {showPillarStrategy
                    ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                </div>
              </CardHeader>
              {showPillarStrategy && (
                <CardContent className="pt-0 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="pillar-topic">Main Topic *</Label>
                      <Input id="pillar-topic" data-testid="input-pillar-topic" placeholder="e.g., HVAC Repair Services" value={pillarTopic} onChange={(e) => setPillarTopic(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pillar-industry">Industry *</Label>
                      <Input id="pillar-industry" data-testid="input-pillar-industry" placeholder="e.g., Home Services" value={pillarIndustry} onChange={(e) => setPillarIndustry(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pillar-audience">Target Audience</Label>
                      <Input id="pillar-audience" data-testid="input-pillar-audience" placeholder="e.g., Homeowners" value={pillarAudience} onChange={(e) => setPillarAudience(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pillar-pages">Cluster Pages</Label>
                      <Input id="pillar-pages" data-testid="input-pillar-pages" type="number" min={4} max={20} value={pillarPages} onChange={(e) => setPillarPages(e.target.value)} />
                    </div>
                  </div>
                  <Button
                    onClick={() => pillarStrategyMutation.mutate()}
                    disabled={pillarStrategyMutation.isPending || !pillarTopic || !pillarIndustry}
                    data-testid="button-generate-strategy"
                  >
                    {pillarStrategyMutation.isPending
                      ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      : <Sparkles className="w-4 h-4 mr-2" />}
                    Generate Strategy
                  </Button>

                  {pillarStrategy && (
                    <div className="space-y-2 pt-2">
                      <p className="text-sm font-medium text-muted-foreground">Click a page to use it as your topic:</p>
                      {pillarStrategy.pillarPage && (
                        <div
                          className="p-3 rounded-lg border bg-primary/5 cursor-pointer hover-elevate"
                          onClick={() => { setCoreTopic(`${pillarStrategy.pillarPage.title} — ${pillarStrategy.pillarPage.description}`); setShowPillarStrategy(false); }}
                          data-testid="button-use-pillar"
                        >
                          <Badge variant="secondary" className="mb-1 text-xs">Pillar</Badge>
                          <p className="text-sm font-semibold">{pillarStrategy.pillarPage.title}</p>
                          <p className="text-xs text-muted-foreground">{pillarStrategy.pillarPage.description}</p>
                        </div>
                      )}
                      {pillarStrategy.clusterPages?.map((page: any, i: number) => (
                        <div
                          key={i}
                          className="p-3 rounded-lg border cursor-pointer hover-elevate"
                          onClick={() => { setCoreTopic(`${page.title} — ${page.description}`); setShowPillarStrategy(false); }}
                          data-testid={`button-use-cluster-${i}`}
                        >
                          <Badge variant="outline" className="mb-1 text-xs">Cluster {i + 1}</Badge>
                          <p className="text-sm font-medium">{page.title}</p>
                          <p className="text-xs text-muted-foreground">{page.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Campaign Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Campaign Details</CardTitle>
                <CardDescription>The topic and location that will shape every generated title.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="coreTopic">Core Topic *</Label>
                    <Input
                      id="coreTopic"
                      data-testid="input-core-topic"
                      placeholder="e.g., Plumbing Repair Services"
                      value={coreTopic}
                      onChange={(e) => setCoreTopic(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="targetUrl">Target URL *</Label>
                    <Input
                      id="targetUrl"
                      data-testid="input-target-url"
                      type="url"
                      placeholder="https://yourdomain.com/services"
                      value={targetUrl}
                      onChange={(e) => setTargetUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="geo-focus">
                      Geographic Focus *{" "}
                      <span className="text-xs font-normal text-primary">required for local SEO</span>
                    </Label>
                    <Input
                      id="geo-focus"
                      data-testid="input-geo-focus"
                      placeholder="e.g., Austin, Texas"
                      value={geographicFocus}
                      onChange={(e) => setGeographicFocus(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tone">Content Tone</Label>
                    <Select value={tone} onValueChange={setTone}>
                      <SelectTrigger id="tone" data-testid="select-tone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TONE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="numTitles">Titles to Generate (5–100)</Label>
                    <Input
                      id="numTitles"
                      data-testid="input-num-titles"
                      type="number"
                      min={5}
                      max={100}
                      value={numTitles}
                      onChange={(e) => setNumTitles(Math.min(100, Math.max(5, parseInt(e.target.value) || 25)))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="audience">Target Audience</Label>
                    <Input
                      id="audience"
                      data-testid="input-audience"
                      placeholder="e.g., Homeowners, Small business owners"
                      value={audience}
                      onChange={(e) => setAudience(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Business Profile */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Business Profile</CardTitle>
                <CardDescription>
                  Grounds AI content to prevent hallucinations.
                  {brandProfileData && " Auto-filled from your Brand Intelligence profile."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="businessName">Business Name *</Label>
                    <Input
                      id="businessName"
                      data-testid="input-business-name"
                      placeholder="Exact legal business name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">AI uses this exact spelling — double-check it carefully.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="businessAddress">Business Address</Label>
                    <Input
                      id="businessAddress"
                      data-testid="input-business-address"
                      placeholder="123 Main St, Austin, TX 78701"
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="businessPhone">Business Phone</Label>
                    <Input
                      id="businessPhone"
                      data-testid="input-business-phone"
                      placeholder="(555) 123-4567"
                      value={businessPhone}
                      onChange={(e) => setBusinessPhone(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Advanced SEO Options (collapsible) */}
            <div>
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
                onClick={() => setShowAdvanced(!showAdvanced)}
                data-testid="button-toggle-advanced"
              >
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span className="font-medium">Advanced SEO Options</span>
                <span className="text-xs">(competitor URLs, SERP targeting, cluster linking)</span>
              </button>
              {showAdvanced && (
                <AdvancedOptions
                  competitorUrls={competitorUrls}
                  setCompetitorUrls={setCompetitorUrls}
                  serpFeatureTarget={serpFeatureTarget}
                  setSerpFeatureTarget={setSerpFeatureTarget}
                  geographicFocus={geographicFocus}
                  setGeographicFocus={setGeographicFocus}
                  semanticClusterId={semanticClusterId}
                  setSemanticClusterId={setSemanticClusterId}
                />
              )}
            </div>

            {/* CTA */}
            <div className="flex justify-end">
              <Button
                size="lg"
                onClick={handleGenerateTitles}
                disabled={generateTitlesMutation.isPending}
                data-testid="button-generate-titles"
              >
                {generateTitlesMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Titles…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Generate Titles <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 2 — Select Titles
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <CardTitle className="text-base">Choose Titles to Write</CardTitle>
                    <CardDescription className="mt-1">
                      Each selected title becomes a full SEO article with local intelligence.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => currentBatch && regenerateTitlesMutation.mutate(currentBatch.id)}
                    disabled={regenerateTitlesMutation.isPending}
                    data-testid="button-regenerate-titles"
                  >
                    {regenerateTitlesMutation.isPending
                      ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      : <RefreshCw className="w-4 h-4 mr-1.5" />}
                    Regenerate
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Bulk actions */}
                <div className="flex items-center justify-between pb-4 mb-4 border-b gap-2 flex-wrap">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
                      Select All ({titles.length})
                    </Button>
                    <Button variant="ghost" size="sm" onClick={deselectAll} disabled={selectedTitles.size === 0} data-testid="button-deselect-all">
                      Clear
                    </Button>
                  </div>
                  <Badge variant="secondary">{selectedTitles.size} / {titles.length} selected</Badge>
                </div>

                {titles.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Titles still generating…</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {titles.map((title, i) => {
                      const checked = selectedTitles.has(title);
                      return (
                        <div
                          key={i}
                          onClick={() => toggleTitle(title)}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                            checked
                              ? "border-primary/30 bg-primary/5"
                              : "border-transparent bg-muted/30 hover:bg-muted/50"
                          )}
                          data-testid={`title-item-${i}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleTitle(title)}
                            className="mt-0.5 shrink-0"
                          />
                          <span className="text-sm leading-snug">{title}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => { setStep(1); setCurrentBatch(null); setSelectedTitles(new Set()); }}
                data-testid="button-back-to-setup"
              >
                ← Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={selectedTitles.size === 0}
                data-testid="button-go-to-configure"
              >
                Configure & Review Cost <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 3 — Configure & Submit
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div className="space-y-5">

            {/* Summary pill */}
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">{selectedTitles.size} article{selectedTitles.size !== 1 ? "s" : ""} selected</p>
                    <p className="text-xs text-muted-foreground truncate max-w-sm">{coreTopic}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                    Edit selection
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Logo */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Company Logo</CardTitle>
                <CardDescription>AI references this when generating branded images with your company identity.</CardDescription>
              </CardHeader>
              <CardContent>
                <LogoDropzone
                  url={companyLogoUrl}
                  busy={uploadingLogo}
                  onFile={handleLogoFile}
                  onClear={() => setCompanyLogoUrl("")}
                  onError={(msg) => toast({ title: "Invalid file", description: msg, variant: "destructive" })}
                />
              </CardContent>
            </Card>

            {/* Content settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Content Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="wc-min">Min Word Count</Label>
                    <Input
                      id="wc-min"
                      data-testid="input-word-count-min"
                      type="number"
                      min={500}
                      max={5000}
                      value={wordCountMin}
                      onChange={(e) => setWordCountMin(parseInt(e.target.value) || 800)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wc-max">Max Word Count</Label>
                    <Input
                      id="wc-max"
                      data-testid="input-word-count-max"
                      type="number"
                      min={500}
                      max={5000}
                      value={wordCountMax}
                      onChange={(e) => setWordCountMax(parseInt(e.target.value) || 2000)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended: 800–2,000 words for optimal local SEO and E-E-A-T signals.
                </p>
              </CardContent>
            </Card>

            {/* Credit cost preview */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Cost Estimate</p>
              <CreditPreviewBanner units={selectedTitles.size} onCanAffordChange={setCreditCanAfford} />
            </div>

            <div className="flex justify-between gap-3 flex-wrap">
              <Button variant="outline" onClick={() => setStep(2)} data-testid="button-back-to-titles">
                ← Back
              </Button>
              <Button
                size="lg"
                onClick={() => handleSubmitBatch()}
                disabled={submitBatchMutation.isPending || selectedTitles.size === 0 || !creditCanAfford}
                data-testid="button-start-generating"
              >
                {submitBatchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Start Generating {selectedTitles.size} Article{selectedTitles.size !== 1 ? "s" : ""}</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STEP 4 — Generation Progress
        ═══════════════════════════════════════════════════════════════════ */}
        {step === 4 && (
          <div className="space-y-5">
            {generatingBatchId ? (
              <GenerationProgress
                batchId={generatingBatchId}
                onComplete={() => setGenerationComplete(true)}
              />
            ) : (
              <Card className="p-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Starting generation…</p>
              </Card>
            )}

            {generationComplete && (
              <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                <CardContent className="p-6 text-center space-y-4">
                  <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
                  <div>
                    <p className="font-semibold text-lg">Generation Complete</p>
                    <p className="text-sm text-muted-foreground">Your articles are ready in the Content Library.</p>
                  </div>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <Link href="/content">
                      <Button><FileText className="w-4 h-4 mr-2" /> View Articles</Button>
                    </Link>
                    <Button variant="outline" onClick={handleStartNew}>
                      <Sparkles className="w-4 h-4 mr-2" /> Generate More
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!generationComplete && (
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleStartNew} data-testid="button-start-new">
                  Start New Campaign
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <BrandConfirmationModal
        open={showBrandModal}
        onOpenChange={setShowBrandModal}
        initialBrandName={businessName}
        onConfirm={handleBrandConfirm}
        title="Confirm Your Business Name"
        description="This exact spelling will be used across all generated articles, images, and schemas. It cannot be changed after generation starts."
      />

      <Dialog open={showIntelGateDialog} onOpenChange={setShowIntelGateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up Brand Intelligence first?</DialogTitle>
            <DialogDescription>
              Brand Intelligence researches your brand, competitors, and customer pain points so every article is on-brand and strategically targeted. One-time setup, takes a few minutes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => { setShowIntelGateDialog(false); handleSubmitBatch(true); }}>
              Skip for now
            </Button>
            <Link href="/intelligence">
              <Button>
                <Sparkles className="w-4 h-4 mr-2" /> Set up Brand Intelligence
              </Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
