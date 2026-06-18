"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, FileText, CheckCircle2, Edit3, Zap, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClientDashboard {
  team: {
    id: number;
    name: string;
    isClientTeam: boolean;
  };
  credits: {
    balance: number;
  };
  articles: {
    total: number;
    published: number;
    draft: number;
  };
  recentBatches: Array<{
    id: number;
    publicId: string;
    status: string;
    totalArticles: number;
    completedArticles: number;
    createdAt: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const BATCH_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  completed: "default",
  processing: "secondary",
  pending: "outline",
  failed: "destructive",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientDashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const { data, isLoading, isError } = useQuery<ClientDashboard>({
    queryKey: ["/api/client/dashboard"],
    queryFn: () =>
      fetch("/api/client/dashboard").then((r) => {
        if (!r.ok) throw new Error("Failed to load dashboard");
        return r.json();
      }),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (isAuthLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Failed to load client dashboard. Please refresh and try again.
      </div>
    );
  }

  const { team, credits, articles, recentBatches } = data;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-team-name">
            {team.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {team.isClientTeam ? "Client team dashboard" : "Team dashboard"} · read-only view
          </p>
        </div>
        <Button asChild variant="outline" size="sm" data-testid="link-view-articles">
          <Link href="/content">
            <ExternalLink className="h-4 w-4 mr-2" />
            View all content
          </Link>
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Credits</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${credits.balance <= 0 ? "text-destructive" : credits.balance <= 20 ? "text-yellow-600 dark:text-yellow-400" : ""}`}
              data-testid="text-credit-balance"
            >
              {credits.balance.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Available credits</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Articles</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-articles">
              {articles.total.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Published</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-published-count">
              {articles.published.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {articles.total > 0
                ? `${Math.round((articles.published / articles.total) * 100)}% of total`
                : "No articles yet"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Drafts</CardTitle>
            <Edit3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-draft-count">
              {articles.draft.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting publish</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Batches */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Batches</CardTitle>
          <CardDescription>Your last 5 content generation runs</CardDescription>
        </CardHeader>
        <CardContent>
          {recentBatches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No batches yet. Start generating content to see activity here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Progress</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBatches.map((batch) => {
                  const pct =
                    batch.totalArticles > 0
                      ? Math.round((batch.completedArticles / batch.totalArticles) * 100)
                      : 0;
                  return (
                    <TableRow key={batch.id} data-testid={`row-batch-${batch.id}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {batch.publicId ?? `#${batch.id}`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={BATCH_STATUS_VARIANT[batch.status] ?? "outline"}
                          data-testid={`badge-batch-status-${batch.id}`}
                        >
                          {batch.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {batch.completedArticles}/{batch.totalArticles}
                        {batch.totalArticles > 0 && ` (${pct}%)`}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {relativeTime(batch.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Low credit nudge */}
      {credits.balance <= 20 && (
        <Card className="border-yellow-200 dark:border-yellow-900/40 bg-yellow-50/30 dark:bg-yellow-900/10">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3">
                <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm text-yellow-900 dark:text-yellow-300">
                    {credits.balance <= 0 ? "No credits remaining" : `Only ${credits.balance} credits left`}
                  </p>
                  <p className="text-xs text-yellow-800/70 dark:text-yellow-400/70 mt-0.5">
                    Top up or upgrade your plan to continue generating content.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" data-testid="link-upgrade-cta">
                <Link href="/settings/billing">Manage billing</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
