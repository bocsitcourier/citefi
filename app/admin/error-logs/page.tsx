"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronDown, ChevronUp, Trash2, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ErrorEntry {
  id: number;
  source: "article" | "video_idea" | "social_video";
  errorType: string;
  errorMessage: string;
  severity: string;
  resolved: number;
  createdAt: string;
  articleId: number | null;
  batchId: number | null;
  title: string | null;
  parentName: string | null;
  screenshotUrl: string | null;
}

interface ErrorSummary {
  total: number;
  unresolved: number;
  critical: number;
  generation: number;
  brandValidation: number;
  dalle: number;
  social: number;
  videoIdeas: number;
  socialVideos: number;
}

interface ErrorLogsResponse {
  errors: ErrorEntry[];
  summary: ErrorSummary;
  page: number;
  hasMore: boolean;
}

function severityVariant(severity: string): "destructive" | "secondary" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "outline";
  return "secondary";
}

function sourceLabel(source: string) {
  switch (source) {
    case "article": return "Article";
    case "video_idea": return "Video Idea";
    case "social_video": return "Social Video";
    default: return source;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rowKey(entry: ErrorEntry) {
  return `${entry.source}-${entry.id}`;
}

function ErrorRow({
  entry,
  selected,
  onSelect,
  onResolve,
  onDelete,
}: {
  entry: ErrorEntry;
  selected: boolean;
  onSelect: (key: string, checked: boolean) => void;
  onResolve: (id: number, resolved: boolean) => void;
  onDelete: (entry: ErrorEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isResolved = entry.resolved === 1;
  const canDelete = entry.source === "article";

  return (
    <div
      className={cn(
        "border rounded-md p-4 space-y-2 transition-colors",
        isResolved ? "opacity-60" : "",
        selected ? "border-primary/50 bg-primary/5" : ""
      )}
      data-testid={`error-row-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {canDelete ? (
            <Checkbox
              checked={selected}
              onCheckedChange={(checked) => onSelect(rowKey(entry), !!checked)}
              data-testid={`checkbox-error-${entry.id}`}
              aria-label="Select error"
            />
          ) : (
            <div className="w-4" />
          )}
          <Badge variant={severityVariant(entry.severity)} data-testid={`badge-severity-${entry.id}`}>
            {entry.severity}
          </Badge>
          <Badge variant="outline" data-testid={`badge-source-${entry.id}`}>
            {sourceLabel(entry.source)}
          </Badge>
          <span className="text-sm font-mono text-muted-foreground">{entry.errorType}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDate(entry.createdAt)}
          </span>
          {!isResolved && entry.source === "article" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onResolve(entry.id, true)}
              data-testid={`button-resolve-${entry.id}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Resolve
            </Button>
          )}
          {isResolved && entry.source === "article" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onResolve(entry.id, false)}
              data-testid={`button-unresolve-${entry.id}`}
            >
              Reopen
            </Button>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(entry)}
              data-testid={`button-delete-${entry.id}`}
              aria-label="Delete error"
            >
              <Trash2 className="w-4 h-4 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      {(entry.title || entry.parentName) && (
        <div className="text-sm text-foreground font-medium pl-7">
          {entry.title || entry.parentName}
          {entry.title && entry.parentName && (
            <span className="text-muted-foreground font-normal"> — {entry.parentName}</span>
          )}
        </div>
      )}

      <div className="flex items-start gap-2 pl-7">
        <p
          className={cn(
            "text-sm text-muted-foreground flex-1",
            !expanded && "line-clamp-2"
          )}
          data-testid={`text-error-message-${entry.id}`}
        >
          {entry.errorMessage}
        </p>
        {entry.errorMessage && entry.errorMessage.length > 120 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0 pt-0.5"
            data-testid={`button-expand-${entry.id}`}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {entry.screenshotUrl && (
        <div className="mt-2 pl-7">
          <p className="text-xs text-muted-foreground mb-1 font-medium">UI Screenshot at time of error:</p>
          <a
            href={entry.screenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`link-screenshot-${entry.id}`}
          >
            <img
              src={entry.screenshotUrl}
              alt="Error screenshot"
              className="rounded-md border max-h-48 object-cover hover:opacity-80 transition-opacity cursor-zoom-in"
            />
          </a>
        </div>
      )}
    </div>
  );
}

function getAuthHeader() {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("auth_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AdminErrorLogsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery<ErrorLogsResponse>({
    queryKey: ["/api/admin/error-logs", typeFilter, severityFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ type: typeFilter, severity: severityFilter, page: String(page) });
      const res = await fetch(`/api/admin/error-logs?${params}`, {
        headers: getAuthHeader() as HeadersInit,
      });
      if (!res.ok) throw new Error("Failed to fetch error logs");
      return res.json();
    },
  });

  const errors = data?.errors || [];
  const summary = data?.summary;

  // Only article errors can be deleted (they live in error_logs table)
  const articleErrors = errors.filter(e => e.source === "article");
  const allArticleKeys = articleErrors.map(rowKey);
  const selectedCount = selected.size;
  const allSelected = allArticleKeys.length > 0 && allArticleKeys.every(k => selected.has(k));
  const someSelected = selectedCount > 0;

  function handleSelect(key: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(allArticleKeys));
    } else {
      setSelected(new Set());
    }
  }

  const resolveMutation = useMutation({
    mutationFn: async ({ id, resolved }: { id: number; resolved: boolean }) => {
      const res = await fetch("/api/admin/error-logs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeader() } as HeadersInit,
        body: JSON.stringify({ id, resolved }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (_, { resolved }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs"] });
      toast({ title: resolved ? "Error marked as resolved" : "Error reopened" });
    },
    onError: () => {
      toast({ title: "Failed to update error log", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/admin/error-logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...getAuthHeader() } as HeadersInit,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/error-logs"] });
      setSelected(new Set());
      const count = result?.deleted;
      toast({ title: count !== undefined ? `Deleted ${count} error${count !== 1 ? "s" : ""}` : "Errors deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete errors", variant: "destructive" });
    },
  });

  function handleDeleteSelected() {
    const ids = [...selected]
      .filter(k => k.startsWith("article-"))
      .map(k => Number(k.replace("article-", "")));
    if (ids.length === 0) return;
    deleteMutation.mutate({ ids });
  }

  function handleDeleteOne(entry: ErrorEntry) {
    deleteMutation.mutate({ ids: [entry.id] });
  }

  function handleClearResolved() {
    deleteMutation.mutate({ clearResolved: true });
  }

  const resolvedCount = summary?.total !== undefined
    ? articleErrors.filter(e => e.resolved === 1).length
    : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-destructive" />
            Error Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generation failures, AI errors, and validation issues
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleClearResolved}
            disabled={deleteMutation.isPending || resolvedCount === 0}
            data-testid="button-clear-resolved"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Clear Resolved
          </Button>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-errors"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">Total Errors</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <p className="text-2xl font-bold" data-testid="stat-total">{summary.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">Unresolved</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <p className="text-2xl font-bold text-destructive" data-testid="stat-unresolved">{summary.unresolved}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">Critical</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <p className="text-2xl font-bold text-destructive" data-testid="stat-critical">{summary.critical}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">Video / Social</CardTitle>
            </CardHeader>
            <CardContent className="pb-4 px-4">
              <p className="text-2xl font-bold" data-testid="stat-video">{(summary.videoIdeas || 0) + (summary.socialVideos || 0)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); setSelected(new Set()); }}>
          <SelectTrigger className="w-44" data-testid="select-type-filter">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="article">Articles</SelectItem>
            <SelectItem value="video_idea">Video Ideas</SelectItem>
            <SelectItem value="social_video">Social Videos</SelectItem>
          </SelectContent>
        </Select>

        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); setSelected(new Set()); }}>
          <SelectTrigger className="w-44" data-testid="select-severity-filter">
            <SelectValue placeholder="Filter by severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border rounded-md p-4 h-20 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : errors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-2">
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="font-medium">No errors found</p>
          <p className="text-sm">All systems are running cleanly for the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="error-list">
          {/* Batch action toolbar */}
          {articleErrors.length > 0 && (
            <div className="flex items-center gap-3 py-2 px-4 bg-muted/40 rounded-md border">
              <Checkbox
                checked={allSelected}
                onCheckedChange={handleSelectAll}
                data-testid="checkbox-select-all"
                aria-label="Select all article errors"
              />
              <span className="text-sm text-muted-foreground">
                {someSelected
                  ? `${selectedCount} selected`
                  : `Select all (${articleErrors.length} article error${articleErrors.length !== 1 ? "s" : ""})`}
              </span>
              {someSelected && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteSelected}
                  disabled={deleteMutation.isPending}
                  data-testid="button-delete-selected"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete {selectedCount} selected
                </Button>
              )}
              {someSelected && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                  data-testid="button-clear-selection"
                >
                  Clear selection
                </Button>
              )}
            </div>
          )}

          {errors.map((entry) => (
            <ErrorRow
              key={rowKey(entry)}
              entry={entry}
              selected={selected.has(rowKey(entry))}
              onSelect={handleSelect}
              onResolve={(id, resolved) => resolveMutation.mutate({ id, resolved })}
              onDelete={handleDeleteOne}
            />
          ))}
        </div>
      )}

      {(data?.hasMore || page > 1) && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            disabled={!data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
