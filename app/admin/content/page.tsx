"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, Download, Edit, ExternalLink, FileText, Image as ImageIcon,
  Loader2, Music, RefreshCw, Share2, Trash2, Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { csrfFetch } from "@/lib/queryClient";

type LibraryType = "articles" | "images" | "videos" | "podcasts";

interface Summary {
  articles: number;
  failedArticles: number;
  images: number;
  videos: number;
  podcasts: number;
  socialPosts: number;
  missingAssetOwnership: number;
}

interface LibraryItem {
  id: string | number;
  assetId?: string;
  sourceId: number;
  sourceType?: string;
  kind: string;
  title: string | null;
  status: string | null;
  teamId: number | null;
  teamName: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
  wordCount?: number | null;
  url?: string | null;
  altText?: string | null;
  prompt?: string | null;
  fileFormat?: string | null;
  duration?: number | null;
  detailUrl: string;
  actions?: {
    edit: string | null;
    delete: string | null;
    download: string;
    regenerate: string | null;
    source: string;
  };
}

interface LibraryResponse {
  type: LibraryType;
  summary: Summary;
  items: LibraryItem[];
  count: number;
  total: number;
  nextCursor: string | null;
}

const typeConfig = {
  articles: { label: "Articles", icon: FileText },
  images: { label: "Images", icon: ImageIcon },
  videos: { label: "Videos", icon: Video },
  podcasts: { label: "Podcasts", icon: Music },
} satisfies Record<LibraryType, { label: string; icon: typeof FileText }>;

function statusVariant(status: string | null) {
  if (status === "FAILED" || status === "failed") return "destructive" as const;
  if (["COMPLETE", "READY", "PUBLISHED", "ready"].includes(status || "")) return "default" as const;
  return "secondary" as const;
}

