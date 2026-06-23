"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, MessageSquare, Clock, ChevronDown, ChevronUp } from "lucide-react";
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
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "secondary" },
  in_review: { label: "In Review", color: "default" },
  approved: { label: "Approved", color: "secondary" },
  changes_requested: { label: "Changes Requested", color: "destructive" },
};

function ArticleReviewCard({ article, onAction }: { article: ReviewArticle; onAction: (id: number, action: string, feedback?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState(article.approvalFeedback ?? "");

  const statusInfo = STATUS_LABELS[article.approvalStatus] ?? { label: article.approvalStatus, color: "secondary" };
  const reqAt = article.approvalRequestedAt ? new Date(article.approvalRequestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <Card data-testid={`card-review-article-${article.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap pb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug" data-testid={`text-article-title-${article.id}`}>{article.chosenTitle}</p>
          {article.seoTitle && article.seoTitle !== article.chosenTitle && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{article.seoTitle}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge variant={statusInfo.color as any} className="text-xs" data-testid={`badge-status-${article.id}`}>
              {statusInfo.label}
            </Badge>
            {article.wordCount && (
              <span className="text-xs text-muted-foreground">{article.wordCount.toLocaleString()} words</span>
            )}
            {reqAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Requested {reqAt}
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)} data-testid={`button-expand-${article.id}`} aria-label="Expand review">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          <Separator />
          {article.approvalFeedback && (
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Previous feedback</p>
              <p className="text-sm">{article.approvalFeedback}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Feedback (optional)</label>
            <Textarea
              placeholder="Add notes for the content team…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="text-sm resize-none"
              rows={3}
              data-testid={`textarea-feedback-${article.id}`}
            />
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAction(article.id, "changes_requested", feedback)}
              data-testid={`button-request-changes-${article.id}`}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Request Changes
            </Button>
            <Button
              size="sm"
              onClick={() => onAction(article.id, "approved", feedback)}
              data-testid={`button-approve-${article.id}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Approve
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

  const { data, isLoading, isError } = useQuery<{ articles: ReviewArticle[]; total: number; status: string }>({
    queryKey: ["/api/content/review", statusFilter],
    queryFn: () => apiRequest(`/api/content/review?status=${statusFilter}`),
    staleTime: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, action, feedback }: { id: number; action: string; feedback?: string }) =>
      apiRequest(`/api/content/${id}/approve`, { method: "POST", body: JSON.stringify({ action, feedback }) }),
    onSuccess: (_, { action }) => {
      toast({ title: action === "approved" ? "Article approved" : "Changes requested", description: "The content team has been notified." });
      queryClient.invalidateQueries({ queryKey: ["/api/content/review"] });
    },
    onError: (err: any) => {
      toast({ title: "Action failed", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  function handleAction(id: number, action: string, feedback?: string) {
    approveMutation.mutate({ id, action, feedback });
  }

  const articles = data?.articles ?? [];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" data-testid="heading-review-queue">Content Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Review and approve articles before they are published.</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status-filter">
          <SelectTrigger className="w-44" data-testid="trigger-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="changes_requested">Changes Requested</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="p-8 text-center text-muted-foreground text-sm" data-testid="text-review-error">
          Failed to load review queue. Please refresh and try again.
        </div>
      )}

      {!isLoading && !isError && articles.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-center gap-2" data-testid="text-review-empty">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No articles in this queue</p>
          <p className="text-xs text-muted-foreground">
            {statusFilter === "in_review" ? "When the content team requests review, articles will appear here." : `No articles with status "${statusFilter}".`}
          </p>
        </div>
      )}

      {!isLoading && articles.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{articles.length} article{articles.length !== 1 ? "s" : ""}</p>
          {articles.map((article) => (
            <ArticleReviewCard key={article.id} article={article} onAction={handleAction} />
          ))}
        </div>
      )}
    </div>
  );
}
