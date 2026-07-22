import { db } from '../db';
import { 
  publishingConnections, 
  publishingJobs, 
  publishingCallbacks,
  articles,
  articleAssets,
  videoIdeas,
  type PublishingConnection,
  type PublishingJob
} from '../../shared/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { websiteAdapter } from './channels/website/adapter';
import type { 
  ChannelAdapter, 
  PublishableContent, 
  PublishResult,
  CallbackPayload 
} from './types';
import { generateApiKey, hashApiKey, encryptApiKey, decryptApiKey } from './auth/hmac';
import { logError, logCritical } from '../error-logger';
import { addPublishingJob } from '../queue';

const adapters: Record<string, ChannelAdapter> = {
  website: websiteAdapter,
};

/**
 * Validates publishing secrets are ready at startup.
 * Call this before registering workers to fail fast on misconfiguration.
 */
export async function ensurePublishingSecretsReady(): Promise<void> {
  const encryptionSecret = process.env.API_KEY_ENCRYPTION_SECRET;
  
  if (!encryptionSecret) {
    console.warn('⚠️ API_KEY_ENCRYPTION_SECRET not set - publishing will be disabled');
    return;
  }
  
  if (encryptionSecret.length < 32) {
    throw new Error('API_KEY_ENCRYPTION_SECRET must be at least 32 characters for AES-256');
  }
  
  // Verify we can decrypt existing website connections
  const websiteConnections = await db.select({
    id: publishingConnections.id,
    name: publishingConnections.name,
    encryptedApiKey: publishingConnections.encryptedApiKey,
  }).from(publishingConnections)
    .where(and(
      eq(publishingConnections.channel, 'website'),
      isNull(publishingConnections.deletedAt)
    ));
  
  let validCount = 0;
  let invalidCount = 0;
  
  for (const conn of websiteConnections) {
    if (!conn.encryptedApiKey) continue;
    
    try {
      decryptApiKey(conn.encryptedApiKey);
      validCount++;
    } catch (e) {
      console.error(`❌ Failed to decrypt API key for connection "${conn.name}" (ID: ${conn.id}). Key needs regeneration.`);
      invalidCount++;
    }
  }
  
  if (invalidCount > 0) {
    console.warn(`⚠️ ${invalidCount} connection(s) have invalid API keys - they need key regeneration`);
  }
  
  if (validCount > 0) {
    console.log(`✅ Publishing secrets validated - ${validCount} connection(s) ready`);
  }

  // Resolve the engine's public URL — required for receiver to download media files.
  // Priority: NEXTAUTH_URL → NEXT_PUBLIC_APP_URL → REPLIT_DOMAINS (auto-detected)
  const engineUrl =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.REPLIT_DOMAINS ? `https://${(process.env.REPLIT_DOMAINS.split(',')[0] ?? '').trim()}` : '');

  if (engineUrl) {
    console.log(`✅ Engine URL for media: ${engineUrl}`);
  } else {
    console.warn('⚠️ No engine URL detected — hero images and media may not transfer to receiver. Set NEXTAUTH_URL to your engine\'s public URL.');
  }
}

export function getAdapter(channel: string): ChannelAdapter | undefined {
  return adapters[channel];
}

export async function getConnectionsForTeam(teamId: number): Promise<PublishingConnection[]> {
  return db.select().from(publishingConnections)
    .where(and(
      eq(publishingConnections.teamId, teamId),
      isNull(publishingConnections.deletedAt)
    ));
}

export async function getConnectionById(
  connectionId: number, 
  teamId: number
): Promise<PublishingConnection | undefined> {
  const [connection] = await db.select().from(publishingConnections)
    .where(and(
      eq(publishingConnections.id, connectionId),
      eq(publishingConnections.teamId, teamId),
      isNull(publishingConnections.deletedAt)
    ))
    .limit(1);
  return connection;
}

const apiKeyCache = new Map<number, string>();