export default function AdminGeneratedContentPage() {
  const [type, setType] = useState<LibraryType>("articles");
  const [teamId, setTeamId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const filters = { teamId, status, from, to };
  const query = useInfiniteQuery({
    queryKey: ["/api/admin/content-library", type, filters],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ type, limit: "60" });
      if (teamId) params.set("teamId", teamId);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", `${to}T23:59:59.999Z`);
      if (pageParam) params.set("cursor", pageParam);
      const response = await csrfFetch(`/api/admin/content-library?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load generated content");
      return payload as LibraryResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });

  const pages = query.data?.pages || [];
  const items = pages.flatMap((page) => page.items);
  const summary = pages[0]?.summary;
  const total = pages[0]?.total ?? 0;

  async function runAction(item: LibraryItem, action: "edit" | "delete" | "regenerate") {
    const url = item.actions?.[action];
    if (!url) return;
    let body: string | undefined;
    if (action === "delete" && !window.confirm("Delete this generated asset? This cannot be undone.")) return;
    if (action === "edit") {
      const altText = window.prompt("Alt text", item.altText || "");
      if (altText === null) return;
      body = JSON.stringify({ altText });
    }
    if (action === "regenerate" && type === "images") {
      const prompt = window.prompt("Generation prompt", item.prompt || "");
      if (!prompt) return;
      body = JSON.stringify({ prompt });
    }
    setActionBusy(`${action}-${item.id}`);
    try {
      const response = await csrfFetch(url, {
        method: action === "edit" ? "PATCH" : action === "delete" ? "DELETE" : "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Failed to ${action} asset`);
      await query.refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : `Failed to ${action} asset`);
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Generated Content</h1>
          <p className="mt-1 text-muted-foreground">Platform-wide output across every client team and generation pipeline.</p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {query.error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {query.error instanceof Error ? query.error.message : "Generated content could not be loaded."}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {summary && (
          <>
            {(["articles", "images", "videos", "podcasts"] as LibraryType[]).map((key) => {
              const config = typeConfig[key];
              const Icon = config.icon;
              return (
                <button key={key} type="button" onClick={() => setType(key)} className="text-left">
                  <Card className={type === key ? "border-primary ring-1 ring-primary" : "hover-elevate"}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div><p className="text-sm text-muted-foreground">{config.label}</p><p className="text-2xl font-bold">{summary[key].toLocaleString()}</p></div>
                      <Icon className="h-6 w-6 text-primary" />
                    </CardContent>
                  </Card>
                </button>
              );
            })}
            <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm text-muted-foreground">Social Posts</p><p className="text-2xl font-bold">{summary.socialPosts.toLocaleString()}</p></div><Share2 className="h-6 w-6 text-primary" /></CardContent></Card>
            <Card className={summary.failedArticles ? "border-destructive/40" : ""}><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm text-muted-foreground">Failed Articles</p><p className="text-2xl font-bold">{summary.failedArticles.toLocaleString()}</p></div><AlertTriangle className="h-6 w-6 text-destructive" /></CardContent></Card>
          </>
        )}
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Input inputMode="numeric" placeholder="Team ID" value={teamId} onChange={(event) => setTeamId(event.target.value.replace(/\D/g, ""))} />
          <Input placeholder="Status (e.g. READY)" value={status} onChange={(event) => setStatus(event.target.value)} />
          <Input type="date" aria-label="Created from" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input type="date" aria-label="Created through" value={to} onChange={(event) => setTo(event.target.value)} />
          <Button variant="ghost" onClick={() => { setTeamId(""); setStatus(""); setFrom(""); setTo(""); }}>Clear filters</Button>
        </CardContent>
      </Card>

      <Tabs value={type} onValueChange={(value) => setType(value as LibraryType)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          {(Object.entries(typeConfig) as Array<[LibraryType, (typeof typeConfig)[LibraryType]]>).map(([key, config]) => {
            const Icon = config.icon;
            return <TabsTrigger key={key} value={key}><Icon className="mr-2 h-4 w-4" />{config.label}</TabsTrigger>;
          })}
        </TabsList>

        <TabsContent value={type} className="mt-6">
          <Card>
            <CardHeader><CardTitle>{typeConfig[type].label} {!query.isLoading && <span className="text-base font-normal text-muted-foreground">({total.toLocaleString()})</span>}</CardTitle></CardHeader>
            <CardContent>
              {query.isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
              ) : !items.length ? (
                <div className="py-16 text-center text-muted-foreground">No {typeConfig[type].label.toLowerCase()} were found.</div>
              ) : type === "articles" ? (
                <div className="divide-y">
                  {items.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.title || "Untitled article"}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.teamName || "Unassigned team"}</span>
                          {item.wordCount ? <span>{item.wordCount.toLocaleString()} words</span> : null}
                          {item.createdAt ? <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span> : null}
                        </div>
                      </div>
                      <Badge variant={statusVariant(item.status)}>{item.status || "UNKNOWN"}</Badge>
                      <Link href={item.detailUrl}><Button size="sm" variant="outline">Open <ExternalLink className="ml-2 h-4 w-4" /></Button></Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <Card key={item.assetId || item.id} className="overflow-hidden">
                      {type === "images" && item.url ? <img src={item.url} alt={item.altText || item.title || "Generated image"} className="h-48 w-full object-cover" />
                        : type === "videos" && item.url ? <video src={item.url} controls preload="metadata" className="h-48 w-full bg-black object-contain" />
                        : type === "podcasts" && item.url ? <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-6"><Music className="mx-auto mb-4 h-10 w-10 text-purple-600" /><audio src={item.url} controls preload="metadata" className="w-full" /></div>
                        : <div className="flex h-48 items-center justify-center bg-muted text-muted-foreground">Preview unavailable</div>}
                      <CardContent className="space-y-3 p-4">
                        <div><p className="line-clamp-2 font-medium">{item.title || item.altText || "Generated asset"}</p><p className="mt-1 text-xs text-muted-foreground">{item.teamName || "Unassigned team"}{item.createdAt ? ` • ${formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}` : ""}</p></div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={statusVariant(item.status)}>{item.status || item.fileFormat || "READY"}</Badge>
                          <Link href={item.actions?.source || item.detailUrl}><Button size="sm" variant="outline">Source <ExternalLink className="ml-2 h-4 w-4" /></Button></Link>
                          {item.actions?.download && <a href={item.actions.download} download><Button size="icon" variant="outline" aria-label="Download"><Download className="h-4 w-4" /></Button></a>}
                          {item.actions?.edit && <Button size="icon" variant="outline" aria-label="Edit" disabled={!!actionBusy} onClick={() => runAction(item, "edit")}><Edit className="h-4 w-4" /></Button>}
                          {item.actions?.regenerate && <Button size="icon" variant="outline" aria-label="Regenerate" disabled={!!actionBusy} onClick={() => runAction(item, "regenerate")}><RefreshCw className="h-4 w-4" /></Button>}
                          {item.actions?.delete && <Button size="icon" variant="destructive" aria-label="Delete" disabled={!!actionBusy} onClick={() => runAction(item, "delete")}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {query.hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                    {query.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Load more
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}