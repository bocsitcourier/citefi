"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  GitBranch, Plus, Play, Pause, CheckCircle2, Clock, Circle,
  ChevronRight, Layers, RefreshCw, AlertCircle, Zap, Globe, ExternalLink, Mic, Video,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepContentPreview {
  title?: string;
  slug?: string;
  wordCount?: number;
  url?: string;
  text?: string;
  podcastStatus?: string;
  podcastUrl?: string;
  videoStatus?: string;
  videoUrl?: string;
}

interface JourneyStep {
  id: number;
  journeyId: number;
  stepIndex: number;
  contentType: string;
  dayOffset: number;
  topicAngle: string | null;
  channel: string | null;
  status: "pending" | "queued" | "generated" | "published";
  articleId: number | null;
  batchId: number | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  contentPreview?: StepContentPreview | null;
}

interface Journey {
  id: number;
  teamId: number;
  name: string;
  templateType: string | null;
  triggerType: string;
  status: "draft" | "active" | "completed" | "paused";
  terminalKpi: string;
  locale: string | null;
  triggeredAt: string | null;
  completedAt: string | null;
  createdAt: string;
  // Enriched by list API for dashboard progress/next-due display
  steps?: JourneyStep[];
  totalSteps?: number;
  completedSteps?: number;
  nextDueStep?: JourneyStep | null;
}

interface JourneyTemplate {
  id: number;
  name: string;
  description: string | null;
  templateType: string;
  stepsConfig: Array<{
    stepIndex: number;
    contentType: string;
    dayOffset: number;
    topicAngle: string;
    channel?: string;
  }>;
  isBuiltin: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  completed: "bg-green-500/10 text-green-600 dark:text-green-400",
  paused: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
};

const STEP_STATUS_ICON: Record<string, JSX.Element> = {
  pending: <Circle className="w-4 h-4 text-muted-foreground" />,
  queued: <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />,
  generated: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  published: <Zap className="w-4 h-4 text-purple-500" />,
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  article: "Article",
  social: "Social Post",
  podcast: "Podcast",
  video: "Video",
};

const KPI_LABELS: Record<string, string> = {
  conversion: "Conversion",
  engagement: "Engagement",
  awareness: "Awareness",
  subscription: "Subscription",
};

