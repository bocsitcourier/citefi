"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { csrfFetch } from "@/lib/queryClient";

type Person = { id: number; email: string; fullName: string | null };
type Advice = {
  summary: string;
  likelyCauses: { cause: string; evidenceRefs: string[] }[];
  recommendedChecks: { check: string; evidenceRefs: string[] }[];
  confidence: number;
  insufficientEvidence: boolean;
  missingEvidence: string[];
  safetyNotice: string;
};
type Detail = {
  incident: { id: string; title: string; fingerprint: string; severity: string; status: string; category: string; environment: string; occurrenceCount: number; evidenceVersion: number; firstSeenAt: string; lastSeenAt: string; acknowledgedAt: string | null; resolvedAt: string | null };
  component: string | null;
  correlationIds: { requestIds: string[]; jobIds: string[]; deployIds: string[] };
  assignee: Person | null;
  evidence: { id: string; occurredAt: string; severity: string; message: string; stack: string | null; process: string; release: string | null; correlation: Record<string, string | null>; metadata: Record<string, unknown> }[];
  audit: { id: number; action: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string; actor: Person | null }[];
  analysis: { analysis: Advice; evidenceVersion: number; createdAt: string } | null;
};
type ListMeta = { admins: Person[] };

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const { toast } = useToast();
  const detail = useQuery<Detail>({
    queryKey: ["/api/admin/incidents", id],
    queryFn: async () => {
      const response = await fetch(`/api/admin/incidents/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load incident");
      return response.json();
    },
  });
  const admins = useQuery<ListMeta>({
    queryKey: ["/api/admin/incidents", "admins"],
    queryFn: async () => {
      const response = await fetch("/api/admin/incidents?limit=1", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load admins");
      return response.json();
    },
  });
  const action = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const response = await csrfFetch(`/api/admin/incidents/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Update failed");
      return result;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: ["/api/admin/incidents"] }); toast({ title: "Incident updated" }); },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  const analyze = useMutation({
    mutationFn: async (refresh: boolean) => {
      const response = await csrfFetch(`/api/admin/incidents/${id}/analysis`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh }) });
      if (!response.ok) throw new Error("Analysis failed");
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: ["/api/admin/incidents", id] }); toast({ title: "Advisory analysis ready" }); },
    onError: () => toast({ title: "AI analysis failed", variant: "destructive" }),
  });

  if (detail.isLoading) return <div className="p-6"><div className="h-60 bg-muted animate-pulse rounded-md" /></div>;
  if (!detail.data) return <div className="p-6 text-destructive">Incident not found or could not be loaded.</div>;
  const data = detail.data;
  const advice = data.analysis?.analysis;

  return (
    <div className="p-6 space-y-6">
      <Link href="/admin/error-logs" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4 mr-1" />Back to incidents</Link>
      <div className="flex justify-between gap-4 flex-wrap">
        <div><div className="flex gap-2 mb-2 flex-wrap"><Badge variant={data.incident.severity === "critical" ? "destructive" : "secondary"}>{data.incident.severity}</Badge><Badge variant="outline">{data.incident.status}</Badge><Badge variant="outline">{data.incident.category}</Badge><Badge variant="outline">{data.incident.environment}</Badge></div><h1 className="text-2xl font-bold">{data.incident.title}</h1><p className="text-xs font-mono text-muted-foreground mt-2">{data.incident.fingerprint}</p></div>
        <div className="flex gap-2 flex-wrap items-start">
          {data.incident.status === "open" && <Button onClick={() => action.mutate({ action: "status", status: "acknowledged" })}>Acknowledge</Button>}
          {data.incident.status !== "resolved" ? <Button variant="outline" onClick={() => action.mutate({ action: "status", status: "resolved" })}><CheckCircle2 className="w-4 h-4 mr-1" />Resolve</Button> : <Button variant="outline" onClick={() => action.mutate({ action: "status", status: "open", note: "Reopened by administrator" })}>Reopen</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><span className="text-xs text-muted-foreground">Occurrences</span><div className="text-xl font-bold">{data.incident.occurrenceCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><span className="text-xs text-muted-foreground">First seen</span><div className="text-sm font-medium">{new Date(data.incident.firstSeenAt).toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><span className="text-xs text-muted-foreground">Last seen</span><div className="text-sm font-medium">{new Date(data.incident.lastSeenAt).toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="p-4"><span className="text-xs text-muted-foreground">Component</span><div className="text-sm font-medium">{data.component || "Unknown"}</div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-base">Ownership</CardTitle></CardHeader><CardContent className="flex items-center gap-3 flex-wrap">
        <Select value={data.assignee ? String(data.assignee.id) : undefined} onValueChange={(value) => action.mutate({ action: "assign", assigneeUserId: Number(value) })}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Assign an active admin" /></SelectTrigger><SelectContent>{admins.data?.admins.map((admin) => <SelectItem key={admin.id} value={String(admin.id)}>{admin.fullName || admin.email}</SelectItem>)}</SelectContent>
        </Select>
        {data.assignee && <span className="text-sm text-muted-foreground">Assigned to {data.assignee.fullName || data.assignee.email}</span>}
      </CardContent></Card>

      <Card className="border-amber-500/40"><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="w-5 h-5" />AI advisory</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="rounded-md bg-amber-500/10 p-3 text-sm flex gap-2"><AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" /><strong>Human review required. AI output is advisory and may be incomplete or incorrect. No fixes were executed.</strong></div>
        <Button variant="outline" disabled={analyze.isPending} onClick={() => analyze.mutate(!!advice)}><RefreshCw className="w-4 h-4 mr-2" />{advice ? "Refresh analysis" : "Request analysis"}</Button>
        {advice && <div className="space-y-4"><div><h3 className="font-semibold">Summary</h3><p className="text-sm">{advice.summary}</p><p className="text-xs text-muted-foreground mt-1">Confidence: {Math.round(advice.confidence * 100)}%{advice.insufficientEvidence ? " · insufficient evidence" : ""}</p></div>
          <div><h3 className="font-semibold">Likely root causes</h3><ul className="list-disc pl-5 text-sm space-y-1">{advice.likelyCauses.map((item, i) => <li key={i}>{item.cause} <span className="text-xs text-muted-foreground">({item.evidenceRefs.join(", ")})</span></li>)}</ul></div>
          <div><h3 className="font-semibold">Recommended checks</h3><ul className="list-disc pl-5 text-sm space-y-1">{advice.recommendedChecks.map((item, i) => <li key={i}>{item.check} <span className="text-xs text-muted-foreground">({item.evidenceRefs.join(", ") || "general"})</span></li>)}</ul></div>
          {!!advice.missingEvidence.length && <div><h3 className="font-semibold">Missing evidence</h3><p className="text-sm">{advice.missingEvidence.join("; ")}</p></div>}
        </div>}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Correlation IDs</CardTitle></CardHeader><CardContent className="grid md:grid-cols-3 gap-4 text-xs font-mono">
        {Object.entries(data.correlationIds).map(([kind, values]) => <div key={kind}><strong className="font-sans capitalize">{kind.replace("Ids", " IDs")}</strong>{values.length ? values.map((value) => <div key={value} className="break-all mt-1">{value}</div>) : <div className="text-muted-foreground mt-1">None</div>}</div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Sanitized evidence timeline</CardTitle></CardHeader><CardContent className="space-y-3">
        {data.evidence.map((event) => <div key={event.id} id={`evidence-${event.id}`} className="border rounded-md p-3">
          <div className="flex justify-between gap-2 text-xs"><code>{event.id}</code><span className="text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span></div>
          <p className="text-sm mt-2 whitespace-pre-wrap">{event.message}</p>{event.stack && <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-auto max-h-48">{event.stack}</pre>}
          {Object.keys(event.metadata || {}).length > 0 && <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-auto">{JSON.stringify(event.metadata, null, 2)}</pre>}
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Immutable status audit</CardTitle></CardHeader><CardContent className="space-y-2">{data.audit.map((entry) => <div key={entry.id} className="border-l-2 pl-3 text-sm"><strong>{entry.action.replace("_", " ")}</strong>{entry.fromStatus || entry.toStatus ? ` · ${entry.fromStatus || "—"} → ${entry.toStatus || "—"}` : ""}<div className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {entry.actor?.fullName || entry.actor?.email || "System"}{entry.note ? ` · ${entry.note}` : ""}</div></div>)}</CardContent></Card>
    </div>
  );
}