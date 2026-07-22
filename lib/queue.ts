import { Queue } from "bullmq";
import Redis from "ioredis";

// ============================================================================
// JOB DATA INTERFACES (unchanged — all API routes depend on these)
// ============================================================================

export interface BatchJobData {
  batchId: number;
  userId: number;
  teamId: number;
  selectedTitles: string[];
  targetUrl: string;
  tone?: string;
  wordCountMin?: number;
  wordCountMax?: number;
  geographicFocus?: string;
  audience?: string;
  businessName?: string;
  companyLogoUrl?: string;
  competitorUrls?: string[];
  semanticClusterId?: number;
  serpFeatureTarget?: string;
  personaId?: number;
  journeyContext?: string | null;
  journeyName?: string | null;
  creditRunId?: string;
  creditCostPerUnit?: number;
  capReservationId?: number | null;
}

export interface ArticleJobData {
  articleId: number;
  batchId: number;
  runId: string;
  title: string;
  targetUrl: string;
  tone?: string;
  wordCountMin?: number;
  wordCountMax?: number;
  geographicFocus?: string;
  audience?: string;
  businessName?: string;
  companyLogoUrl?: string;
  competitorUrls?: string[];
  semanticClusterId?: number;
  serpFeatureTarget?: string;
  customInstructions?: string;
  teamId?: number;
  personaId?: number;
  journeyContext?: string | null;
  journeyName?: string | null;
  creditRunId?: string;
  creditCostPerUnit?: number;
}

export interface PodcastJobData {
  articleId: number;
  teamId: number;
  tone?: string;
  duration?: string;
  journeyStepId?: number;
}

export interface SocialPostJobData {
  socialPostId: number;
  userId: number;
  teamId?: number;
  creditRunId?: string;
  prompt: string;
  platforms: string[];
  tone?: string;
  mood?: string;
  industry?: string;
  includeImage?: boolean;
  generateVideos?: boolean;
  userEmail?: string;
  articleId?: number;
}

export interface ImageGenerationJobData {
  articleId: number;
  batchId: number;
  imagePrompts: string[];
  businessName?: string;
}

export interface ReformatJobData {
  articleId: number;
}

export interface SocialVideoJobData {
  creditRunId?: string;
  socialPostId: number;
  platform?: string;
  videoType?: string;
  teamId?: number;
}

export interface CleanupJobData {
  jobType: "media" | "logs" | "orphans" | "sessions";
  dryRun?: boolean;
  retentionDays?: number;
  teamId?: number;
}

export interface IntelligenceResearchJobData {
  teamId: number;
  websiteUrl: string;
  companyName: string;
}

export interface PublishingJobData {
  dbJobId: number;
  teamId: number;
}

export interface SiteCrawlJobData {
  crawlJobId: number;
  teamId: number;
  userId: number;
  baseUrl: string;
  maxPages: number;
  maxDepth: number;
}

export interface VideoIdeaJobData {
  videoIdeaId: number;
  teamId?: number;
  userId?: number;
  creditRunId?: string;
}

// ============================================================================
// QUEUE NAMES (unchanged — all workers and API routes depend on these)
// ============================================================================

export const BATCH_GENERATION_QUEUE = "batch-generation";
export const ARTICLE_GENERATION_QUEUE = "article-generation";
export const SOCIAL_POST_GENERATION_QUEUE = "social-post-generation";
export const IMAGE_GENERATION_QUEUE = "image-generation";
export const REFORMAT_QUEUE = "article-reformat";
export const SOCIAL_VIDEO_GENERATION_QUEUE = "social-video-generation";
export const VIDEO_IDEA_GENERATION_QUEUE = "video-idea-generation";
export const CLEANUP_QUEUE = "cleanup";
export const SITE_CRAWL_QUEUE = "site-crawl";
export const CONTENT_PUBLISHING_QUEUE = "content-publishing";
export const INTELLIGENCE_RESEARCH_QUEUE = "intelligence-research";
export const PODCAST_GENERATION_QUEUE = "article-podcast";

