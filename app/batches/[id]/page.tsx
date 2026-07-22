"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { use, Suspense, useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, ExternalLink, Sparkles, Trash2, RefreshCw, ImagePlus, Link2, Zap, ImageIcon, Clock, Share2, Globe, Check, WifiOff, RotateCcw, AlertCircle, Square, GitBranch, MoreHorizontal, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Article {
  id: number;
  articleStatus: string;
  chosenTitle: string;
  seoTitle: string | null;
  slug: string | null;
  wordCount: number | null;
  heroImageUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Batch {
  id: number;
  userId: number;
  coreTopic: string;
  targetUrl: string;
  status: string;
  numArticlesRequested: number;
  titlePoolJson?: {
    titles: string[];
    primaryKeywords?: string[];
    contentStrategy?: string;
  } | null;
  createdAt: string;
  completedAt: string | null;
}

interface BatchResponse {
  batch: Batch;
  articles: Article[];
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    failed: number;
  };
}

interface PublishingConnection {
  id: number;
  name: string;
  channel: string;
  baseUrl: string;
  status: string;
}

function BatchDetailContent({ paramsPromise }: { paramsPromise: Promise<{ id: string }> }) {
  const resolvedParams = use(paramsPromise);
  const batchId = resolvedParams.id;
  const { toast } = useToast();
  const router = useRouter();
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [publishProgress, setPublishProgress] = useState<{ done: number; total: number } | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // Track when we first observed this batch as RUNNING for adaptive poll throttling
  const runningStartRef = useRef<number | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<BatchResponse>({
    queryKey: [`/api/batches/${batchId}`],
    refetchInterval: (query) => {
      const batchData = query.state.data as BatchResponse | undefined;
      if (batchData?.batch.status !== "RUNNING") return false;
      // Record the first moment we see it running
      if (!runningStartRef.current) runningStartRef.current = Date.now();
      const elapsedMs = Date.now() - runningStartRef.current;
      // Adaptive: 3s → 5s (after 1 min) → 10s (after 5 min)
      if (elapsedMs < 60_000) return 3000;
      if (elapsedMs < 300_000) return 5000;
      return 10_000;
    },
    refetchIntervalInBackground: false,
  });

  const handleRefresh = async () => {
    await refetch();
    toast({
      title: "Refreshed",
      description: "Article statuses updated",
    });
  };

  const deleteBatchMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}`, {
        method: "DELETE",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Batch deleted",
        description: `Batch and ${data.deletedArticlesCount} articles permanently removed.`,
      });
      router.push("/content");
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete batch",
        variant: "destructive",
      });
    },
  });

  const cancelBatchMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/cancel`, { method: "POST" });
    },
    onSuccess: (data: any) => {
      toast({ title: "Generation stopped", description: data.message || "Batch cancelled." });
      queryClient.invalidateQueries({ queryKey: [`/api/batches/${batchId}`] });
    },
    onError: (error) => {
      toast({
        title: "Could not stop generation",
        description: error instanceof Error ? error.message : "Failed to cancel batch",
        variant: "destructive",
      });
    },
  });

  const regenerateImagesMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/regenerate-images`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Image regeneration started",
        description: data.message || `Regenerating images for ${data.regenerated} articles`,
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Regeneration failed",
        description: error instanceof Error ? error.message : "Failed to regenerate images",
        variant: "destructive",
      });
    },
  });

  const fixHyperlinksMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/fix-hyperlinks`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Hyperlinks fixed",
        description: `Fixed ${data.summary?.fixed || 0} articles, skipped ${data.summary?.skipped || 0}`,
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Fix failed",
        description: error instanceof Error ? error.message : "Failed to fix hyperlinks",
        variant: "destructive",
      });
    },
  });

  const forceReinjectMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/fix-hyperlinks?force=true`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Hyperlinks re-injected",
        description: `Stripped city-name anchors and re-injected quality links in ${data.summary?.fixed || 0} article(s)`,
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Force re-inject failed",
        description: error instanceof Error ? error.message : "Failed to force re-inject hyperlinks",
        variant: "destructive",
      });
    },
  });

  // NEW: Enterprise Keyword Hyperlink Pipeline (Stage 1-3)
  const keywordHyperlinkMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/apply-keyword-hyperlinks`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Keyword hyperlinks applied",
        description: `Applied ${data.summary?.totalKeywordsLinked || 0} keyword links to ${data.summary?.fixed || 0} articles (${data.keywords?.total || 0} keywords extracted)`,
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Keyword hyperlinking failed",
        description: error instanceof Error ? error.message : "Failed to apply keyword hyperlinks",
        variant: "destructive",
      });
    },
  });

  // Fix Image Captions - replaces figcaptions with company URL
  const fixImageCaptionsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/fix-image-captions`, {
        method: "POST",
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Image captions fixed",
        description: `Fixed ${data.summary?.fixed || 0} articles, skipped ${data.summary?.skipped || 0}. Company URL now appears under images.`,
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Fix failed",
        description: error instanceof Error ? error.message : "Failed to fix image captions",
        variant: "destructive",
      });
    },
  });

  const retryArticleMutation = useMutation({
    mutationFn: async (articleId: number) => {
      return await apiRequest("/api/admin/requeue-failed", {
        method: "POST",
        body: JSON.stringify({ articleIds: [articleId] }),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Article queued for retry",
        description: data.message || "Article is being retried.",
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : "Failed to retry article",
        variant: "destructive",
      });
    },
  });

  const { data: connectionsData } = useQuery<{ success: boolean; data: PublishingConnection[] }>({
    queryKey: ['/api/publishing/connections'],
  });
  const activeConnections = (connectionsData?.data || []).filter(c => c.status !== 'error');

  const publishBatchMutation = useMutation({
    mutationFn: async ({ connectionId, articleIds }: { connectionId: number; articleIds: number[] }) => {
      setPublishProgress({ done: 0, total: articleIds.length });
      let done = 0;
      for (const articleId of articleIds) {
        await apiRequest('/api/publishing/jobs', {
          method: 'POST',
          body: JSON.stringify({ connectionId, contentType: 'article', contentId: articleId }),
        });
        done++;
        setPublishProgress({ done, total: articleIds.length });
      }
      return { done };
    },
    onSuccess: ({ done }) => {
      toast({
        title: "Batch publishing started",
        description: `${done} article(s) queued for publishing. Track status in the publishing dashboard.`,
      });
      setPublishProgress(null);
      queryClient.invalidateQueries({ queryKey: ['/api/publishing/jobs'] });
    },
    onError: (error) => {
      setPublishProgress(null);
      toast({
        title: "Publishing failed",
        description: error instanceof Error ? error.message : "Failed to publish articles",
        variant: "destructive",
      });
    },
  });

  const launchJourneyMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/batches/${batchId}/launch-journey`, { method: "POST" });
    },
    onSuccess: (res: any) => {
      toast({
        title: "Journey launched",
        description: res?.message ?? "Local SEO Journey created and activated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Launch failed",
        description: error instanceof Error ? error.message : "Failed to launch journey",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Batch not found</CardTitle>
            <CardDescription>The requested batch could not be loaded.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { batch, articles, summary } = data;

  const hasTitlePool = batch.titlePoolJson && batch.titlePoolJson.titles && batch.titlePoolJson.titles.length > 0;
  const isPending = batch.status === "PENDING";
  
  const completedArticles = articles.filter(a => ["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"].includes(a.articleStatus));
  const articlesWithoutImages = completedArticles.filter(a => !a.heroImageUrl || a.heroImageUrl === "");
  const hasArticlesWithoutImages = articlesWithoutImages.length > 0;

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ── Header: two-row layout to prevent flex collapse on long titles ── */}
        <div className="space-y-3">
          {/* Row 1: Title block + status badge */}
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold leading-snug" data-testid="text-batch-title">{batch.coreTopic}</h1>
              {batch.targetUrl && (
                <p className="text-sm text-muted-foreground mt-1 truncate" data-testid="text-batch-url">{batch.targetUrl}</p>
              )}
            </div>
            <Badge variant="secondary" className="shrink-0 mt-1" data-testid="badge-batch-status">{batch.status}</Badge>
          </div>
          {/* Row 2: Action buttons – wrap on narrow screens */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {isPending && hasTitlePool && (
              <Link href={`/batches/${batch.id}/select`}>
                <Button data-testid="button-select-titles">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Select Titles to Generate
                </Button>
              </Link>
            )}
            {(batch.status === "COMPLETE" || batch.status === "PARTIAL_COMPLETE") && summary.completed > 0 && (
              <Button
                onClick={() => launchJourneyMutation.mutate()}
                disabled={launchJourneyMutation.isPending}
                data-testid="button-launch-journey"
              >
                {launchJourneyMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <GitBranch className="w-4 h-4 mr-2" />
                )}
                Launch Journey
              </Button>
            )}
            {batch.status === "RUNNING" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" data-testid="button-stop-generation" disabled={cancelBatchMutation.isPending}>
                    {cancelBatchMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4 mr-2" />
                    )}
                    Stop Generation
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Stop article generation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will cancel all pending articles in this batch. Articles already in progress may still complete. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-stop">Keep Running</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => cancelBatchMutation.mutate()}
                      data-testid="button-confirm-stop"
                    >
                      Stop Generation
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {/* Delete moved into overflow menu to de-clutter the action bar */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-batch-more">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setShowDeleteDialog(true)}
                  className="text-destructive focus:text-destructive"
                  data-testid="dropdown-delete-batch"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Batch
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Delete batch confirmation dialog (controlled) */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this batch?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the batch and all {summary.total} associated articles. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteBatchMutation.mutate()}
                disabled={deleteBatchMutation.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteBatchMutation.isPending ? "Deleting..." : "Delete Permanently"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── PENDING hero card: shown instead of empty stats when no articles yet ── */}
        {isPending && articles.length === 0 && hasTitlePool && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-col items-center text-center py-10 gap-4">
              <Sparkles className="w-12 h-12 text-primary" />
              <div>
                <p className="text-lg font-semibold mb-1">
                  {batch.titlePoolJson!.titles.length} titles ready for selection
                </p>
                <p className="text-sm text-muted-foreground">
                  Choose which articles to generate from your title pool.
                </p>
              </div>
              <Link href={`/batches/${batch.id}/select`}>
                <Button size="lg" data-testid="button-select-titles-hero">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Select Titles to Generate
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Stats tiles — hidden for PENDING batches with no articles yet (all zeros is confusing) */}
        {!(isPending && articles.length === 0) && (
          <div className="grid gap-4 md:grid-cols-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Total</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-count">{summary.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600" data-testid="text-completed-count">{summary.completed}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600" data-testid="text-inprogress-count">{summary.inProgress}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Pending</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-muted-foreground" data-testid="text-pending-count">{summary.pending}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-destructive" data-testid="text-failed-count">{summary.failed}</div>
              </CardContent>
            </Card>
          </div>
        )}
        
        {batch.status === "RUNNING" && summary.total > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Clock className="w-4 h-4 animate-pulse text-yellow-600" />
                Generation Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress 
                value={summary.total > 0 ? ((summary.completed + summary.failed) / summary.total) * 100 : 0} 
                className="h-3"
                data-testid="progress-bar"
              />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span data-testid="text-progress-fraction">
                  {summary.completed} of {summary.total} articles completed
                </span>
                <span data-testid="text-progress-percentage">
                  {summary.total > 0 ? Math.round(((summary.completed + summary.failed) / summary.total) * 100) : 0}%
                </span>
              </div>
              {summary.inProgress > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {summary.inProgress} article(s) currently being generated... Auto-refreshing every 5 seconds.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {summary.failed > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-4 h-4" />
                Failed Articles
              </CardTitle>
              <CardDescription>
                {summary.failed} article(s) failed due to API quota limits or errors. You can requeue them to retry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={async () => {
                  const failedArticles = articles.filter(a => a.articleStatus === "FAILED");
                  const token = sessionStorage.getItem("auth_token");
                  const response = await fetch("/api/admin/requeue-failed", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ articleIds: failedArticles.map(a => a.id) }),
                  });
                  if (response.ok) {
                    refetch();
                  }
                }}
                variant="destructive"
                data-testid="button-requeue-failed"
              >
                Requeue {summary.failed} Failed Article(s)
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ── Batch Tools: all post-generation actions in one neutral card ── */}
        {(completedArticles.length > 0 || hasArticlesWithoutImages) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                Batch Tools
              </CardTitle>
              <CardDescription>
                Post-generation actions for your {completedArticles.length} completed article(s).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {hasArticlesWithoutImages && (
                <div className="space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <ImagePlus className="w-4 h-4" />
                    Missing Images
                    <span className="text-xs text-muted-foreground font-normal">— {articlesWithoutImages.length} article(s) are missing hero images</span>
                  </p>
                  <Button
                    onClick={() => regenerateImagesMutation.mutate()}
                    disabled={regenerateImagesMutation.isPending}
                    variant="outline"
                    size="sm"
                    data-testid="button-regenerate-images"
                  >
                    {regenerateImagesMutation.isPending ? (
                      <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Generating...</>
                    ) : (
                      <><ImagePlus className="w-3 h-3 mr-2" />Regenerate {articlesWithoutImages.length} Image(s)</>
                    )}
                  </Button>
                </div>
              )}
              {completedArticles.length > 0 && (
                <>
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      Keyword Hyperlinks
                      <span className="text-xs text-muted-foreground font-normal">— Recommended first step</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Extracts 25 long-phrase keywords and applies hyperlinks throughout article body and FAQ sections.
                    </p>
                    <Button
                      onClick={() => keywordHyperlinkMutation.mutate()}
                      disabled={keywordHyperlinkMutation.isPending}
                      variant="outline"
                      size="sm"
                      data-testid="button-apply-keyword-hyperlinks"
                    >
                      {keywordHyperlinkMutation.isPending ? (
                        <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Applying hyperlinks...</>
                      ) : (
                        <><Zap className="w-3 h-3 mr-2" />Apply Keyword Hyperlinks ({completedArticles.length})</>
                      )}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      Fix Hyperlinks & Hashtags
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Apply stored hyperlinks and hashtags, or force re-inject to replace bare city-name anchors with semantic phrases.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => fixHyperlinksMutation.mutate()}
                        disabled={fixHyperlinksMutation.isPending || forceReinjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        data-testid="button-fix-hyperlinks"
                      >
                        {fixHyperlinksMutation.isPending ? (
                          <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Fixing...</>
                        ) : (
                          <><Link2 className="w-3 h-3 mr-2" />Fix Hyperlinks ({completedArticles.length})</>
                        )}
                      </Button>
                      <Button
                        onClick={() => forceReinjectMutation.mutate()}
                        disabled={fixHyperlinksMutation.isPending || forceReinjectMutation.isPending}
                        variant="outline"
                        size="sm"
                        data-testid="button-force-reinject-hyperlinks"
                      >
                        {forceReinjectMutation.isPending ? (
                          <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Re-injecting...</>
                        ) : (
                          <><Link2 className="w-3 h-3 mr-2" />Force Re-inject ({completedArticles.length})</>
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      Fix Image Captions
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Replace image captions with your company URL and convert image paths to absolute URLs.
                    </p>
                    <Button
                      onClick={() => fixImageCaptionsMutation.mutate()}
                      disabled={fixImageCaptionsMutation.isPending}
                      variant="outline"
                      size="sm"
                      data-testid="button-fix-image-captions"
                    >
                      {fixImageCaptionsMutation.isPending ? (
                        <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Fixing captions...</>
                      ) : (
                        <><ImageIcon className="w-3 h-3 mr-2" />Fix Image Captions ({completedArticles.length})</>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {completedArticles.length > 0 && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="w-5 h-5" />
                Publish All Articles to Website
              </CardTitle>
              <CardDescription>
                Send all {completedArticles.length} completed article(s) to your connected receiver. Requires a website publishing connection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeConnections.length === 0 ? (
                <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed">
                  <WifiOff className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">No connections found</p>
                    <p className="text-xs text-muted-foreground">Set up a publishing connection first.</p>
                  </div>
                  <Link href="/settings/publishing">
                    <Button variant="outline" size="sm" data-testid="link-batch-setup-connections">
                      Set Up
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {activeConnections.map(conn => (
                      <div
                        key={conn.id}
                        onClick={() => setSelectedConnectionId(conn.id)}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover-elevate ${selectedConnectionId === conn.id ? 'border-primary bg-primary/5' : 'border-border'}`}
                        data-testid={`connection-select-${conn.id}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selectedConnectionId === conn.id ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                          {selectedConnectionId === conn.id ? <Check className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{conn.name}</p>
                          <p className="text-xs text-muted-foreground">{conn.channel} · {conn.baseUrl}</p>
                        </div>
                        <Badge variant={conn.status === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
                          {conn.status === 'active' ? 'Verified' : conn.status === 'pending' ? 'Unverified' : conn.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {publishProgress && (
                    <div className="space-y-1">
                      <Progress value={(publishProgress.done / publishProgress.total) * 100} className="h-2" />
                      <p className="text-xs text-muted-foreground">Queuing {publishProgress.done} of {publishProgress.total} articles...</p>
                    </div>
                  )}
                  <Button
                    onClick={() => {
                      if (selectedConnectionId) {
                        publishBatchMutation.mutate({
                          connectionId: selectedConnectionId,
                          articleIds: completedArticles.map(a => a.id),
                        });
                      }
                    }}
                    disabled={!selectedConnectionId || publishBatchMutation.isPending}
                    data-testid="button-publish-all-articles"
                  >
                    {publishBatchMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Publishing...</>
                    ) : (
                      <><Share2 className="w-4 h-4 mr-2" />Publish {completedArticles.length} Article(s)</>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Track jobs in <Link href="/settings/publishing/jobs" className="underline">Publishing Dashboard</Link>.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Articles ({articles.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {articles.length > 0 ? (
              <div className="space-y-3">
                {articles.map((article) => (
                <div
                  key={article.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                  data-testid={`article-item-${article.id}`}
                >
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">{article.chosenTitle}</h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {article.wordCount && <span>{article.wordCount} words</span>}
                      {article.slug && <span className="font-mono">{article.slug}</span>}
                    </div>
                    {["FAILED", "REFORMAT_FAILED"].includes(article.articleStatus) && article.errorMessage && (
                      <p className="mt-1 text-xs text-destructive flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{article.errorMessage}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      ["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"].includes(article.articleStatus)
                        ? "default"
                        : ["FAILED", "REFORMAT_FAILED"].includes(article.articleStatus)
                        ? "destructive"
                        : article.articleStatus === "REFORMATTING"
                        ? "secondary"
                        : "secondary"
                    }>
                      {["FAILED", "REFORMAT_FAILED"].includes(article.articleStatus) && <AlertCircle className="w-3 h-3 mr-1" />}
                      {article.articleStatus === "REFORMATTING" ? "Reformatting…" : article.articleStatus}
                    </Badge>
                    {["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"].includes(article.articleStatus) && article.wordCount && (
                      <Link href={`/content/${article.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-view-article-${article.id}`}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          View & Edit
                        </Button>
                      </Link>
                    )}
                    {["FAILED", "REFORMAT_FAILED"].includes(article.articleStatus) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryArticleMutation.mutate(article.id)}
                        disabled={retryArticleMutation.isPending}
                        data-testid={`button-retry-article-${article.id}`}
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function BatchDetail({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <BatchDetailContent paramsPromise={params} />
    </Suspense>
  );
}
