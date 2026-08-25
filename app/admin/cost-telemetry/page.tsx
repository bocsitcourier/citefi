"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";

type Data = {
  periodDays: number; summary: { ledgerEvents: number; netActualCogsUsd: number; usageCogsUsd: number; correctionsUsd: number; refundsUsd: number; unpricedEvents: number; creditsDebited: number };
  byProvider: { provider: string; eventCount: number; netActualCogsUsd: number; unpricedEvents: number }[];
  rateVersions: { rateVersionId: number | null; label: string; eventCount: number; netActualCogsUsd: number }[];
  invoiceReconciliations: { id: number; provider: string; invoiceReference: string; invoicedCostUsd: number; ledgerCostUsd: number; varianceUsd: number }[];
  creditProviderReconciliation: { providerRuns: number; creditDebitRuns: number; ledgerRunsWithoutCreditDebit: unknown[]; creditDebitsWithoutLedgerUsage: unknown[]; matches: boolean; note: string };
  negativeMarginWorkspaces: { teamId: number; teamName: string; margin: number }[];
  marginStatus: string;
};
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);

export default function CostTelemetryPage() {
  const { user, isLoading: authLoading } = useAuth(); const router = useRouter(); const [days, setDays] = useState(7);
  const query = useQuery<Data>({ queryKey: ["admin-ledger-profitability", days], queryFn: async () => { const r = await fetch(`/api/admin/cost-telemetry?days=${days}`); if (!r.ok) throw new Error("Could not load ledger accounting"); return r.json(); }, refetchOnWindowFocus: false });
  if (authLoading) return <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!user || user.role !== "admin") { router.push("/admin"); return null; }
  const s = query.data?.summary;
  return <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
    <header className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold tracking-widest uppercase text-primary">Platform accounting</p><h1 className="text-2xl font-semibold">Actual provider costs</h1><p className="text-sm text-muted-foreground">Immutable ledger entries, including later corrections and refunds.</p></div><div className="flex gap-2">{[7,30,90].map(d => <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d}d</Button>)}<Button size="icon" variant="outline" onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin h-4 w-4" : "h-4 w-4"} /></Button></div></header>
    {query.isLoading ? <div className="h-48 flex items-center justify-center"><Loader2 className="animate-spin" /></div> : query.isError ? <Card><CardContent className="p-6">Ledger accounting could not be loaded.</CardContent></Card> : query.data && <><section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[["Net actual COGS", money(s!.netActualCogsUsd)],["Corrections", money(s!.correctionsUsd)],["Refunds", money(s!.refundsUsd)],["Credits debited", s!.creditsDebited.toLocaleString()]].map(([label,value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></CardContent></Card>)}
    </section>
    <Card><CardHeader><CardTitle>Pricing completeness</CardTitle><CardDescription>{s!.ledgerEvents} ledger events; usage COGS before adjustments: {money(s!.usageCogsUsd)}.</CardDescription></CardHeader><CardContent><p className="text-sm">{s!.unpricedEvents ? <Badge variant="destructive">{s!.unpricedEvents} unpriced usage events</Badge> : <Badge variant="outline">All period usage has a locked rate</Badge>}</p><div className="overflow-x-auto mt-4"><Table><TableHeader><TableRow><TableHead>Locked rate</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Net COGS</TableHead></TableRow></TableHeader><TableBody>{query.data.rateVersions.map(r => <TableRow key={r.label}><TableCell>{r.label}</TableCell><TableCell className="text-right">{r.eventCount}</TableCell><TableCell className="text-right">{money(r.netActualCogsUsd)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Provider invoice reconciliation</CardTitle><CardDescription>Invoice variance is invoice amount minus ledger amount.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Provider / invoice</TableHead><TableHead className="text-right">Invoice</TableHead><TableHead className="text-right">Ledger</TableHead><TableHead className="text-right">Variance</TableHead></TableRow></TableHeader><TableBody>{query.data.invoiceReconciliations.length ? query.data.invoiceReconciliations.map(r => <TableRow key={r.id}><TableCell>{r.provider} · {r.invoiceReference}</TableCell><TableCell className="text-right">{money(r.invoicedCostUsd)}</TableCell><TableCell className="text-right">{money(r.ledgerCostUsd)}</TableCell><TableCell className="text-right">{money(r.varianceUsd)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="text-muted-foreground">No reconciled provider invoices overlap this period.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Credits-to-provider reconciliation</CardTitle><CardDescription>Compares attributable provider runs with credit debit runs. It reports gaps without changing balances.</CardDescription></CardHeader><CardContent className="space-y-2"><div className="flex flex-wrap gap-2"><Badge variant="outline">{query.data.creditProviderReconciliation.providerRuns} provider runs</Badge><Badge variant="outline">{query.data.creditProviderReconciliation.creditDebitRuns} credit debit runs</Badge><Badge variant={query.data.creditProviderReconciliation.matches ? "outline" : "destructive"}>{query.data.creditProviderReconciliation.matches ? "Run attribution matches" : `${query.data.creditProviderReconciliation.ledgerRunsWithoutCreditDebit.length + query.data.creditProviderReconciliation.creditDebitsWithoutLedgerUsage.length} mismatches`}</Badge></div><p className="text-xs text-muted-foreground">{query.data.creditProviderReconciliation.note}</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Negative-margin workspaces</CardTitle><CardDescription>Only approved rebilling or markup inputs can be used to calculate margin.</CardDescription></CardHeader><CardContent>{query.data.negativeMarginWorkspaces.length ? "Negative-margin workspaces are listed above." : <p className="text-sm text-muted-foreground">No workspace margin is shown: {query.data.marginStatus.replaceAll("_", " ")}. This page never estimates revenue from provider costs or plan prices.</p>}</CardContent></Card>
    </>}
  </main>;
}