export const ALL_QUEUE_NAMES = [
  BATCH_GENERATION_QUEUE,
  ARTICLE_GENERATION_QUEUE,
  SOCIAL_POST_GENERATION_QUEUE,
  IMAGE_GENERATION_QUEUE,
  REFORMAT_QUEUE,
  SOCIAL_VIDEO_GENERATION_QUEUE,
  VIDEO_IDEA_GENERATION_QUEUE,
  CLEANUP_QUEUE,
  SITE_CRAWL_QUEUE,
  CONTENT_PUBLISHING_QUEUE,
  INTELLIGENCE_RESEARCH_QUEUE,
  PODCAST_GENERATION_QUEUE,
  "video-orphan-sweeper",
  "engagement-scoring",
  "conversion-labeler",
  "underperformer-archiving",
  "cohort-mining",
  "journey-scheduler",
  "credit-period-reset",
  "stripe-reconcile",
  "citation-probe",
];

// ============================================================================
// REDIS CONNECTION SINGLETON
// ============================================================================

let _redisConn: Redis | null = null;

export function getRedisConnection(): Redis {
  if (_redisConn) return _redisConn;

  let url = process.env.REDIS_URL || "redis://127.0.0.1:6379";

  // The Replit javascript_mem_db integration injects REDIS_URL with a typo:
  // "ediss://" instead of "rediss://" — normalize it here.
  if (url.startsWith("ediss://")) {
    url = "rediss://" + url.slice("ediss://".length);
  }

  const isTls = url.startsWith("rediss://");
  _redisConn = new Redis(url, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
    ...(isTls && { tls: {} }),
  });

  _redisConn.on("error", (err) => {
    console.error("❌ Redis connection error:", err.message);
  });
  _redisConn.on("connect", () => {
    console.log(`✅ Redis connected (${url})`);
  });
  _redisConn.on("reconnecting", () => {
    console.warn("🔄 Redis reconnecting...");
  });

  return _redisConn;
}

// ============================================================================
// BULLMQ QUEUE REGISTRY
// ============================================================================

const _queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (_queues.has(name)) return _queues.get(name)!;

  const q = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });

  _queues.set(name, q);
  return q;
}

export async function initQueues(): Promise<void> {
  for (const name of ALL_QUEUE_NAMES) {
    getQueue(name);
  }
  console.log(`✅ ${ALL_QUEUE_NAMES.length} BullMQ queues initialized`);
}

// ============================================================================
// QUEUE HELPER FUNCTIONS (identical signatures — drop-in replacement)
// ============================================================================

export async function addBatchGenerationJob(data: BatchJobData) {
  if (!data.teamId || typeof data.teamId !== "number") {
    throw new Error(
      `CRITICAL: Cannot queue batch ${data.batchId} without teamId.`
    );
  }
  if (!data.businessName || data.businessName.trim().length === 0) {
    throw new Error(
      `CRITICAL: Cannot queue batch ${data.batchId} without businessName.`
    );
  }

  const job = await getQueue(BATCH_GENERATION_QUEUE).add("batch", data, {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
  });

  console.log(
    `📦 Queued batch generation job: ${job.id} for batch ${data.batchId} (brand: ${data.businessName})`
  );
  return job.id ?? null;
}

export async function addArticleJob(data: ArticleJobData) {
  if (!data.businessName || data.businessName.trim().length === 0) {
    console.warn(
      `⚠️ Queueing article ${data.articleId} without businessName — brand-lock will be skipped.`
    );
  }

  const runId = data.runId || crypto.randomUUID();
  const enrichedData = { ...data, runId };

  const job = await getQueue(ARTICLE_GENERATION_QUEUE).add(
    "article",
    enrichedData,
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    }
  );

  console.log(
    `✅ Article job queued: ${job.id} for article ${data.articleId} (brand: ${data.businessName}, runId: ${runId.slice(0, 8)}...)`
  );
  return job.id ?? null;
}

export async function addSocialPostJob(
  data: SocialPostJobData,
  options?: { singletonKey?: string }
) {
  const jobOpts: Parameters<Queue["add"]>[2] = {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  };

  // BullMQ deduplication via jobId (equivalent to pg-boss singletonKey)
  if (options?.singletonKey) {
    jobOpts.jobId = options.singletonKey;
  }

  const job = await getQueue(SOCIAL_POST_GENERATION_QUEUE).add(
    "social-post",
    data,
    jobOpts
  );

  if (!job) {
    if (options?.singletonKey) {
      console.log(
        `♻️ Social post ${data.socialPostId} already queued (deduplication: ${options.singletonKey})`
      );
      return null;
    }
    throw new Error(
      `BullMQ returned null job for social post ${data.socialPostId}`
    );
  }

  console.log(
    `🎭 Social post job queued: ${job.id} for social post ${data.socialPostId}`
  );
  return job.id ?? null;
}

