"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, TrendingUp, Users, FileText, Activity, MousePointer, Zap } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface AnalyticsData {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalArticles: number;
    activeTeams: number;
    averagePerDay: number;
  };
  dailyStats: Array<{
    date: string;
    total_articles: number;
    active_teams: number;
  }>;
  topTeams: Array<{
    teamId: number | null;
    teamName: string;
    articleCount: number;
  }>;
}

interface EventAnalyticsData {
  last24h: {
    total: number;
    breakdown: Array<{ eventType: string; count: number }>;
  };
  lastConversions: Array<{
    id: number;
    contentType: string;
    contentTitle: string;
    conversionType: string;
    conversionValue: number | null;
    visitorId: string | null;
    createdAt: string;
  }>;
  labelerLastRun: string | null;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  page_view: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  view: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  heartbeat: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  scroll_milestone: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  read_complete: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cta_click: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  click: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  share: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  conversion: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
};

export default function AdminAnalyticsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState("30");

  useEffect(() => {
    if (!isAuthLoading && (!user || user.role !== "admin")) {
      router.push("/login");
    }
  }, [user, isAuthLoading, router]);

  const { data: analytics, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/analytics", period],
    enabled: user?.role === "admin",
  });

  const { data: eventAnalytics, isLoading: isEventsLoading } = useQuery<EventAnalyticsData>({
    queryKey: ["/api/admin/analytics/events"],
    enabled: user?.role === "admin",
    refetchInterval: 60_000,
  });

  if (isLoading || isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">No analytics data available</p>
      </div>
    );
  }

  const dailyStats = analytics.dailyStats ?? [];
  const topTeams = analytics.topTeams ?? [];

  const chartData = dailyStats.map(stat => ({
    date: new Date(stat.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    articles: Number(stat.total_articles),
    teams: Number(stat.active_teams),
  }));

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-analytics-title">Usage Analytics</h1>
          <p className="text-muted-foreground">Track content generation trends and user activity</p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]" data-testid="select-period">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Articles</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.summary.totalArticles.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Last {analytics.period.days} days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Teams</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-teams">{analytics.summary.activeTeams}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Created content this period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily Average</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.summary.averagePerDay.toFixed(1)}</div>
            <p className="text-xs text-muted-foreground mt-2">
              Articles per day
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Content Generation Trends</CardTitle>
          <CardDescription>Daily article creation and user activity</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="articles" stroke="hsl(var(--primary))" strokeWidth={2} name="Articles" />
              <Line type="monotone" dataKey="teams" stroke="hsl(var(--chart-2))" strokeWidth={2} name="Active Teams" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Teams */}
      <Card>
        <CardHeader>
          <CardTitle>Top Teams</CardTitle>
          <CardDescription>Most active teams in the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {topTeams.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No team activity in this period
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rank</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Articles Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topTeams.map((team, index) => (
                  <TableRow key={team.teamId ?? `unassigned-${index}`} data-testid={`row-team-${team.teamId ?? "unassigned"}`}>
                    <TableCell className="font-medium">#{index + 1}</TableCell>
                    <TableCell>{team.teamName}</TableCell>
                    <TableCell className="text-right font-bold">{team.articleCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Event Ingestion Panel */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-events-panel-title">Event Ingestion</h2>
          <p className="text-muted-foreground">Beacon events collected from published content (last 24h)</p>
        </div>

        {/* Event summary cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Events Last 24h</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isEventsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-events-total">
                    {(eventAnalytics?.last24h.total ?? 0).toLocaleString()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {eventAnalytics?.last24h.breakdown.length ?? 0} distinct event types
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Conversions Last 24h</CardTitle>
              <Zap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isEventsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-events-conversions">
                    {(eventAnalytics?.last24h.breakdown.find(b => b.eventType === "conversion")?.count ?? 0).toLocaleString()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    From beacon &amp; conversion endpoint
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ConversionLabeler</CardTitle>
              <MousePointer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isEventsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="text-sm font-semibold" data-testid="text-labeler-last-run">
                    {eventAnalytics?.labelerLastRun
                      ? new Date(eventAnalytics.labelerLastRun).toLocaleString()
                      : "Never run"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Nightly 02:00 UTC — labels content_performance_metrics
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Event type breakdown */}
        {!isEventsLoading && (eventAnalytics?.last24h.breakdown.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Event Type Breakdown</CardTitle>
              <CardDescription>All event types ingested in the last 24 hours</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2" data-testid="event-breakdown">
                {eventAnalytics!.last24h.breakdown.map((b) => (
                  <div
                    key={b.eventType}
                    className={`flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium ${EVENT_TYPE_COLORS[b.eventType] ?? "bg-muted text-muted-foreground"}`}
                    data-testid={`event-type-${b.eventType}`}
                  >
                    <span>{b.eventType}</span>
                    <span className="font-bold">{b.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Last 10 conversions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Conversions</CardTitle>
            <CardDescription>Last 10 conversion events across all teams</CardDescription>
          </CardHeader>
          <CardContent>
            {isEventsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (eventAnalytics?.lastConversions.length ?? 0) === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No conversions recorded yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Content</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Visitor</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eventAnalytics!.lastConversions.map((conv) => (
                    <TableRow key={conv.id} data-testid={`row-conversion-${conv.id}`}>
                      <TableCell>
                        <div className="font-medium truncate max-w-[220px]" title={conv.contentTitle}>
                          {conv.contentTitle}
                        </div>
                        <div className="text-xs text-muted-foreground">{conv.contentType}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {conv.conversionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {conv.conversionValue != null
                          ? `$${conv.conversionValue.toFixed(2)}`
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground font-mono">
                          {conv.visitorId ? conv.visitorId.slice(0, 8) + "…" : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(conv.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
