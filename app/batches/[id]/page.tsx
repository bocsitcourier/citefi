"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { use, Suspense, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, ExternalLink, Sparkles, Home, Trash2, RefreshCw, ImagePlus, Link2, Zap, ImageIcon, Clock, Share2, Globe, Check, WifiOff, RotateCcw, AlertCircle } from "lucide-react";
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

  const { data, isLoading, error, refetch, isFetching } = useQuery<BatchResponse>({
    queryKey: [`/api/batches/${batchId}`],
    refetchInterval: (query) => {
      // Auto-poll every 5 seconds when batch is actively running
      const batchData = query.state.data as BatchResponse | undefined;
      return batchData?.batch.status === "RUNNING" ? 5000 : false;
    },
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
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2" data-testid="text-batch-title">{batch.coreTopic}</h1>
            <p className="text-muted-foreground" data-testid="text-batch-url">{batch.targetUrl}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Link href="/home">
              <Button variant="outline" data-testid="button-home">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
            {isPending && hasTitlePool && (
              <Link href={`/batches/${batch.id}/select`}>
                <Button data-testid="button-select-titles" size="lg">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Select Titles to Generate
                </Button>
              </Link>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-delete-batch">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Batch
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this batch?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the batch "{batch.coreTopic}" and all {summary.total} associated articles. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteBatchMutation.mutate()}
                    disabled={deleteBatchMutation.isPending}
                    className="bg-destructive hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    {deleteBatchMutation.isPending ? "Deleting..." : "Delete Permanently"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Badge data-testid="badge-batch-status">{batch.status}</Badge>
          </div>
        </div>

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
              <div className="text-2xl font-bold text-gray-600" data-testid="text-pending-count">{summary.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Failed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600" data-testid="text-failed-count">{summary.failed}</div>
            </CardContent>
          </Card>
        </div>
        
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
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/10 dark:border-red-900">
            <CardHeader>
              <CardTitle className="text-red-800 dark:text-red-200">⚠️ Failed Articles</CardTitle>
              <CardDescription>
                {summary.failed} article(s) failed due to API quota limits or errors. You can requeue them to retry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={async () => {
                  const failedArticles = articles.filter(a => a.articleStatus === "FAILED");
                  const token = localStorage.getItem("auth_token");
                  const response = await fetch("/api/admin/requeue-failed", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ articleIds: failedArticles.map(a => a.id) }),
                  });
                  if (response.ok) {
                    window.location.reload();
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

        {hasArticlesWithoutImages && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/10 dark:border-amber-900">
            <CardHeader>
              <CardTitle className="text-amber-800 dark:text-amber-200 flex items-center gap-2">
                <ImagePlus className="w-5 h-5" />
                Missing Images
              </CardTitle>
              <CardDescription>
                {articlesWithoutImages.length} completed article(s) are missing hero images. This may have occurred due to a previous configuration issue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => regenerateImagesMutation.mutate()}
                disabled={regenerateImagesMutation.isPending}
                variant="default"
                data-testid="button-regenerate-images"
              >
                {regenerateImagesMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <ImagePlus className="w-4 h-4 mr-2" />
                    Regenerate Images for {articlesWithoutImages.length} Article(s)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {completedArticles.length > 0 && (
          <>
            {/* NEW: Enterprise Keyword Hyperlink Pipeline */}
            <Card className="border-green-200 bg-green-50 dark:bg-green-950/10 dark:border-green-900">
              <CardHeader>
                <CardTitle className="text-green-800 dark:text-green-200 flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Apply Long-Phrase Keyword Hyperlinks (RECOMMENDED)
                </CardTitle>
                <CardDescription>
                  Enterprise 3-stage pipeline: Extracts 25 business-specific long-phrase keywords (4-10 words), then programmatically applies hyperlinks throughout article body AND FAQ sections. This is the permanent fix for missing hyperlinks.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => keywordHyperlinkMutation.mutate()}
                  disabled={keywordHyperlinkMutation.isPending}
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-apply-keyword-hyperlinks"
                >
                  {keywordHyperlinkMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Extracting keywords & applying hyperlinks...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 mr-2" />
                      Apply Keyword Hyperlinks to {completedArticles.length} Article(s)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Legacy Fix Hyperlinks */}
            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/10 dark:border-blue-900">
              <CardHeader>
                <CardTitle className="text-blue-800 dark:text-blue-200 flex items-center gap-2">
                  <Link2 className="w-5 h-5" />
                  Fix Hyperlinks & Hashtags
                </CardTitle>
                <CardDescription>
                  Apply stored hyperlinks and hashtags to article HTML. Use "Fix" for articles with missing links, or "Force Re-inject" to strip bare city-name anchors and replace with 4-7 word semantic phrases.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button
                  onClick={() => fixHyperlinksMutation.mutate()}
                  disabled={fixHyperlinksMutation.isPending || forceReinjectMutation.isPending}
                  variant="outline"
                  data-testid="button-fix-hyperlinks"
                >
                  {fixHyperlinksMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Fixing...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      Fix Hyperlinks ({completedArticles.length})
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => forceReinjectMutation.mutate()}
                  disabled={fixHyperlinksMutation.isPending || forceReinjectMutation.isPending}
                  variant="outline"
                  data-testid="button-force-reinject-hyperlinks"
                >
                  {forceReinjectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Re-injecting...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      Force Re-inject Semantic Links ({completedArticles.length})
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Fix Image Captions - replaces descriptions with company URL */}
            <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950/10 dark:border-purple-900">
              <CardHeader>
                <CardTitle className="text-purple-800 dark:text-purple-200 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  Fix Image Captions
                </CardTitle>
                <CardDescription>
                  Replace image descriptions with your company URL. Also converts image URLs to absolute paths so they work when copy-pasted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => fixImageCaptionsMutation.mutate()}
                  disabled={fixImageCaptionsMutation.isPending}
                  variant="outline"
                  data-testid="button-fix-image-captions"
                >
                  {fixImageCaptionsMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Fixing image captions...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Fix Image Captions for {completedArticles.length} Article(s)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </>
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
            {isPending && hasTitlePool && articles.length === 0 && (
              <div className="text-center py-8 space-y-4">
                <div className="text-muted-foreground">
                  <p className="mb-2">This batch has {batch.titlePoolJson!.titles.length} generated titles ready for selection.</p>
                  <p>Click "Select Titles to Generate" above to choose which articles to create.</p>
                </div>
              </div>
            )}
            {articles.length > 0 && (
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
                    {article.articleStatus === "FAILED" && article.errorMessage && (
                      <p className="mt-1 text-xs text-destructive flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{article.errorMessage}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"].includes(article.articleStatus) ? "default" : article.articleStatus === "FAILED" ? "destructive" : "secondary"}>
                      {article.articleStatus === "FAILED" && <AlertCircle className="w-3 h-3 mr-1" />}
                      {article.articleStatus}
                    </Badge>
                    {["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"].includes(article.articleStatus) && article.wordCount && (
                      <Link href={`/content/${article.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-view-article-${article.id}`}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          View & Edit
                        </Button>
                      </Link>
                    )}
                    {article.articleStatus === "FAILED" && (
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
            )}
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
