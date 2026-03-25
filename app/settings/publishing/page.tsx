"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Plus, Globe, Trash2, RefreshCw, CheckCircle2, XCircle, Clock,
  Copy, Eye, EyeOff, FileText, Video, Headphones, MessageSquare,
  RotateCcw, SendHorizonal, AlertCircle, ExternalLink, Radio,
  Filter, Upload, Layers,
} from "lucide-react";
import { SiFacebook, SiLinkedin, SiTiktok } from "react-icons/si";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format, formatDistanceToNow } from "date-fns";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PublishingJob {
  id: number;
  publicId: string;
  connectionId: number;
  teamId: number;
  contentType: string;
  articleId: number | null;
  videoIdeaId: number | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  articleTitle: string | null;
  connectionName: string | null;
  connectionBaseUrl: string | null;
}

interface PublishingConnection {
  id: number;
  publicId: string;
  name: string;
  channel: string;
  status: string;
  baseUrl: string | null;
  lastHeartbeatAt: string | null;
  lastErrorMessage: string | null;
  capabilities: Record<string, boolean> | null;
  createdAt: string;
}

interface Article {
  id: number;
  title: string;
  article_status: string;
  batchId: number;
  location?: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNEL_OPTIONS = [
  { value: "website", label: "Website (Receiver)", icon: Globe, description: "Deploy receiver to your website" },
  { value: "facebook", label: "Facebook", icon: SiFacebook, description: "Post to Facebook Pages", disabled: true },
  { value: "linkedin", label: "LinkedIn", icon: SiLinkedin, description: "Share on LinkedIn", disabled: true },
  { value: "tiktok", label: "TikTok", icon: SiTiktok, description: "Upload videos to TikTok", disabled: true },
];

const STATUS_LABELS: Record<string, string> = {
  all: "All Statuses",
  pending: "Pending",
  processing: "Processing",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

const TYPE_LABELS: Record<string, string> = {
  all: "All Types",
  article: "Articles",
  video: "Videos",
  podcast: "Podcasts",
  social_post: "Social Posts",
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Badge variant="outline" className="gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
    case "processing":
      return <Badge variant="secondary" className="gap-1"><Loader2 className="w-3 h-3 animate-spin" />Processing</Badge>;
    case "sent":
      return <Badge className="gap-1 bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300"><SendHorizonal className="w-3 h-3" />Sent</Badge>;
    case "delivered":
      return <Badge className="gap-1 bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300"><CheckCircle2 className="w-3 h-3" />Delivered</Badge>;
    case "failed":
      return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function ConnectionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <Badge className="gap-1 bg-green-600 text-white"><CheckCircle2 className="w-3 h-3" />Active</Badge>;
    case "error":
      return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Error</Badge>;
    case "pending":
      return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function ContentTypeIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 text-muted-foreground";
  switch (type) {
    case "article": return <FileText className={cls} />;
    case "video": return <Video className={cls} />;
    case "podcast": return <Headphones className={cls} />;
    case "social_post": return <MessageSquare className={cls} />;
    default: return <Globe className={cls} />;
  }
}

function ChannelIcon({ channel }: { channel: string }) {
  const cls = "w-5 h-5";
  switch (channel) {
    case "website": return <Globe className={cls} />;
    case "facebook": return <SiFacebook className={cls} />;
    case "linkedin": return <SiLinkedin className={cls} />;
    case "tiktok": return <SiTiktok className={cls} />;
    default: return <Globe className={cls} />;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PublishingDashboard() {
  const { toast } = useToast();

  // ── Jobs state ──────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [retryingId, setRetryingId] = useState<number | null>(null);

  // ── Connections state ───────────────────────────────────────────────────
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState("website");
  const [newUrl, setNewUrl] = useState("");
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // ── Publish Now state ───────────────────────────────────────────────────
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishConnectionId, setPublishConnectionId] = useState<string>("");
  const [publishMode, setPublishMode] = useState<"single" | "batch">("single");
  const [publishArticleId, setPublishArticleId] = useState<string>("");
  const [publishBatchIds, setPublishBatchIds] = useState<Set<number>>(new Set());

  // ─── Data Queries ────────────────────────────────────────────────────────

  const buildJobsQueryKey = () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (typeFilter !== "all") params.set("contentType", typeFilter);
    return ["/api/publishing/jobs", statusFilter, typeFilter];
  };

  const fetchJobs = async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (typeFilter !== "all") params.set("contentType", typeFilter);
    const qs = params.toString();
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api/publishing/jobs${qs ? `?${qs}` : ""}`, { headers });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return res.json();
  };

  const { data: jobsData, isLoading: loadingJobs, refetch: refetchJobs } = useQuery<{ success: boolean; data: PublishingJob[] }>({
    queryKey: buildJobsQueryKey(),
    queryFn: fetchJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data?.data || [];
      const hasActive = jobs.some((j: PublishingJob) => j.status === "pending" || j.status === "processing" || j.status === "sent");
      return hasActive ? 4000 : 15000;
    },
  });

  const { data: connectionsData, isLoading: loadingConnections } = useQuery<{ success: boolean; data: PublishingConnection[] }>({
    queryKey: ["/api/publishing/connections"],
  });

  const { data: articlesData } = useQuery<any>({
    queryKey: ["/api/articles/list"],
    enabled: showPublishModal,
  });

  const jobs = jobsData?.data || [];
  const connections = connectionsData?.data || [];
  const publishableArticles: Article[] = Array.isArray(articlesData) ? articlesData : (articlesData?.data || articlesData?.articles || []);

  const hasActiveJobs = jobs.some((j) => j.status === "pending" || j.status === "processing" || j.status === "sent");

  // ─── Job Mutations ───────────────────────────────────────────────────────

  const retryMutation = useMutation({
    mutationFn: async (jobId: number) => {
      return await apiRequest(`/api/publishing/jobs/${jobId}/retry`, { method: "POST" });
    },
    onMutate: (jobId) => setRetryingId(jobId),
    onSettled: () => setRetryingId(null),
    onSuccess: () => {
      toast({ title: "Job queued for retry" });
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/jobs"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Retry failed", description: error?.message });
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await fetch(`/api/publishing/jobs/${jobId}`, { method: "DELETE", credentials: "include" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Job deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/jobs"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Delete failed", description: error?.message });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch("/api/publishing/jobs", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Deleted ${data.deleted} job${data.deleted !== 1 ? "s" : ""}` });
      setSelectedJobIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/jobs"] });
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Batch delete failed", description: error?.message });
    },
  });

  // ─── Connection Mutations ────────────────────────────────────────────────

  const createConnectionMutation = useMutation({
    mutationFn: async (data: { name: string; channel: string; baseUrl?: string }) => {
      const res = await apiRequest("/api/publishing/connections", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/connections"] });
      if (response.data?.apiKey) {
        setGeneratedApiKey(response.data.apiKey);
        setShowApiKey(true);
      } else {
        toast({ title: "Connection created" });
        setShowAddDialog(false);
        resetConnectionForm();
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create connection", description: error.message, variant: "destructive" });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (connectionId: number) => {
      return await apiRequest(`/api/publishing/connections/${connectionId}/test`, { method: "POST" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/connections"] });
      if (data.success) {
        toast({ title: "Connection successful", description: "Your receiver is responding correctly." });
      } else {
        toast({ title: "Connection failed", description: data.error || "Could not connect.", variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: async (connectionId: number) => {
      return await apiRequest(`/api/publishing/connections/${connectionId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/connections"] });
      toast({ title: "Connection deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  // ─── Publish Mutations ───────────────────────────────────────────────────

  const publishSingleMutation = useMutation({
    mutationFn: async ({ connectionId, contentId }: { connectionId: number; contentId: number }) => {
      const res = await apiRequest("/api/publishing/jobs", {
        method: "POST",
        body: JSON.stringify({ connectionId, contentType: "article", contentId }),
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Publishing job created", description: "Your article has been queued for publishing." });
      setShowPublishModal(false);
      setPublishArticleId("");
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/jobs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to publish", description: error.message, variant: "destructive" });
    },
  });

  const publishBatchMutation = useMutation({
    mutationFn: async ({ connectionId, articleIds }: { connectionId: number; articleIds: number[] }) => {
      const results = await Promise.allSettled(
        articleIds.map((id) =>
          apiRequest("/api/publishing/jobs", {
            method: "POST",
            body: JSON.stringify({ connectionId, contentType: "article", contentId: id }),
          })
        )
      );
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      toast({
        title: `${succeeded} article${succeeded !== 1 ? "s" : ""} queued for publishing`,
        description: failed > 0 ? `${failed} failed to queue.` : undefined,
      });
      setShowPublishModal(false);
      setPublishBatchIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/publishing/jobs"] });
    },
    onError: (error: Error) => {
      toast({ title: "Batch publish failed", description: error.message, variant: "destructive" });
    },
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const resetConnectionForm = () => {
    setNewName("");
    setNewChannel("website");
    setNewUrl("");
    setGeneratedApiKey(null);
    setShowApiKey(false);
  };

  const handleCreateConnection = () => {
    if (!newName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (newChannel === "website" && !newUrl.trim()) {
      toast({ title: "URL required", variant: "destructive" });
      return;
    }
    createConnectionMutation.mutate({
      name: newName,
      channel: newChannel,
      baseUrl: newChannel === "website" ? newUrl : undefined,
    });
  };

  const handleCopyApiKey = () => {
    if (generatedApiKey) {
      navigator.clipboard.writeText(generatedApiKey);
      toast({ title: "API key copied" });
    }
  };

  const toggleJobSelection = (id: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedJobIds.size === jobs.length) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(jobs.map((j) => j.id)));
    }
  };

  const toggleBatchArticle = (id: number) => {
    setPublishBatchIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handlePublish = () => {
    const connId = parseInt(publishConnectionId);
    if (!connId) {
      toast({ title: "Select a connection", variant: "destructive" });
      return;
    }
    if (publishMode === "single") {
      const artId = parseInt(publishArticleId);
      if (!artId) {
        toast({ title: "Select an article", variant: "destructive" });
        return;
      }
      publishSingleMutation.mutate({ connectionId: connId, contentId: artId });
    } else {
      if (publishBatchIds.size === 0) {
        toast({ title: "Select at least one article", variant: "destructive" });
        return;
      }
      publishBatchMutation.mutate({ connectionId: connId, articleIds: Array.from(publishBatchIds) });
    }
  };

  const canRetry = (job: PublishingJob) => job.status !== "delivered" && job.status !== "processing";
  const canDelete = (job: PublishingJob) => job.status !== "processing";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Publishing Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage connections and track content distribution
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveJobs && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Radio className="w-3 h-3 animate-pulse" />
              Live
            </Badge>
          )}
          <Button
            onClick={() => setShowPublishModal(true)}
            data-testid="button-publish-now"
          >
            <Upload className="w-4 h-4 mr-2" />
            Publish Now
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs" data-testid="tab-jobs">
            Publishing Jobs
            {jobs.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{jobs.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="connections" data-testid="tab-connections">
            Connections
            {connections.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{connections.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="setup" data-testid="tab-setup">Setup Guide</TabsTrigger>
        </TabsList>

        {/* ── Jobs Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="jobs" className="space-y-4 mt-4">
          {/* Filter Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSelectedJobIds(new Set()); }}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setSelectedJobIds(new Set()); }}>
                <SelectTrigger className="w-36" data-testid="select-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {selectedJobIds.size > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      data-testid="button-bulk-delete"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Delete {selectedJobIds.size} selected
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {selectedJobIds.size} jobs?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the selected publishing jobs. Jobs currently processing cannot be deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => batchDeleteMutation.mutate(Array.from(selectedJobIds))}
                        className="bg-destructive hover:bg-destructive/90"
                        data-testid="button-confirm-bulk-delete"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchJobs()}
                disabled={loadingJobs}
                data-testid="button-refresh-jobs"
              >
                <RefreshCw className={`w-4 h-4 mr-1 ${loadingJobs ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Jobs List */}
          {loadingJobs ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <Card>
              <CardContent className="text-center py-16">
                <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-lg">No publishing jobs</h3>
                <p className="text-muted-foreground text-sm mt-2">
                  {statusFilter !== "all" || typeFilter !== "all"
                    ? "No jobs match your filters."
                    : "Use Publish Now to send content to your connected sites."}
                </p>
                {(statusFilter !== "all" || typeFilter !== "all") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => { setStatusFilter("all"); setTypeFilter("all"); }}
                  >
                    Clear filters
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Select All */}
              <div className="flex items-center gap-2 px-1 pb-1">
                <Checkbox
                  checked={jobs.length > 0 && selectedJobIds.size === jobs.length}
                  onCheckedChange={toggleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <span className="text-xs text-muted-foreground">
                  {selectedJobIds.size > 0 ? `${selectedJobIds.size} of ${jobs.length} selected` : "Select all"}
                </span>
              </div>

              {jobs.map((job) => (
                <Card
                  key={job.id}
                  className={selectedJobIds.has(job.id) ? "border-primary/50 bg-primary/5" : ""}
                  data-testid={`job-card-${job.id}`}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className="flex items-center pt-0.5">
                        <Checkbox
                          checked={selectedJobIds.has(job.id)}
                          onCheckedChange={() => toggleJobSelection(job.id)}
                          data-testid={`checkbox-job-${job.id}`}
                        />
                      </div>

                      {/* Content Type Icon */}
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <ContentTypeIcon type={job.contentType} />
                      </div>

                      {/* Main Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="font-medium text-sm truncate max-w-xs"
                            data-testid={`text-job-title-${job.id}`}
                            title={job.articleTitle || undefined}
                          >
                            {job.articleTitle || `${job.contentType} #${job.articleId || job.videoIdeaId || job.id}`}
                          </span>
                          <StatusBadge status={job.status} />
                          <Badge variant="outline" className="text-xs capitalize">
                            {job.contentType.replace("_", " ")}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          {job.connectionName && (
                            <span className="flex items-center gap-1">
                              <Globe className="w-3 h-3" />
                              {job.connectionName}
                            </span>
                          )}
                          <span>{formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}</span>
                          <span>Attempts: {job.attempts}/{job.maxAttempts}</span>
                          {job.publishedAt && (
                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Published {formatDistanceToNow(new Date(job.publishedAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>

                        {job.lastError && (
                          <div
                            className="flex items-start gap-1.5 p-2 bg-destructive/10 rounded text-destructive text-xs mt-1"
                            data-testid={`text-job-error-${job.id}`}
                          >
                            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">{job.lastError}</span>
                          </div>
                        )}

                        {job.publishedUrl && (
                          <a
                            href={job.publishedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                            data-testid={`link-preview-${job.id}`}
                          >
                            <ExternalLink className="w-3 h-3" />
                            View published article
                          </a>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {job.publishedUrl && (
                          <Button
                            size="icon"
                            variant="ghost"
                            asChild
                            data-testid={`button-open-${job.id}`}
                          >
                            <a href={job.publishedUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                        )}
                        {canRetry(job) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryMutation.mutate(job.id)}
                            disabled={retryingId === job.id}
                            data-testid={`button-retry-${job.id}`}
                          >
                            {retryingId === job.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                          </Button>
                        )}
                        {canDelete(job) && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-muted-foreground"
                                data-testid={`button-delete-job-${job.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently remove the publishing job for
                                  "{job.articleTitle || `#${job.id}`}".
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteJobMutation.mutate(job.id)}
                                  className="bg-destructive hover:bg-destructive/90"
                                  data-testid="button-confirm-delete-job"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Connections Tab ───────────────────────────────────────────────── */}
        <TabsContent value="connections" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button
                  data-testid="button-add-connection"
                  onClick={() => { resetConnectionForm(); setShowAddDialog(true); }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Connection
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                {generatedApiKey ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>Save Your API Key</DialogTitle>
                      <DialogDescription>
                        This key will only be shown once. Copy it and add it to your receiver's environment.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="bg-muted p-4 rounded-md font-mono text-sm break-all" data-testid="text-api-key">
                        {showApiKey ? generatedApiKey : "••••••••••••••••••••••••••••••••"}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowApiKey(!showApiKey)} data-testid="button-toggle-key">
                          {showApiKey ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                          {showApiKey ? "Hide" : "Show"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleCopyApiKey} data-testid="button-copy-key">
                          <Copy className="w-4 h-4 mr-2" />
                          Copy
                        </Button>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Add to your receiver's <code className="bg-muted px-1 rounded">.env</code> file:
                        <pre className="mt-2 bg-muted p-2 rounded text-xs">
                          APEX_API_KEY={showApiKey ? generatedApiKey : "your-api-key-here"}
                        </pre>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => { setShowAddDialog(false); resetConnectionForm(); }} data-testid="button-done-key">
                        I've Saved the Key
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>Add Publishing Connection</DialogTitle>
                      <DialogDescription>
                        Connect a website or social media account to publish content automatically.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="connection-name">Connection Name</Label>
                        <Input
                          id="connection-name"
                          placeholder="e.g., My Main Website"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          data-testid="input-connection-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Channel Type</Label>
                        <Select value={newChannel} onValueChange={setNewChannel}>
                          <SelectTrigger data-testid="select-channel">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CHANNEL_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                                <div className="flex items-center gap-2">
                                  <opt.icon className="w-4 h-4" />
                                  <span>{opt.label}</span>
                                  {opt.disabled && <Badge variant="secondary" className="ml-2 text-xs">Soon</Badge>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {newChannel === "website" && (
                        <div className="space-y-2">
                          <Label htmlFor="connection-url">Receiver URL</Label>
                          <Input
                            id="connection-url"
                            type="url"
                            placeholder="https://yoursite.com"
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            data-testid="input-connection-url"
                          />
                          <p className="text-xs text-muted-foreground">
                            The base URL where your @apex/receiver is deployed.
                          </p>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                      <Button
                        onClick={handleCreateConnection}
                        disabled={createConnectionMutation.isPending}
                        data-testid="button-create-connection"
                      >
                        {createConnectionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Create Connection
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {loadingConnections ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : connections.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Globe className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No connections yet</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Add your first publishing connection to distribute content.
                </p>
                <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-first-connection">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Connection
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {connections.map((conn) => (
                <Card key={conn.id} data-testid={`card-connection-${conn.id}`}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                          <ChannelIcon channel={conn.channel} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm" data-testid={`text-connection-name-${conn.id}`}>
                              {conn.name}
                            </span>
                            <ConnectionStatusBadge status={conn.status} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-connection-url-${conn.id}`}>
                            {conn.baseUrl || conn.channel}
                          </p>
                          {conn.lastHeartbeatAt && (
                            <p className="text-xs text-muted-foreground">
                              Last ping: {formatDistanceToNow(new Date(conn.lastHeartbeatAt), { addSuffix: true })}
                            </p>
                          )}
                          {conn.lastErrorMessage && (
                            <p className="text-xs text-destructive mt-0.5">{conn.lastErrorMessage}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {conn.channel === "website" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => testConnectionMutation.mutate(conn.id)}
                            disabled={testConnectionMutation.isPending}
                            data-testid={`button-test-${conn.id}`}
                          >
                            {testConnectionMutation.isPending ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4 mr-1" />
                            )}
                            Test
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground"
                              data-testid={`button-delete-connection-${conn.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Connection</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{conn.name}"? This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteConnectionMutation.mutate(conn.id)}
                                className="bg-destructive hover:bg-destructive/90"
                                data-testid="button-confirm-delete-connection"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Setup Guide Tab ───────────────────────────────────────────────── */}
        <TabsContent value="setup" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Receiver Setup Guide</CardTitle>
              <CardDescription>
                Install and configure the @apex/receiver package on your website.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div>
                <h4 className="font-medium mb-2">1. Install the Receiver Package</h4>
                <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">npm install @apex/receiver</pre>
              </div>
              <div>
                <h4 className="font-medium mb-2">2. Configure Environment Variables</h4>
                <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">
{`APEX_API_KEY=your-api-key
APEX_ENGINE_URL=${typeof window !== "undefined" ? window.location.origin : "https://your-engine.replit.app"}
BASE_URL=https://yoursite.com`}
                </pre>
              </div>
              <div>
                <h4 className="font-medium mb-2">3. Add to Your Express App</h4>
                <pre className="bg-muted p-3 rounded-md overflow-x-auto text-xs">
{`import { createReceiverApp } from '@apex/receiver';
const receiver = createReceiverApp();
app.use('/api/v1', receiver);`}
                </pre>
              </div>
              <div>
                <h4 className="font-medium mb-2">4. Add a Connection</h4>
                <p className="text-muted-foreground">
                  Go to the Connections tab, click "Add Connection", and enter your website URL to generate an API key.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Publish Now Modal ─────────────────────────────────────────────── */}
      <Dialog open={showPublishModal} onOpenChange={(open) => {
        if (!open) {
          setPublishBatchIds(new Set());
          setPublishConnectionId("");
          setPublishMode("single");
          setPublishArticleId("");
        }
        setShowPublishModal(open);
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Publish Content</DialogTitle>
            <DialogDescription>
              Choose a connection and select articles to publish.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 overflow-hidden flex-1">
            {/* Connection Select */}
            <div className="space-y-2">
              <Label>Publishing Connection</Label>
              <Select value={publishConnectionId} onValueChange={setPublishConnectionId}>
                <SelectTrigger data-testid="select-publish-connection">
                  <SelectValue placeholder="Select a connection..." />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={String(conn.id)}>
                      <div className="flex items-center gap-2">
                        <ChannelIcon channel={conn.channel} />
                        <span>{conn.name}</span>
                        <span className="text-xs text-muted-foreground">{conn.baseUrl}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connections.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No connections available. Add one in the Connections tab first.
                </p>
              )}
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center gap-2">
              <Button
                variant={publishMode === "single" ? "default" : "outline"}
                size="sm"
                onClick={() => setPublishMode("single")}
                data-testid="button-mode-single"
              >
                <FileText className="w-3 h-3 mr-1" />
                Single Article
              </Button>
              <Button
                variant={publishMode === "batch" ? "default" : "outline"}
                size="sm"
                onClick={() => setPublishMode("batch")}
                data-testid="button-mode-batch"
              >
                <Layers className="w-3 h-3 mr-1" />
                Batch ({publishBatchIds.size > 0 ? publishBatchIds.size : "Multiple"})
              </Button>
            </div>

            {/* Article Selection */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <Label className="mb-2">
                {publishMode === "single" ? "Select Article" : `Select Articles (${publishBatchIds.size} selected)`}
              </Label>

              {publishMode === "single" ? (
                <Select value={publishArticleId} onValueChange={setPublishArticleId}>
                  <SelectTrigger data-testid="select-publish-article">
                    <SelectValue placeholder="Choose an article..." />
                  </SelectTrigger>
                  <SelectContent>
                    {publishableArticles.map((art) => (
                      <SelectItem key={art.id} value={String(art.id)}>
                        <span className="truncate max-w-xs" title={art.title}>{art.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="overflow-y-auto border rounded-md divide-y flex-1 max-h-64">
                  {publishableArticles.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      No publishable articles found.
                    </div>
                  ) : (
                    publishableArticles.map((art) => (
                      <div
                        key={art.id}
                        className="flex items-center gap-3 px-3 py-2 hover-elevate cursor-pointer"
                        onClick={() => toggleBatchArticle(art.id)}
                        data-testid={`batch-article-${art.id}`}
                      >
                        <Checkbox
                          checked={publishBatchIds.has(art.id)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => toggleBatchArticle(art.id)}
                        />
                        <span className="text-sm truncate flex-1">{art.title}</span>
                        <Badge variant="outline" className="text-xs shrink-0">{art.article_status}</Badge>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setShowPublishModal(false)}>Cancel</Button>
            <Button
              onClick={handlePublish}
              disabled={publishSingleMutation.isPending || publishBatchMutation.isPending || !publishConnectionId}
              data-testid="button-confirm-publish"
            >
              {(publishSingleMutation.isPending || publishBatchMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {publishMode === "batch" && publishBatchIds.size > 0
                ? `Publish ${publishBatchIds.size} Articles`
                : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