export async function createConnection(
  teamId: number,
  data: {
    name: string;
    channel: string;
    baseUrl?: string;
  }
): Promise<{ connection: PublishingConnection; apiKey?: string }> {
  let apiKey: string | undefined;
  let apiKeyHash: string | undefined;
  let encryptedKey: string | undefined;
  
  if (data.channel === 'website') {
    apiKey = generateApiKey();
    apiKeyHash = hashApiKey(apiKey);
    encryptedKey = encryptApiKey(apiKey);
  }
  
  const [connectionRow] = await db.insert(publishingConnections).values({
    teamId,
    name: data.name,
    channel: data.channel,
    baseUrl: data.baseUrl,
    apiKeyHash,
    encryptedApiKey: encryptedKey,
    status: 'pending',
    capabilities: { articles: true, images: true, videos: true, podcasts: true },
  }).returning();
  const connection = connectionRow!;
  
  if (apiKey && connection.id) {
    apiKeyCache.set(connection.id, apiKey);
  }
  
  return { connection, apiKey };
}

export async function getApiKeyForConnection(connectionId: number): Promise<string | undefined> {
  if (apiKeyCache.has(connectionId)) {
    return apiKeyCache.get(connectionId);
  }
  
  const [connection] = await db.select().from(publishingConnections)
    .where(eq(publishingConnections.id, connectionId))
    .limit(1);
  
  if (connection?.encryptedApiKey) {
    const apiKey = decryptApiKey(connection.encryptedApiKey);
    apiKeyCache.set(connectionId, apiKey);
    return apiKey;
  }
  
  return undefined;
}

export function setApiKeyForConnection(connectionId: number, apiKey: string): void {
  apiKeyCache.set(connectionId, apiKey);
}

