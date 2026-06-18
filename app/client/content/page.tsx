"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, Share2, ChevronLeft, ChevronRight } from "lucide-react";

interface ContentItem {
  id: number;
  publicId: string;
  title: string | null;
  status: string | null;
  wordCount?: number | null;
  seoScore?: number | null;
  type: "article" | "social";
  createdAt: string;
  updatedAt: string;
}

interface ContentResponse {
  items: ContentItem[];
  page: number;
  limit: number;
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  COMPLETE: "default",
  published: "default",
  FAILED: "destructive",
  failed: "destructive",
  PENDING: "outline",
  pending: "outline",
  draft: "secondary",
};

export default function ContentPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<string>("all");
  const limit = 20;

  const { data, isLoading, isError } = useQuery<ContentResponse>({
    queryKey: ["/api/client/content", page, type],
    queryFn: () => apiRequest(`/api/client/content?page=${page}&limit=${limit}&type=${type}`),
    staleTime: 30_000,
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Content</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your articles and social posts</p>
        </div>
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
          <SelectTrigger className="w-36" data-testid="select-content-type">
            <SelectValue placeholder="Filter type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="article">Articles</SelectItem>
            <SelectItem value="social">Social posts</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !data ? (
        <div className="p-8 text-center text-muted-foreground text-sm">
          Failed to load content. Please refresh and try again.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {data.items.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                No content yet. Start generating to see your articles and social posts here.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Words</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map(item => (
                    <TableRow key={`${item.type}-${item.id}`} data-testid={`row-content-${item.id}`}>
                      <TableCell className="font-medium max-w-xs">
                        <span className="truncate block text-sm">
                          {item.title ?? <span className="text-muted-foreground italic">Untitled</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                          {item.type === "article"
                            ? <FileText className="h-3.5 w-3.5" />
                            : <Share2 className="h-3.5 w-3.5" />}
                          <span className="capitalize">{item.type}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.status ? (
                          <Badge
                            variant={STATUS_VARIANTS[item.status] ?? "outline"}
                            data-testid={`badge-status-${item.id}`}
                          >
                            {item.status.toLowerCase()}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {item.wordCount ?? "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right text-xs text-muted-foreground">
                        {relativeTime(item.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {data && data.items.length === limit && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            data-testid="button-prev-page"
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => p + 1)}
            data-testid="button-next-page"
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
