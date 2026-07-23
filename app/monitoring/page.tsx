"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Clock, TrendingUp, AlertCircle, CheckCircle, XCircle, Loader2, Shield, Brain, BookOpen } from "lucide-react";

interface CostData {
  summary: {
    costPer50Articles: string;
    costPerArticle: string;
    totalCostRange: string;
    perArticleBreakdown: {
      titleGeneration: string;
      contentGeneration: string;
      reviewEnhancement: string;
      imageGeneration: string;
      podcastGeneration: string;
    };
  };
  benchmarks: Record<string, string>;
  batch?: {
    totalCost: string;
    costPerArticle: string;
    numArticles: number;
    includeImages: boolean;
    includePodcasts: boolean;
  };
}

interface BatchMonitoringData {
  liveStatus: {
    status: string;
    batchId: number;
    progress: number;
    articlesCompleted: number;
    articlesTotal: number;
    articlesInProgress: number;
    articlesFailed: number;
    currentCost: number;
    recentErrors: Array<{ timestamp: string; message: string }>;
  };
  performanceMetrics?: {
    averageTimePerArticle: number;
    totalDuration: number;
    errorRate: number;
    concurrentWorkers: number;
    imagesGenerated: number;
    podcastsGenerated: number;
  };
}

interface BatchDetailsData {
  seoCache?: {
    cacheVersion?: string;
    redditResearch?: {
      consolidatedOutline?: {
        consolidatedIntents: any[];
        overallTheme: string;
        targetAudience: string;
      };
      questions?: any[];
      subreddits?: string[];
      contentGaps?: any[];
    };
    locationAnalysis?: any;
    locationKeywords?: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

export default function MonitoringDashboard() {
  const [batchId, setBatchId] = useState<string>("");
  const [monitoringBatchId, setMonitoringBatchId] = useState<number | null>(null);
  const [numArticles, setNumArticles] = useState<number>(50);
  const [includeImages, setIncludeImages] = useState(true);
  const [includePodcasts, setIncludePodcasts] = useState(false);

  const MONITORING_ACTIVE = ["SUBMITTING", "QUEUED", "PROCESSING", "RUNNING", "IN_PROGRESS"];

  const { data: recentBatches } = useQuery<Array<{ id: number; coreTopic: string; status: string }>>({
    queryKey: ["/api/batches"],
  });

  // Auto-select the most recent active batch (or latest batch) on first load
  useEffect(() => {
    if (recentBatches && recentBatches.length > 0 && monitoringBatchId === null) {
      const active = recentBatches.find(b => MONITORING_ACTIVE.includes(b.status));
      const pick = active ?? recentBatches[0];
      setMonitoringBatchId(pick.id);
      setBatchId(String(pick.id));
    }
  }, [recentBatches]);

  // Fetch cost estimates
  const { data: costData, isLoading: costLoading } = useQuery<CostData>({
    queryKey: ["/api/monitoring/cost-calculator"],
  });

  // Fetch custom cost calculation
  const { data: customCostData, refetch: refetchCustomCost } = useQuery<CostData>({
    queryKey: ["/api/monitoring/cost-calculator", numArticles, includeImages, includePodcasts],
    enabled: false,
  });

  // Fetch batch monitoring data — poll every 6s (down from 3s), pause in background
  const { data: batchData, isLoading: batchLoading } = useQuery<BatchMonitoringData>({
    queryKey: monitoringBatchId !== null ? [`/api/monitoring/batch/${monitoringBatchId}`] : ["/api/monitoring/batch/null"],
    enabled: monitoringBatchId !== null,
    refetchInterval: 6000,
    refetchIntervalInBackground: false,
  });

  // Fetch batch details (includes Reddit research and SEO cache)
  // SAFETY: Only fetch when we have a valid batch ID (don't poll `/api/batches/null`)
  const { data: batchDetailsData } = useQuery<BatchDetailsData>({
    queryKey: [`/api/batches/${monitoringBatchId}`],
    enabled: monitoringBatchId !== null && monitoringBatchId > 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });

  const calculateCustomCost = async () => {
    await fetch("/api/monitoring/cost-calculator", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numArticles, includeImages, includePodcasts }),
    }).then(res => res.json()).then(data => {
      refetchCustomCost();
    });
  };

  const monitorBatch = () => {
    const id = parseInt(batchId);
    if (!isNaN(id)) {
      setMonitoringBatchId(id);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Production Monitoring Dashboard</h1>
          <p className="text-muted-foreground">Real-time metrics, cost tracking, and performance analytics</p>
        </div>
      </div>

      <Separator />

      {/* Cost Calculator Section */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card data-testid="card-cost-calculator">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              API Cost Calculator
            </CardTitle>
            <CardDescription>Estimate costs for typical workloads</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {costLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : costData && (
              <>
                <div className="space-y-2">
                  <h3 className="font-semibold">Standard Pricing (50 Articles)</h3>
                  <div className="text-3xl font-bold text-primary">{costData.summary.costPer50Articles}</div>
                  <p className="text-sm text-muted-foreground">
                    {costData.summary.costPerArticle} per article
                  </p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Per-Article Breakdown</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Title Generation:</span>
                      <span className="font-mono">{costData.summary.perArticleBreakdown.titleGeneration}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Content Generation:</span>
                      <span className="font-mono">{costData.summary.perArticleBreakdown.contentGeneration}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Review & Enhancement:</span>
                      <span className="font-mono">{costData.summary.perArticleBreakdown.reviewEnhancement}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Image Generation (5 images):</span>
                      <span className="font-mono">{costData.summary.perArticleBreakdown.imageGeneration}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Podcast Generation:</span>
                      <span className="font-mono">{costData.summary.perArticleBreakdown.podcastGeneration}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Volume Benchmarks</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(costData.benchmarks).map(([key, value]) => (
                      <div key={key} className="flex justify-between p-2 rounded-md bg-muted">
                        <span>{key}:</span>
                        <span className="font-mono font-semibold">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Custom Cost Calculator */}
        <Card data-testid="card-custom-calculator">
          <CardHeader>
            <CardTitle>Custom Cost Estimator</CardTitle>
            <CardDescription>Calculate costs for your specific needs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="num-articles">Number of Articles</Label>
              <Input
                id="num-articles"
                data-testid="input-num-articles"
                type="number"
                min="1"
                max="1000"
                value={numArticles}
                onChange={(e) => setNumArticles(parseInt(e.target.value) || 50)}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="include-images"
                data-testid="checkbox-include-images"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="include-images">Include Images (5 per article)</Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="include-podcasts"
                data-testid="checkbox-include-podcasts"
                checked={includePodcasts}
                onChange={(e) => setIncludePodcasts(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="include-podcasts">Include Podcasts</Label>
            </div>

            <Button 
              onClick={calculateCustomCost} 
              className="w-full"
              data-testid="button-calculate-cost"
            >
              Calculate Cost
            </Button>

            {customCostData?.batch && (
              <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary">
                <div className="text-2xl font-bold text-primary mb-2">
                  {customCostData.batch.totalCost}
                </div>
                <p className="text-sm text-muted-foreground">
                  {customCostData.batch.costPerArticle} per article
                </p>
                <div className="mt-2 text-xs text-muted-foreground">
                  {customCostData.batch.numArticles} articles
                  {customCostData.batch.includeImages && " + images"}
                  {customCostData.batch.includePodcasts && " + podcasts"}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Batch Monitoring Section */}
      <Card data-testid="card-batch-monitoring">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Live Batch Monitoring
          </CardTitle>
          <CardDescription>Track real-time progress and performance metrics</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recentBatches && recentBatches.length > 0 && (
            <Select
              value={monitoringBatchId?.toString() ?? ""}
              onValueChange={(val) => {
                setMonitoringBatchId(parseInt(val));
                setBatchId(val);
              }}
            >
              <SelectTrigger data-testid="select-recent-batch">
                <SelectValue placeholder="Select a recent batch…" />
              </SelectTrigger>
              <SelectContent>
                {recentBatches.slice(0, 15).map(b => (
                  <SelectItem key={b.id} value={b.id.toString()}>
                    #{b.id} — {b.coreTopic.slice(0, 45)}{b.coreTopic.length > 45 ? "…" : ""} ({b.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Or enter Batch ID manually"
              data-testid="input-batch-id"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && monitorBatch()}
            />
            <Button 
              onClick={monitorBatch}
              data-testid="button-monitor-batch"
            >
              Monitor
            </Button>
          </div>

          {batchLoading && (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}

          {batchData && batchData.liveStatus && (
            <div className="space-y-6">
              {/* Status Badge */}
              <div className="flex items-center gap-4">
                <Badge 
                  variant={batchData.liveStatus.status === "COMPLETE" ? "default" : "secondary"}
                  className="text-lg py-1 px-3"
                  data-testid="badge-batch-status"
                >
                  {batchData.liveStatus.status}
                </Badge>
                <div className="text-sm text-muted-foreground">
                  Batch #{batchData.liveStatus.batchId}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall Progress</span>
                  <span className="font-semibold" data-testid="text-progress-percentage">
                    {batchData.liveStatus.progress.toFixed(1)}%
                  </span>
                </div>
                <Progress value={batchData.liveStatus.progress} />
              </div>

              {/* Article Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">Completed</span>
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-articles-completed">
                    {batchData.liveStatus.articlesCompleted}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    of {batchData.liveStatus.articlesTotal}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex items-center gap-2 mb-1">
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    <span className="text-sm font-medium">In Progress</span>
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-articles-in-progress">
                    {batchData.liveStatus.articlesInProgress}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium">Failed</span>
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-articles-failed">
                    {batchData.liveStatus.articlesFailed}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">Current Cost</span>
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-current-cost">
                    ${batchData.liveStatus.currentCost.toFixed(4)}
                  </div>
                </div>
              </div>

              {/* Performance Metrics */}
              {batchData.performanceMetrics && (
                <div className="p-4 rounded-lg border">
                  <h3 className="font-semibold mb-3">Performance Metrics</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Avg Time/Article:</span>
                      <span className="ml-2 font-mono font-semibold">
                        {(batchData.performanceMetrics.averageTimePerArticle / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Duration:</span>
                      <span className="ml-2 font-mono font-semibold">
                        {(batchData.performanceMetrics.totalDuration / 60000).toFixed(1)}m
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Error Rate:</span>
                      <span className="ml-2 font-mono font-semibold">
                        {batchData.performanceMetrics.errorRate.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Workers:</span>
                      <span className="ml-2 font-mono font-semibold">
                        {batchData.performanceMetrics.concurrentWorkers}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Images Generated:</span>
                      <span className="ml-2 font-mono font-semibold">
                        {batchData.performanceMetrics.imagesGenerated}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Podcasts:</span>
                      <span className="ml-2 font-mono font-semibold">
                        {batchData.performanceMetrics.podcastsGenerated}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Reddit Research Insights - v3.0 with Phase 1 Consolidation */}
              {batchDetailsData?.seoCache?.redditResearch && (
                <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold text-lg">🔥 Phase 1: Consolidated Intent Outline</h3>
                    <Badge variant="secondary" className="ml-auto">
                      v{batchDetailsData.seoCache?.cacheVersion || '3.0'}
                    </Badge>
                  </div>
                  
                  {/* Phase 1 Consolidated Outline */}
                  {(batchDetailsData.seoCache?.redditResearch?.consolidatedOutline?.consolidatedIntents?.length ?? 0) > 0 && (
                    <div className="mb-4 p-3 rounded bg-background/50 border border-primary/10">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-sm">📋 AEO-Ready Article Structure</h4>
                        <Badge variant="outline" className="text-xs">
                          {batchDetailsData.seoCache!.redditResearch!.consolidatedOutline!.consolidatedIntents.length} themes
                        </Badge>
                      </div>
                      
                      {/* Overall Theme & Audience */}
                      <div className="text-xs text-muted-foreground mb-3">
                        <span className="font-medium">Theme:</span> {batchDetailsData.seoCache!.redditResearch!.consolidatedOutline!.overallTheme} • 
                        <span className="font-medium ml-2">Audience:</span> {batchDetailsData.seoCache!.redditResearch!.consolidatedOutline!.targetAudience}
                      </div>
                      
                      {/* Consolidated Intent Cards */}
                      <div className="space-y-3">
                        {batchDetailsData.seoCache!.redditResearch!.consolidatedOutline!.consolidatedIntents.slice(0, 5).map((intent: any, idx: number) => (
                          <div key={idx} className="p-3 rounded border border-primary/10 bg-background">
                            <div className="flex items-start gap-2 mb-2">
                              <Badge variant="secondary" className="text-xs shrink-0">
                                H2 #{idx + 1}
                              </Badge>
                              <div className="flex-1">
                                <div className="font-semibold text-sm text-foreground mb-1">
                                  {intent.h2Question}
                                </div>
                                <div className="flex flex-wrap gap-1 mb-2">
                                  <Badge variant="outline" className="text-xs">
                                    {intent.coreIntent}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    {intent.coveragePillar}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    • {intent.prevalence}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground italic border-l-2 border-primary pl-2">
                                  Experience Proof: {intent.experienceProof}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {batchDetailsData.seoCache!.redditResearch!.consolidatedOutline!.consolidatedIntents.length > 5 && (
                        <div className="text-xs text-muted-foreground mt-2 text-center">
                          +{batchDetailsData.seoCache!.redditResearch!.consolidatedOutline!.consolidatedIntents.length - 5} more themes
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Mined Questions */}
                  {batchDetailsData.seoCache.redditResearch.questions && batchDetailsData.seoCache.redditResearch.questions.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <span>Top Reddit Questions</span>
                        <Badge variant="outline" className="text-xs">
                          {batchDetailsData.seoCache.redditResearch.questions.length} questions
                        </Badge>
                      </h4>
                      <div className="space-y-1.5 text-sm">
                        {batchDetailsData.seoCache.redditResearch.questions.slice(0, 5).map((q: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 p-2 rounded bg-background/50">
                            <Badge variant="secondary" className="text-xs shrink-0 mt-0.5">
                              {q.upvotes} ↑
                            </Badge>
                            <div className="flex-1">
                              <span className="text-foreground">"{q.question}"</span>
                              <span className="text-muted-foreground ml-2 text-xs">
                                r/{q.subreddit}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Subreddit Sources */}
                  {batchDetailsData.seoCache.redditResearch.subreddits && batchDetailsData.seoCache.redditResearch.subreddits.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-medium text-sm mb-2">Subreddit Sources</h4>
                      <div className="flex flex-wrap gap-2">
                        {batchDetailsData.seoCache.redditResearch.subreddits.map((sub: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            r/{sub}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Content Gaps */}
                  {batchDetailsData.seoCache.redditResearch.contentGaps && batchDetailsData.seoCache.redditResearch.contentGaps.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <span>Content Gaps Identified</span>
                        <Badge variant="outline" className="text-xs">
                          {batchDetailsData.seoCache.redditResearch.contentGaps.length} gaps
                        </Badge>
                      </h4>
                      <div className="space-y-1 text-sm">
                        {batchDetailsData.seoCache.redditResearch.contentGaps.slice(0, 3).map((gap: any, idx: number) => (
                          <div key={idx} className="p-2 rounded bg-background/50 border-l-2 border-primary">
                            <div className="font-medium text-foreground">{gap.gap}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {gap.prevalence} mentions across {gap.subreddits.join(', ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Recent Errors */}
              {batchData.liveStatus.recentErrors.length > 0 && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <h3 className="font-semibold text-red-900">Recent Errors</h3>
                  </div>
                  <div className="space-y-2">
                    {batchData.liveStatus.recentErrors.map((error: any, idx: number) => (
                      <div key={idx} className="text-sm text-red-800">
                        <span className="font-mono">{new Date(error.timestamp).toLocaleTimeString()}</span>
                        {" - "}
                        <span>{error.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content Quality & Compliance Overview */}
      <Card data-testid="card-quality-compliance">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Content Quality &amp; Compliance
          </CardTitle>
          <CardDescription>
            EU AI Act disclosure, information-gain gate, and citation attribution thresholds applied to every article
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {/* EU AI Act */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-600" />
                <span className="font-semibold text-sm">EU AI Act Article 50</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Every completed article has an AI-generated content disclosure footer injected automatically before publishing. Tracks <code className="text-xs bg-muted px-1 rounded">ai_disclosure_included</code> per article.
              </p>
              <Badge variant="secondary" className="text-xs">Auto-injected</Badge>
            </div>

            {/* Information-Gain Gate */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-600" />
                <span className="font-semibold text-sm">Information-Gain Gate</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Bigram Jaccard novelty scorer measures how much new information each article adds beyond existing batch content.
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="default" className="text-xs">≥55 PASSED</Badge>
                <Badge variant="secondary" className="text-xs">35–54 FLAGGED</Badge>
                <Badge variant="destructive" className="text-xs">&lt;35 BLOCKED</Badge>
              </div>
            </div>

            {/* Citation Attribution */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-green-600" />
                <span className="font-semibold text-sm">Citation Attribution</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Citation probes query Gemini with article topics and measure content overlap. Score (0–100) reflects how much AI models draw from your content.
              </p>
              <Badge variant="outline" className="text-xs">Async probes, auto-updated</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
