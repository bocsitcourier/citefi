import { db } from "./db";
import { jobEvents, errorLogs, jobBatches } from "@/shared/schema";
import { eq, and, gte } from "drizzle-orm";

// ============================================================================
// API COST TRACKING CONSTANTS
// ============================================================================

export const API_COSTS = {
  // Gemini 2.0 Flash costs (per million tokens)
  GEMINI_FLASH_INPUT: 0.10,  // $0.10 per 1M input tokens
  GEMINI_FLASH_OUTPUT: 0.40, // $0.40 per 1M output tokens
  
  // Gemini 2.5 Flash Image costs
  GEMINI_FLASH_IMAGE: 0.008, // $0.008 per image (estimate)
  
  // GPT-4o-mini costs (per million tokens)
  GPT4_MINI_INPUT: 0.15,   // $0.15 per 1M input tokens
  GPT4_MINI_OUTPUT: 0.60,  // $0.60 per 1M output tokens
  
  // OpenAI TTS costs
  TTS_NOVA: 15.00,  // $15.00 per 1M characters
  TTS_ONYX: 15.00,  // $15.00 per 1M characters
} as const;

// ============================================================================
// TOKEN/CHARACTER ESTIMATES PER OPERATION
// ============================================================================

export const OPERATION_ESTIMATES = {
  // Article generation (Gemini 2.0 Flash)
  ARTICLE_TITLE_GEN_INPUT: 500,     // Prompt tokens
  ARTICLE_TITLE_GEN_OUTPUT: 300,    // 50 titles × ~6 tokens each
  
  ARTICLE_CONTENT_INPUT: 800,       // Prompt + title
  ARTICLE_CONTENT_OUTPUT: 2500,     // 800-2000 words × 1.3 tokens/word
  
  // Enhancement (GPT-4o-mini)
  ARTICLE_REVIEW_INPUT: 3000,       // Article content + prompts
  ARTICLE_REVIEW_OUTPUT: 500,       // SEO analysis + hyperlinks
  
  // Image generation
  IMAGES_PER_ARTICLE: 5,
  
  // Podcast/Audio generation
  PODCAST_SCRIPT_INPUT: 2500,       // Article content
  PODCAST_SCRIPT_OUTPUT: 800,       // Conversational script
  PODCAST_CHARS_PER_MINUTE: 1000,   // ~1000 chars per minute of audio
  PODCAST_AVG_DURATION_MINS: 3,     // Average 3-minute podcast
} as const;

// ============================================================================
// COST CALCULATION FUNCTIONS
// ============================================================================

export interface ArticleCostBreakdown {
  titleGeneration: number;
  contentGeneration: number;
  reviewEnhancement: number;
  imageGeneration: number;
  podcastGeneration: number;
  total: number;
}

