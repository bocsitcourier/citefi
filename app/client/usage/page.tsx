"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, FileText, Share2, Mic, Video, AlertTriangle } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import Link from "next/link";

interface UsageData {
  credits: { balance: number; used: number; allocated: number; usedPct: number };
  breakdown: { article: number; social: number; podcast: number; video: number };
  dailySeries: Array<{ day: string; used: number }>;
  articlesThisPeriod: number;
  currentPeriodEnd: string | null;
  planName: string;
}

const BREAKDOWN_COLORS: Record<string, string> = {
  article: "hsl(var(--chart-1))",
  social: "hsl(var(--chart-2))",
  podcast: "hsl(var(--chart-3))",
  video: "hsl(var(--chart-4))",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  article: FileText,
  social: Share2,
  podcast: Mic,
  video: Video,
};

function formatDay(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPeriodEnd(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function UsagePage() {
  const { data, isLoading, isError } = useQuery<UsageData>({
    queryKey: ["/api/client/usage"],
    queryFn: () => apiRequest("/api/client/usage"),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        Failed to load usage data. Please refresh and try again.
      </div>
    );
  }

  const { credits, breakdown, dailySeries, planName, currentPeriodEnd } = data;

  const breakdownItems = Object.entries(breakdown).filter(([, v]) => v > 0);
  const barData = Object.entries(breakdown).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    credits: value,
    key,
  }));

  const isLowCredit = credits.allocated > 0 && credits.usedPct >= 80;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {planName} plan
            {currentPeriodEnd && ` · period ends ${formatPeriodEnd(currentPeriodEnd)}`}
          </p>
        </div>
        <Link
          href="/client/billing"
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          data-testid="link-manage-billing"
        >
          Manage billing
        </Link>
      </div>

      {/* Low-credit warning banner */}
      {isLowCredit && (
        <div
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          data-testid="banner-low-credit"
        >
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              You&apos;ve used {credits.usedPct}% of your credits
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Only {credits.balance.toLocaleString()} credits remaining.{" "}
              <Link href="/client/billing" className="underline underline-offset-2 hover:no-underline">
                Upgrade your plan
              </Link>{" "}
              to avoid interruptions.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="shrink-0 border-amber-500/50 text-amber-800 dark:text-amber-300">
            <Link href="/client/billing" data-testid="link-upgrade-from-warning">Upgrade</Link>
          </Button>
        </div>
      )}

      {/* Credit progress */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Credit Usage</CardTitle>
            <CardDescription>This billing period</CardDescription>
          </div>
          <Zap className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between gap-2">
            <div>
              <span className="text-3xl font-bold" data-testid="text-credit-balance">{credits.balance.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground ml-2">remaining</span>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <span data-testid="text-credits-used">{credits.used.toLocaleString()}</span>
              <span> / {credits.allocated.toLocaleString()} used</span>
            </div>
          </div>
          <Progress
            value={credits.usedPct}
            className={`h-2 ${isLowCredit ? "[&>div]:bg-amber-500" : ""}`}
            data-testid="progress-credit-usage"
          />
          <div className="flex flex-wrap gap-3">
            {breakdownItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No credits used this period.</p>
            ) : breakdownItems.map(([key, value]) => {
              const Icon = TYPE_ICONS[key] ?? Zap;
              return (
                <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="capitalize">{key}</span>
                  <Badge variant="secondary" className="text-xs py-0">{value}</Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 30-day area chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Daily Credit Usage</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {dailySeries.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                No usage data yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={dailySeries} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="creditGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={formatDay}
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    labelFormatter={(v) => formatDay(String(v))}
                    formatter={(v) => [`${v} credits`, "Used"]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="used"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#creditGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Breakdown bar chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Usage by Content Type</CardTitle>
            <CardDescription>This billing period</CardDescription>
          </CardHeader>
          <CardContent>
            {barData.every(b => b.credits === 0) ? (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                No usage data yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={barData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [`${v} credits`, "Used"]} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="credits" radius={[3, 3, 0, 0]}>
                    {barData.map(entry => (
                      <Cell key={entry.key} fill={BREAKDOWN_COLORS[entry.key] ?? "hsl(var(--primary))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Articles Generated This Period</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-articles-this-period">
            {data.articlesThisPeriod.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Since the start of your billing period</p>
        </CardContent>
      </Card>
    </div>
  );
}
