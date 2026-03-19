"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FileText, Loader2, ExternalLink, Trash2, Home, RefreshCw, LogIn, Search, X } from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
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

interface Batch {
  id: number;
  coreTopic: string;
  status: string;
  numArticlesRequested: number;
  createdAt: string;
}

interface ArticleResult {
  id: number;
  title: string;
  word_count: number | null;
  location: string | null;
  seo_score: number | null;
  article_status: string;
}

export default function ContentLibrary() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: batches, isLoading, error, refetch, isFetching } = useQuery<Batch[]>({
    queryKey: ["/api/batches"],
  });

  const { data: allArticles, isLoading: articlesLoading } = useQuery<ArticleResult[]>({
    queryKey: ["/api/articles/list"],
    staleTime: 60_000,
  });

  const isAuthError =
    (error as any)?.status === 401 ||
    (error as any)?.message?.includes("401") ||
    (error as any)?.message?.includes("Authentication");

  const handleRefresh = async () => {
    await refetch();
    toast({
      title: "Refreshed",
      description: "Article list updated with latest statuses",
    });
  };

  const filteredArticles = useMemo(() => {
    if (!searchQuery.trim() || !allArticles) return [];
    const q = searchQuery.toLowerCase();
    return allArticles.filter((a) => a.title?.toLowerCase().includes(q));
  }, [searchQuery, allArticles]);

  const isSearching = searchQuery.trim().length > 0;

  const deleteBatchMutation = useMutation({
    mutationFn: async (batchId: number) => {
      return await apiRequest(`/api/batches/${batchId}`, {
        method: "DELETE",
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/batches"] });
      toast({
        title: "Batch deleted",
        description: `Batch and ${data.deletedArticlesCount} articles permanently removed from the system.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete batch",
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

  const hasBatches = batches && batches.length > 0;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-page-title">Content Library</h1>
            <p className="text-muted-foreground" data-testid="text-page-description">
              Browse and export your generated articles
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Link href="/home">
              <Button variant="default" data-testid="button-home">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search articles by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
            data-testid="input-article-search"
          />
          {isSearching && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              data-testid="button-clear-search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search results */}
        {isSearching ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" />
                Search Results
              </CardTitle>
              <CardDescription>
                {articlesLoading
                  ? "Searching..."
                  : `${filteredArticles.length} article${filteredArticles.length !== 1 ? "s" : ""} matching "${searchQuery}"`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {articlesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredArticles.length === 0 ? (
                <div className="text-center py-12">
                  <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="font-semibold mb-1">No articles found</p>
                  <p className="text-sm text-muted-foreground">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredArticles.map((article) => (
                    <div
                      key={article.id}
                      className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                      data-testid={`search-result-${article.id}`}
                    >
                      <div className="flex-1 min-w-0 mr-4">
                        <p className="font-medium truncate">{article.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {article.location && <span>{article.location} • </span>}
                          {article.word_count && <span>{article.word_count.toLocaleString()} words • </span>}
                          <span>{article.article_status}</span>
                        </p>
                      </div>
                      <Link href={`/content/${article.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-view-article-${article.id}`}>
                          <ExternalLink className="w-4 h-4 mr-2" />
                          View
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          /* Batch list */
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Generated Articles
              </CardTitle>
              <CardDescription>
                View all completed and in-progress content
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isAuthError ? (
                <div className="text-center py-12">
                  <LogIn className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold mb-2">Session expired</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your login session has ended. Please sign back in — your articles are all still here.
                  </p>
                  <Link href="/login">
                    <Button data-testid="button-goto-login">
                      <LogIn className="w-4 h-4 mr-2" />
                      Sign Back In
                    </Button>
                  </Link>
                </div>
              ) : !hasBatches ? (
                <div className="text-center py-12">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold mb-2">No articles yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Generate your first batch of articles from the dashboard
                  </p>
                  <Link href="/dashboard">
                    <Button data-testid="button-goto-dashboard">
                      Go to Dashboard
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {batches.map((batch) => (
                    <div
                      key={batch.id}
                      className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                      data-testid={`batch-item-${batch.id}`}
                    >
                      <div className="flex-1">
                        <h3 className="font-semibold mb-1">{batch.coreTopic}</h3>
                        <p className="text-sm text-muted-foreground">
                          {batch.numArticlesRequested} articles • Created {new Date(batch.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={batch.status === "COMPLETE" ? "default" : "secondary"}>
                          {batch.status}
                        </Badge>
                        <Link href={`/batches/${batch.id}`}>
                          <Button variant="outline" size="sm" data-testid={`button-view-batch-${batch.id}`}>
                            <ExternalLink className="w-4 h-4 mr-2" />
                            View
                          </Button>
                        </Link>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              data-testid={`button-delete-batch-${batch.id}`}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Batch
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Batch and All Articles?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this batch and all {batch.numArticlesRequested} associated articles from the system. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel data-testid={`button-cancel-delete-batch-${batch.id}`}>
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteBatchMutation.mutate(batch.id)}
                                disabled={deleteBatchMutation.isPending}
                                data-testid={`button-confirm-delete-batch-${batch.id}`}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleteBatchMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Delete Permanently
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
