"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Activity, 
  AlertTriangle, 
  FileText, 
  TrendingUp, 
  Users, 
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw
} from "lucide-react";
import Link from "next/link";

interface DashboardData {
  summary: {
    totalBatches: number;
    totalArticles: number;
    totalUsers: number;
    unresolvedErrors: number;
    pendingApprovals: number;
  };
  batchStatus: Record<string, number>;
  articleStatus: Record<string, number>;
  activeArticles: any[];
  recentBatches: any[];
  recentEvents: any[];
}

export default function AdminDashboard() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, refetch } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard"],
    refetchInterval: autoRefresh ? 10000 : false, // Refresh every 10 seconds
  });

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case "COMPLETE":
        return "default";
      case "RUNNING":
      case "IN_PROGRESS":
      case "GEMINI_DONE":
      case "GPT_DONE":
        return "secondary";
      case "PENDING":
        return "outline";
      case "FAILED":
        return "destructive";
      default:
        return "outline";
    }
  };

  const getEventIcon = (eventType: string) => {
    if (eventType.includes("COMPLETE")) return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (eventType.includes("FAILED")) return <XCircle className="w-4 h-4 text-red-600" />;
    if (eventType.includes("START")) return <Activity className="w-4 h-4 text-blue-600" />;
    return <Clock className="w-4 h-4 text-gray-600" />;
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-page-title">
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground" data-testid="text-page-description">
              Monitor and manage your content generation system
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              data-testid="button-toggle-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? "Auto-Refresh On" : "Auto-Refresh Off"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              data-testid="button-manual-refresh"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Link href="/home">
              <Button variant="outline" size="sm" data-testid="button-back-home">
                Back to Home
              </Button>
            </Link>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-6 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Batches</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.totalBatches}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data.batchStatus.RUNNING || 0} running now
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Articles</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.totalArticles}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data.articleStatus.COMPLETE || 0} completed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.summary.totalUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">Active accounts</p>
            </CardContent>
          </Card>

          <Link href="/admin/users" data-testid="card-pending-approvals">
            <Card className="hover-elevate cursor-pointer h-full">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Approvals</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${data.summary.pendingApprovals > 0 ? "text-amber-500" : ""}`}>
                  {data.summary.pendingApprovals}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.summary.pendingApprovals > 0 ? "Awaiting review" : "None pending"}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Unresolved Errors</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {data.summary.unresolvedErrors}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Last 24 hours</p>
            </CardContent>
          </Card>
        </div>

        {/* Active Articles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Active Article Generation
            </CardTitle>
            <CardDescription>
              Articles currently being processed
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.activeArticles.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No articles currently being generated
              </p>
            ) : (
              <div className="space-y-3">
                {data.activeArticles.map((article) => (
                  <div
                    key={article.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                    data-testid={`active-article-${article.id}`}
                  >
                    <div className="flex-1">
                      <p className="font-medium">{article.title}</p>
                      <p className="text-sm text-muted-foreground">
                        Batch #{article.batchId} • Updated {new Date(article.updatedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <Badge variant={getStatusColor(article.status)}>
                      {article.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Batches & Events */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Recent Batches */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Recent Batches
              </CardTitle>
              <CardDescription>Latest content generation jobs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.recentBatches.slice(0, 5).map((batch) => (
                  <Link key={batch.id} href={`/batches/${batch.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg border hover-elevate">
                      <div className="flex-1">
                        <p className="font-medium">{batch.coreTopic}</p>
                        <p className="text-sm text-muted-foreground">
                          {batch.numArticlesRequested} articles • {new Date(batch.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant={getStatusColor(batch.status)}>
                        {batch.status}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Events */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Recent Events
              </CardTitle>
              <CardDescription>Latest system activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {data.recentEvents.map((event: any) => (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50"
                  >
                    {getEventIcon(event.eventType)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{event.eventType}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {event.message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleTimeString()}
                        {event.durationMs && ` • ${event.durationMs}ms`}
                      </p>
                    </div>
                    {event.severity !== "info" && (
                      <Badge variant={event.severity === "error" ? "destructive" : "secondary"} className="text-xs">
                        {event.severity}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Navigation</CardTitle>
            <CardDescription>Navigate to different sections</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <Link href="/content">
                <Button className="w-full" variant="outline" data-testid="button-view-all-articles">
                  <FileText className="w-4 h-4 mr-2" />
                  Content Library
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button className="w-full" variant="outline" data-testid="button-create-batch">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Create Batch
                </Button>
              </Link>
              <Link href="/media">
                <Button className="w-full" variant="outline" data-testid="button-media-library">
                  <Activity className="w-4 h-4 mr-2" />
                  Media Library
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Admin Tools */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Job Queue Management</CardTitle>
              <CardDescription>Manage failed and pending jobs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={async () => {
                    const res = await fetch('/api/admin/requeue-failed', { method: 'POST' });
                    const data = await res.json();
                    alert(`Requeued ${data.requeued || 0} failed jobs`);
                    refetch();
                  }}
                  data-testid="button-requeue-failed"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Requeue Failed Jobs
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={async () => {
                    const res = await fetch('/api/admin/requeue-pending', { method: 'POST' });
                    const data = await res.json();
                    alert(`Requeued ${data.requeued || 0} pending jobs`);
                    refetch();
                  }}
                  data-testid="button-requeue-pending"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Requeue Pending Jobs
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={async () => {
                    const res = await fetch('/api/admin/job-health');
                    const data = await res.json();
                    const stats = JSON.stringify(data, null, 2);
                    alert(`Queue Health:\n${stats}`);
                  }}
                  data-testid="button-job-health"
                >
                  <Activity className="w-4 h-4 mr-2" />
                  View Job Health
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Image Management</CardTitle>
              <CardDescription>Image validation and statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={async () => {
                    const res = await fetch('/api/admin/validate-hero-images');
                    const data = await res.json();
                    const stats = `Valid: ${data.valid || 0}\nBroken: ${data.broken || 0}\nMissing: ${data.missing || 0}`;
                    alert(`Hero Image Validation:\n${stats}`);
                  }}
                  data-testid="button-validate-images"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Validate Hero Images
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Reports */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Error Logs</CardTitle>
              <CardDescription>View system errors and issues</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={async () => {
                  const res = await fetch('/api/admin/errors');
                  const data = await res.json();
                  console.log('Errors:', data);
                  alert(`Found ${data.errors?.length || 0} errors. Check console for details.`);
                }}
                data-testid="button-view-errors"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                View Error Logs
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SEO Reports</CardTitle>
              <CardDescription>Generate SEO performance reports</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={async () => {
                  const res = await fetch('/api/admin/seo-report');
                  const data = await res.json();
                  console.log('SEO Report:', data);
                  alert(`SEO Report generated. Check console for details.`);
                }}
                data-testid="button-seo-report"
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Generate SEO Report
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
