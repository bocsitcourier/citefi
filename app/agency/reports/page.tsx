"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownToLine, CheckCircle2, Clock3, FileSpreadsheet, FileText, Mail, Palette, Plus, RefreshCw, Send, ShieldCheck, X } from "lucide-react";

type Section = "campaigns" | "articles" | "socialAssets" | "videoAssets" | "publishing" | "exports" | "performance" | "dailyBriefThemes" | "recommendations";
interface Client { id: number; name: string; }
interface ReportConfig { displayName?: string; logoUrl?: string; accentColor?: string; recipients?: string[]; cadence?: "monthly" | "manual"; clientVisibleSections?: Record<string, boolean> | Section[]; markupBasisPoints?: number; approvalStatus?: string; approvedAt?: string | null; }
interface Report { id: number; status?: string; periodStart: string; periodEnd: string; createdAt?: string; approvedAt?: string | null; clientSafeSnapshot?: Record<string, unknown>; agencyRebillingSnapshot?: { revenueAvailable?: boolean }; }
interface Delivery { id: number; status?: string; recipient?: string; sentAt?: string; createdAt?: string; error?: string; }
interface Workspace { client: Client; config: ReportConfig | null; reports: Report[]; deliveries: Delivery[]; }

const SECTIONS: Array<{ value: Section; label: string; note: string }> = [
  { value: "campaigns", label: "Campaigns", note: "Active work and outcomes" },
  { value: "articles", label: "Articles", note: "Published and drafted editorial" },
  { value: "socialAssets", label: "Social assets", note: "Posts and creative variants" },
  { value: "videoAssets", label: "Video assets", note: "Video work delivered" },
  { value: "publishing", label: "Publishing", note: "Live destinations and dates" },
  { value: "exports", label: "Exports", note: "Files prepared for the client" },
  { value: "performance", label: "Performance", note: "Available reporting signals" },
  { value: "dailyBriefThemes", label: "Daily Brief themes", note: "Themes informing the work" },
  { value: "recommendations", label: "Recommendations", note: "Evidence-backed next actions" },
];

