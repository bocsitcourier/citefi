"use client";

import { useState } from "react";
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
import { Loader2, TrendingUp, DollarSign, Cpu, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

// ── Types matching the API response ──────────────────────────────────────────

interface TelemetrySummary {
  totalCalls: number;
  totalCostUsd: number;
  totalTokens: number;
  successCount: number;
  failureCount: number;
}

interface ByOperation {
  operationType: string;
  callCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
  p95CostUsd: number;
  totalTokens: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

interface ByModel {
  provider: string;
  model: string;
  callCount: number;
  totalCostUsd: number;
  avgCostUsd: number;
}

interface CreditAnchorHealth {
  operationType: string;
  credits: number;
  avgCostUsd: number;
  revenuePerCreditUsd: number;
  grossMarginPct: number;
  status: "healthy" | "warning" | "critical";
  hasAllData: boolean;
  missingOperations: string[];
}

interface RecentEvent {
  id: number;
  operationType: string;
  provider: string;
  model: string;
  costUsd: number;
  totalTokens: number | null;
  latencyMs: number | null;
  success: boolean;
  createdAt: string;
}

interface TelemetryData {
  periodDays: number;
  since: string;
  summary: TelemetrySummary;
  byOperation: ByOperation[];
  byModel: ByModel[];
  creditAnchorHealth: CreditAnchorHealth[];
  recentEvents: RecentEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function usd(val: number): string {
  if (val === 0) return "$0.00";
  if (val < 0.01) return `$${val.toFixed(5)}`;
  if (val < 1) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(3)}`;
}

function num(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toLocaleString();
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  healthy:  { label: "Healthy",  variant: "default" },
  warning:  { label: "Warning",  variant: "secondary" },
  critical: { label: "Critical", variant: "destructive" },
};

const PERIOD_OPTIONS = [
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CostTelemetryPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [days, setDays] = useState(7);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<TelemetryData>({
    queryKey: ["/api/admin/cost-telemetry", days],
    queryFn: () =>
      fetch(`/api/admin/cost-telemetry?days=${days}`).then((r) => {
        if (!r.ok) throw new Error("Failed to load telemetry");
        return r.json();
      }),
    refetchOnWindowFocus: false,
  });

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    router.push("/admin");
    return null;
  }

  const s = data?.summary;
  const successRate = s ? (s.totalCalls > 0 ? ((s.successCount / s.totalCalls) * 100).toFixed(1) : "—") : "—";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Cost &amp; Margin</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real AI spend per operation · credit anchor validation · model breakdown
          </p>
        </div>
        <div className="flex items-center gap-2">
          {PERIOD_OPTIONS.map((p) => (
            <Button
              key={p.days}
              size="sm"
              variant={days === p.days ? "default" : "outline"}
              onClick={() => setDays(p.days)}
              data-testid={`button-period-${p.days}`}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="icon"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Failed to load cost telemetry. Check your admin access or try refreshing.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Spend</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-spend">{usd(s?.totalCostUsd ?? 0)}</div>
                <p className="text-xs text-muted-foreground mt-1">{num(s?.totalCalls ?? 0)} API calls · last {days}d</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Tokens</CardTitle>
                <Cpu className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-tokens">{num(s?.totalTokens ?? 0)}</div>
                <p className="text-xs text-muted-foreground mt-1">Input + output tokens</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-success-rate">{successRate}%</div>
                <p className="text-xs text-muted-foreground mt-1">{num(s?.failureCount ?? 0)} failures excluded from cost avg</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Cost / Call</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-avg-cost-call">
                  {s && s.successCount > 0 ? usd(s.totalCostUsd / s.successCount) : "—"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Successful calls only</p>
              </CardContent>
            </Card>
          </div>

          {/* Credit Anchor Health */}
          <Card>
            <CardHeader>
              <CardTitle>Credit Anchor Validation</CardTitle>
              <CardDescription>
                Measured AI spend vs. planned credit revenue per product · Growth plan ($0.445/credit)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.creditAnchorHealth.length === 0 ? (
                <p className="text-sm text-muted-foreground">No telemetry data yet for this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Avg COGS</TableHead>
                      <TableHead className="text-right">Gross Margin</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.creditAnchorHealth.map((row) => {
                      const badge = STATUS_BADGE[row.status];
                      return (
                        <TableRow key={row.operationType} data-testid={`row-anchor-${row.operationType}`}>
                          <TableCell className="font-medium capitalize">{row.operationType}</TableCell>
                          <TableCell className="text-right">{row.credits}</TableCell>
                          <TableCell className="text-right">{usd(row.revenuePerCreditUsd)}</TableCell>
                          <TableCell className="text-right">
                            {row.hasAllData ? usd(row.avgCostUsd) : (
                              <span className="text-muted-foreground text-xs">
                                {usd(row.avgCostUsd)} (partial)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {row.grossMarginPct.toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant} data-testid={`badge-status-${row.operationType}`}>
                              {badge.label}
                            </Badge>
                            {!row.hasAllData && row.missingOperations.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Missing data: {row.missingOperations.join(", ")}
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Per-Operation Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>By Operation</CardTitle>
              <CardDescription>Successful calls only · failures are excluded from cost averages</CardDescription>
            </CardHeader>
            <CardContent>
              {data.byOperation.length === 0 ? (
                <p className="text-sm text-muted-foreground">No successful calls recorded in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Operation</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Avg Cost</TableHead>
                      <TableHead className="text-right">p95 Cost</TableHead>
                      <TableHead className="text-right">Total Spend</TableHead>
                      <TableHead className="text-right">Avg Tokens In</TableHead>
                      <TableHead className="text-right">Avg Tokens Out</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byOperation.map((row) => (
                      <TableRow key={row.operationType} data-testid={`row-op-${row.operationType}`}>
                        <TableCell className="font-medium text-sm">{row.operationType}</TableCell>
                        <TableCell className="text-right text-sm">{num(row.callCount)}</TableCell>
                        <TableCell className="text-right text-sm">{usd(row.avgCostUsd)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{usd(row.p95CostUsd)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{usd(row.totalCostUsd)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{num(row.avgInputTokens)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{num(row.avgOutputTokens)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* By Model */}
          <Card>
            <CardHeader>
              <CardTitle>By Model</CardTitle>
              <CardDescription>Resolved model IDs from API responses — auto-updates when models change</CardDescription>
            </CardHeader>
            <CardContent>
              {data.byModel.length === 0 ? (
                <p className="text-sm text-muted-foreground">No model data for this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">Avg Cost</TableHead>
                      <TableHead className="text-right">Total Spend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byModel.map((row) => (
                      <TableRow key={`${row.provider}-${row.model}`} data-testid={`row-model-${row.model}`}>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {row.provider}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.model}</TableCell>
                        <TableCell className="text-right text-sm">{num(row.callCount)}</TableCell>
                        <TableCell className="text-right text-sm">{usd(row.avgCostUsd)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{usd(row.totalCostUsd)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Recent Events */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
              <CardDescription>Last 50 telemetry entries for this period</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recentEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operation</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentEvents.map((ev) => (
                        <TableRow key={ev.id} data-testid={`row-event-${ev.id}`}>
                          <TableCell className="text-sm">{ev.operationType}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{ev.model}</TableCell>
                          <TableCell className="text-right text-sm">{usd(ev.costUsd)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {ev.totalTokens != null ? num(ev.totalTokens) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {ev.latencyMs != null ? `${(ev.latencyMs / 1000).toFixed(1)}s` : "—"}
                          </TableCell>
                          <TableCell>
                            {ev.success ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {relativeTime(ev.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
