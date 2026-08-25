"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownToLine, FileText, ShieldCheck } from "lucide-react";

interface ClientReport { id: number; periodStart: string; periodEnd: string; approvedAt?: string; clientSafeSnapshot?: Record<string, any>; }
const EVIDENCE = [
  { label: "Campaigns", key: "campaigns" },
  { label: "Articles", key: "articles" },
  { label: "Social assets", key: "socialAssets" },
  { label: "Video assets", key: "videoAssets" },
  { label: "Publishing", key: "publishing" },
  { label: "Exports", key: "exports" },
  { label: "Performance", key: "performance" },
  { label: "Daily Brief themes", key: "dailyBriefThemes" },
];
function date(value: string) { return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
async function download(id: number) { const response = await fetch(`/api/client/reports/${id}/download`, { credentials: "include" }); if (!response.ok) throw new Error("Download unavailable"); const blob = await response.blob(); const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = "approved-report.html"; anchor.click(); URL.revokeObjectURL(href); }

export default function ClientReportsPage() {
  const reportsQuery = useQuery<{ reports: ClientReport[] }>({ queryKey: ["/api/client/reports"], queryFn: () => apiRequest("/api/client/reports"), retry: false });
  if (reportsQuery.isLoading) return <div className="max-w-5xl mx-auto p-6 space-y-5"><Skeleton className="h-20 w-1/2" /><Skeleton className="h-56 w-full" /></div>;
  if (reportsQuery.isError) return <div className="max-w-3xl mx-auto p-6"><Card><CardContent className="py-12 text-center"><p className="font-medium">Reports are unavailable right now</p><Button className="mt-4" variant="outline" onClick={() => reportsQuery.refetch()}>Try again</Button></CardContent></Card></div>;
  const reports = reportsQuery.data?.reports ?? [];
  return <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6" data-testid="client-report-archive"><header><p className="text-xs uppercase tracking-[0.18em] font-medium text-muted-foreground">Client archive</p><h1 className="text-2xl font-semibold mt-1">Approved reports</h1><p className="text-sm text-muted-foreground mt-1">A read-only record of completed reporting periods.</p></header>
    {reports.length === 0 ? <Card><CardContent className="py-14 text-center"><FileText className="h-9 w-9 text-muted-foreground mx-auto mb-3" /><p className="font-medium">No approved reports yet</p><p className="text-sm text-muted-foreground mt-1">Your approved reports will be collected here.</p></CardContent></Card> : <div className="grid gap-5">{reports.map((report) => { const snapshot = report.clientSafeSnapshot ?? {}; const branding = snapshot.branding ?? {}; return <Card key={report.id} className="overflow-hidden" data-testid={`client-report-${report.id}`}><div className="h-2" style={{ backgroundColor: branding.accentColor || "#285B61" }} /><CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div className="flex gap-3">{branding.logoUrl ? <img className="w-10 h-10 rounded-md object-contain border" src={branding.logoUrl} alt="" /> : <div className="w-10 h-10 rounded-md flex items-center justify-center text-white" style={{ backgroundColor: branding.accentColor || "#285B61" }}><FileText className="h-5 w-5" /></div>}<div><CardTitle className="text-base">{branding.displayName || "Monthly report"}</CardTitle><CardDescription>{date(report.periodStart)} – {date(new Date(new Date(report.periodEnd).getTime() - 1).toISOString())}</CardDescription></div></div><Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Approved</Badge></CardHeader><CardContent><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">{EVIDENCE.map((item) => { const value = snapshot[item.key]; const available = Object.prototype.hasOwnProperty.call(snapshot, item.key) && value?.available !== false; return <div className="rounded-md bg-muted/55 p-2.5" key={item.key}><p className="text-xs text-muted-foreground">{item.label}</p><p className="text-sm font-medium mt-1">{available ? "Included" : "Not available"}</p></div>; })}</div><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Approved {report.approvedAt ? date(report.approvedAt) : "report"}</p><Button size="sm" variant="outline" onClick={() => download(report.id)} data-testid={`button-download-client-report-${report.id}`}><ArrowDownToLine className="h-4 w-4 mr-2" />Download HTML</Button></div></CardContent></Card>; })}</div>}
  </div>;
}