function monthValue(offset = 0) {
  const date = new Date();
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthDates(value: string) {
  const [year = new Date().getFullYear(), month = new Date().getMonth() + 1] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return {
    start: `${value}-01T00:00:00.000Z`,
    end: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`,
  };
}
function displayDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not available";
}
function approved(config: ReportConfig | null) {
  return Boolean(config?.approvedAt || config?.approvalStatus?.toLowerCase() === "approved");
}
async function download(url: string, filename: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Download could not be prepared");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl; link.download = filename; link.click();
  URL.revokeObjectURL(objectUrl);
}

export default function AgencyReportsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [clientId, setClientId] = useState<string>(() => searchParams.get("clientTeamId") ?? "");
  const [month, setMonth] = useState(monthValue(-1));
  const [form, setForm] = useState({ displayName: "", logoUrl: "", accentColor: "#285B61", recipients: [] as string[], cadence: "monthly" as "monthly" | "manual", clientVisibleSections: SECTIONS.map((section) => section.value), markupBasisPoints: 0, approvalStatus: "", approvedAt: null as string | null });
  const [email, setEmail] = useState("");
  const [previewId, setPreviewId] = useState<number | null>(null);

  const clientsQuery = useQuery<{ clients: Client[] }>({ queryKey: ["/api/agency/clients"], queryFn: () => apiRequest("/api/agency/clients"), retry: false });
  useEffect(() => { if (!clientId && clientsQuery.data?.clients?.[0]) setClientId(String(clientsQuery.data.clients[0].id)); }, [clientId, clientsQuery.data]);
  const workspaceQuery = useQuery<Workspace>({
    queryKey: ["/api/agency/reports", clientId],
    queryFn: () => apiRequest(`/api/agency/reports?clientTeamId=${clientId}`),
    enabled: Boolean(clientId),
    retry: false,
  });
  const reportDetailQuery = useQuery<Report | { report: Report }>({
    queryKey: ["/api/agency/reports/detail", previewId],
    queryFn: () => apiRequest(`/api/agency/reports/${previewId}`),
    enabled: Boolean(previewId),
    retry: false,
  });
  useEffect(() => {
    const config = workspaceQuery.data?.config;
    if (config) {
      const sectionFlags = !Array.isArray(config.clientVisibleSections)
        ? config.clientVisibleSections
        : null;
      const sections = Array.isArray(config.clientVisibleSections)
        ? config.clientVisibleSections
        : SECTIONS.filter((section) => sectionFlags?.[section.value] !== false).map((section) => section.value);
      setForm({ displayName: config.displayName ?? workspaceQuery.data?.client.name ?? "", logoUrl: config.logoUrl ?? "", accentColor: config.accentColor ?? "#285B61", recipients: config.recipients ?? [], cadence: config.cadence ?? "monthly", clientVisibleSections: sections, markupBasisPoints: config.markupBasisPoints ?? 0, approvalStatus: config.approvalStatus ?? "", approvedAt: config.approvedAt ?? null });
    } else if (workspaceQuery.data?.client) {
      setForm((current) => ({ ...current, displayName: workspaceQuery.data!.client.name }));
    }
  }, [workspaceQuery.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/agency/reports", clientId] });
  const saveConfig = useMutation({
    mutationFn: () => apiRequest("/api/agency/reports/config", { method: "PUT", body: JSON.stringify({ clientTeamId: Number(clientId), displayName: form.displayName, logoUrl: form.logoUrl || null, accentColor: form.accentColor, recipients: form.recipients, cadence: form.cadence, clientVisibleSections: Object.fromEntries(SECTIONS.map((section) => [section.value, form.clientVisibleSections.includes(section.value)])), markupBasisPoints: form.markupBasisPoints }) }),
    onSuccess: () => { refresh(); toast({ title: "Configuration saved", description: "The report configuration is now Draft and needs approval." }); },
    onError: (error: Error) => toast({ title: "Could not save configuration", description: error.message, variant: "destructive" }),
  });
  const approveConfig = useMutation({
    mutationFn: () => apiRequest("/api/agency/reports/config/approve", { method: "POST", body: JSON.stringify({ clientTeamId: Number(clientId) }) }),
    onSuccess: () => { refresh(); toast({ title: "Configuration approved", description: "Rebilling is now available for generated reports." }); },
    onError: (error: Error) => toast({ title: "Approval unavailable", description: error.message, variant: "destructive" }),
  });
  const generate = useMutation({
    mutationFn: () => { const dates = monthDates(month); return apiRequest("/api/agency/reports/generate", { method: "POST", body: JSON.stringify({ clientTeamId: Number(clientId), periodStart: dates.start, periodEnd: dates.end }) }); },
    onSuccess: (result: { report: Report }) => { refresh(); setPreviewId(result.report.id); toast({ title: "Preview generated", description: "Review the client-safe snapshot before approving." }); },
    onError: (error: Error) => toast({ title: "Preview unavailable", description: error.message, variant: "destructive" }),
  });
  const reportAction = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "send" }) => apiRequest(`/api/agency/reports/${id}/${action}`, { method: "POST" }),
    onSuccess: (_, variables) => { refresh(); toast({ title: variables.action === "send" ? "Report sent" : "Report approved" }); },
    onError: (error: Error) => toast({ title: "Action unavailable", description: error.message, variant: "destructive" }),
  });

  const workspace = workspaceQuery.data;
  const configApproved = approved(workspace?.config ?? null);
  const reports = workspace?.reports ?? [];
  const detail = reportDetailQuery.data;
  const selectedReport = (detail && "report" in detail ? detail.report : detail) ?? reports.find((report) => report.id === previewId) ?? reports[0];
  const selectedSections = useMemo(() => new Set(form.clientVisibleSections), [form.clientVisibleSections]);
  const changeSection = (section: Section, checked: boolean) => setForm((current) => ({ ...current, clientVisibleSections: checked ? [...current.clientVisibleSections, section] : current.clientVisibleSections.filter((item) => item !== section) }));
  const addRecipient = () => { const value = email.trim().toLowerCase(); if (value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !form.recipients.includes(value)) setForm((current) => ({ ...current, recipients: [...current.recipients, value] })); setEmail(""); };

  if (clientsQuery.isLoading) return <div className="max-w-6xl mx-auto p-6 space-y-5"><Skeleton className="h-16 w-2/5" /><Skeleton className="h-80 w-full" /></div>;
  const clients = clientsQuery.data?.clients?.filter((client: any) => client.clientStatus !== "archived") ?? [];
  if (!clients.length) return <div className="max-w-3xl mx-auto p-6"><Card><CardContent className="py-12 text-center"><FileText className="h-8 w-8 mx-auto text-muted-foreground mb-3" /><p className="font-medium">No active client teams</p><p className="text-sm text-muted-foreground mt-1">Add an active client before preparing a report.</p></CardContent></Card></div>;

  return <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6" data-testid="agency-reports-workspace">
    <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b pb-5">
      <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Agency / Client reporting</p><h1 className="text-2xl font-semibold mt-1">Report desk</h1><p className="text-sm text-muted-foreground mt-1">Prepare a precise, client-safe record of the work.</p></div>
      <div className="w-full lg:w-72"><Label htmlFor="active-client" className="text-xs">Active client</Label><Select value={clientId} onValueChange={setClientId}><SelectTrigger id="active-client" data-testid="select-report-client"><SelectValue /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}</SelectItem>)}</SelectContent></Select></div>
    </header>
    {workspaceQuery.isLoading ? <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-96 w-full" /></div> : workspaceQuery.isError ? <Card><CardContent className="py-12 text-center"><p className="font-medium">Reports could not be loaded</p><Button className="mt-4" variant="outline" onClick={() => workspaceQuery.refetch()}><RefreshCw className="h-4 w-4 mr-2" />Try again</Button></CardContent></Card> : <>
      <div className={`rounded-lg border px-4 py-3 flex flex-col sm:flex-row gap-3 sm:items-center justify-between ${configApproved ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20" : "bg-amber-50 border-amber-200 dark:bg-amber-950/20"}`} data-testid="config-approval-state">
        <div className="flex gap-3"><div className={`mt-0.5 ${configApproved ? "text-emerald-700" : "text-amber-700"}`}>{configApproved ? <ShieldCheck className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}</div><div><p className="text-sm font-semibold">{configApproved ? "Configuration approved" : "Configuration draft"}</p><p className="text-xs text-muted-foreground">{configApproved ? "Reports can include the approved rebilling CSV." : "Any edit returns this configuration to Draft. Rebilling stays unavailable until approval."}</p></div></div>
        {!configApproved && <Button size="sm" onClick={() => approveConfig.mutate()} disabled={approveConfig.isPending} data-testid="button-approve-config"><ShieldCheck className="h-4 w-4 mr-2" />Approve configuration</Button>}
      </div>
      <div className="grid xl:grid-cols-[1.05fr_.95fr] gap-6">
        <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Palette className="h-4 w-4" />Client presentation</CardTitle><CardDescription>Only these details appear in the client-safe report.</CardDescription></CardHeader><CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="display-name">Display name</Label><Input id="display-name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} data-testid="input-report-display-name" /></div><div className="space-y-2"><Label htmlFor="accent-color">Accent color</Label><div className="flex gap-2"><Input id="accent-color" type="color" className="w-12 p-1" value={form.accentColor} onChange={(event) => setForm({ ...form, accentColor: event.target.value })} /><Input value={form.accentColor} onChange={(event) => setForm({ ...form, accentColor: event.target.value })} aria-label="Accent hex value" /></div></div></div>
          <div className="space-y-2"><Label htmlFor="logo-url">Logo URL <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="logo-url" placeholder="https://…" value={form.logoUrl} onChange={(event) => setForm({ ...form, logoUrl: event.target.value })} data-testid="input-report-logo" /></div>
          <div className="space-y-2"><Label>Recipients</Label><div className="flex gap-2"><Input value={email} placeholder="name@client.com" onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRecipient(); } }} aria-label="Recipient email" /><Button type="button" variant="outline" onClick={addRecipient} aria-label="Add recipient"><Plus className="h-4 w-4" /></Button></div><div className="flex flex-wrap gap-1.5">{form.recipients.map((recipient) => <Badge key={recipient} variant="secondary" className="gap-1">{recipient}<button type="button" onClick={() => setForm((current) => ({ ...current, recipients: current.recipients.filter((item) => item !== recipient) }))} aria-label={`Remove ${recipient}`}><X className="h-3 w-3" /></button></Badge>)}</div></div>
          <div className="grid sm:grid-cols-2 gap-4"><div className="space-y-2"><Label>Cadence</Label><Select value={form.cadence} onValueChange={(value: "monthly" | "manual") => setForm({ ...form, cadence: value })}><SelectTrigger data-testid="select-report-cadence"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="manual">Manual</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="markup">Markup percentage</Label><Input id="markup" type="number" min="0" step="0.1" value={(form.markupBasisPoints / 100).toString()} onChange={(event) => setForm({ ...form, markupBasisPoints: Math.round(Number(event.target.value || 0) * 100) })} data-testid="input-report-markup" /></div></div>
          <Separator /><div><Label className="mb-3 block">Visible evidence</Label><div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">{SECTIONS.map((section) => <label key={section.value} className="flex items-start gap-2 cursor-pointer"><Checkbox checked={selectedSections.has(section.value)} onCheckedChange={(value) => changeSection(section.value, Boolean(value))} /><span><span className="text-sm font-medium block">{section.label}</span><span className="text-xs text-muted-foreground">{section.note}</span></span></label>)}</div></div>
          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending} data-testid="button-save-report-config">{saveConfig.isPending ? "Saving…" : "Save configuration"}</Button>
        </CardContent></Card>
        <div className="space-y-6"><Card className="overflow-hidden"><div className="h-2" style={{ backgroundColor: form.accentColor || "#285B61" }} /><CardHeader><CardTitle className="text-base">Report run</CardTitle><CardDescription>Choose the month, then create a reviewable snapshot.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label htmlFor="report-month">Reporting month</Label><Input id="report-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} data-testid="input-report-month" /></div><div className="rounded-md bg-muted/60 p-3 text-sm"><span className="text-muted-foreground">Included period</span><p className="font-medium mt-0.5">{displayDate(monthDates(month).start)} – {displayDate(monthDates(month).end)}</p></div><Button className="w-full" onClick={() => generate.mutate()} disabled={!configApproved || generate.isPending} data-testid="button-generate-report"><FileText className="h-4 w-4 mr-2" />{generate.isPending ? "Generating preview…" : "Generate preview"}</Button>{!configApproved && <p className="text-xs text-amber-700">Approve the configuration before creating a report.</p>}</CardContent></Card>
           <ReportSnapshot report={selectedReport} accent={form.accentColor} displayName={form.displayName || workspace?.client.name || "Client"} onAction={(id, action) => reportAction.mutate({ id, action })} downloading={(id, kind) => download(`/api/agency/reports/${id}/download?kind=${kind}`, `${form.displayName || "report"}-${kind}.${kind === "report" ? "html" : "csv"}`)} busy={reportAction.isPending} configApproved={configApproved} />
        </div>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Delivery history</CardTitle><CardDescription>A record of report emails and any failed delivery attempts.</CardDescription></CardHeader><CardContent>{(workspace?.deliveries?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground py-3">No deliveries have been recorded for this client.</p> : <div className="space-y-2">{workspace!.deliveries.map((delivery) => <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0"><div><p className="text-sm font-medium">{delivery.recipient || "Recipient not available"}</p><p className="text-xs text-muted-foreground">{displayDate(delivery.sentAt || delivery.createdAt)}{delivery.error ? ` · ${delivery.error}` : ""}</p></div><Badge variant={delivery.status?.toLowerCase() === "failed" ? "destructive" : "secondary"}>{delivery.status || "Sent"}</Badge></div>)}</div>}</CardContent></Card>
    </>}
  </div>;
}