export async function testConnection(
  connectionId: number,
  teamId: number
): Promise<{ success: boolean; error?: string }> {
  const connection = await getConnectionById(connectionId, teamId);
  if (!connection) {
    return { success: false, error: 'Connection not found' };
  }
  
  if (connection.channel === 'website') {
    if (!connection.baseUrl) {
      return { success: false, error: 'Missing base URL' };
    }
    
    try {
      // Use the receiver origin only — same as the publish() method — to handle
      // cases where baseUrl includes a content path like /blog or /articles.
      const receiverOrigin = new URL(connection.baseUrl).origin;
      const response = await fetch(`${receiverOrigin}/api/v1/status/ping`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      if (response.ok) {
        await db.update(publishingConnections)
          .set({ 
            status: 'active', 
            lastHeartbeatAt: new Date(),
            lastErrorMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(publishingConnections.id, connectionId));
        
        return { success: true };
      }
      
      const errorText = await response.text();
      await db.update(publishingConnections)
        .set({ 
          status: 'error',
          lastErrorMessage: `HTTP ${response.status}: ${errorText}`,
          updatedAt: new Date(),
        })
        .where(eq(publishingConnections.id, connectionId));
      
      return { success: false, error: `HTTP ${response.status}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      
      await db.update(publishingConnections)
        .set({ 
          status: 'error',
          lastErrorMessage: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(publishingConnections.id, connectionId));
      
      return { success: false, error: errorMessage };
    }
  }
  
  return { success: false, error: 'Unsupported channel type for testing' };
}

export async function createPublishingJob(
  teamId: number,
  connectionId: number,
  contentType: 'article' | 'social_post' | 'video' | 'podcast',
  contentId: number
): Promise<PublishingJob> {
  const jobData: any = {
    teamId,
    connectionId,
    contentType,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
  };
  
  switch (contentType) {
    case 'article':
      jobData.articleId = contentId;
      break;
    case 'social_post':
      jobData.socialPostId = contentId;
      break;
    case 'video':
      jobData.videoIdeaId = contentId;
      break;
    case 'podcast':
      // Podcasts are tied to articles — contentId is the articleId
      jobData.articleId = contentId;
      break;
  }
  
  const [jobRow] = await db.insert(publishingJobs).values(jobData).returning();
  const job = jobRow!;

  // Enqueue in BullMQ so the publishing worker picks it up
  try {
    const pgBossId = await addPublishingJob({ dbJobId: job.id, teamId: job.teamId });
    if (pgBossId) {
      await db.update(publishingJobs)
        .set({ pgBossJobId: pgBossId, status: 'queued', updatedAt: new Date() })
        .where(eq(publishingJobs.id, job.id));
      job.pgBossJobId = pgBossId;
      job.status = 'queued';
    }
  } catch (err) {
    // Non-fatal — the job is in DB and the recovery monitor will re-enqueue
    console.error(`⚠️ Failed to enqueue publishing job ${job.id} in BullMQ:`, err);
  }

  return job;
}

export async function processCallback(callback: CallbackPayload): Promise<void> {
  const [job] = await db.select().from(publishingJobs)
    .where(eq(publishingJobs.publicId, callback.jobId as any))
    .limit(1);
  
  if (!job) {
    console.error(`Publishing job not found for callback: ${callback.jobId}`);
    return;
  }
  
  await db.insert(publishingCallbacks).values({
    publishingJobId: job.id,
    status: callback.status,
    payload: callback as any,
  });
  
  if (callback.status === 'success') {
    await db.update(publishingJobs)
      .set({
        status: 'delivered',
        publishedUrl: callback.pageUrl,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(publishingJobs.id, job.id));
  } else if (callback.status === 'failure') {
    const newAttempts = job.attempts + 1;
    const shouldRetry = newAttempts < job.maxAttempts;
    
    await db.update(publishingJobs)
      .set({
        status: shouldRetry ? 'pending' : 'failed',
        attempts: newAttempts,
        lastError: callback.error,
        errorDetails: callback as any,
        lastAttemptAt: new Date(),
        nextRetryAt: shouldRetry ? new Date(Date.now() + 60000 * newAttempts) : null,
        updatedAt: new Date(),
      })
      .where(eq(publishingJobs.id, job.id));
  }
}

export async function deleteConnection(
  connectionId: number,
  teamId: number
): Promise<boolean> {
  const result = await db.update(publishingConnections)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(publishingConnections.id, connectionId),
      eq(publishingConnections.teamId, teamId)
    ));
  
  return true;
}

/**
 * Process a publishing job with proper error handling.
 * This is the main entry point for the publishing worker.
 */
export async function processPublishingJob(jobId: number): Promise<{
  success: boolean;
  error?: string;
  errorCode?: string;
}> {
  const [job] = await db.select().from(publishingJobs)
    .where(eq(publishingJobs.id, jobId))
    .limit(1);
  
  if (!job) {
    return { success: false, error: 'Job not found', errorCode: 'JOB_NOT_FOUND' };
  }
  
  // Get connection
  const [connection] = await db.select().from(publishingConnections)
    .where(eq(publishingConnections.id, job.connectionId))
    .limit(1);
  
  if (!connection) {
    await markJobFailed(job.id, 'Connection not found', 'CONNECTION_NOT_FOUND');
    return { success: false, error: 'Connection not found', errorCode: 'CONNECTION_NOT_FOUND' };
  }
  
  // Get API key with graceful error handling
  let apiKey: string | undefined;
  try {
    apiKey = await getApiKeyForConnection(connection.id);
  } catch (e) {
    const error = 'API key decryption failed - connection needs key regeneration';
    console.error(`❌ ${error} for connection ${connection.id}:`, e);
    
    // Mark connection as having an error
    await db.update(publishingConnections)
      .set({ 
        status: 'error',
        lastErrorMessage: 'API key decryption failed - please regenerate API key',
        updatedAt: new Date(),
      })
      .where(eq(publishingConnections.id, connection.id));
    
    await markJobFailed(job.id, error, 'AUTHENTICATION_ERROR');
    return { success: false, error, errorCode: 'AUTHENTICATION_ERROR' };
  }
  
  if (!apiKey) {
    const error = 'No API key configured for connection';
    await markJobFailed(job.id, error, 'NO_API_KEY');
    return { success: false, error, errorCode: 'NO_API_KEY' };
  }
  
  // Get adapter
  const adapter = getAdapter(connection.channel);
  if (!adapter) {
    await markJobFailed(job.id, `Unsupported channel: ${connection.channel}`, 'UNSUPPORTED_CHANNEL');
    return { success: false, error: `Unsupported channel: ${connection.channel}`, errorCode: 'UNSUPPORTED_CHANNEL' };
  }
  
  // Get content based on job's contentType and linked record
  let content: PublishableContent | null = null;

  if (job.contentType === 'video' && job.videoIdeaId) {
    const [video] = await db.select().from(videoIdeas)
      .where(eq(videoIdeas.id, job.videoIdeaId))
      .limit(1);
    if (video) {
      content = { type: 'video', videoIdea: video };
    }
  } else if (job.articleId) {
    const [article] = await db.select().from(articles)
      .where(eq(articles.id, job.articleId))
      .limit(1);
    if (article) {
      const assets = await db.select().from(articleAssets)
        .where(and(eq(articleAssets.articleId, article.id), isNull(articleAssets.deletedAt)));
      
      // Look up business name from the batch — used as the author on the receiver site.
      let businessName: string | undefined;
      if (article.batchId) {
        const { jobBatches } = await import('../../shared/schema');
        const [batch] = await db.select({ businessName: jobBatches.businessName })
          .from(jobBatches)
          .where(eq(jobBatches.id, article.batchId))
          .limit(1);
        businessName = batch?.businessName ?? undefined;
      }

      const contentType = job.contentType === 'podcast' ? 'podcast' : 'article';
      content = { type: contentType, article, articleAssets: assets, businessName };
    }
  }

  if (!content) {
    await markJobFailed(job.id, 'Content not found', 'CONTENT_NOT_FOUND');
    return { success: false, error: 'Content not found', errorCode: 'CONTENT_NOT_FOUND' };
  }
  
  // Mark job as processing
  await db.update(publishingJobs)
    .set({ status: 'processing', lastAttemptAt: new Date(), updatedAt: new Date() })
    .where(eq(publishingJobs.id, job.id));
  
  try {
    // Validate
    const validation = await adapter.validate(content, connection);
    if (!validation.valid) {
      await markJobFailed(job.id, validation.errors?.join(', ') || 'Validation failed', 'VALIDATION_FAILED');
      return { success: false, error: 'Validation failed', errorCode: 'VALIDATION_FAILED' };
    }
    
    // Format
    const formatted = await adapter.format(content, connection);
    
    // Publish
    const result = await adapter.publish(formatted, connection, apiKey, job.publicId);
    
    if (result.success) {
      await db.update(publishingJobs)
        .set({
          status: 'sent',
          publishedUrl: result.publishedUrl,
          lastError: null,   // Clear any stale error from a prior failed attempt
          updatedAt: new Date(),
        })
        .where(eq(publishingJobs.id, job.id));
      
      return { success: true };
    } else {
      const newAttempts = job.attempts + 1;
      // RECEIVER_REJECTED (HTTP 400) = permanent receiver validation failure — retrying
      // the same payload will always get the same 400. Mark as failed immediately.
      const permanentErrorCodes = ['AUTHENTICATION_ERROR', 'RECEIVER_REJECTED'];
      const shouldRetry = newAttempts < job.maxAttempts && !permanentErrorCodes.includes(result.errorCode || '');

      if (!shouldRetry) {
        await logError({
          errorType: "PUBLISHING",
          errorMessage: result.error || 'Publishing failed',
          severity: result.errorCode === 'AUTHENTICATION_ERROR' ? 'warning' : 'error',
          component: 'PublishingWorker',
          context: {
            jobId: job.id,
            jobPublicId: job.publicId,
            contentType: job.contentType,
            connectionId: job.connectionId,
            errorCode: result.errorCode,
            attempts: newAttempts,
          },
        });
      }
      
      await db.update(publishingJobs)
        .set({
          status: shouldRetry ? 'pending' : 'failed',
          attempts: newAttempts,
          lastError: result.error,
          errorDetails: result.rawResponse as any,
          nextRetryAt: shouldRetry ? new Date(Date.now() + 60000 * newAttempts) : null,
          updatedAt: new Date(),
        })
        .where(eq(publishingJobs.id, job.id));
      
      return { success: false, error: result.error, errorCode: result.errorCode };
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Publishing failed';
    await logCritical("PUBLISHING", error, {
      component: 'PublishingWorker',
      context: {
        jobId: job.id,
        jobPublicId: job.publicId,
        contentType: job.contentType,
        connectionId: job.connectionId,
        stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
      },
    });
    await markJobFailed(job.id, error, 'PUBLISH_ERROR');
    return { success: false, error, errorCode: 'PUBLISH_ERROR' };
  }
}

async function markJobFailed(jobId: number, error: string, errorCode: string): Promise<void> {
  await db.update(publishingJobs)
    .set({
      status: 'failed',
      lastError: error,
      errorDetails: { errorCode } as any,
      updatedAt: new Date(),
    })
    .where(eq(publishingJobs.id, jobId));
}

export { generateApiKey, hashApiKey } from './auth/hmac';
export * from './types';