export function calculateArticleCost(): ArticleCostBreakdown {
  // Title generation (Gemini Flash)
  const titleGenCost = 
    (OPERATION_ESTIMATES.ARTICLE_TITLE_GEN_INPUT / 1_000_000) * API_COSTS.GEMINI_FLASH_INPUT +
    (OPERATION_ESTIMATES.ARTICLE_TITLE_GEN_OUTPUT / 1_000_000) * API_COSTS.GEMINI_FLASH_OUTPUT;
  
  // Content generation (Gemini Flash)
  const contentGenCost = 
    (OPERATION_ESTIMATES.ARTICLE_CONTENT_INPUT / 1_000_000) * API_COSTS.GEMINI_FLASH_INPUT +
    (OPERATION_ESTIMATES.ARTICLE_CONTENT_OUTPUT / 1_000_000) * API_COSTS.GEMINI_FLASH_OUTPUT;
  
  // Review enhancement (GPT-4o-mini)
  const reviewCost = 
    (OPERATION_ESTIMATES.ARTICLE_REVIEW_INPUT / 1_000_000) * API_COSTS.GPT4_MINI_INPUT +
    (OPERATION_ESTIMATES.ARTICLE_REVIEW_OUTPUT / 1_000_000) * API_COSTS.GPT4_MINI_OUTPUT;
  
  // Image generation (Gemini Flash Image)
  const imageCost = OPERATION_ESTIMATES.IMAGES_PER_ARTICLE * API_COSTS.GEMINI_FLASH_IMAGE;
  
  // Podcast generation (Gemini + OpenAI TTS)
  const podcastScriptCost = 
    (OPERATION_ESTIMATES.PODCAST_SCRIPT_INPUT / 1_000_000) * API_COSTS.GEMINI_FLASH_INPUT +
    (OPERATION_ESTIMATES.PODCAST_SCRIPT_OUTPUT / 1_000_000) * API_COSTS.GEMINI_FLASH_OUTPUT;
  
  const podcastChars = OPERATION_ESTIMATES.PODCAST_CHARS_PER_MINUTE * OPERATION_ESTIMATES.PODCAST_AVG_DURATION_MINS;
  const podcastTTSCost = (podcastChars / 1_000_000) * (API_COSTS.TTS_NOVA + API_COSTS.TTS_ONYX);
  
  const podcastCost = podcastScriptCost + podcastTTSCost;
  
  return {
    titleGeneration: titleGenCost,
    contentGeneration: contentGenCost,
    reviewEnhancement: reviewCost,
    imageGeneration: imageCost,
    podcastGeneration: podcastCost,
    total: titleGenCost + contentGenCost + reviewCost + imageCost + podcastCost,
  };
}

export function calculateBatchCost(numArticles: number, includeImages: boolean = true, includePodcasts: boolean = false): number {
  const perArticleCost = calculateArticleCost();
  
  let costPerArticle = perArticleCost.titleGeneration + 
                       perArticleCost.contentGeneration + 
                       perArticleCost.reviewEnhancement;
  
  if (includeImages) {
    costPerArticle += perArticleCost.imageGeneration;
  }
  
  if (includePodcasts) {
    costPerArticle += perArticleCost.podcastGeneration;
  }
  
  return costPerArticle * numArticles;
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

export interface PerformanceMetrics {
  batchId: number;
  totalArticles: number;
  completedArticles: number;
  failedArticles: number;
  averageTimePerArticle: number;  // milliseconds
  totalDuration: number;  // milliseconds
  concurrentWorkers: number;
  geminiRateLimit: number;  // requests per minute
  imagesGenerated: number;
  podcastsGenerated: number;
  errorRate: number;  // percentage
}

export async function getBatchPerformanceMetrics(batchId: number): Promise<PerformanceMetrics> {
  // Get all events for this batch
  const events = await db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.batchId, batchId))
    .orderBy(jobEvents.createdAt);
  
  // Get error logs
  const errors = await db
    .select()
    .from(errorLogs)
    .where(eq(errorLogs.batchId, batchId));
  
  // Calculate metrics
  const batchStartEvent = events.find(e => e.eventType === "BATCH_STARTED");
  const batchEndEvent = events.find(e => e.eventType === "BATCH_COMPLETE" || e.eventType === "BATCH_FAILED");
  
  const articleCompleteEvents = events.filter(e => e.eventType === "ARTICLE_COMPLETE");
  const articleFailedEvents = events.filter(e => e.eventType === "ARTICLE_FAILED");
  
  const totalDuration = batchStartEvent && batchEndEvent
    ? new Date(batchEndEvent.createdAt!).getTime() - new Date(batchStartEvent.createdAt!).getTime()
    : 0;
  
  const articleDurations = articleCompleteEvents
    .map(e => e.durationMs)
    .filter((d): d is number => d !== null && d !== undefined);
  
  const averageTimePerArticle = articleDurations.length > 0
    ? articleDurations.reduce((sum, d) => sum + d, 0) / articleDurations.length
    : 0;
  
  const imageEvents = events.filter(e => e.eventType === "IMAGE_GENERATED");
  const podcastEvents = events.filter(e => e.eventType === "PODCAST_GENERATED");
  
  const totalArticles = articleCompleteEvents.length + articleFailedEvents.length;
  const errorRate = totalArticles > 0 ? (articleFailedEvents.length / totalArticles) * 100 : 0;
  
  // Get actual configured limits from environment
  const configuredWorkers = parseInt(process.env.ARTICLE_WORKER_CONCURRENCY || "100");
  const geminiRateLimit = parseInt(process.env.GEMINI_RATE_LIMIT || "10");

  return {
    batchId,
    totalArticles,
    completedArticles: articleCompleteEvents.length,
    failedArticles: articleFailedEvents.length,
    averageTimePerArticle,
    totalDuration,
    concurrentWorkers: configuredWorkers,
    geminiRateLimit,
    imagesGenerated: imageEvents.length,
    podcastsGenerated: podcastEvents.length,
    errorRate,
  };
}

