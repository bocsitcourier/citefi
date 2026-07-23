"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, CheckCircle2, Clock, Zap, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardData {
  team: { id: number; name: string; isClientTeam: boolean };
  credits: { balance: number };
  articles: { total: number; published: number; draft: number };
  recentBatches: Array<{
    id: number;
    publicId: string;
    status: string;
    totalArticles: number;
    completedArticles: number;
    createdAt: string;
  }>;
}

interface ArticleRow {
  id: number;
  publicId: string;
  title: string;
  status: string;
  seoScore: number | null;
  wordCount: number | null;
  createdAt: string;
  publishedAt: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-muted text-muted-foreground",
    COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    FAILED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? map.draft}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace("_", " ")}
    </span>
  );
}

export default function ClientDashboardPage() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/client/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/client/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: articlesData, isLoading: articlesLoading } = useQuery<{ articles: ArticleRow[] }>({
    queryKey: ["/api/client/articles"],
    queryFn: async () => {
      const res = await fetch("/api/client/articles?limit=20", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Content Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            {data?.team.name ?? "Your team"} — read-only content overview
          </p>
        </div>
        {data?.team.isClientTeam && (
          <Button variant="outline" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Total Articles</p>
            </div>
            <p className="text-2xl font-bold">{data?.articles.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <p className="text-sm text-muted-foreground">Published</p>
            </div>
            <p className="text-2xl font-bold">{data?.articles.published ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Drafts</p>
            </div>
            <p className="text-2xl font-bold">{data?.articles.draft ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-yellow-500" />
              <p className="text-sm text-muted-foreground">Credits</p>
            </div>
            <p className="text-2xl font-bold">{data?.credits.balance.toLocaleString() ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent batches */}
      {(data?.recentBatches?.length ?? 0) > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Recent Generation Batches
          </h2>
          <div className="grid gap-2">
            {data!.recentBatches.map((batch) => (
              <Card key={batch.id} data-testid={`card-batch-${batch.id}`}>
                <CardContent className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={batch.status} />
                      <span className="text-sm">
                        {batch.completedArticles} / {batch.totalArticles} articles
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(batch.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Articles list */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Recent Articles
        </h2>
        {articlesLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (articlesData?.articles.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p>No articles generated yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {articlesData!.articles.map((article) => (
              <Card key={article.id} data-testid={`card-article-${article.id}`}>
                <CardContent className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{article.title}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <StatusBadge status={article.status} />
                        {article.wordCount && (
                          <span className="text-xs text-muted-foreground">{article.wordCount.toLocaleString()} words</span>
                        )}
                        {article.seoScore != null && (
                          <span className="text-xs text-muted-foreground">SEO {article.seoScore}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(article.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
