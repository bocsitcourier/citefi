import { Queue, type Job } from "bullmq";
import Redis, { type RedisOptions } from "ioredis";

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
  creditRunId?: string;
  userId?: number;
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
  runId?: string;
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

export interface DailyBriefJobData {
  userId: number;
  teamId: number;
  localDate: string;
  force?: boolean;
}

export interface SignupCompetitorIntakeJobData {
  intakeId: number;
  email: string;
  companyName?: string;
  websiteUrl?: string;
  teamId?: number;
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
export const DAILY_BRIEF_QUEUE = "daily-brief";
export const SIGNUP_COMPETITOR_INTAKE_QUEUE = "signup-competitor-intake";
export const CANARY_QUEUE = "canary";
export const RESERVATION_SWEEPER_QUEUE = "reservation-sweeper";

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
  DAILY_BRIEF_QUEUE,
  SIGNUP_COMPETITOR_INTAKE_QUEUE,
  CANARY_QUEUE,
  RESERVATION_SWEEPER_QUEUE,
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

/**
 * Normalize a raw REDIS_URL string.
 *
 * The Replit javascript_mem_db integration injects REDIS_URL with a typo:
 * "ediss://" instead of "rediss://". Call this helper whenever constructing
 * a Redis client so both the shared connection and ad-hoc clients (e.g. in
 * the canary health reader) apply the same fix.
 */
export function normalizeRedisUrl(raw?: string): { url: string; tls: boolean } {
  let url = raw ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  if (url.startsWith("ediss://")) {
    url = "rediss://" + url.slice("ediss://".length);
  }
  return { url, tls: url.startsWith("rediss://") };
}

/**
 * Build a consistent ioredis URL/options pair for every process.
 * Callers provide purpose-specific options; TLS is added automatically for
 * normalized rediss:// URLs.
 */
export function getRedisClientConfig(
  raw?: string,
  options: RedisOptions = {}
): { url: string; options: RedisOptions } {
  const { url, tls } = normalizeRedisUrl(raw);
  return {
    url,
    options: {
      ...options,
      ...(tls && { tls: options.tls ?? {} }),
    },
  };
}

let _redisConn: Redis | null = null;

export function getRedisConnection(): Redis {
  if (_redisConn) return _redisConn;

  const { url, options } = getRedisClientConfig(undefined, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  });
  _redisConn = new Redis(url, options);

