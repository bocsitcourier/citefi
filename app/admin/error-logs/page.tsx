"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Clock, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Incident = {
  id: string;
  title: string;
  fingerprint: string;
  severity: string;
  status: string;
  category: string;
  environment: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

type ListResponse = {
  incidents: Incident[];
  page: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  facets: { categories: string[]; environments: string[] };
};

type Report = {
  totals: { total: number; critical: number; new: number; regressed: number; open: number };
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  top: { fingerprints: { key: string; count: number }[]; categories: { key: string; count: number }[]; components: { key: string; count: number }[] };
};

function badgeVariant(severity: string): "destructive" | "secondary" | "outline" {
  return severity === "critical" ? "destructive" : severity === "error" ? "secondary" : "outline";
}

function duration(value: number | null) {
  if (value == null) return "Not enough data";
  if (value < 60) return `${Math.round(value)}m`;
  return `${(value / 60).toFixed(1)}h`;
}

export default function AdminIncidentPage() {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [environment, setEnvironment] = useState("all");
  const [window, setWindow] = useState<"24h" | "7d">("24h");
  const filters = { severity, status, category, environment };

  const query = useQuery<ListResponse>({
    queryKey: ["/api/admin/incidents", page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      Object.entries(filters).forEach(([key, value]) => value !== "all" && params.set(key, value));
      const response = await fetch(`/api/admin/incidents?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load incidents");
      return response.json();
    },
  });
  const report = useQuery<Report>({
    queryKey: ["/api/admin/incidents/report", window],
    queryFn: async () => {
      const response = await fetch(`/api/admin/incidents/report?window=${window}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load incident report");
      return response.json();
    },
  });

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert className="w-6 h-6 text-destructive" />Incident Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">Operational incidents, evidence, ownership, and human-reviewed AI guidance</p>
        </div>
        <Button variant="outline" onClick={() => { query.refetch(); report.refetch(); }} disabled={query.isFetching}>
          <RefreshCw className={cn("w-4 h-4 mr-2", query.isFetching && "animate-spin")} />Refresh
        </Button>
      </div>

      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
        <div><strong>AI advice is advisory only.</strong> A qualified human must review evidence and approve all remediation. No fixes are executed automatically.</div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4" />Incident report</h2>
          <Select value={window} onValueChange={(value: "24h" | "7d") => setWindow(value)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="24h">24 hours</SelectItem><SelectItem value="7d">7 days</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["total", "critical", "new", "regressed", "open"] as const).map((key) => (
            <Card key={key}><CardHeader className="p-4 pb-1"><CardTitle className="text-xs capitalize text-muted-foreground">{key}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 text-2xl font-bold">{report.data?.totals[key] ?? "—"}</CardContent></Card>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Card><CardContent className="p-4 text-sm"><span className="text-muted-foreground">Mean time to acknowledge:</span> <strong>{duration(report.data?.mttaMinutes ?? null)}</strong></CardContent></Card>
          <Card><CardContent className="p-4 text-sm"><span className="text-muted-foreground">Mean time to resolve:</span> <strong>{duration(report.data?.mttrMinutes ?? null)}</strong></CardContent></Card>
        </div>
        {report.data && (
          <div className="grid md:grid-cols-3 gap-3">
            {(["categories", "components", "fingerprints"] as const).map((kind) => (
              <Card key={kind}><CardHeader className="p-4 pb-2"><CardTitle className="text-sm capitalize">Top {kind}</CardTitle></CardHeader>
                <CardContent className="px-4 pb-4 space-y-1">{report.data.top[kind].map((row) => (
                  <div key={row.key} className="flex justify-between gap-2 text-xs"><span className="truncate font-mono">{row.key}</span><strong>{row.count}</strong></div>
                ))}{!report.data.top[kind].length && <span className="text-xs text-muted-foreground">No data</span>}</CardContent></Card>
            ))}
          </div>
        )}
      </section>

      <div className="flex gap-3 flex-wrap">
        <Select value={severity} onValueChange={(v) => changeFilter(setSeverity, v)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All severities</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem>
        </SelectContent></Select>
        <Select value={status} onValueChange={(v) => changeFilter(setStatus, v)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All statuses</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="acknowledged">Acknowledged</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="ignored">Ignored</SelectItem>
        </SelectContent></Select>
        <Select value={category} onValueChange={(v) => changeFilter(setCategory, v)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All categories</SelectItem>{query.data?.facets.categories.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
        </SelectContent></Select>
        <Select value={environment} onValueChange={(v) => changeFilter(setEnvironment, v)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">All environments</SelectItem>{query.data?.facets.environments.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
        </SelectContent></Select>
      </div>

      {query.isLoading ? <div className="h-40 rounded-md bg-muted animate-pulse" /> : query.isError ? (
        <div className="text-destructive">Unable to load incidents. Try refreshing.</div>
      ) : !query.data?.incidents.length ? (
        <div className="py-16 text-center text-muted-foreground">No incidents match these filters.</div>
      ) : (
        <div className="space-y-2">
          {query.data.incidents.map((incident) => (
            <Link key={incident.id} href={`/admin/error-logs/${incident.id}`} className="block border rounded-md p-4 hover:bg-muted/40 transition-colors">
              <div className="flex justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex gap-2 items-center flex-wrap"><Badge variant={badgeVariant(incident.severity)}>{incident.severity}</Badge><Badge variant="outline">{incident.status}</Badge><Badge variant="outline">{incident.category}</Badge><span className="text-xs text-muted-foreground">{incident.environment}</span></div>
                  <h3 className="font-medium mt-2 truncate">{incident.title}</h3>
                  <p className="font-mono text-xs text-muted-foreground mt-1 truncate">{incident.fingerprint}</p>
                </div>
                <div className="text-right text-sm shrink-0"><strong>{incident.occurrenceCount}</strong> occurrences<div className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Clock className="w-3 h-3" />Last {new Date(incident.lastSeenAt).toLocaleString()}</div></div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {query.data && query.data.totalPages > 1 && <div className="flex justify-center items-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm">Page {page} of {query.data.totalPages} · {query.data.total} incidents</span><Button variant="outline" disabled={!query.data.hasMore} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </div>
  );
}