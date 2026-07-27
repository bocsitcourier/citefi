"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Zap,
  Mail,
  Eye,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  Loader2,
  CalendarDays,
  Send,
} from "lucide-react";

interface BriefStats {
  total: number;
  generated: number;
  failed: number;
  generating: number;
  viewed: number;
  emailed: number;
  usersWithPrefs: number;
  noBriefToday: number;
}

interface BriefRow {
  id: number;
  userId: number;
  teamId: number;
  localDate: string;
  status: string;
  todayFocusType: string | null;
  generatedAt: string | null;
  viewedAt: string | null;
  emailedAt: string | null;
  userEmail: string;
  userFullName: string | null;
  prefs: {
    cadence: string;
    timezone: string;
    sendHourLocal: number;
    emailEnabled: number;
    inAppEnabled: number;
  } | null;
  sourceMetricsJson: any;
}

interface AdminBriefsData {
  date: string;
  stats: BriefStats;
  briefs: BriefRow[];
  allPrefs: Array<{
    userId: number;
    teamId: number;
    email: string;
    fullName: string | null;
    cadence: string;
    timezone: string;
    sendHourLocal: number;
    accountStatus: string;
  }>;
  deliveries: Array<{
    id: number;
    briefId: number;
    channel: string;
    status: string;
    error: string | null;
    sentAt: string;
  }>;
}

