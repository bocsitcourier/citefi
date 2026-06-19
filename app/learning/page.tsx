"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Loader2, 
  Brain, 
  TrendingUp, 
  TrendingDown,
  Zap, 
  FileText, 
  Video, 
  MessageSquare, 
  Mic, 
  Image,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Shield,
  ShieldCheck,
  Activity,
  BarChart2,
  FlaskConical,
  Trophy,
  Target,
  Layers,
  GitBranch,
  Award,
  Users,
  Flag,
  Info,
  TrendingUp as TrendingUpIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LearnedPattern {
  id: number;
  patternType: string;
  patternName: string;
  patternValue: string;
  successRate: number;
  confidence: number;
}

interface LearningAgent {
  id: number;
  name: string;
  contentType: string;
  totalGenerations: number;
  successfulGenerations: number;
  averageQualityScore: number;
  patternCount: number;
  topPatterns: LearnedPattern[];
}

interface GuardianFailure {
  errorType: string;
  label: string;
  count: number;
  lastOccurrence: string;
  isActivelySupressed: boolean;
}

interface IntelligenceData {
  guardianFailures: GuardianFailure[];
  articleStats: {
    total7d: number;
    complete7d: number;
    failed7d: number;
    failureRate7d: number;
    total30d: number;
    complete30d: number;
  };
  billing: {
    estimatedCost30dUsd: number;
    articlesGenerated30d: number;
    imagesGenerated30d: number;
    costPerArticle: number;
    costPerImage: number;
  };
}

interface DriftEntry {
  dimension: string;
  recentAvg: number;
  baselineAvg: number;
  delta: number;
  recentSamples: number;
  drifting: boolean;
  note?: string;
}

interface LeaderboardEntry {
  patternId: number;
  name: string;
  type: string;
  wilson: number;
  successes: number;
  trials: number;
}

interface LeaderboardData {
  dimension: string;
  best: LeaderboardEntry[];
  worst: LeaderboardEntry[];
  proven: number;
}

interface ReadinessData {
  dimension: string;
  untouched: number;
  exploring: number;
  proven: number;
  total: number;
}

interface DefectEntry {
  defect: string;
  contentType: string;
  count: number;
  lastSeen: string;
  status: string;
}

interface MonitorSnapshot {
  alerts: string[];
  drift: DriftEntry[];
  leaderboards: LeaderboardData[];
  topDefects: DefectEntry[];
  readiness: ReadinessData;
  engineDrift: Array<{ patternId: number; name: string; lifetimeWilson: number; recentRate: number; recentSamples: number; gap: number; drifting: boolean }>;
}

const CONTENT_TYPE_ICONS: Record<string, any> = {
  article: FileText,
  video: Video,
  social: MessageSquare,
  podcast: Mic,
  image: Image,
};

const CONTENT_TYPE_COLORS: Record<string, string> = {
  article: "bg-blue-500",
  video: "bg-purple-500",
  social: "bg-pink-500",
  podcast: "bg-orange-500",
  image: "bg-green-500",
};

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const DIM_LABELS: Record<string, string> = {
  completeness: "Completeness",
  factuality: "Factuality",
  structure: "Structure",
  humanness: "Humanness",
  engagement: "Engagement",
};

