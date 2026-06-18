"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Building2,
  Plus,
  Archive,
  RefreshCw,
  Users,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Clock,
} from "lucide-react";

interface ClientTeam {
  id: number;
  publicId: string;
  name: string;
  clientStatus: "active" | "archived";
  billingPlan: string;
  createdAt: string;
}

interface AgencyData {
  clients: ClientTeam[];
  agencyTeam: { id: number; name: string };
}

interface IntelligenceStatus {
  status: string;
  companyName: string;
  lastRunAt: string | null;
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchClients(): Promise<AgencyData> {
  const res = await fetch("/api/agency/clients", { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err.error ?? "Failed to load clients"), { status: res.status, body: err });
  }
  return res.json();
}

function IntelBadge({ status, lastRunAt }: { status: string | undefined; lastRunAt: string | null | undefined }) {
  if (!status) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-intel-none">
            <Sparkles className="w-3 h-3" />
            No Intel
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Brand Intelligence not set up for this client</TooltipContent>
      </Tooltip>
    );
  }
  if (status === "complete") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-600/40 bg-green-50 dark:bg-green-950/20" data-testid="badge-intel-complete">
            <CheckCircle2 className="w-3 h-3" />
            Intel Active
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          Brand Intelligence active
          {lastRunAt && ` · Updated ${new Date(lastRunAt).toLocaleDateString()}`}
        </TooltipContent>
      </Tooltip>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/40" data-testid="badge-intel-running">
        <Loader2 className="w-3 h-3 animate-spin" />
        Researching…
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-destructive border-destructive/40" data-testid="badge-intel-failed">
        <AlertTriangle className="w-3 h-3" />
        Intel Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-intel-pending">
      <Clock className="w-3 h-3" />
      Pending
    </Badge>
  );
}

export default function AgencyPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWebsiteUrl, setNewWebsiteUrl] = useState("");
  const [switchingTo, setSwitchingTo] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<AgencyData>({
    queryKey: ["/api/agency/clients"],
    queryFn: fetchClients,
    retry: false,
  });

  const { data: intelData } = useQuery<{ statuses: Record<number, IntelligenceStatus> }>({
    queryKey: ["/api/intelligence/agency"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence/agency", { headers: getAuthHeaders() });
      if (!res.ok) return { statuses: {} };
      return res.json();
    },
    enabled: !isLoading && !error && (data?.clients?.length ?? 0) > 0,
  });

  const intelStatuses = intelData?.statuses ?? {};

  const createMutation = useMutation({
    mutationFn: async ({ name, websiteUrl }: { name: string; websiteUrl?: string }) => {
      const res = await fetch("/api/agency/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ name, websiteUrl: websiteUrl || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create client");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agency/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/intelligence/agency"] });
      setShowCreate(false);
      setNewName("");
      setNewWebsiteUrl("");
      const hasIntel = Boolean(data?.intelligenceJobId);
      toast({
        title: "Client created",
        description: hasIntel
          ? "New client team created. Brand intelligence research has started automatically."
          : "New client team is ready.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "active" | "archived" }) => {
      const res = await fetch(`/api/agency/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ clientStatus: status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to update client");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agency/clients"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  async function handleSwitchTeam(clientId: number, clientName: string) {
    setSwitchingTo(clientId);
    try {
      const res = await fetch("/api/auth/team-context", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ teamId: clientId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to switch team");
      }
      toast({ title: "Team switched", description: `Now managing: ${clientName}` });
      window.location.href = "/home";
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSwitchingTo(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not on agency plan
  if (error) {
    const apiError = (error as any).body;
    const isNotAgency = apiError?.upgradeUrl;
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">
                  {isNotAgency ? "Agency plan required" : "Failed to load agency clients"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isNotAgency
                    ? "Upgrade to the Agency plan to create and manage client teams."
                    : String(error)}
                </p>
                {isNotAgency && (
                  <Button className="mt-4" onClick={() => window.location.href = "/settings/billing"}>
                    Upgrade to Agency
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeClients = data?.clients.filter((c) => c.clientStatus === "active") ?? [];
  const archivedClients = data?.clients.filter((c) => c.clientStatus === "archived") ?? [];

  const intelActiveCount = activeClients.filter((c) => intelStatuses[c.id]?.status === "complete").length;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="w-6 h-6" />
            Agency Clients
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage client teams under <strong>{data?.agencyTeam.name}</strong>.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-client">
          <Plus className="w-4 h-4 mr-2" />
          Add Client
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active Clients</p>
            <p className="text-2xl font-bold mt-1">{activeClients.length}</p>
            <p className="text-xs text-muted-foreground">of 25 max</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Archived</p>
            <p className="text-2xl font-bold mt-1">{archivedClients.length}</p>
          </CardContent>
        </Card>
        {activeClients.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Intel Active
              </p>
              <p className="text-2xl font-bold mt-1">{intelActiveCount}</p>
              <p className="text-xs text-muted-foreground">of {activeClients.length} clients</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Active clients */}
      {activeClients.length === 0 ? (
        <Card>
          <CardContent className="pt-8 pb-8 text-center">
            <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No client teams yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first client team to start managing their content.
            </p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active</h2>
          <div className="grid gap-3">
            {activeClients.map((client) => {
              const intel = intelStatuses[client.id];
              return (
                <Card key={client.id} data-testid={`card-client-${client.id}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{client.name}</p>
                            <IntelBadge status={intel?.status} lastRunAt={intel?.lastRunAt} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Created {new Date(client.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => archiveMutation.mutate({ id: client.id, status: "archived" })}
                          disabled={archiveMutation.isPending}
                          data-testid={`button-archive-client-${client.id}`}
                        >
                          <Archive className="w-3 h-3 mr-1" />
                          Archive
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleSwitchTeam(client.id, client.name)}
                          disabled={switchingTo === client.id}
                          data-testid={`button-switch-client-${client.id}`}
                        >
                          {switchingTo === client.id ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <ArrowRight className="w-3 h-3 mr-1" />
                          )}
                          Manage
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Archived clients */}
      {archivedClients.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Archived</h2>
          <div className="grid gap-3">
            {archivedClients.map((client) => (
              <Card key={client.id} className="opacity-60" data-testid={`card-client-archived-${client.id}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        <Badge variant="secondary" className="text-xs">Archived</Badge>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => archiveMutation.mutate({ id: client.id, status: "active" })}
                      disabled={archiveMutation.isPending}
                      data-testid={`button-restore-client-${client.id}`}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Restore
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Create client dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => {
        setShowCreate(open);
        if (!open) { setNewName(""); setNewWebsiteUrl(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Client Team</DialogTitle>
            <DialogDescription>
              Create a new client team. Add a website URL to auto-start Brand Intelligence research.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="client-name">Client name <span className="text-destructive">*</span></Label>
              <Input
                id="client-name"
                placeholder="Acme Corp"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                data-testid="input-client-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-website">
                Website URL <span className="text-muted-foreground text-xs">(optional — enables Brand Intelligence)</span>
              </Label>
              <Input
                id="client-website"
                placeholder="https://acmecorp.com"
                value={newWebsiteUrl}
                onChange={(e) => setNewWebsiteUrl(e.target.value)}
                data-testid="input-client-website"
              />
              {newWebsiteUrl && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-primary" />
                  Brand Intelligence research will start automatically after creation.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName.trim(), websiteUrl: newWebsiteUrl.trim() || undefined })}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-confirm-create-client"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Create Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