function getStepProgress(steps: JourneyStep[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((s) => s.status === "generated" || s.status === "published").length;
  return Math.round((done / steps.length) * 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getNextStepDue(steps: JourneyStep[]): string {
  const pending = steps
    .filter((s) => s.status === "pending" && s.scheduledFor)
    .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());
  return pending[0]?.scheduledFor ? formatDate(pending[0].scheduledFor) : "No pending steps";
}

// ─── Journey Card ─────────────────────────────────────────────────────────────

function JourneyCard({
  journey,
  steps,
  onSelect,
}: {
  journey: Journey;
  steps: JourneyStep[];
  onSelect: () => void;
}) {
  const progress = getStepProgress(steps);
  const nextDue = getNextStepDue(steps);

  return (
    <Card
      className="cursor-pointer hover-elevate"
      onClick={onSelect}
      data-testid={`card-journey-${journey.id}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-base truncate">{journey.name}</CardTitle>
          </div>
          <Badge className={STATUS_COLOR[journey.status]} variant="outline" data-testid={`status-journey-${journey.id}`}>
            {journey.status.charAt(0).toUpperCase() + journey.status.slice(1)}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-3 mt-1 flex-wrap">
          <span className="flex items-center gap-1 text-xs">
            <Layers className="w-3 h-3" />
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1 text-xs">
            <Zap className="w-3 h-3" />
            {KPI_LABELS[journey.terminalKpi] ?? journey.terminalKpi}
          </span>
          {journey.locale && (
            <span className="flex items-center gap-1 text-xs">
              <Globe className="w-3 h-3" />
              {journey.locale}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress}% complete</span>
            <span>{steps.filter((s) => s.status === "generated" || s.status === "published").length}/{steps.length} done</span>
          </div>
          <Progress value={progress} className="h-1.5" data-testid={`progress-journey-${journey.id}`} />
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>Next due: {nextDue}</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDate(journey.createdAt)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step Timeline ────────────────────────────────────────────────────────────

function StepContentLink({ step }: { step: JourneyStep }) {
  const p = step.contentPreview;
  if (!p) return null;

  if (step.contentType === "article" && p.title) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        {p.url ? (
          <a
            href={p.url}
            className="text-xs text-primary underline-offset-2 hover:underline flex items-center gap-1 truncate max-w-[260px]"
            data-testid={`link-step-article-${step.id}`}
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            {p.title}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground truncate max-w-[260px]">{p.title}</span>
        )}
        {p.wordCount && (
          <span className="text-xs text-muted-foreground shrink-0">{p.wordCount.toLocaleString()} words</span>
        )}
      </div>
    );
  }

  if (step.contentType === "social" && p.title) {
    return (
      <p className="text-xs text-muted-foreground mt-1 truncate max-w-[300px]" data-testid={`text-step-social-${step.id}`}>
        {p.title}
      </p>
    );
  }

  if (step.contentType === "podcast") {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <Mic className="w-3 h-3 text-muted-foreground shrink-0" />
        {p.podcastUrl ? (
          <a
            href={p.podcastUrl}
            className="text-xs text-primary underline-offset-2 hover:underline truncate max-w-[240px]"
            data-testid={`link-step-podcast-${step.id}`}
          >
            {p.title ?? "Listen"}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{p.podcastStatus ?? "Pending"}</span>
        )}
      </div>
    );
  }

  if (step.contentType === "video") {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <Video className="w-3 h-3 text-muted-foreground shrink-0" />
        {p.videoUrl ? (
          <a
            href={p.videoUrl}
            className="text-xs text-primary underline-offset-2 hover:underline truncate max-w-[240px]"
            data-testid={`link-step-video-${step.id}`}
          >
            {p.title ?? "Watch"}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{p.videoStatus ?? "Pending"}</span>
        )}
      </div>
    );
  }

  return null;
}

function StepTimeline({ steps }: { steps: JourneyStep[] }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div
          key={step.id}
          className="flex items-start gap-3 p-2 rounded-md hover-elevate"
          data-testid={`row-step-${step.id}`}
        >
          <div className="mt-0.5 shrink-0">{STEP_STATUS_ICON[step.status] ?? STEP_STATUS_ICON.pending}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">
                Day {step.dayOffset}
              </span>
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                {CONTENT_TYPE_LABEL[step.contentType] ?? step.contentType}
              </Badge>
              {step.channel && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground">
                  {step.channel}
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs px-1.5 py-0 ${STATUS_COLOR[step.status]}`}>
                {step.status}
              </Badge>
            </div>
            {step.topicAngle && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.topicAngle}</p>
            )}
            <StepContentLink step={step} />
            {step.scheduledFor && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Scheduled: {formatDate(step.scheduledFor)}
              </p>
            )}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className="w-3 h-3 text-muted-foreground/40 mt-1 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Create Journey Dialog ────────────────────────────────────────────────────

function CreateJourneyDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [terminalKpi, setTerminalKpi] = useState("conversion");
  const [triggerType, setTriggerType] = useState("manual");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [locale, setLocale] = useState("");

  const { data: tmplData } = useQuery<{ templates: JourneyTemplate[] }>({
    queryKey: ["/api/journeys/templates"],
    enabled: open,
  });
  const templates = tmplData?.templates ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/journeys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          terminalKpi,
          triggerType,
          templateId: selectedTemplateId ?? undefined,
          locale: locale.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create journey");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: "Journey created", description: `"${name}" is ready. Trigger it to start scheduling steps.` });
      onClose();
      setName("");
      setSelectedTemplateId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Content Journey</DialogTitle>
          <DialogDescription>
            Pick a template and configure your journey. Steps will be scheduled automatically when you trigger it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="journey-name">Journey Name</Label>
            <Input
              id="journey-name"
              placeholder="e.g. HVAC Winter SEO Push"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-journey-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Template</Label>
            <div className="grid grid-cols-1 gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(t.id === selectedTemplateId ? null : t.id)}
                  className={`text-left rounded-md border p-3 transition-colors ${
                    selectedTemplateId === t.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover-elevate"
                  }`}
                  data-testid={`button-template-${t.templateType}`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {(t.stepsConfig as JourneyTemplate["stepsConfig"]).length} steps
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedTemplate && (
            <div className="rounded-md bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preview</p>
              {(selectedTemplate.stepsConfig as JourneyTemplate["stepsConfig"]).map((s) => (
                <div key={s.stepIndex} className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="px-1.5 py-0 text-xs shrink-0">
                    Day {s.dayOffset}
                  </Badge>
                  <span className="text-muted-foreground">
                    {CONTENT_TYPE_LABEL[s.contentType] ?? s.contentType}
                    {s.channel ? ` (${s.channel})` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Goal KPI</Label>
              <Select value={terminalKpi} onValueChange={setTerminalKpi}>
                <SelectTrigger data-testid="select-terminal-kpi">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conversion">Conversion</SelectItem>
                  <SelectItem value="engagement">Engagement</SelectItem>
                  <SelectItem value="awareness">Awareness</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger data-testid="select-trigger-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="on_publish">On Publish</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="journey-locale">Locale (optional)</Label>
            <Input
              id="journey-locale"
              placeholder="e.g. en-US, es-MX"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              data-testid="input-journey-locale"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-journey">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!name.trim() || createMutation.isPending}
              data-testid="button-create-journey"
            >
              {createMutation.isPending ? "Creating..." : "Create Journey"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Journey Detail Panel ─────────────────────────────────────────────────────

function JourneyDetailPanel({
  journey,
  steps,
  onClose,
}: {
  journey: Journey;
  steps: JourneyStep[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/journeys/${journey.id}/trigger`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to trigger journey");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: "Journey activated", description: "Steps have been scheduled. The 15-minute scheduler will begin processing them." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      const newStatus = journey.status === "active" ? "paused" : "active";
      const res = await fetch(`/api/journeys/${journey.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update journey");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: journey.status === "active" ? "Journey paused" : "Journey resumed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const progress = getStepProgress(steps);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-base">{journey.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {journey.templateType
              ? `Template: ${journey.templateType.replace(/_/g, " ")}`
              : "Custom journey"}{" "}
            · {KPI_LABELS[journey.terminalKpi] ?? journey.terminalKpi} goal
          </p>
        </div>
        <Badge className={STATUS_COLOR[journey.status]} variant="outline">
          {journey.status}
        </Badge>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div><span className="font-medium text-foreground">Trigger:</span> {journey.triggerType}</div>
        <div><span className="font-medium text-foreground">Locale:</span> {journey.locale ?? "Default"}</div>
        <div><span className="font-medium text-foreground">Triggered:</span> {formatDate(journey.triggeredAt)}</div>
        <div><span className="font-medium text-foreground">Completed:</span> {formatDate(journey.completedAt)}</div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Steps</p>
        <StepTimeline steps={steps} />
      </div>

      <div className="flex gap-2 pt-2 flex-wrap">
        {journey.status === "draft" && (
          <Button
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            data-testid={`button-trigger-journey-${journey.id}`}
          >
            <Play className="w-3 h-3 mr-1" />
            {triggerMutation.isPending ? "Activating..." : "Activate Journey"}
          </Button>
        )}
        {(journey.status === "active" || journey.status === "paused") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending}
            data-testid={`button-pause-journey-${journey.id}`}
          >
            {journey.status === "active" ? (
              <><Pause className="w-3 h-3 mr-1" /> Pause</>
            ) : (
              <><Play className="w-3 h-3 mr-1" /> Resume</>
            )}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-detail">
          Close
        </Button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function JourneysPage() {
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedJourneyId, setSelectedJourneyId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<{ journeys: Journey[] }>({
    queryKey: ["/api/journeys"],
    enabled: !!user,
  });

  const journeyList = data?.journeys ?? [];

  const { data: detailData } = useQuery<{ journey: Journey; steps: JourneyStep[] }>({
    queryKey: ["/api/journeys", selectedJourneyId],
    enabled: selectedJourneyId !== null,
  });

  const selectedJourney = detailData?.journey ?? journeyList.find((j) => j.id === selectedJourneyId) ?? null;
  const selectedSteps = detailData?.steps ?? [];

  const activeCount = journeyList.filter((j) => j.status === "active").length;
  const completedCount = journeyList.filter((j) => j.status === "completed").length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main list */}
      <div className={`flex flex-col flex-1 overflow-hidden transition-all ${selectedJourneyId ? "max-w-[600px]" : ""}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-primary" />
              Content Journeys
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Coordinated content sequences that keep your audience moving toward conversion
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-journey">
            <Plus className="w-4 h-4 mr-1" />
            New Journey
          </Button>
        </div>

        {/* Stats bar */}
        {journeyList.length > 0 && (
          <div className="flex items-center gap-6 px-6 py-3 border-b bg-muted/30 text-sm flex-wrap gap-y-1">
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{journeyList.length}</span> total
            </span>
            <span className="text-muted-foreground">
              <span className="font-medium text-blue-600 dark:text-blue-400">{activeCount}</span> active
            </span>
            <span className="text-muted-foreground">
              <span className="font-medium text-green-600 dark:text-green-400">{completedCount}</span> completed
            </span>
          </div>
        )}

        {/* Journey list */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground" data-testid="status-loading">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading journeys...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive py-8" data-testid="status-error">
              <AlertCircle className="w-4 h-4" />
              Failed to load journeys
            </div>
          )}

          {!isLoading && !error && journeyList.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="status-empty">
              <GitBranch className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-lg mb-2">No journeys yet</h3>
              <p className="text-muted-foreground text-sm max-w-sm mb-6">
                Create your first content journey to start coordinating articles, social posts, podcasts, and videos into
                a single conversion-focused sequence.
              </p>
              <Button onClick={() => setCreateOpen(true)} data-testid="button-first-journey">
                <Plus className="w-4 h-4 mr-1" />
                Create Your First Journey
              </Button>
            </div>
          )}

          {!isLoading && journeyList.length > 0 && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {journeyList.map((journey) => (
                <JourneyCard
                  key={journey.id}
                  journey={journey}
                  steps={
                    journey.id === selectedJourneyId
                      ? selectedSteps.length > 0
                        ? selectedSteps
                        : (journey.steps ?? [])
                      : (journey.steps ?? [])
                  }
                  onSelect={() =>
                    setSelectedJourneyId(journey.id === selectedJourneyId ? null : journey.id)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedJourneyId && selectedJourney && (
        <div className="w-[380px] shrink-0 border-l overflow-y-auto p-6" data-testid="panel-journey-detail">
          <JourneyDetailPanel
            journey={selectedJourney}
            steps={selectedSteps}
            onClose={() => setSelectedJourneyId(null)}
          />
        </div>
      )}

      <CreateJourneyDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
