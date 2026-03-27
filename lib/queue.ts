import PgBoss from "pg-boss";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required for pg-boss");
}

// ============================================================================
// JOB DATA INTERFACES
// ============================================================================

export interface BatchJobData {
  batchId: number;
  userId: number;
  teamId: number; // CRITICAL: Required for team isolation
  selectedTitles: string[];
  targetUrl: string;
  tone?: string;
  wordCountMin?: number;
  wordCountMax?: number;
  geographicFocus?: string;
  audience?: string;
  businessName?: string;
  companyLogoUrl?: string;
  // Advanced features
  competitorUrls?: string[];
  semanticClusterId?: number;
  serpFeatureTarget?: string;
  // Psychographic targeting
  personaId?: number;
}

export interface ArticleJobData {
  articleId: number;
  batchId: number;
  runId: string; // UUID v4 for duplicate detection and cache lookup
  title: string;
  targetUrl: string;
  tone?: string;
  wordCountMin?: number;
  wordCountMax?: number;
  geographicFocus?: string;
  audience?: string;
  businessName?: string;
  companyLogoUrl?: string;
  // Advanced features
  competitorUrls?: string[];
  semanticClusterId?: number;
  serpFeatureTarget?: string;
  // Regeneration with custom instructions
  customInstructions?: string;
  // Psychographic targeting
  teamId?: number;
  personaId?: number;
}

export interface SocialPostJobData {
  socialPostId: number; // Standalone social post ID (not tied to articles)
  userId: number;
  prompt: string;
  platforms: string[]; // ['x', 'facebook', 'instagram', 'linkedin', 'pinterest']
  tone?: string;
  mood?: string;
  industry?: string;
  includeImage?: boolean;
  generateVideos?: boolean; // Queue video generation after social post creation
  userEmail?: string;
  articleId?: number; // Optional link to article
}

export interface ImageGenerationJobData {
  articleId: number;
  batchId: number;
  imagePrompts: string[]; // Array of image prompts from Gemini
  businessName?: string; // For brand lock enforcement in image generation
}

export interface ReformatJobData {
  articleId: number;
}

export interface SocialVideoJobData {
  socialPostId: number;
  platform?: string; // tiktok, instagram, youtube, facebook, linkedin, x
}

export interface CleanupJobData {
  jobType: "media" | "logs" | "orphans" | "sessions";
  dryRun?: boolean;
  retentionDays?: number;
  teamId?: number;
}

// ============================================================================
// QUEUE NAMES
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

// ============================================================================
// PG-BOSS CLIENT (SINGLETON)
// ============================================================================

let pgBossInstance: PgBoss | null = null;

export async function getPgBoss(): Promise<PgBoss> {
  if (pgBossInstance) {
    return pgBossInstance;
  }

  // pg-boss MUST use the direct (non-pooled) DATABASE_URL.
  // It relies on PostgreSQL session-level features (advisory locks,
  // listen/notify) that break through transaction poolers like PgBouncer.
  // The app worker pool uses DATABASE_POOLED_URL separately.
  pgBossInstance = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInHours: 12,
    retentionDays: 7,
    deleteAfterDays: 14,
    // CRITICAL: Job timeouts - article generation takes 25-40 mins
    expireInSeconds: 3600, // 60 minutes per job (allows for multi-stage AI processing)
    maintenanceIntervalMinutes: 5, // Check for stuck jobs every 5 minutes
    // Monitoring settings
    monitorStateIntervalMinutes: 5,
  });

  pgBossInstance.on('error', (error) => {
    console.error('❌ pg-boss error:', error);
  });

  await pgBossInstance.start();
  console.log("✅ pg-boss queue initialized (PostgreSQL-backed)");

  // Queue partitions are created manually in PostgreSQL for pg-boss 10+
  // See: pgboss.job_image_generation, pgboss.job_social_post_generation, etc.
  console.log("✅ Queue partitions configured (managed manually in PostgreSQL)");

  return pgBossInstance;
}

// ============================================================================
// QUEUE HELPER FUNCTIONS
// ============================================================================

export async function addBatchGenerationJob(data: BatchJobData) {
  // CRITICAL: Validate teamId is present for team isolation
  if (!data.teamId || typeof data.teamId !== 'number') {
    const error = new Error(
      `CRITICAL: Cannot queue batch ${data.batchId} without teamId. ` +
      `This ensures articles are created with proper team isolation.`
    );
    console.error(`❌ ${error.message}`);
    throw error;
  }
  
  // CRITICAL: Validate businessName is present to prevent AI hallucination
  if (!data.businessName || data.businessName.trim().length === 0) {
    const error = new Error(
      `CRITICAL: Cannot queue batch ${data.batchId} without businessName. ` +
      `This prevents AI from hallucinating company names in text and images.`
    );
    console.error(`❌ ${error.message}`);
    throw error;
  }
  
  const boss = await getPgBoss();
  const jobId = await boss.send(BATCH_GENERATION_QUEUE, data, {
    retryLimit: 2,
    retryDelay: 10,
    retryBackoff: true,
  });
  console.log(`📦 Queued batch generation job: ${jobId} for batch ${data.batchId} (brand: ${data.businessName})`);
  return jobId;
}

