"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, History, RefreshCw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamBalance {
  teamId: number;
  teamName: string | null;
  balance: number;
  updatedAt: string;
}

interface LedgerRow {
  id: number;
  teamId: number;
  userId: number | null;
  adminUserId: number | null;
  amount: number;
  balanceAfter: number;
  eventType: string;
  productType: string | null;
  sourceType: string | null;
  reason: string | null;
  reversedAt: string | null;
  createdAt: string;
}

interface TeamLedgerData {
  balance: number;
  teamId: number;
  ledger: LedgerRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const EVENT_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  grant: "default",
  debit: "destructive",
  refund: "secondary",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminCreditsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [ledgerTeamId, setLedgerTeamId] = useState<number | null>(null);
  const [grantTeamId, setGrantTeamId] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const { data: allBalances, isLoading, refetch, isFetching } = useQuery<{ balances: TeamBalance[] }>({
    queryKey: ["/api/admin/credits"],
    queryFn: () => fetch("/api/admin/credits").then((r) => r.json()),
    refetchOnWindowFocus: false,
  });

  const { data: ledgerData, isLoading: isLedgerLoading } = useQuery<TeamLedgerData>({
    queryKey: ["/api/admin/credits", ledgerTeamId],
    queryFn: () =>
      fetch(`/api/admin/credits?teamId=${ledgerTeamId}`).then((r) => r.json()),
    enabled: !!ledgerTeamId,
  });

  const grantMutation = useMutation({
    mutationFn: async (body: { teamId: number; amount: number; reason?: string }) =>
      apiRequest("POST", "/api/admin/credits/grant", body),
    onSuccess: async () => {
      toast({ title: "Credits granted", description: `${grantAmount} credits added to team ${grantTeamId}.` });
      setGrantDialogOpen(false);
      setGrantTeamId("");
      setGrantAmount("");
      setGrantReason("");
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/credits"] });
      if (ledgerTeamId) {
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/credits", ledgerTeamId] });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message ?? "Failed to grant credits", variant: "destructive" });
    },
  });

  const handleGrant = () => {
    const teamId = parseInt(grantTeamId, 10);
    const amount = parseInt(grantAmount, 10);
    if (!teamId || !amount || amount < 1) {
      toast({ title: "Invalid input", description: "Team ID and amount must be positive integers.", variant: "destructive" });
      return;
    }
    grantMutation.mutate({ teamId, amount, reason: grantReason || undefined });
  };

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

  const balances = allBalances?.balances ?? [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Credit Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            View balances, grant credits, and inspect ledger history per team
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => setGrantDialogOpen(true)}
            data-testid="button-grant-credits"
          >
            <Plus className="h-4 w-4 mr-2" />
            Grant Credits
          </Button>
        </div>
      </div>

      {/* Balances Table */}
      <Card>
        <CardHeader>
          <CardTitle>Team Credit Balances</CardTitle>
          <CardDescription>
            Current credit balance for every team · click a row to view its ledger
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : balances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teams have credit records yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team ID</TableHead>
                  <TableHead>Team Name</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Last Updated</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((row) => (
                  <TableRow
                    key={row.teamId}
                    data-testid={`row-team-${row.teamId}`}
                    className="cursor-pointer"
                    onClick={() => setLedgerTeamId(row.teamId)}
                  >
                    <TableCell className="text-muted-foreground text-sm">{row.teamId}</TableCell>
                    <TableCell className="font-medium">{row.teamName ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={row.balance <= 0 ? "destructive" : row.balance < 20 ? "secondary" : "default"}
                        data-testid={`badge-balance-${row.teamId}`}
                      >
                        {row.balance.toLocaleString()} credits
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {relativeTime(row.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); setLedgerTeamId(row.teamId); }}
                        data-testid={`button-ledger-${row.teamId}`}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ledger Panel */}
      {ledgerTeamId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>Ledger — Team {ledgerTeamId}</CardTitle>
                <CardDescription>Last 100 transactions</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {ledgerData && (
                  <Badge variant="outline" data-testid="text-ledger-balance">
                    Balance: {ledgerData.balance.toLocaleString()}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setGrantTeamId(String(ledgerTeamId));
                    setGrantDialogOpen(true);
                  }}
                  data-testid="button-grant-this-team"
                >
                  <Plus className="h-4 w-4 mr-1" /> Grant
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLedgerTeamId(null)}
                  data-testid="button-close-ledger"
                >
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLedgerLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !ledgerData?.ledger?.length ? (
              <p className="text-sm text-muted-foreground">No ledger entries yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance After</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerData.ledger.map((row) => (
                    <TableRow
                      key={row.id}
                      data-testid={`row-ledger-${row.id}`}
                      className={row.reversedAt ? "opacity-50" : ""}
                    >
                      <TableCell>
                        <Badge variant={EVENT_BADGE[row.eventType] ?? "outline"}>
                          {row.eventType}
                          {row.reversedAt && " (reversed)"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.productType ?? "—"}
                      </TableCell>
                      <TableCell className={`text-right font-medium text-sm ${row.amount > 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                        {row.amount > 0 ? `+${row.amount}` : row.amount}
                      </TableCell>
                      <TableCell className="text-right text-sm">{row.balanceAfter.toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {row.reason ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {relativeTime(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grant Dialog */}
      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Credits</DialogTitle>
            <DialogDescription>
              Add credits to a team&apos;s balance. This is recorded in the ledger with your admin ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="grant-team-id">Team ID</Label>
              <Input
                id="grant-team-id"
                type="number"
                placeholder="e.g. 42"
                value={grantTeamId}
                onChange={(e) => setGrantTeamId(e.target.value)}
                data-testid="input-grant-team-id"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-amount">Credits to Add</Label>
              <Input
                id="grant-amount"
                type="number"
                placeholder="e.g. 100"
                min={1}
                max={100000}
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                data-testid="input-grant-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-reason">Reason (optional)</Label>
              <Input
                id="grant-reason"
                placeholder="e.g. Trial extension, support grant, plan upgrade"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                data-testid="input-grant-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialogOpen(false)} data-testid="button-cancel-grant">
              Cancel
            </Button>
            <Button
              onClick={handleGrant}
              disabled={grantMutation.isPending}
              data-testid="button-confirm-grant"
            >
              {grantMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Grant Credits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
