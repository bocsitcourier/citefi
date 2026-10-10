"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, MessageSquare, Clock, ChevronDown, ChevronUp, RefreshCw, ShieldCheck, FileText, Film, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ReviewArticle {
  id: number;
  publicId: string;
  chosenTitle: string;
  seoTitle: string | null;
  slug: string | null;
  wordCount: number | null;
  approvalStatus: string;
  approvalFeedback: string | null;
  approvalRequestedAt: string | null;
  approvalReviewedAt: string | null;
  heroImageUrl: string | null;
  teamId: number;
  approvalTeamId: number | null;
  batchId: number;
  createdAt: string;
  publishingReviewBound?: boolean;
}

interface Connection {
  id: number;
  name: string;
  channel: string;
  baseUrl: string;
}

interface AssignmentTeam {
  id: number;
  name: string;
}

interface ReviewAsset {
  sourceKey: string;
  sha256: string;
  size: number;
  pinnedKey: string;
}

interface MediaToUpload {
  id: number;
  sourceUrl: string;
  filename: string;
  mimeType: string;
  type: string;
  altText: string;
}

interface DestinationReview {
  digest: string;
  contentType: "article" | "podcast";
  destination: { id: number; name: string; channel: string; origin: string; accountFingerprint: string };
  formatted: { payload?: Record<string, unknown>; mediaToUpload?: MediaToUpload[] };
  assets: ReviewAsset[];
  assignmentTeamId: number | null;
}

interface ApprovalPreview {
  canReview: boolean;
  canAssign: boolean;
  assignmentTeams: AssignmentTeam[];
  assignmentTeamId: number | null;
  updatedAt: string;
  connections: Connection[];
  policy: string;
  review?: DestinationReview;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "secondary" },
  in_review: { label: "In Review", color: "default" },
  approved: { label: "Approved (revalidation required)", color: "secondary" },
  changes_requested: { label: "Changes Requested", color: "destructive" },
};