  _redisConn.on("error", (err) => {
    console.error("❌ Redis connection error:", err.message);
  });
  _redisConn.on("connect", () => {
    const redactedUrl = url.replace(/:\/\/[^@]*@/, "://***@");
    console.log(`✅ Redis connected (${redactedUrl})`);

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

  const queue = getQueue(BATCH_GENERATION_QUEUE);
  const jobId = `batch:${data.batchId}`;
  let job: Job;
  try {
    job = await queue.add("batch", data, {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 10000 },
    });
  } catch (error) {
    const accepted = await findJobAfterAmbiguousEnqueue(queue, jobId);
    if (accepted) return accepted.id ?? jobId;
    const [{ db }, { jobBatches }, { eq }] = await Promise.all([
      import("./db"),
      import("@/shared/schema"),
      import("drizzle-orm"),
    ]);
    await db.update(jobBatches)
      .set({ status: "FAILED_ENQUEUE" })
      .where(eq(jobBatches.id, data.batchId));
    throw error;
  }

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
  const {
    prepareArticleRunForEnqueue,
    markArticleRunEnqueueFailed,
  } = await import("./article-run-state");
  await prepareArticleRunForEnqueue({
    articleId: data.articleId,
    runId,
    runType: data.customInstructions ? "regeneration" : "generation",
  });

  const queue = getQueue(ARTICLE_GENERATION_QUEUE);
  let job: Job;
  try {
    job = await queue.add(
      "article",
      enrichedData,
      {
        jobId: runId,  // BullMQ native dedup: double-clicks get the same job
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      }
    );
  } catch (enqueueError) {
    // Queue.add() can time out after Redis accepted the write. Confirm absence
    // before declaring FAILED_ENQUEUE so a retry cannot race an existing job.
    const acceptedJob = await findJobAfterAmbiguousEnqueue(queue, runId);
    if (acceptedJob) {
      console.warn(
        `⚠️ Article enqueue returned an error but job ${runId} exists; treating it as accepted`
      );
      return acceptedJob.id ?? runId;
    }

    await markArticleRunEnqueueFailed({
      articleId: data.articleId,
      runId,
      error: enqueueError,
    });
    throw enqueueError;
  }

  console.log(
    `✅ Article job queued: ${job.id} for article ${data.articleId} (brand: ${data.businessName}, runId: ${runId.slice(0, 8)}...)`
  );
  return job.id ?? null;
}

const ENQUEUE_CONFIRMATION_DELAYS_MS = [100, 250, 500] as const;

export async function findJobAfterAmbiguousEnqueue(
  queue: Pick<Queue, "getJob">,
  jobId: string,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<Job | null> {
  for (const delayMs of ENQUEUE_CONFIRMATION_DELAYS_MS) {
    const job = await queue.getJob(jobId);
    if (job) return job;
    await sleep(delayMs);
  }
  return (await queue.getJob(jobId)) ?? null;
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
  const enqueueJobId =
    options?.singletonKey ?? `social:${data.socialPostId}:${crypto.randomUUID()}`;
  jobOpts.jobId = enqueueJobId;

  const queue = getQueue(SOCIAL_POST_GENERATION_QUEUE);
  let job: Job;
  try {
    job = await queue.add("social-post", data, jobOpts);
  } catch (error) {
    const accepted = await findJobAfterAmbiguousEnqueue(queue, enqueueJobId);
    if (accepted) return accepted.id ?? enqueueJobId;
    const [{ db }, { socialPosts }, { eq }] = await Promise.all([
      import("./db"),
      import("@/shared/schema"),
      import("drizzle-orm"),
    ]);
    await db.update(socialPosts)
      .set({
        status: "FAILED_ENQUEUE",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, data.socialPostId));
    throw error;
  }

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
    // Dedup by articleId: prevents a race where two parallel requests both
    // queue image generation for the same article.
    jobId: data.runId
      ? `image:${data.articleId}:${data.runId}`
      : `image:${data.articleId}`,
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
  const queue = getQueue(CONTENT_PUBLISHING_QUEUE);
  const jobId = `publishing:${data.dbJobId}`;
  let job: Job;
  try {
    job = await queue.add("publish", data, {
      jobId,
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
    });
  } catch (error) {
    const accepted = await findJobAfterAmbiguousEnqueue(queue, jobId);
    if (accepted) return accepted.id ?? jobId;
    const [{ db }, { publishingJobs }, { eq }] = await Promise.all([
      import("./db"),
      import("@/shared/schema"),
      import("drizzle-orm"),
    ]);
    await db.update(publishingJobs)
      .set({
        status: "failed_enqueue",
        lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(publishingJobs.id, data.dbJobId));
    throw error;
  }

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
  const queue = getQueue(PODCAST_GENERATION_QUEUE);
  const jobId = `podcast:${data.articleId}`;
  let job: Job;
  try {
    job = await queue.add("podcast", data, {
    // Dedup by articleId: prevents double-submits while the job is pending/active.
    // Once the job reaches a terminal state and is removed, a new one can be added.
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 60000 },
  });
  } catch (error) {
    const accepted = await findJobAfterAmbiguousEnqueue(queue, jobId);
    if (accepted) return accepted.id ?? jobId;
    const [{ db }, { articles }, { eq }] = await Promise.all([
      import("./db"),
      import("@/shared/schema"),
      import("drizzle-orm"),
    ]);
    await db.update(articles)
      .set({
        podcastStatus: "failed_enqueue",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(articles.id, data.articleId));
    throw error;
  }

  console.log(
    `🎙️ Podcast generation job queued: ${job.id} for article ${data.articleId}`
  );
  return job.id ?? null;
}

export async function addVideoGenerationJob(data: SocialVideoJobData, opts?: { delayMs?: number }) {
  const queue = getQueue(SOCIAL_VIDEO_GENERATION_QUEUE);
  const jobId = data.creditRunId
    ? `video:${data.creditRunId}`
    : `video:${data.socialPostId}:${crypto.randomUUID()}`;
  let job: Job;
  try {
    job = await queue.add("social-video", data, {
      // Dedup by creditRunId so a double-submit uses the same reservation.
      // Falls back to socialPostId + timestamp so intentional retries after
      // failure still create new jobs.
      jobId,
      attempts: 1, // No retries — each attempt consumes a credit reservation
      ...(opts?.delayMs ? { delay: opts.delayMs } : {}),
    });
  } catch (error) {
    const accepted = await findJobAfterAmbiguousEnqueue(queue, jobId);
    if (accepted) return accepted.id ?? jobId;
    const [{ db }, { socialPosts }, { eq }] = await Promise.all([
      import("./db"),
      import("@/shared/schema"),
      import("drizzle-orm"),
    ]);
    await db.update(socialPosts)
      .set({
        videoStatus: "FAILED_ENQUEUE",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(socialPosts.id, data.socialPostId));
    throw error;
  }

  console.log(
    `🎬 Social video job queued: ${job.id} for social post ${data.socialPostId}`
  );
  return job.id ?? null;
}

export async function addVideoIdeaJob(data: VideoIdeaJobData) {
  const queue = getQueue(VIDEO_IDEA_GENERATION_QUEUE);
  const jobId = data.creditRunId
    ? `video-idea:${data.creditRunId}`
    : `video-idea:${data.videoIdeaId}:${crypto.randomUUID()}`;
  let job: Job;
  try {
    job = await queue.add("video-idea", data, {
      jobId,
      attempts: 1, // No retries — each attempt consumes a credit reservation
    });
  } catch (error) {
    const accepted = await findJobAfterAmbiguousEnqueue(queue, jobId);
    if (accepted) return accepted.id ?? jobId;
    const [{ db }, { videoIdeas }, { eq }] = await Promise.all([
      import("./db"),
      import("@/shared/schema"),
      import("drizzle-orm"),
    ]);
    await db.update(videoIdeas)
      .set({
        status: "FAILED_ENQUEUE",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(videoIdeas.id, data.videoIdeaId));
    throw error;
  }
  console.log(`🎬 Video idea job queued: ${job.id} for video ${data.videoIdeaId}`);
  return job.id ?? null;
}

export async function addDailyBriefJob(data: DailyBriefJobData) {
  // force=true jobs get a unique jobId (timestamp suffix) so BullMQ doesn't
  // silently deduplicate them against the existing deterministic job id
  const jobId = data.force
    ? `daily-brief:${data.userId}:${data.localDate}:force:${Date.now()}`
    : `daily-brief:${data.userId}:${data.localDate}`;

  const job = await getQueue(DAILY_BRIEF_QUEUE).add("daily-brief", data, {
    jobId,
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
  });

  console.log(
    `📅 Daily brief job queued: ${job.id} for user ${data.userId} on ${data.localDate}`
  );
  return job.id ?? null;
}

export async function addSignupCompetitorIntakeJob(
  data: SignupCompetitorIntakeJobData
) {
  const job = await getQueue(SIGNUP_COMPETITOR_INTAKE_QUEUE).add(
    "signup-intake",
    data,
    {
      attempts: 2,
      backoff: { type: "exponential", delay: 30000 },
    }
  );

  console.log(
    `🤝 Signup competitor intake job queued: ${job.id} for ${data.email}`
  );
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