function statusBadge(status: string) {
  switch (status) {
    case 'generated':
      return <Badge className="bg-green-500/15 text-green-700 border-green-500/30">Generated</Badge>;
    case 'generating':
      return <Badge variant="secondary" className="animate-pulse">Generating…</Badge>;
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>;
    case 'pending':
      return <Badge variant="outline">Pending</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md ${color || 'bg-muted'}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-none">{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminBriefsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery<AdminBriefsData>({
    queryKey: ["/api/admin/briefs", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/admin/briefs?date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 15000,
  });

  const generateMutation = useMutation({
    mutationFn: async (params: { userId?: number; teamId?: number }) => {
      return apiRequest("/api/admin/briefs", {
        method: "POST",
        body: JSON.stringify({ ...params, date: selectedDate }),
      });
    },
    onSuccess: (_, vars) => {
      toast({
        title: "Brief queued",
        description: vars.userId
          ? "Brief generation queued for that user."
          : "Brief generation queued for all team members.",
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/briefs", selectedDate] });
      }, 3000);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  const stats = data?.stats;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            Citefi Coach — Brief Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor, force-generate, and inspect daily marketing briefs for all users
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <Input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-40"
              data-testid="input-brief-date"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            data-testid="button-refresh-briefs"
          >
            {isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={CheckCircle2} label="Generated" value={stats.generated} color="bg-green-500/10 text-green-600" />
          <StatCard icon={Eye} label="Viewed" value={stats.viewed} color="bg-blue-500/10 text-blue-600" />
          <StatCard icon={Mail} label="Emailed" value={stats.emailed} color="bg-purple-500/10 text-purple-600" />
          <StatCard icon={XCircle} label="Failed" value={stats.failed} color="bg-red-500/10 text-red-600" />
          <StatCard icon={Users} label="Users with prefs" value={stats.usersWithPrefs} color="bg-muted" />
          <StatCard icon={AlertTriangle} label="No brief today" value={stats.noBriefToday} color="bg-orange-500/10 text-orange-600" />
          <StatCard icon={Loader2} label="Generating now" value={stats.generating} color="bg-yellow-500/10 text-yellow-600" />
          <StatCard icon={Zap} label="Total briefs" value={stats.total} color="bg-primary/10 text-primary" />
        </div>
      )}

      {/* Users missing briefs today */}
      {data && data.allPrefs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              Users without a brief on {selectedDate}
            </CardTitle>
            <CardDescription>
              These users have delivery preferences set but no brief was generated for this date.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {(() => {
              const briefUserIds = new Set(data.briefs.map(b => b.userId));
              const missing = data.allPrefs.filter(p => !briefUserIds.has(p.userId));
              if (missing.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground px-6 pb-4">
                    All users with preferences have a brief for this date.
                  </p>
                );
              }
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Cadence</TableHead>
                      <TableHead>Send time</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missing.map(p => (
                      <TableRow key={p.userId} data-testid={`row-missing-brief-${p.userId}`}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{p.email}</p>
                            {p.fullName && <p className="text-xs text-muted-foreground">{p.fullName}</p>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{p.cadence}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {p.sendHourLocal}:00 {p.timezone.split('/')[1]?.replace('_', ' ') || p.timezone}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.accountStatus === 'active' ? 'secondary' : 'outline'}>
                            {p.accountStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={generateMutation.isPending}
                            onClick={() => generateMutation.mutate({ userId: p.userId })}
                            data-testid={`button-generate-brief-${p.userId}`}
                          >
                            <Send className="w-3 h-3 mr-1" />
                            Generate now
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Briefs generated on this date */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Briefs generated on {selectedDate}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : !data?.briefs.length ? (
            <p className="text-sm text-muted-foreground p-6">No briefs found for this date.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Focus type</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Viewed</TableHead>
                  <TableHead>Emailed</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.briefs.map(brief => (
                  <>
                    <TableRow
                      key={brief.id}
                      data-testid={`row-brief-${brief.id}`}
                      className="cursor-pointer"
                      onClick={() => setExpandedRow(expandedRow === brief.id ? null : brief.id)}
                    >
                      <TableCell>
                        {expandedRow === brief.id
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        }
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{brief.userEmail}</p>
                          {brief.userFullName && (
                            <p className="text-xs text-muted-foreground">{brief.userFullName}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{statusBadge(brief.status)}</TableCell>
                      <TableCell>
                        {brief.todayFocusType
                          ? <Badge variant="outline" className="text-xs">{brief.todayFocusType.replace('_', ' ')}</Badge>
                          : <span className="text-muted-foreground text-xs">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(brief.generatedAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {brief.viewedAt
                          ? <span className="text-sm text-green-600 flex items-center gap-1"><Eye className="w-3 h-3" />{formatTime(brief.viewedAt)}</span>
                          : <span className="text-xs text-muted-foreground">Not viewed</span>
                        }
                      </TableCell>
                      <TableCell>
                        {brief.emailedAt
                          ? <span className="text-sm text-purple-600 flex items-center gap-1"><Mail className="w-3 h-3" />{formatTime(brief.emailedAt)}</span>
                          : <span className="text-xs text-muted-foreground">Not emailed</span>
                        }
                      </TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={generateMutation.isPending}
                          onClick={() => generateMutation.mutate({ userId: brief.userId })}
                          data-testid={`button-regen-brief-${brief.id}`}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Regenerate
                        </Button>
                      </TableCell>
                    </TableRow>

                    {/* Expanded detail row */}
                    {expandedRow === brief.id && (
                      <TableRow key={`detail-${brief.id}`} className="bg-muted/30">
                        <TableCell colSpan={8} className="py-4">
                          <div className="grid md:grid-cols-2 gap-4 px-4">
                            {brief.prefs && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery prefs</p>
                                <p className="text-sm">Cadence: <span className="font-medium">{brief.prefs.cadence}</span></p>
                                <p className="text-sm">Timezone: <span className="font-medium">{brief.prefs.timezone}</span></p>
                                <p className="text-sm">Send hour: <span className="font-medium">{brief.prefs.sendHourLocal}:00</span></p>
                                <p className="text-sm">Email: <span className="font-medium">{brief.prefs.emailEnabled ? 'On' : 'Off'}</span></p>
                                <p className="text-sm">In-app: <span className="font-medium">{brief.prefs.inAppEnabled ? 'On' : 'Off'}</span></p>
                              </div>
                            )}
                            {brief.sourceMetricsJson && (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source metrics</p>
                                <p className="text-sm">Articles this month: <span className="font-medium">{brief.sourceMetricsJson.articlesPublishedThisMonth ?? '—'}</span></p>
                                <p className="text-sm">Est. on page 1: <span className="font-medium">{brief.sourceMetricsJson.articlesOnPage1 ?? '—'}</span></p>
                                <p className="text-sm">Days since last article: <span className="font-medium">{brief.sourceMetricsJson.daysSinceLastArticle ?? '—'}</span></p>
                                <p className="text-sm">Has competitor data: <span className="font-medium">{brief.sourceMetricsJson.hasCompetitorData ? 'Yes' : 'No'}</span></p>
                                {brief.sourceMetricsJson.candidateScores && (
                                  <div className="mt-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Candidate scores</p>
                                    <div className="space-y-0.5">
                                      {brief.sourceMetricsJson.candidateScores.map((s: any, i: number) => (
                                        <p key={i} className="text-xs text-muted-foreground">
                                          {i === 0 ? '→ ' : '  '}<span className="font-medium">{s.type}</span> ({s.score}/100)
                                        </p>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Delivery log */}
      {data?.deliveries && data.deliveries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="w-4 h-4 text-muted-foreground" />
              Delivery log
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brief ID</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent at</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deliveries.map(d => (
                  <TableRow key={d.id} data-testid={`row-delivery-${d.id}`}>
                    <TableCell className="font-mono text-xs">{d.briefId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{d.channel}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={d.status === 'sent' || d.status === 'delivered' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatTime(d.sentAt)}</TableCell>
                    <TableCell>
                      {d.error
                        ? <span className="text-xs text-destructive font-mono truncate max-w-xs block">{d.error}</span>
                        : <span className="text-muted-foreground text-xs">—</span>
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