function safePreviewUrl(raw: string) {
  try {
    const url = new URL(raw, typeof window === "undefined" ? "https://local.invalid" : window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function MediaPreview({ media, contextLabel }: { media: MediaToUpload; contextLabel: string }) {
  const url = safePreviewUrl(media.sourceUrl);
  if (!url) return <p className="text-xs text-destructive">Preview unavailable: invalid media URL.</p>;
  const kind = media.type.toLowerCase();
  return (
    <div className="space-y-2">
      {kind.includes("image") || media.mimeType.startsWith("image/") ? (
        // URL is server-provided signed media, guarded to http(s) above.
        <img src={url} alt={media.altText?.trim() || `Image attached to ${contextLabel}`} className="max-h-72 w-auto rounded-md border bg-muted object-contain" />
      ) : kind.includes("audio") || media.mimeType.startsWith("audio/") ? (
        <audio controls preload="metadata" className="w-full" src={url}>Audio preview unavailable.</audio>
      ) : kind.includes("video") || media.mimeType.startsWith("video/") ? (
        <video controls preload="metadata" className="max-h-72 w-full rounded-md bg-black" src={url}>Video preview unavailable.</video>
      ) : <a href={url} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">{media.filename} — open media</a>}
    </div>
  );
}

function DataBlock({ title, value }: { title: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h4>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed" data-testid={`formatted-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
        {text ?? "No formatted payload supplied."}
      </pre>
    </section>
  );
}

function ArticleReviewCard({ article, onAction, busy }: {
  article: ReviewArticle;
  onAction: (
    id: number,
    action: string,
    feedback?: string,
    connectionId?: number,
    contentType?: "article" | "podcast",
    digest?: string,
    expectedUpdatedAt?: string,
    approvalTeamId?: number | null,
    access?: { canReview: boolean; canAssign: boolean; assignmentConfirmed: boolean; status: string },
  ) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState(article.approvalFeedback ?? "");
  const [connectionId, setConnectionId] = useState("");
  const [contentType, setContentType] = useState<"article" | "podcast">("article");
  const [reviewed, setReviewed] = useState(false);
  const [assignmentSelection, setAssignmentSelection] = useState("");
  const [assignmentChangedConfirmed, setAssignmentChangedConfirmed] = useState(false);
  const [assignmentLoadedAt, setAssignmentLoadedAt] = useState("");
  const { data: options, isLoading: optionsLoading, isError: optionsError, error: optionsErrorValue, refetch: refetchOptions } = useQuery<ApprovalPreview>({
    queryKey: ["/api/content", article.id, "approve-options"],
    queryFn: () => apiRequest(`/api/content/${article.id}/approve`),
    enabled: expanded,
    staleTime: 0,
  });
  const connections = options?.connections ?? [];
  const selectedConnection = connectionId ? Number(connectionId) : undefined;
  const selectionKey = `${article.id}:${connectionId}:${contentType}`;
  const reviewQuery = useQuery<ApprovalPreview>({
    queryKey: ["/api/content", article.id, "approve-review", selectionKey],
    queryFn: () => apiRequest(`/api/content/${article.id}/approve?connectionId=${encodeURIComponent(connectionId)}&contentType=${contentType}`),
    enabled: expanded && !!connectionId && !optionsLoading && !!connections.some((item) => item.id === selectedConnection),
    staleTime: 0,
    retry: false,
  });
  const review = reviewQuery.data?.review;
  const statusInfo = article.approvalStatus === "approved" && !article.publishingReviewBound
    ? { label: "Legacy approved — fresh review required", color: "secondary" }
    : STATUS_LABELS[article.approvalStatus] ?? { label: article.approvalStatus, color: "secondary" };
  const reqAt = article.approvalRequestedAt ? new Date(article.approvalRequestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
  const reviewMatches = !!review && review.destination.id === selectedConnection && review.contentType === contentType;
  const canApprove = reviewMatches && reviewed && options?.canReview === true && article.approvalStatus === "in_review" && !busy && !reviewQuery.isFetching;
  const assignmentValue = options?.assignmentTeamId == null ? "__owning_team__" : String(options.assignmentTeamId);
  const selectedAssignmentValue = assignmentSelection || assignmentValue;
  const hasAssignmentChange = !!options?.canAssign && selectedAssignmentValue !== assignmentValue;
  const selectedAssignmentId = selectedAssignmentValue === "__owning_team__" ? null : Number(selectedAssignmentValue);
  const canChangeStatus = !!options?.updatedAt && !optionsError && !busy;

  useEffect(() => {
    setReviewed(false);
  }, [selectionKey]);

  useEffect(() => {
    if (options?.updatedAt && options.updatedAt !== assignmentLoadedAt) {
      setAssignmentSelection(assignmentValue);
      setAssignmentLoadedAt(options.updatedAt);
      setAssignmentChangedConfirmed(false);
    }
  }, [options?.updatedAt, assignmentValue, assignmentLoadedAt]);

  function changeSelection(connection: string, type: "article" | "podcast") {
    setConnectionId(connection);
    setContentType(type);
    setReviewed(false);
  }

  function requestFreshReview() {
    if (!options?.updatedAt) return;
    onAction(
      article.id,
      "in_review",
      feedback,
      selectedConnection,
      contentType,
      reviewMatches ? review.digest : undefined,
      options.updatedAt,
      hasAssignmentChange ? selectedAssignmentId : undefined,
      { canReview: options.canReview, canAssign: options.canAssign, assignmentConfirmed: assignmentChangedConfirmed, status: article.approvalStatus },
    );
    setReviewed(false);
  }

  return (
    <Card data-testid={`card-review-article-${article.id}`} className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug" data-testid={`text-article-title-${article.id}`}>{article.chosenTitle}</p>
          {article.seoTitle && article.seoTitle !== article.chosenTitle && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{article.seoTitle}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge variant={statusInfo.color as any} className="text-xs" data-testid={`badge-status-${article.id}`}>{statusInfo.label}</Badge>
            {article.wordCount && <span className="text-xs text-muted-foreground">{article.wordCount.toLocaleString()} words</span>}
            {reqAt && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Requested {reqAt}</span>}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)} data-testid={`button-expand-${article.id}`} aria-label={expanded ? "Collapse review" : "Expand review"}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-5 pt-0">
          <Separator />
          {article.approvalFeedback && (
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Previous feedback</p>
              <p className="text-sm">{article.approvalFeedback}</p>
            </div>
          )}

          <div className="rounded-lg border bg-card p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2 text-primary"><ShieldCheck className="h-4 w-4" /></div>
              <div>
                <h3 className="text-sm font-semibold">Destination-bound approval</h3>
                <p className="text-xs text-muted-foreground mt-1">Approval applies only to the exact formatted version and connected account reviewed below.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor={`destination-${article.id}`}>Destination</label>
                <Select value={connectionId} onValueChange={(value) => changeSelection(value, contentType)} disabled={optionsLoading || busy}>
                  <SelectTrigger id={`destination-${article.id}`} data-testid={`select-destination-${article.id}`}><SelectValue placeholder={optionsLoading ? "Loading destinations…" : "Choose a destination"} /></SelectTrigger>
                  <SelectContent>{connections.map((connection) => <SelectItem key={connection.id} value={String(connection.id)}>{connection.name} · {connection.channel}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor={`content-type-${article.id}`}>Content format</label>
                <Select value={contentType} onValueChange={(value) => changeSelection(connectionId, value as "article" | "podcast")} disabled={busy}>
                  <SelectTrigger id={`content-type-${article.id}`} data-testid={`select-content-type-${article.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="article">Article</SelectItem><SelectItem value="podcast">Podcast</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            {optionsLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading publishing policy and destinations…</div>}
            {optionsError && <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><span>{(optionsErrorValue as Error)?.message || "Could not load destinations."}</span><Button variant="outline" size="sm" onClick={() => refetchOptions()}>Retry</Button></div>}
            {!!options?.policy && <div className="rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2"><p className="text-xs font-semibold mb-1">Approval policy</p><p className="whitespace-pre-wrap text-xs leading-relaxed">{options.policy}</p></div>}
            {!optionsLoading && !optionsError && options && connections.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No publishing destinations are connected. Connect a destination before approving this content.</p>}
            {options && (
              <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">Review assignment</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Currently assigned to {options.assignmentTeamId == null ? "the owning team (unassigned)" : options.assignmentTeams.find((team) => team.id === options.assignmentTeamId)?.name ?? `team ${options.assignmentTeamId}`}.
                    </p>
                  </div>
                  <Badge variant={options.canReview ? "default" : "secondary"}>{options.canReview ? "You can review" : "Review unavailable"}</Badge>
                </div>
                {!options.canReview && <p className="text-xs text-muted-foreground">This assignment does not permit your account to approve. An owner or admin must explicitly unassign the review before approval is available.</p>}
                {options.canAssign && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium" htmlFor={`assignment-${article.id}`}>Assign fresh review to</label>
                      <Select
                        value={selectedAssignmentValue}
                        onValueChange={(value) => {
                          setAssignmentSelection(value);
                          setAssignmentChangedConfirmed(false);
                        }}
                        disabled={busy || !options.assignmentTeams.length && options.assignmentTeamId == null}
                      >
                        <SelectTrigger id={`assignment-${article.id}`} data-testid={`select-assignment-${article.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__owning_team__">Owning team (unassigned)</SelectItem>
                          {options.assignmentTeams.map((team) => <SelectItem key={team.id} value={String(team.id)}>{team.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {hasAssignmentChange && (
                      <label className="flex max-w-sm cursor-pointer items-start gap-2 text-xs leading-relaxed sm:pb-2">
                        <Checkbox checked={assignmentChangedConfirmed} onCheckedChange={(value) => setAssignmentChangedConfirmed(value === true)} disabled={busy} aria-label="Confirm assignment change revokes prior consent and queued work" />
                        <span>I understand changing this assignment revokes existing reviewer consent and queued approval work.</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {connectionId && (
              <div className="space-y-4">
                {reviewQuery.isFetching && <div className="space-y-2"><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /></div>}
                {reviewQuery.isError && !reviewQuery.isFetching && (
                  <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <span>{(reviewQuery.error as Error)?.message || "Could not prepare this destination preview."}</span>
                    <Button variant="outline" size="sm" onClick={() => { setReviewed(false); reviewQuery.refetch(); }}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry preview</Button>
                  </div>
                )}
                {reviewMatches && (
                  <div className="space-y-4" data-testid={`destination-review-${article.id}`}>
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2"><Badge variant="outline">{review.destination.channel}</Badge><span className="text-sm font-semibold">{review.destination.name}</span></div>
                        <span className="font-mono text-[11px] text-muted-foreground">Origin · {review.destination.origin}</span>
                      </div>
                      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">Account fingerprint · {review.destination.accountFingerprint}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Review assignment team</p><p className="mt-1 text-sm font-medium">{review.assignmentTeamId ?? "Unassigned"}</p></div>
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Review digest</p><p className="mt-1 break-all font-mono text-xs">{review.digest}</p></div>
                    </div>
                    {reviewQuery.data?.policy && <div className="rounded-md border-l-2 border-primary bg-muted/60 px-3 py-2"><p className="text-xs font-semibold mb-1">Policy for this review</p><p className="whitespace-pre-wrap text-xs leading-relaxed">{reviewQuery.data.policy}</p></div>}
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /><h4 className="text-sm font-semibold">Exact formatted content</h4></div>
                      <p className="text-xs text-muted-foreground">Displayed as escaped text. HTML markup is never executed here.</p>
                      <DataBlock title="Payload" value={review.formatted.payload ?? "No formatted payload supplied."} />
                    </div>
                    <div className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center gap-2"><Film className="h-4 w-4 text-primary" /><h4 className="text-sm font-semibold">Media to upload</h4></div>
                      {(review.formatted.mediaToUpload ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No media attached to this destination payload.</p> :
                        review.formatted.mediaToUpload?.map((media) => (
                          <div key={media.id} className="space-y-3 rounded-md bg-muted/40 p-3">
                            <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                              <p><span className="text-muted-foreground">File</span> · {media.filename}</p>
                              <p><span className="text-muted-foreground">Type</span> · {media.type} ({media.mimeType})</p>
                              <p className="sm:col-span-2"><span className="text-muted-foreground">Alt text</span> · {media.altText || "None"}</p>
                            </div>
                            <MediaPreview media={media} contextLabel={article.chosenTitle} />
                          </div>
                        ))}
                    </div>
                    <div className="space-y-2 rounded-lg border p-4">
                      <h4 className="text-sm font-semibold">Pinned source assets</h4>
                      {review.assets.length === 0 ? <p className="text-xs text-muted-foreground">No source assets recorded.</p> : review.assets.map((asset) => (
                        <div key={`${asset.sourceKey}:${asset.sha256}`} className="grid gap-1 border-t pt-2 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <div className="min-w-0"><p className="break-all text-xs font-medium">{asset.sourceKey}</p><p className="break-all font-mono text-[11px] text-muted-foreground">SHA-256 · {asset.sha256}</p><p className="break-all font-mono text-[11px] text-muted-foreground">Pinned key · {asset.pinnedKey}</p></div>
                          <span className="text-xs text-muted-foreground">{asset.size.toLocaleString()} bytes</span>
                        </div>
                      ))}
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-muted/30 p-3">
                      <Checkbox checked={reviewed} onCheckedChange={(value) => setReviewed(value === true)} disabled={busy || !reviewMatches} aria-label="Confirm reviewed destination-bound content" />
                      <span className="text-xs leading-relaxed"><strong className="font-semibold">I reviewed this exact destination-bound version.</strong> I checked the formatted content, account fingerprint, media and pinned asset hashes above.</span>
                    </label>
                  </div>
                )}
                {!reviewQuery.isFetching && !reviewQuery.isError && reviewQuery.data && !reviewMatches && <div role="alert" className="flex items-center gap-2 text-xs text-destructive"><AlertCircle className="h-4 w-4" /> Returned preview does not match the selected destination and content type. Reload before taking action.</div>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`feedback-${article.id}`}>Feedback (optional)</label>
            <Textarea id={`feedback-${article.id}`} placeholder="Add notes for the content team…" value={feedback} onChange={(e) => setFeedback(e.target.value)} className="text-sm resize-none" rows={3} data-testid={`textarea-feedback-${article.id}`} disabled={busy} />
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={requestFreshReview}
              disabled={!canChangeStatus || (!!connectionId && reviewQuery.isFetching) || (hasAssignmentChange && !assignmentChangedConfirmed)}
              data-testid={`button-in-review-${article.id}`}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Clock className="mr-1.5 h-3.5 w-3.5" />}
              {article.approvalStatus === "in_review" ? "Refresh review" : "Request fresh review"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => options?.updatedAt && onAction(article.id, "changes_requested", feedback, selectedConnection, contentType, reviewMatches ? review.digest : undefined, options.updatedAt, undefined, { canReview: options.canReview, canAssign: options.canAssign, assignmentConfirmed: assignmentChangedConfirmed, status: article.approvalStatus })}
              disabled={!canChangeStatus || options?.canReview !== true || article.approvalStatus !== "in_review" || (!!connectionId && reviewQuery.isFetching)}
              data-testid={`button-request-changes-${article.id}`}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" /> Request Changes
            </Button>
            <Button
              size="sm"
              onClick={() => reviewMatches && options?.updatedAt && onAction(article.id, "approved", feedback, selectedConnection, contentType, review.digest, options.updatedAt, undefined, { canReview: options.canReview, canAssign: options.canAssign, assignmentConfirmed: assignmentChangedConfirmed, status: article.approvalStatus })}
              disabled={!canApprove}
              data-testid={`button-approve-${article.id}`}
              title={article.approvalStatus !== "in_review" ? "Request a fresh review before approval" : !options?.canReview ? "Your assignment does not allow approval" : !reviewMatches ? "Load a matching destination preview first" : !reviewed ? "Confirm you reviewed the exact formatted version" : undefined}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />} Approve for destination
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function ReviewQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("in_review");
  const [activeSaveId, setActiveSaveId] = useState<number | null>(null);
  const savingRef = useRef(false);
  const { data, isLoading, isError, refetch } = useQuery<{ articles: ReviewArticle[]; total: number; status: string }>({
    queryKey: ["/api/content/review", statusFilter],
    queryFn: () => apiRequest(`/api/content/review?status=${statusFilter}`),
    staleTime: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, action, feedback, connectionId, contentType, reviewDigest, expectedUpdatedAt, approvalTeamId }: {
      id: number;
      action: string;
      feedback?: string;
      connectionId?: number;
      contentType?: "article" | "podcast";
      reviewDigest?: string;
      expectedUpdatedAt?: string;
      approvalTeamId?: number | null;
    }) =>
      apiRequest(`/api/content/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          action,
          feedback,
          ...(action === "approved"
            ? { connectionId, contentType, reviewDigest }
            : {
                expectedUpdatedAt,
                ...(reviewDigest ? { connectionId, contentType, reviewDigest } : {}),
                ...(action === "in_review" && approvalTeamId !== undefined ? { approvalTeamId } : {}),
              }),
        }),
      }),
    onSuccess: (_, { action }) => {
      toast({ title: action === "approved" ? "Destination approval recorded" : action === "in_review" ? "Review status updated" : "Changes requested", description: "The content team has been notified." });
      queryClient.removeQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["approve-review", "approve-options"].includes(String(query.queryKey[2])) });
      queryClient.invalidateQueries({ queryKey: ["/api/content/review"] });
      queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[2] === "approve-options" });
    },
    onError: (err: any) => {
      queryClient.removeQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["approve-review", "approve-options"].includes(String(query.queryKey[2])) });
      toast({ title: "Action failed", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
    onSettled: () => {
      savingRef.current = false;
      setActiveSaveId(null);
    },
  });

  function handleAction(
    id: number,
    action: string,
    feedback?: string,
    connectionId?: number,
    contentType?: "article" | "podcast",
    digest?: string,
    expectedUpdatedAt?: string,
    approvalTeamId?: number | null,
    access?: { canReview: boolean; canAssign: boolean; assignmentConfirmed: boolean; status: string },
  ) {
    if (savingRef.current) return;
    if (action === "approved" && (!connectionId || !contentType || !digest || access?.canReview !== true || access.status !== "in_review")) {
      toast({ title: "Destination review required", description: "Load and confirm a preview for the selected destination before approving.", variant: "destructive" });
      return;
    }
    if (action !== "approved" && !expectedUpdatedAt) {
      toast({ title: "Current review state required", description: "Refresh the approval details before changing review status.", variant: "destructive" });
      return;
    }
    if (action === "changes_requested" && (access?.status !== "in_review" || access.canReview !== true)) {
      toast({ title: "Review permission required", description: "Changes can only be requested when the content is in review and your assignment permits review.", variant: "destructive" });
      return;
    }
    if (action === "in_review" && approvalTeamId !== undefined && (!access?.canAssign || !access.assignmentConfirmed)) {
      toast({ title: "Assignment change needs confirmation", description: "Only a permitted assignment change with explicit revocation confirmation can be submitted.", variant: "destructive" });
      return;
    }
    savingRef.current = true;
    setActiveSaveId(id);
    approveMutation.mutate({ id, action, feedback, connectionId, contentType, reviewDigest: digest, expectedUpdatedAt, approvalTeamId });
  }

  const articles = data?.articles ?? [];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" data-testid="heading-review-queue">Content Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review the exact destination version before granting publishing approval.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { queryClient.removeQueries({ predicate: (query) => Array.isArray(query.queryKey) && ["approve-review", "approve-options"].includes(String(query.queryKey[2])) }); queryClient.invalidateQueries({ queryKey: ["/api/content/review"] }); refetch(); }} disabled={isLoading} aria-label="Refresh review queue"><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
          <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
            <SelectTrigger className="w-44" data-testid="trigger-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="in_review">In Review</SelectItem><SelectItem value="changes_requested">Changes Requested</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {isLoading && <div className="space-y-3" aria-label="Loading review queue"><div className="h-4 w-28 animate-pulse rounded bg-muted" /><div className="h-28 animate-pulse rounded-lg bg-muted" /><div className="h-28 animate-pulse rounded-lg bg-muted" /></div>}
      {isError && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center text-sm" data-testid="text-review-error"><p className="text-muted-foreground">Failed to load review queue.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button></div>}
      {!isLoading && !isError && articles.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 h-48 text-center gap-2" data-testid="text-review-empty">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">No articles in this queue</p>
          <p className="text-xs text-muted-foreground">{statusFilter === "in_review" ? "When the content team requests review, articles will appear here." : `No articles with status "${statusFilter}".`}</p>
        </div>
      )}
      {!isLoading && articles.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{articles.length} article{articles.length !== 1 ? "s" : ""}</p>
          {articles.map((article) => <ArticleReviewCard key={article.id} article={article} onAction={handleAction} busy={activeSaveId === article.id} />)}
        </div>
      )}
    </div>
  );
}