// ============================================================================
// REAL-TIME MONITORING
// ============================================================================

export interface LiveBatchStatus {
  batchId: number;
  status: string;
  progress: number;  // percentage
  articlesCompleted: number;
  articlesTotal: number;
  articlesInProgress: number;
  articlesFailed: number;
  estimatedTimeRemaining: number;  // milliseconds
  currentCost: number;  // dollars
  recentErrors: Array<{ message: string; timestamp: Date }>;
}

export async function getLiveBatchStatus(batchId: number): Promise<LiveBatchStatus> {
  // Get batch info
  const [batch] = await db
    .select()
    .from(jobBatches)
    .where(eq(jobBatches.id, batchId));
  
  if (!batch) {
    throw new Error(`Batch ${batchId} not found`);
  }
  
  // Get articles for this batch
  const { articles } = await import("@/shared/schema");
  const batchArticles = await db
    .select()
    .from(articles)
    .where(eq(articles.batchId, batchId));
  
  const articlesCompleted = batchArticles.filter(a => a.articleStatus === "COMPLETE").length;
  const articlesInProgress = batchArticles.filter(a => 
    a.articleStatus === "IN_PROGRESS" || 
    a.articleStatus === "GEMINI_COMPLETE" || 
    a.articleStatus === "CHATGPT_REVIEWED"
  ).length;
  const articlesFailed = batchArticles.filter(a => a.articleStatus === "FAILED").length;
  const articlesTotal = batch.numArticlesRequested || batchArticles.length;
  
  const progress = articlesTotal > 0 ? (articlesCompleted / articlesTotal) * 100 : 0;
  
  // Get recent errors (last 5)
  const recentErrors = await db
    .select()
    .from(errorLogs)
    .where(eq(errorLogs.batchId, batchId))
    .orderBy(errorLogs.createdAt)
    .limit(5);
  
  // Calculate estimated time remaining based on average time per article
  const metrics = await getBatchPerformanceMetrics(batchId);
  const articlesRemaining = articlesTotal - articlesCompleted;
  const estimatedTimeRemaining = articlesRemaining > 0 && metrics.averageTimePerArticle > 0
    ? (articlesRemaining / 100) * metrics.averageTimePerArticle  // Divide by 100 workers
    : 0;
  
  // Calculate current cost
  const currentCost = calculateBatchCost(articlesCompleted, true, false);
  
  return {
    batchId,
    status: batch.status,
    progress,
    articlesCompleted,
    articlesTotal,
    articlesInProgress,
    articlesFailed,
    estimatedTimeRemaining,
    currentCost,
    recentErrors: recentErrors.map(e => ({
      message: e.errorMessage || "Unknown error",
      timestamp: e.createdAt!,
    })),
  };
}

// ============================================================================
// MONITORING UTILITIES
// ============================================================================

export async function logPerformanceMetric(
  batchId: number | null,
  articleId: number | null,
  eventType: string,
  stage: string,
  message: string,
  durationMs?: number,
  severity: "info" | "warning" | "error" = "info"
) {
  await db.insert(jobEvents).values({
    batchId,
    articleId,
    eventType,
    stage,
    message,
    durationMs,
    severity,
  });
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatProgress(completed: number, total: number): string {
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  return `${completed}/${total} (${percentage.toFixed(1)}%)`;
}
