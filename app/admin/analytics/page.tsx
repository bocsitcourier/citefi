"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2, TrendingUp, Users, FileText, Activity } from "lucide-react";
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

export default function AdminAnalyticsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [period, setPeriod] = useState("30");

  useEffect(() => {
    if (!isAuthLoading && (!user || user.role !== "admin")) {
      router.push("/");
    }
  }, [user, isAuthLoading, router]);

  const { data: analytics, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/analytics", period],
    enabled: user?.role === "admin",
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
    </div>
  );
}