export async function addArticleJob(data: ArticleJobData) {
  try {
    // Warn when businessName is absent (legacy batch) — don't throw.
    // Brand-lock features are skipped inside the worker when businessName is empty.
    if (!data.businessName || data.businessName.trim().length === 0) {
      console.warn(
        `⚠️ Queueing article ${data.articleId} without businessName — ` +
        `brand-lock in AI prompts / image generation will be skipped.`
      );
    }
    
    // Generate run ID if not provided (for duplicate detection and cache lookup)
    const runId = data.runId || crypto.randomUUID();
    const enrichedData = { ...data, runId };
    
    const boss = await getPgBoss();
    const jobId = await boss.send(ARTICLE_GENERATION_QUEUE, enrichedData, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 3600, // 60 minutes - article generation can take 25-40 mins
    });
    
    console.log(`✅ Article job queued: ${jobId} for article ${data.articleId} (brand: ${data.businessName}, runId: ${runId.slice(0,8)}...)`);
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue article ${data.articleId}:`, error);
    throw error;
  }
}

export async function addSocialPostJob(data: SocialPostJobData) {
  try {
    const boss = await getPgBoss();
    const jobId = await boss.send(SOCIAL_POST_GENERATION_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 5,
      retryBackoff: true,
    });
    
    console.log(`🎭 Social post job queued: ${jobId} for social post ${data.socialPostId}`);
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue social post ${data.socialPostId}:`, error);
    throw error;
  }
}

export async function addImageGenerationJob(data: ImageGenerationJobData) {
  try {
    // CRITICAL: Validate businessName is present to prevent AI hallucination in images
    if (!data.businessName || data.businessName.trim().length === 0) {
      const error = new Error(
        `CRITICAL: Cannot queue image generation for article ${data.articleId} without businessName. ` +
        `This prevents AI from hallucinating company names in generated images.`
      );
      console.error(`❌ ${error.message}`);
      throw error;
    }
    
    const boss = await getPgBoss();
    console.log(`🖼️ Attempting to queue image job for article ${data.articleId} with ${data.imagePrompts.length} prompts`);
    console.log(`  Queue name: "${IMAGE_GENERATION_QUEUE}"`);
    console.log(`  Brand lock: ${data.businessName}`);
    console.log(`  Job data:`, JSON.stringify(data, null, 2));
    
    const jobId = await boss.send(IMAGE_GENERATION_QUEUE, data, {
      retryLimit: 2,
      retryDelay: 10,
      retryBackoff: true,
    });
    
    if (!jobId) {
      console.error(`⚠️ WARNING: boss.send() returned NULL for article ${data.articleId}!`);
      console.error(`  This usually means pg-boss is not accepting jobs for this queue`);
    } else {
      console.log(`✅ Image generation job queued: ${jobId} for article ${data.articleId} (brand: ${data.businessName})`);
    }
    
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue images for article ${data.articleId}:`, error);
    throw error;
  }
}

export async function addReformatJob(data: ReformatJobData) {
  try {
    const boss = await getPgBoss();

    // Ensure the queue row exists in pgboss.queue before calling send().
    // boss.send() returns null (not an error) when the queue is absent, which
    // silently swallows the job. createQueue is idempotent — safe to call every time.
    try {
      await boss.createQueue(REFORMAT_QUEUE);
    } catch {
      // Queue already exists — ignore the constraint error
    }

    const jobId = await boss.send(REFORMAT_QUEUE, data, {
      retryLimit: 3,
      retryDelay: 10,
      retryBackoff: true,
      expireInSeconds: 1800, // 30 minutes (was 5 min - too short for OpenAI calls)
    });

    if (!jobId) {
      throw new Error(
        `pg-boss returned null for article ${data.articleId} — queue "${REFORMAT_QUEUE}" may not be ready. ` +
        `Try again in a few seconds after the worker process registers its handlers.`
      );
    }
    
    console.log(`🔄 Reformat job queued: ${jobId} for article ${data.articleId}`);
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue reformat for article ${data.articleId}:`, error);
    throw error;
  }
}

export async function addCleanupJob(data: CleanupJobData) {
  try {
    const boss = await getPgBoss();
    const jobId = await boss.send(CLEANUP_QUEUE, data, {
      retryLimit: 2,
      retryDelay: 10,
      retryBackoff: true,
    });
    
    console.log(`🧹 Cleanup job queued: ${jobId} (type: ${data.jobType}, dryRun: ${data.dryRun || false})`);
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue cleanup job:`, error);
    throw error;
  }
}

export async function addSiteCrawlJob(data: SiteCrawlJobData) {
  try {
    const boss = await getPgBoss();
    const jobId = await boss.send(SITE_CRAWL_QUEUE, data, {
      retryLimit: 1,
      retryDelay: 30,
      expireInSeconds: 1800,
    });
    console.log(`🕷️ Queued site crawl job: ${jobId} for ${data.baseUrl} (team ${data.teamId})`);
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue site crawl job:`, error);
    throw error;
  }
}

export async function addPublishingJob(data: PublishingJobData) {
  try {
    const boss = await getPgBoss();
    const jobId = await boss.send(CONTENT_PUBLISHING_QUEUE, data, {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 300, // 5 minutes per publish attempt
    });
    console.log(`📤 Publishing job queued: ${jobId} for db job ${data.dbJobId} (team ${data.teamId})`);
    return jobId;
  } catch (error) {
    console.error(`❌ Failed to queue publishing job ${data.dbJobId}:`, error);
    throw error;
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

export async function closeQueues() {
  if (pgBossInstance) {
    await pgBossInstance.stop();
    pgBossInstance = null;
    console.log("🛑 pg-boss queue stopped");
  }
}

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing queues...');
  await closeQueues();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing queues...');
  await closeQueues();
  process.exit(0);
});
