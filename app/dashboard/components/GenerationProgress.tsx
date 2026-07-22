"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Clock, AlertCircle, ArrowRight, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import Link from "next/link";

const COMPLETED_STATUSES = ["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"];

interface Article {
  id: number;
  chosenTitle: string;
  articleStatus: string;
}

interface BatchStatus {
  id: number;
  status: string;
  coreTopic: string;
  articles: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    progress: number;
  };
}

interface GenerationProgressProps {
  batchId: number;
  onComplete?: () => void;
}

export function GenerationProgress({ batchId, onComplete }: GenerationProgressProps) {
  const [articles, setArticles] = useState<Article[]>([]);

  const { data: batchStatus, isLoading } = useQuery({
    queryKey: ["batch-status", batchId],
    queryFn: async () => {
      const data = await apiRequest(`/api/jobs/status/${batchId}`);
      return data as BatchStatus;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "COMPLETE" || status === "PARTIAL_COMPLETE" || status === "FAILED" || status === "CANCELLED") {
        return false;
      }
      return 3000;
    },
    refetchIntervalInBackground: false,
  });

  const { data: batchDetails } = useQuery({
    queryKey: ["batch-details", batchId],
    queryFn: async () => {
      const data = await apiRequest(`/api/batches/${batchId}`);
      setArticles(data.articles || []);
      return data;
    },
    refetchInterval: (query) => {
      const status = batchStatus?.status;
      if (status === "COMPLETE" || status === "PARTIAL_COMPLETE" || status === "FAILED" || status === "CANCELLED") {
        return false;
      }
      return 5000;
    },
    refetchIntervalInBackground: false,
    enabled: !!batchStatus,
  });

  useEffect(() => {
    if (
      batchStatus?.status === "COMPLETE" ||
      batchStatus?.status === "PARTIAL_COMPLETE" ||
      batchStatus?.status === "CANCELLED"
    ) {
      onComplete?.();
    }
  }, [batchStatus?.status, onComplete]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading batch status...</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!batchStatus) return null;

  const isComplete = batchStatus.status === "COMPLETE" || batchStatus.status === "PARTIAL_COMPLETE";
  const isFailed = batchStatus.status === "FAILED";

  return (
    <Card className="border-primary/20" data-testid="card-generation-progress">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {isComplete ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : isFailed ? (
                <AlertCircle className="h-5 w-5 text-destructive" />
              ) : (
                <Clock className="h-5 w-5 text-primary animate-pulse" />
              )}
              Article Generation Progress
            </CardTitle>
            <CardDescription>
              {batchStatus.coreTopic}
            </CardDescription>
          </div>
          {isComplete && (
            <Link href="/content">
              <Button data-testid="button-view-articles">
                View Articles <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span>
              {batchStatus.articles.completed} of {batchStatus.articles.total} articles completed
            </span>
            <span className="font-medium">{batchStatus.articles.progress}%</span>
          </div>
          <Progress value={batchStatus.articles.progress} className="h-2" data-testid="progress-generation" />
        </div>

        {articles.length > 0 && (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            <h4 className="text-sm font-medium text-muted-foreground">Articles:</h4>
            {articles.map((article) => {
              const done = COMPLETED_STATUSES.includes(article.articleStatus);
              const failed = article.articleStatus === "FAILED";
              const row = (
                <div
                  className={`flex items-center justify-between p-2 bg-secondary/50 rounded text-sm ${done ? "cursor-pointer hover-elevate" : ""}`}
                  data-testid={`article-status-${article.id}`}
                >
                  <span className="truncate flex-1">{article.chosenTitle}</span>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium shrink-0 ml-2 ${
                      done
                        ? "bg-green-500/20 text-green-700 dark:text-green-400"
                        : failed
                        ? "bg-red-500/20 text-red-700 dark:text-red-400"
                        : article.articleStatus === "PENDING"
                        ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                        : "bg-blue-500/20 text-blue-700 dark:text-blue-400"
                    }`}
                  >
                    {done ? "Complete" : failed ? "Failed" : article.articleStatus}
                  </span>
                  {done && <ExternalLink className="w-3 h-3 ml-1 shrink-0 text-muted-foreground" />}
                </div>
              );
              return done ? (
                <Link key={article.id} href={`/content/${article.id}`}>{row}</Link>
              ) : (
                <div key={article.id}>{row}</div>
              );
            })}
          </div>
        )}

        {isFailed && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded">
            <p className="text-sm text-destructive">
              Batch generation failed. Please check the logs or try again.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