export default function LearningDashboard() {
  const { toast } = useToast();
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const { data: agentsData, isLoading, refetch } = useQuery<{ success: boolean; agents: LearningAgent[] }>({
    queryKey: ["/api/learning/agents"],
  });

  const { data: intelligenceData, isLoading: intelligenceLoading } = useQuery<{ success: boolean } & IntelligenceData>({
    queryKey: ["/api/learning/intelligence"],
  });

  const { data: monitorData, isLoading: monitorLoading, refetch: refetchMonitor } = useQuery<{ success: boolean } & MonitorSnapshot>({
    queryKey: ["/api/learning/monitor/snapshot"],
    staleTime: 5 * 60 * 1000,
  });

  const [decisioningCt, setDecisioningCt] = useState("article");
  const { data: decisioningSummary, isLoading: decisioningLoading, refetch: refetchDecisioning } = useQuery<any>({
    queryKey: ["/api/decisioning/summary", decisioningCt],
    queryFn: () => apiRequest(`/api/decisioning/summary?contentType=${decisioningCt}`),
    staleTime: 2 * 60 * 1000,
  });

  const { data: strategyData, isLoading: strategyLoading } = useQuery<any>({
    queryKey: ["/api/learning/strategy"],
    staleTime: 10 * 60 * 1000,
  });

  const mineCorpusMutation = useMutation({
    mutationFn: async (contentType: string) => {
      return apiRequest("/api/learning/monitor/mine-corpus", {
        method: "POST",
        body: JSON.stringify({ contentType, limit: 200 }),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Corpus review complete",
        description: `Reviewed ${data?.reviewed ?? 0} pieces. Top defect: ${data?.topDefects?.[0]?.code ?? "none"}`,
      });
      refetchMonitor();
      queryClient.invalidateQueries({ queryKey: ["/api/learning/agents"] });
    },
    onError: (error: any) => {
      toast({ title: "Mine corpus failed", description: error.message, variant: "destructive" });
    },
  });

  const optimizeMutation = useMutation({
    mutationFn: async (agentId: number) => {
      return apiRequest(`/api/learning/agents/${agentId}/optimize`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Agent optimized", description: "Learning patterns have been updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/learning/agents"] });
    },
    onError: (error: any) => {
      toast({ title: "Optimization failed", description: error.message, variant: "destructive" });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async ({ agentId, contentType }: { agentId: number; contentType: string }) => {
      return apiRequest(`/api/learning/agents/${agentId}/seed`, {
        method: "POST",
        body: JSON.stringify({ contentType }),
      });
    },
    onSuccess: () => {
      toast({ title: "Patterns seeded", description: "Default learning patterns have been added" });
      queryClient.invalidateQueries({ queryKey: ["/api/learning/agents"] });
    },
    onError: (error: any) => {
      toast({ title: "Seeding failed", description: error.message, variant: "destructive" });
    },
  });

  const [declareWinnerResult, setDeclareWinnerResult] = useState<any>(null);

  const declareWinnerMutation = useMutation({
    mutationFn: async (armId: number) => {
      return apiRequest(`/api/decisioning/arms/${armId}/declare-winner`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      setDeclareWinnerResult(data);
      toast({
        title: "Winner declared",
        description: `Arm ${data?.arm?.armName ?? "treatment"} promoted with readiness ${data?.readinessScore}%.`,
      });
      refetchDecisioning();
    },
    onError: (error: any) => {
      const body = (error as any)?.body ?? error;
      setDeclareWinnerResult(body);
      const isPremature = body?.error === "PREMATURE_PROMOTION";
      toast({
        title: isPremature ? "Gates not satisfied" : "Promotion failed",
        description: isPremature
          ? `Readiness score ${body?.readinessScore ?? 0}% — gates not yet fully passed.`
          : (error.message ?? "Unknown error"),
        variant: "destructive",
      });
    },
  });

  const agents = agentsData?.agents || [];
  const intel = intelligenceData;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Brain className="w-6 h-6" />
            AI Learning Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitors failures, tracks patterns, and corrects the AI on every future generation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => mineCorpusMutation.mutate("article")}
            disabled={mineCorpusMutation.isPending}
            data-testid="button-mine-corpus"
          >
            {mineCorpusMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <FlaskConical className="w-4 h-4 mr-2" />
            )}
            Backfill Reviews
          </Button>
          <Button 
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              refetchMonitor();
              queryClient.invalidateQueries({ queryKey: ["/api/learning/intelligence"] });
            }}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="decisioning" data-testid="tab-decisioning">
            <Target className="w-4 h-4 mr-1.5" />
            Decisioning
          </TabsTrigger>
          <TabsTrigger value="strategy" data-testid="tab-strategy">
            <Users className="w-4 h-4 mr-1.5" />
            Strategy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
      {/* Top stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-agents">{agents.length}</p>
                <p className="text-sm text-muted-foreground">Active Agents</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-green-500/10">
                <TrendingUp className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-patterns">
                  {agents.reduce((sum, a) => sum + a.patternCount, 0)}
                </p>
                <p className="text-sm text-muted-foreground">Learned Patterns</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-red-500/10">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-failure-rate">
                  {intel?.articleStats?.failureRate7d ?? "—"}
                  {intel?.articleStats ? "%" : ""}
                </p>
                <p className="text-sm text-muted-foreground">Failure rate (7d)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-yellow-500/10">
                <DollarSign className="w-6 h-6 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-billing-estimate">
                  {intel?.billing ? `$${intel.billing.estimatedCost30dUsd.toFixed(2)}` : "—"}
                </p>
                <p className="text-sm text-muted-foreground">Est. AI cost (30d)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================
          FAILURE INTELLIGENCE PANEL
          ================================================================ */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5" />
          What the System Is Actually Learning
        </h2>

        {/* Article production stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Article Production — Last 7 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {intelligenceLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : intel?.articleStats ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Completed successfully</span>
                    <span className="font-medium text-green-600 dark:text-green-400" data-testid="text-complete-7d">
                      {intel.articleStats.complete7d}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Failed</span>
                    <span className="font-medium text-red-600 dark:text-red-400" data-testid="text-failed-7d">
                      {intel.articleStats.failed7d}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total attempted</span>
                    <span className="font-medium" data-testid="text-total-7d">{intel.articleStats.total7d}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Success rate</span>
                      <span>{100 - intel.articleStats.failureRate7d}%</span>
                    </div>
                    <Progress value={100 - intel.articleStats.failureRate7d} className="h-2" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-yellow-500" />
                Estimated AI Costs — Last 30 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {intelligenceLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : intel?.billing ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Articles generated</span>
                    <span className="font-medium">{intel.billing.articlesGenerated30d}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Hero images generated</span>
                    <span className="font-medium">{intel.billing.imagesGenerated30d}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Article cost (~${intel.billing.costPerArticle.toFixed(3)} ea.)
                    </span>
                    <span className="font-medium">
                      ${(intel.billing.articlesGenerated30d * intel.billing.costPerArticle).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Image cost (~${intel.billing.costPerImage.toFixed(3)} ea.)
                    </span>
                    <span className="font-medium">
                      ${(intel.billing.imagesGenerated30d * intel.billing.costPerImage).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t pt-2">
                    <span>Total estimate</span>
                    <span data-testid="text-billing-total">${intel.billing.estimatedCost30dUsd.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Rough estimate — actual Gemini/OpenAI billing may differ
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Guardian failure ledger */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-500" />
              Recurring Failures the AI Is Being Corrected For
            </CardTitle>
            <CardDescription>
              Every error listed here is automatically injected as a warning into the AI prompt on the next generation run — the system IS learning from these
            </CardDescription>
          </CardHeader>
          <CardContent>
            {intelligenceLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading failure data...
              </div>
            ) : !intel?.guardianFailures || intel.guardianFailures.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-70" />
                No recurring failures detected yet. Generate some articles to start learning.
              </div>
            ) : (
              <div className="space-y-2">
                {intel.guardianFailures.map((failure) => (
                  <div
                    key={failure.errorType}
                    className="flex items-center justify-between p-3 rounded-md bg-muted/40"
                    data-testid={`failure-${failure.errorType}`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {failure.count >= 5 ? (
                        <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{failure.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Last seen {timeAgo(failure.lastOccurrence)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <Badge variant="outline" className="text-xs">
                        {failure.count}× recorded
                      </Badge>
                      {failure.isActivelySupressed && (
                        <Badge className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0">
                          Active correction
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Errors with 2+ occurrences are injected as mandatory warnings into every future article prompt.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ================================================================
          LEARNING SIGNAL MONITOR
          ================================================================ */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Live Learning Signal
        </h2>

        {/* Drift alerts */}
        {monitorLoading ? (
          <Card>
            <CardContent className="py-6 flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading signal data...
            </CardContent>
          </Card>
        ) : monitorData?.alerts && monitorData.alerts.length > 0 ? (
          <Card className="border-orange-500/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                Active Drift Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {monitorData.alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-orange-500/10 text-sm" data-testid={`alert-drift-${i}`}>
                  <TrendingDown className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                  <span>{alert}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : monitorData ? (
          <Card>
            <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              No drift detected — all dimensions are stable
            </CardContent>
          </Card>
        ) : null}

        {/* Dimension scorecards + cohort readiness */}
        {monitorData?.drift && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-blue-500" />
                  Dimension Scores (7-day vs 28-day baseline)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {monitorData.drift.map((d) => (
                  <div key={d.dimension} className="space-y-1" data-testid={`drift-${d.dimension}`}>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">{DIM_LABELS[d.dimension] ?? d.dimension}</span>
                      <div className="flex items-center gap-2">
                        {d.note ? (
                          <span className="text-xs text-muted-foreground italic">{d.note}</span>
                        ) : (
                          <span className={`text-xs font-medium ${d.delta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                            {d.delta >= 0 ? "+" : ""}{d.delta}pts
                          </span>
                        )}
                        <span className="font-medium w-8 text-right">{d.recentAvg > 0 ? d.recentAvg : "—"}</span>
                      </div>
                    </div>
                    <Progress
                      value={d.recentAvg}
                      className={`h-1.5 ${d.drifting ? "opacity-60" : ""}`}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Scores averaged from content reviews. Run "Backfill Reviews" to populate.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-purple-500" />
                  Pattern Cohort Readiness
                </CardTitle>
                <CardDescription>How many patterns have real engagement data vs. still exploring</CardDescription>
              </CardHeader>
              <CardContent>
                {monitorData.readiness ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 rounded-md bg-muted/40">
                        <p className="text-xl font-bold text-muted-foreground">{monitorData.readiness.untouched}</p>
                        <p className="text-xs text-muted-foreground mt-1">Untested</p>
                      </div>
                      <div className="p-3 rounded-md bg-muted/40">
                        <p className="text-xl font-bold text-yellow-500">{monitorData.readiness.exploring}</p>
                        <p className="text-xs text-muted-foreground mt-1">Exploring</p>
                      </div>
                      <div className="p-3 rounded-md bg-muted/40">
                        <p className="text-xl font-bold text-green-500">{monitorData.readiness.proven}</p>
                        <p className="text-xs text-muted-foreground mt-1">Proven</p>
                      </div>
                    </div>
                    <Progress
                      value={monitorData.readiness.total > 0
                        ? Math.round((monitorData.readiness.proven / monitorData.readiness.total) * 100)
                        : 0}
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground">
                      {monitorData.readiness.proven}/{monitorData.readiness.total} patterns have ≥5 engagement trials (Wilson-scored)
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Engagement leaderboard toggle */}
        {monitorData?.leaderboards && monitorData.leaderboards.length > 0 && (
          <Card>
            <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowLeaderboard(!showLeaderboard)}>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />
                  Pattern Leaderboards (Wilson Score)
                </CardTitle>
                <Button variant="ghost" size="icon" data-testid="button-toggle-leaderboard">
                  {showLeaderboard ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              </div>
              <CardDescription>Top patterns per quality dimension, ranked by statistical confidence</CardDescription>
            </CardHeader>
            {showLeaderboard && (
              <CardContent>
                <div className="space-y-6">
                  {monitorData.leaderboards.map((board) => (
                    board.best.length > 0 && (
                      <div key={board.dimension}>
                        <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                          {DIM_LABELS[board.dimension] ?? board.dimension}
                          <span className="ml-2 font-normal normal-case">({board.proven} proven)</span>
                        </h4>
                        <div className="space-y-1">
                          {board.best.map((p, rank) => (
                            <div key={p.patternId} className="flex items-center gap-3 py-1.5 text-sm" data-testid={`leaderboard-${board.dimension}-${p.patternId}`}>
                              <span className="w-5 text-center text-muted-foreground text-xs font-mono">#{rank + 1}</span>
                              <span className="flex-1 truncate">{p.name}</span>
                              <Badge variant="outline" className="text-xs shrink-0">
                                {p.wilson}pt Wilson
                              </Badge>
                              <span className="text-xs text-muted-foreground shrink-0">{p.successes}/{p.trials}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Top defects from corpus mining */}
        {monitorData?.topDefects && monitorData.topDefects.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-500" />
                Top Content Defects (from Review Corpus)
              </CardTitle>
              <CardDescription>Most frequent quality failures detected by the review system</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {monitorData.topDefects.slice(0, 6).map((d) => (
                  <div key={`${d.defect}-${d.contentType}`} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/40 text-sm" data-testid={`defect-${d.defect}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${d.status === "active" ? "bg-red-500" : "bg-muted-foreground"}`} />
                      <span className="truncate font-mono text-xs">{d.defect}</span>
                      <Badge variant="outline" className="text-xs shrink-0">{d.contentType}</Badge>
                    </div>
                    <Badge variant={d.count >= 10 ? "destructive" : "secondary"} className="shrink-0 text-xs">
                      {d.count}×
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ================================================================
          SPECIALIZED LEARNING AGENTS
          ================================================================ */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Specialized Learning Agents</h2>
        
        {agents.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No learning agents yet. Generate some content to start learning!</p>
            </CardContent>
          </Card>
        ) : (
          agents.map((agent) => {
            const Icon = CONTENT_TYPE_ICONS[agent.contentType] || Brain;
            const colorClass = CONTENT_TYPE_COLORS[agent.contentType] || "bg-gray-500";
            const isExpanded = expandedAgent === agent.id;
            const successRate = agent.totalGenerations > 0 
              ? Math.round((agent.successfulGenerations / agent.totalGenerations) * 100) 
              : 0;

            return (
              <Card key={agent.id} data-testid={`card-agent-${agent.contentType}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${colorClass} text-white`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{agent.name}</CardTitle>
                        <CardDescription>
                          {agent.patternCount} patterns learned • {agent.totalGenerations} generations
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={successRate >= 70 ? "default" : "secondary"}>
                        {successRate}% success
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                        data-testid={`button-expand-${agent.contentType}`}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex-1 min-w-40">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">Quality Score</span>
                          <span className="font-medium">{agent.averageQualityScore}%</span>
                        </div>
                        <Progress value={agent.averageQualityScore} className="h-2" />
                      </div>
                      
                      <div className="flex gap-2">
                        {agent.patternCount === 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => seedMutation.mutate({ agentId: agent.id, contentType: agent.contentType })}
                            disabled={seedMutation.isPending}
                            data-testid={`button-seed-${agent.contentType}`}
                          >
                            {seedMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-1" />
                                Seed Patterns
                              </>
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => optimizeMutation.mutate(agent.id)}
                          disabled={optimizeMutation.isPending}
                          data-testid={`button-optimize-${agent.contentType}`}
                        >
                          {optimizeMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4 mr-1" />
                              Optimize
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {isExpanded && agent.topPatterns.length > 0 && (
                      <div className="pt-4 border-t space-y-3">
                        <h4 className="text-sm font-medium">Top Performing Patterns</h4>
                        {agent.topPatterns.map((pattern) => (
                          <div 
                            key={pattern.id} 
                            className="p-3 rounded-lg bg-muted/50"
                            data-testid={`pattern-${pattern.id}`}
                          >
                            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                              <span className="text-sm font-medium">{pattern.patternName}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {pattern.patternType}
                                </Badge>
                                <Badge 
                                  variant={pattern.successRate >= 70 ? "default" : "secondary"}
                                  className="text-xs"
                                >
                                  {pattern.successRate}% success
                                </Badge>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {pattern.patternValue}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-muted-foreground">
                                Confidence: {pattern.confidence}%
                              </span>
                              <Progress value={pattern.confidence} className="h-1 flex-1" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {isExpanded && agent.topPatterns.length === 0 && (
                      <div className="pt-4 border-t text-center text-muted-foreground py-4">
                        <p className="text-sm">No patterns learned yet. Click "Seed Patterns" to add default patterns.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* ================================================================
          HOW LEARNING WORKS
          ================================================================ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            How the Learning Loop Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">1. Article Generated</h4>
              <p>The AI writes and your quality gate (Guardian) checks every output for missing sections, bad anchor text, low word count, and more.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">2. Failures Logged</h4>
              <p>Every Guardian failure is written to the ledger above with a count. Crashed articles are also categorized (timeout, rate limit, JSON error, etc.).</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">3. Warnings Injected</h4>
              <p>Before the next article prompt is sent, the top recurring failures are appended as mandatory correction instructions — the AI reads what it got wrong.</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30">
              <h4 className="font-medium text-foreground mb-2">4. Patterns Evolve</h4>
              <p>High-confidence style patterns (opening hooks, structure, tone) are also injected into prompts and updated via weighted averages as quality scores come in.</p>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        {/* ================================================================
            DECISIONING TAB — Thompson Sampling / Variant Arms (Task #16)
            ================================================================ */}
        <TabsContent value="decisioning" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="w-5 h-5" />
                Thompson Sampling Decisioning
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Pattern-level Bayesian arm scores — the system promotes winners automatically when 3 statistical gates pass.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={decisioningCt} onValueChange={setDecisioningCt}>
                <SelectTrigger className="w-36" data-testid="select-content-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["article", "social", "podcast", "video", "image"].map(ct => (
                    <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchDecisioning()} data-testid="button-refresh-decisioning">
                <RefreshCw className="w-4 h-4 mr-1.5" />
                Refresh
              </Button>
            </div>
          </div>

          {decisioningLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading decisioning data...
            </div>
          ) : !decisioningSummary ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No decisioning data yet. Generate content to populate pattern arms.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-primary/10">
                        <Layers className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xl font-bold capitalize" data-testid="text-maturity">{decisioningSummary.maturity}</p>
                        <p className="text-xs text-muted-foreground">Data maturity</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-full bg-green-500/10">
                        <GitBranch className="w-5 h-5 text-green-500" />
                      </div>
                      <div>
                        <p className="text-xl font-bold" data-testid="text-arm-count">{decisioningSummary.arms?.length ?? 0}</p>
                        <p className="text-xs text-muted-foreground">Variant arms</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-2 rounded-full bg-blue-500/10">
                        <Award className="w-4 h-4 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-xl font-bold" data-testid="text-readiness">{decisioningSummary.readinessScore ?? 0}%</p>
                        <p className="text-xs text-muted-foreground">Promotion readiness</p>
                      </div>
                    </div>
                    {decisioningSummary.readinessGates && (
                      <div className="space-y-1 mt-1">
                        {(["gateA", "gateB", "gateC"] as const).map(key => {
                          const g = decisioningSummary.readinessGates[key];
                          if (!g) return null;
                          return (
                            <div key={key} className="flex items-start gap-1.5 text-xs">
                              {g.passed
                                ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-green-500 shrink-0" />
                                : <XCircle className="w-3 h-3 mt-0.5 text-red-400 shrink-0" />}
                              <span className={g.passed ? "text-muted-foreground" : "text-muted-foreground/70"}>
                                {g.label}
                                {!g.passed && g.value != null && ` (${g.value}/${g.required})`}
                                {!g.passed && g.pValue != null && ` (p=${g.pValue})`}
                              </span>
                              <Badge variant="outline" className="text-[10px] ml-auto shrink-0">{g.weight}pt</Badge>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="w-4 h-4" />
                    Thompson-Sampled Pattern Leaderboard
                  </CardTitle>
                  <CardDescription>
                    Patterns ranked by their current Thompson sample score. Archived patterns are greyed out and excluded from selection.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!decisioningSummary.patterns || decisioningSummary.patterns.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No patterns yet for {decisioningCt}.</p>
                  ) : (
                    <div className="space-y-2">
                      {[...decisioningSummary.patterns]
                        .sort((a: any, b: any) => b.thompsonScore - a.thompsonScore)
                        .map((p: any) => (
                          <div
                            key={p.id}
                            className={`flex items-center justify-between p-3 rounded-md gap-2 flex-wrap ${p.isArchived ? "opacity-40 bg-muted/20" : "bg-muted/40"}`}
                            data-testid={`pattern-arm-${p.id}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{p.patternName}</p>
                              <p className="text-xs text-muted-foreground">
                                {p.alpha - 1} successes / {p.alpha + p.beta - 2} trials
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {p.isArchived && (
                                <Badge variant="secondary" className="text-xs">Archived</Badge>
                              )}
                              <Badge variant="outline" className="text-xs">{p.patternType}</Badge>
                              <Badge
                                variant={p.thompsonScore >= 70 ? "default" : "secondary"}
                                className="text-xs"
                                data-testid={`score-${p.id}`}
                              >
                                {p.thompsonScore}% TS
                              </Badge>
                              <div className="w-16">
                                <Progress value={p.thompsonScore} className="h-1.5" />
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {decisioningSummary.arms && decisioningSummary.arms.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <GitBranch className="w-4 h-4" />
                      Variant Arms
                    </CardTitle>
                    <CardDescription>
                      Tag <code className="text-[11px] bg-muted px-1 rounded">contentPerformanceMetrics.variantId = "va-&#123;armId&#125;"</code> on every generation to feed lift analysis.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {decisioningSummary.arms.map((arm: any) => {
                      const isTreatment = arm.armName === "treatment";
                      const isRunning = declareWinnerMutation.isPending && declareWinnerMutation.variables === arm.id;
                      return (
                        <div
                          key={arm.id}
                          className="flex items-center justify-between p-3 rounded-md bg-muted/40 flex-wrap gap-2"
                          data-testid={`arm-${arm.id}`}
                        >
                          <div>
                            <p className="text-sm font-medium capitalize">{arm.armName}</p>
                            <p className="text-xs text-muted-foreground">
                              {arm.allocationPct}% allocation · tag: <code className="text-[10px]">va-{arm.id}</code>
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={arm.isActive ? "default" : "secondary"} className="text-xs">
                              {arm.isActive ? "Active" : "Inactive"}
                            </Badge>
                            {arm.baselinePatternIds?.length > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {arm.baselinePatternIds.length} baseline patterns
                              </Badge>
                            )}
                            {isTreatment && arm.isActive && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => declareWinnerMutation.mutate(arm.id)}
                                disabled={isRunning}
                                data-testid={`button-declare-winner-${arm.id}`}
                              >
                                {isRunning
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                                  : <Flag className="w-3.5 h-3.5 mr-1" />}
                                Declare Winner
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* ── Gate details from last declare-winner attempt ─────────────── */}
              {declareWinnerResult?.gateDetails && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Promotion Gate Details
                      <Badge
                        variant={declareWinnerResult.readinessScore >= 100 ? "default" : "secondary"}
                        className="text-xs ml-1"
                      >
                        {declareWinnerResult.readinessScore ?? 0}% readiness
                      </Badge>
                    </CardTitle>
                    <CardDescription>Results from the last "Declare Winner" check</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Gate A */}
                    {declareWinnerResult.gateDetails.gateA && (() => {
                      const g = declareWinnerResult.gateDetails.gateA;
                      return (
                        <div className="flex items-start gap-2 text-sm">
                          {g.passed
                            ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                            : <XCircle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{g.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {g.value} / {g.required} observations
                              {!g.passed && g.etaObs != null && ` — need ~${g.etaObs} more`}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">30pt</Badge>
                        </div>
                      );
                    })()}
                    {/* Gate B — two windows */}
                    {declareWinnerResult.gateDetails.gateB && (() => {
                      const g = declareWinnerResult.gateDetails.gateB;
                      return (
                        <div className="flex items-start gap-2 text-sm">
                          {g.passed
                            ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                            : <XCircle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{g.label}</p>
                            {[g.w1, g.w2].map((w: any, i: number) => w && (
                              <div key={i} className="mt-1 flex gap-2 text-xs text-muted-foreground flex-wrap">
                                <span className="font-mono">{w.window}:</span>
                                <span>treat={w.treatN}obs @{(w.treatRate * 100).toFixed(1)}%</span>
                                <span>hold={w.holdN}obs @{(w.holdRate * 100).toFixed(1)}%</span>
                                <span>lift={w.lift >= 0 ? "+" : ""}{(w.lift * 100).toFixed(1)}pp</span>
                                <span className={w.significant ? "text-green-600" : "text-amber-500"}>
                                  p={w.pValue}
                                  {!w.significant && w.eta != null && ` (~${w.eta} more)`}
                                </span>
                              </div>
                            ))}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">40pt</Badge>
                        </div>
                      );
                    })()}
                    {/* Gate C */}
                    {declareWinnerResult.gateDetails.gateC && (() => {
                      const g = declareWinnerResult.gateDetails.gateC;
                      return (
                        <div className="flex items-start gap-2 text-sm">
                          {g.passed
                            ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                            : <XCircle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{g.label}</p>
                            {!g.passed && (
                              <p className="text-xs text-muted-foreground">{g.recentConflicts} guardrail conflict(s) in last 14 days</p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">30pt</Badge>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              {/* ── Treatment vs Holdout Lift Table ──────────────────────────── */}
              {decisioningSummary.liftSummary && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUpIcon className="w-4 h-4" />
                      Treatment vs Holdout Lift
                    </CardTitle>
                    <CardDescription>
                      Aggregated success rates across all tagged observations (variantId = "va-&#123;armId&#125;")
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const ls = decisioningSummary.liftSummary;
                      const hasData = ls.treatN > 0 || ls.holdN > 0;
                      if (!hasData) {
                        return (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                            <Info className="w-4 h-4 shrink-0" />
                            No tagged observations yet. Tag generations with <code className="text-[11px] bg-muted px-1 rounded ml-1">va-&#123;armId&#125;</code>.
                          </div>
                        );
                      }
                      const liftColor = ls.liftPct > 0 ? "text-green-600" : ls.liftPct < 0 ? "text-red-500" : "text-muted-foreground";
                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-3 rounded-md bg-muted/40">
                              <p className="text-xs text-muted-foreground mb-0.5">Treatment rate</p>
                              <p className="text-lg font-bold">{(ls.treatRate * 100).toFixed(1)}%</p>
                              <p className="text-xs text-muted-foreground">{ls.treatN} obs</p>
                            </div>
                            <div className="p-3 rounded-md bg-muted/40">
                              <p className="text-xs text-muted-foreground mb-0.5">Holdout rate</p>
                              <p className="text-lg font-bold">{(ls.holdRate * 100).toFixed(1)}%</p>
                              <p className="text-xs text-muted-foreground">{ls.holdN} obs</p>
                            </div>
                            <div className="p-3 rounded-md bg-muted/40">
                              <p className="text-xs text-muted-foreground mb-0.5">Absolute lift</p>
                              <p className={`text-lg font-bold ${liftColor}`}>
                                {ls.liftPct >= 0 ? "+" : ""}{(ls.liftPct * 100).toFixed(1)}pp
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {ls.significant ? "Significant" : `p=${ls.pValue}`}
                              </p>
                            </div>
                            <div className="p-3 rounded-md bg-muted/40">
                              <p className="text-xs text-muted-foreground mb-0.5">ETA to significance</p>
                              <p className="text-lg font-bold">
                                {ls.significant
                                  ? "—"
                                  : ls.etaObs == null
                                    ? "N/A"
                                    : `~${ls.etaObs}`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {ls.significant ? "Already significant" : "more treatment obs"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {ls.significant
                              ? <Badge variant="default" className="text-xs" data-testid="badge-lift-significant">Significant (p&lt;0.05)</Badge>
                              : <Badge variant="secondary" className="text-xs" data-testid="badge-lift-not-significant">Not yet significant (p={ls.pValue})</Badge>
                            }
                            {!ls.significant && ls.etaObs != null && (
                              <span className="text-xs text-muted-foreground">
                                Collect ~{ls.etaObs} more treatment observations to reach p&lt;0.05
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ================================================================
            STRATEGY TAB — Cohort Intelligence (Task #17)
            ================================================================ */}
        <TabsContent value="strategy" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="w-5 h-5" />
              Strategy Intelligence
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cohort-level conversion patterns mined nightly — surfaces which content types and segments over- or under-perform baseline.
            </p>
          </div>

          {strategyLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading cohort insights...
            </div>
          ) : !strategyData || strategyData.insights?.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">No cohort insights yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Insights are computed nightly from content performance data. Come back after your first full day of tracking.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold" data-testid="text-insights-total">{strategyData.summary?.total ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Total insights</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-converter-cohorts">{strategyData.summary?.converterCohorts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Converter cohorts</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold text-orange-500" data-testid="text-untapped">{strategyData.summary?.untapped ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Untapped segments</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold text-red-500" data-testid="text-guardrail-conflicts">{strategyData.summary?.guardrailConflicts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Guardrail conflicts</p>
                  </CardContent>
                </Card>
              </div>

              {strategyData.nextBestActions?.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-green-500" />
                      Next Best Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {strategyData.nextBestActions.map((action: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-md bg-muted/40 space-y-1" data-testid={`action-${idx}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-medium capitalize">{action.cohortValue}</p>
                          <Badge
                            variant={action.vsBaselineMultiplier >= 120 ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {action.vsBaselineMultiplier}% of baseline
                          </Badge>
                        </div>
                        {action.recommendationText && (
                          <p className="text-xs text-muted-foreground">{action.recommendationText}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">All Cohort Insights</CardTitle>
                  <CardDescription>
                    Nightly cohort mining results — each row is a segment with its conversion vs. baseline multiplier.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {strategyData.insights.slice(0, 30).map((insight: any) => (
                      <div
                        key={insight.id}
                        className="flex items-center justify-between p-3 rounded-md bg-muted/40 flex-wrap gap-2"
                        data-testid={`insight-${insight.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium capitalize">{insight.cohortValue}</p>
                          <p className="text-xs text-muted-foreground capitalize">{insight.insightType?.replace(/_/g, " ")}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-xs">n={insight.sampleSize}</Badge>
                          <Badge
                            className="text-xs"
                            variant={insight.vsBaselineMultiplier >= 120 ? "default" : insight.vsBaselineMultiplier < 80 ? "destructive" : "secondary"}
                          >
                            {insight.vsBaselineMultiplier}% vs baseline
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}