export async function addImageGenerationJob(data: ImageGenerationJobData) {
  if (!data.businessName || data.businessName.trim().length === 0) {
    throw new Error(
      `CRITICAL: Cannot queue image generation for article ${data.articleId} without businessName.`
    );
  }

  const job = await getQueue(IMAGE_GENERATION_QUEUE).add("image", data, {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
  });

  if (!job?.id) {
    console.error(
      `⚠️ WARNING: BullMQ returned null job for image article ${data.articleId}`
    );
  } else {
    console.log(
      `✅ Image generation job queued: ${job.id} for article ${data.articleId} (brand: ${data.businessName})`
    );
  }

  return job?.id ?? null;
}

export async function addReformatJob(data: ReformatJobData) {
  const job = await getQueue(REFORMAT_QUEUE).add("reformat", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
  });

  if (!job?.id) {
    throw new Error(
      `BullMQ returned null for article ${data.articleId} reformat job.`
    );
  }

  console.log(`🔄 Reformat job queued: ${job.id} for article ${data.articleId}`);
  return job.id ?? null;
}

export async function addCleanupJob(data: CleanupJobData) {
  const job = await getQueue(CLEANUP_QUEUE).add("cleanup", data, {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
  });

  console.log(
    `🧹 Cleanup job queued: ${job.id} (type: ${data.jobType}, dryRun: ${data.dryRun || false})`
  );
  return job.id ?? null;
}

export async function addSiteCrawlJob(data: SiteCrawlJobData) {
  const job = await getQueue(SITE_CRAWL_QUEUE).add("site-crawl", data, {
    attempts: 1,
    backoff: { type: "fixed", delay: 30000 },
  });

  console.log(
    `🕷️ Queued site crawl job: ${job.id} for ${data.baseUrl} (team ${data.teamId})`
  );
  return job.id ?? null;
}

export async function addPublishingJob(data: PublishingJobData) {
  const job = await getQueue(CONTENT_PUBLISHING_QUEUE).add("publish", data, {
    attempts: 2,
    backoff: { type: "exponential", delay: 30000 },
  });

  console.log(
    `📤 Publishing job queued: ${job.id} for db job ${data.dbJobId} (team ${data.teamId})`
  );
  return job.id ?? null;
}

export async function addIntelligenceResearchJob(
  data: IntelligenceResearchJobData
) {
  const job = await getQueue(INTELLIGENCE_RESEARCH_QUEUE).add(
    "intelligence",
    data,
    {
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
    }
  );

  console.log(
    `🧠 Intelligence research job queued: ${job.id} for team ${data.teamId} (${data.companyName})`
  );
  return job.id ?? null;
}

export async function addPodcastGenerationJob(data: PodcastJobData) {
  const job = await getQueue(PODCAST_GENERATION_QUEUE).add("podcast", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 60000 },
  });

  console.log(
    `🎙️ Podcast generation job queued: ${job.id} for article ${data.articleId}`
  );
  return job.id ?? null;
}

export async function addVideoGenerationJob(data: SocialVideoJobData, opts?: { delayMs?: number }) {
  const job = await getQueue(SOCIAL_VIDEO_GENERATION_QUEUE).add(
    "social-video",
    data,
    {
      attempts: 1, // No retries — each attempt consumes a credit reservation
      ...(opts?.delayMs ? { delay: opts.delayMs } : {}),
    }
  );

  console.log(
    `🎬 Social video job queued: ${job.id} for social post ${data.socialPostId}`
  );
  return job.id ?? null;
}

export async function addVideoIdeaJob(data: VideoIdeaJobData) {
  const job = await getQueue(VIDEO_IDEA_GENERATION_QUEUE).add(
    "video-idea",
    data,
    {
      attempts: 1, // No retries — each attempt consumes a credit reservation
    }
  );
  console.log(`🎬 Video idea job queued: ${job.id} for video ${data.videoIdeaId}`);
  return job.id ?? null;
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

export async function closeQueues() {
  const closePromises: Promise<void>[] = [];
  for (const q of _queues.values()) {
    closePromises.push(q.close());
  }
  await Promise.allSettled(closePromises);
  _queues.clear();

  if (_redisConn) {
    try {
      await _redisConn.quit();
    } catch (_) {
      _redisConn.disconnect();
    }
    _redisConn = null;
  }

  console.log("🛑 BullMQ queues and Redis connection closed");
}

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing queues...");
  await closeQueues();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing queues...");
  await closeQueues();
  process.exit(0);
});
