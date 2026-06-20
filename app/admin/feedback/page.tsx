"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface FeedbackRow {
  id: number;
  teamId: number;
  userId: number;
  contentType: string;
  articleId: number | null;
  socialPostId: number | null;
  rating: string;
  comment: string | null;
  metricId: number | null;
  createdAt: string;
}

interface FeedbackResponse {
  feedback: FeedbackRow[];
  page: number;
  hasMore: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FeedbackAdminPage() {
  const [ratingFilter, setRatingFilter] = useState("all");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page) });
  if (ratingFilter !== "all") params.set("rating", ratingFilter);
  if (contentTypeFilter !== "all") params.set("contentType", contentTypeFilter);

  const { data, isLoading, isError } = useQuery<FeedbackResponse>({
    queryKey: ["/api/feedback", ratingFilter, contentTypeFilter, page],
    queryFn: () => apiRequest(`/api/feedback?${params}`),
    staleTime: 30_000,
  });

  const rows = data?.feedback ?? [];
  const upCount = rows.filter((r) => r.rating === "up").length;
  const downCount = rows.filter((r) => r.rating === "down").length;
  const withComments = rows.filter((r) => r.comment).length;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Content Feedback</h1>
        <p className="text-sm text-muted-foreground mt-1">
          User ratings on generated articles and social posts.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total (this page)</CardTitle>
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{rows.length}</div>
            <p className="text-xs text-muted-foreground">{withComments} with comments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Thumbs Up</CardTitle>
            <ThumbsUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{upCount}</div>
            <p className="text-xs text-muted-foreground">
              {rows.length ? Math.round((upCount / rows.length) * 100) : 0}% positive
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Work</CardTitle>
            <ThumbsDown className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{downCount}</div>
            <p className="text-xs text-muted-foreground">
              {rows.length ? Math.round((downCount / rows.length) * 100) : 0}% negative
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={ratingFilter} onValueChange={(v) => { setRatingFilter(v); setPage(1); }}>
          <SelectTrigger className="w-36" data-testid="select-rating-filter">
            <SelectValue placeholder="All ratings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ratings</SelectItem>
            <SelectItem value="up">Thumbs up</SelectItem>
            <SelectItem value="down">Needs work</SelectItem>
          </SelectContent>
        </Select>
        <Select value={contentTypeFilter} onValueChange={(v) => { setContentTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40" data-testid="select-type-filter">
            <SelectValue placeholder="All content" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All content</SelectItem>
            <SelectItem value="article">Articles</SelectItem>
            <SelectItem value="social">Social posts</SelectItem>
            <SelectItem value="podcast">Podcasts</SelectItem>
            <SelectItem value="video">Videos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading feedback...</div>
          )}
          {isError && (
            <div className="p-8 text-center text-sm text-destructive">Failed to load feedback.</div>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No feedback found.</div>
          )}
          {!isLoading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Team</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Content ID</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rating</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Comment</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-feedback-${row.id}`}>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">{row.teamId}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs capitalize">
                          {row.contentType.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.articleId ?? row.socialPostId ?? (row as any).videoIdeaId ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {row.rating === "up" ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <ThumbsUp className="w-4 h-4" />
                            <span className="text-xs font-medium">Good</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-destructive">
                            <ThumbsDown className="w-4 h-4" />
                            <span className="text-xs font-medium">Needs work</span>
                          </div>
                        )}
                      </td>
                      <td className={cn("px-4 py-3 max-w-xs", !row.comment && "text-muted-foreground")}>
                        {row.comment ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {(page > 1 || data?.hasMore) && (
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!data?.hasMore}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
