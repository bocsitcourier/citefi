"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  Share2,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  id: number;
  sourceId: number;
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
  fileFormat?: string | null;
  duration?: number | null;
  detailUrl: string;
}

interface LibraryResponse {
  type: LibraryType;
  summary: Summary;
  items: LibraryItem[];
  count: number;
}

const typeConfig = {
  articles: { label: "Articles", icon: FileText },
  images: { label: "Images", icon: ImageIcon },
  videos: { label: "Videos", icon: Video },
  podcasts: { label: "Podcasts", icon: Music },
} satisfies Record<LibraryType, { label: string; icon: typeof FileText }>;

function statusVariant(status: string | null) {
  if (status === "FAILED") return "destructive" as const;
  if (["COMPLETE", "READY", "PUBLISHED", "ready"].includes(status || "")) return "default" as const;
  return "secondary" as const;
}

export default function AdminGeneratedContentPage() {
  const [type, setType] = useState<LibraryType>("articles");
  const { data, isLoading, isFetching, error, refetch } = useQuery<LibraryResponse>({
    queryKey: [`/api/admin/content-library?type=${type}&limit=60`],
    queryFn: async ({ queryKey }) => {
      const response = await csrfFetch(String(queryKey[0]));
      const payload = await response.json();
      if (!response.ok) {
        const requestError = new Error(payload.error || "Failed to load generated content") as Error & { status?: number };
        requestError.status = response.status;
        throw requestError;
      }
      return payload;
    },
  });

  const summary = data?.summary;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Generated Content</h1>
          <p className="mt-1 text-muted-foreground">
            Platform-wide output across every client team and generation pipeline.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {error instanceof Error ? error.message : "Generated content could not be loaded."}
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
                      <div>
                        <p className="text-sm text-muted-foreground">{config.label}</p>
                        <p className="text-2xl font-bold">{summary[key].toLocaleString()}</p>
                      </div>
                      <Icon className="h-6 w-6 text-primary" />
                    </CardContent>
                  </Card>
                </button>
              );
            })}
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-muted-foreground">Social Posts</p>
                  <p className="text-2xl font-bold">{summary.socialPosts.toLocaleString()}</p>
                </div>
                <Share2 className="h-6 w-6 text-primary" />
              </CardContent>
            </Card>
            <Card className={summary.failedArticles ? "border-destructive/40" : ""}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-muted-foreground">Failed Articles</p>
                  <p className="text-2xl font-bold">{summary.failedArticles.toLocaleString()}</p>
                </div>
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Tabs value={type} onValueChange={(value) => setType(value as LibraryType)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          {(Object.entries(typeConfig) as Array<[LibraryType, (typeof typeConfig)[LibraryType]]>).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <TabsTrigger key={key} value={key}>
                <Icon className="mr-2 h-4 w-4" />
                {config.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={type} className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{typeConfig[type].label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !data?.items.length ? (
                <div className="py-16 text-center text-muted-foreground">
                  No {typeConfig[type].label.toLowerCase()} were found.
                </div>
              ) : type === "articles" ? (
                <div className="divide-y">
                  {data.items.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.title || "Untitled article"}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.teamName || "Unassigned team"}</span>
                          {item.wordCount ? <span>{item.wordCount.toLocaleString()} words</span> : null}
                          {item.createdAt ? <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span> : null}
                        </div>
                      </div>
                      <Badge variant={statusVariant(item.status)}>{item.status || "UNKNOWN"}</Badge>
                      <Link href={item.detailUrl}>
                        <Button size="sm" variant="outline">
                          Open <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {data.items.map((item) => (
                    <Card key={`${item.kind}-${item.id}`} className="overflow-hidden">
                      {type === "images" && item.url ? (
                        <img src={item.url} alt={item.altText || item.title || "Generated image"} className="h-48 w-full object-cover" />
                      ) : type === "videos" && item.url ? (
                        <video src={item.url} controls preload="metadata" className="h-48 w-full bg-black object-contain" />
                      ) : type === "podcasts" && item.url ? (
                        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-6">
                          <Music className="mx-auto mb-4 h-10 w-10 text-purple-600" />
                          <audio src={item.url} controls preload="metadata" className="w-full" />
                        </div>
                      ) : (
                        <div className="flex h-48 items-center justify-center bg-muted text-muted-foreground">
                          Preview unavailable
                        </div>
                      )}
                      <CardContent className="space-y-3 p-4">
                        <div>
                          <p className="line-clamp-2 font-medium">{item.title || item.altText || "Generated asset"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.teamName || "Unassigned team"}
                            {item.createdAt ? ` • ${formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={statusVariant(item.status)}>{item.status || item.fileFormat || "READY"}</Badge>
                          <Link href={item.detailUrl}>
                            <Button size="sm" variant="outline">
                              Source <ExternalLink className="ml-2 h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}