function ReportSnapshot({ report, accent, displayName, onAction, downloading, busy, configApproved }: { report?: Report; accent: string; displayName: string; onAction: (id: number, action: "approve" | "send") => void; downloading: (id: number, kind: "report" | "rebilling") => void; busy: boolean; configApproved: boolean }) {
  if (!report) return <Card><CardHeader><CardTitle className="text-base">Client-safe snapshot</CardTitle><CardDescription>Your generated report will appear here.</CardDescription></CardHeader><CardContent className="py-8 text-center text-sm text-muted-foreground">No report selected yet.</CardContent></Card>;
  const reportApproved = Boolean(report.approvedAt || report.status?.toLowerCase() === "approved" || report.status?.toLowerCase() === "sent");
  const snapshot = report.clientSafeSnapshot ?? {};
  return <Card data-testid="report-preview"><div className="h-2" style={{ backgroundColor: accent || "#285B61" }} /><CardHeader><div className="flex justify-between gap-3"><div><CardTitle className="text-base">Client-safe snapshot</CardTitle><CardDescription>{displayName} · {displayDate(report.periodStart)} – {displayDate(new Date(new Date(report.periodEnd).getTime() - 1).toISOString())}</CardDescription></div><Badge variant={reportApproved ? "default" : "secondary"}>{reportApproved ? "Approved" : "Preview"}</Badge></div></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-2 gap-2">{SECTIONS.map((section) => { const value = snapshot[section.value] as any; const available = Object.prototype.hasOwnProperty.call(snapshot, section.value) && value?.available !== false; return <div className="rounded-md border p-2.5" key={section.value}><p className="text-xs text-muted-foreground">{section.label}</p><p className="text-sm font-medium mt-1">{available ? "Evidence included" : "Not available"}</p></div>; })}</div><div className="flex flex-wrap gap-2">{!reportApproved && <Button size="sm" onClick={() => onAction(report.id, "approve")} disabled={busy || !configApproved} data-testid={`button-approve-report-${report.id}`}><CheckCircle2 className="h-4 w-4 mr-1.5" />Approve</Button>}<Button size="sm" variant="outline" onClick={() => downloading(report.id, "report")}><ArrowDownToLine className="h-4 w-4 mr-1.5" />Download report</Button><Button size="sm" variant="outline" disabled={!reportApproved || report.agencyRebillingSnapshot?.revenueAvailable !== true} onClick={() => downloading(report.id, "rebilling")}><FileSpreadsheet className="h-4 w-4 mr-1.5" />Rebilling CSV</Button><Button size="sm" variant="outline" disabled={!reportApproved || !configApproved || busy} onClick={() => onAction(report.id, "send")} data-testid={`button-send-report-${report.id}`}><Send className="h-4 w-4 mr-1.5" />Send email</Button></div>{!reportApproved && <p className="text-xs text-muted-foreground">Approve this report before sending it or exporting its rebilling CSV.</p>}</CardContent></Card>;
}