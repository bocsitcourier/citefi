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
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Progress } from "@/components/ui/progress";

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

export default function LearningDashboard() {
  const { toast } = useToast();
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);

  const { data: agentsData, isLoading, refetch } = useQuery<{ success: boolean; agents: LearningAgent[] }>({
    queryKey: ["/api/learning/agents"],
  });

  const { data: intelligenceData, isLoading: intelligenceLoading } = useQuery<{ success: boolean } & IntelligenceData>({
    queryKey: ["/api/learning/intelligence"],
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
        <Button 
          variant="outline" 
          onClick={() => {
            refetch();
            queryClient.invalidateQueries({ queryKey: ["/api/learning/intelligence"] });
          }}
          data-testid="button-refresh"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

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
    </div>
  );
}
