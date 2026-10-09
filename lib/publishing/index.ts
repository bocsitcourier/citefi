import { db } from '../db';
import { 
  publishingConnections, 
  publishingJobs, 
  publishingCallbacks,
  articles,
  articleAssets,
  jobBatches,
  teams,
  teamMembers,
  videoIdeas,
  type PublishingConnection,
  type PublishingJob
} from '../../shared/schema';
import { eq, and, isNull, or, lte, inArray, ne, sql } from 'drizzle-orm';
import { assertReviewedArticle, dispatchContract, publicationHash, reviewHash } from './dispatch-policy';
import { assertBoundReview, assertCurrentActor, reviewMediaPayload } from './review-binding';
import { assertPublishingOperator, detailsOf, reconciliationOf, type Operator } from './reconciliation';
import { reconciliationError } from './receipt-policy';
import type { FormattedContent } from './types';
import { getDatabaseExecutionContext, runWithSystemContext } from '../tenant-context';
import { websiteAdapter } from './channels/website/adapter';
import { safeFetchWithRedirects, validateExternalUrl } from '../url-validation';
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
  if (!getAdapter(data.channel)) throw Object.assign(new Error('This publishing channel is not yet supported'), { statusCode: 400 });
  if (data.channel === 'website') {
    if (!data.baseUrl) throw Object.assign(new Error('Website connections require a base URL'), { statusCode: 400 });
    try { validateExternalUrl(data.baseUrl); } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error('Invalid receiver URL'), { statusCode: 400 });
    }
    if (new URL(data.baseUrl).protocol !== 'https:') throw Object.assign(new Error('Publishing receivers require HTTPS'), { statusCode: 400 });
  }
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
      const response = await safeFetchWithRedirects(`${receiverOrigin}/api/v1/status/ping`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        maxRedirects: 0,
        timeoutMs: 12000,
        maxBytes: 65536,
      });
      if (!response) throw new Error('Receiver URL blocked or request exceeded safe network limits');
      
      if (response.ok) {
        const ping = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        const capabilities = ping?.data?.capabilities ?? ping?.capabilities ?? {};
        await db.update(publishingConnections)
          .set({ 
            status: 'active', 
            lastHeartbeatAt: new Date(),
            lastErrorMessage: null,
            capabilities: { ...connection.capabilities, publishingReceiptV1: capabilities.publishingReceiptV1 === true },
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
  contentId: number,
  publisher?: { userId: number; role: string },
  replacement?: { originalJobId: number; decisionId: string; operator: Operator },
): Promise<PublishingJob> {
  const connection = await getConnectionById(connectionId, teamId);
  if (!connection || connection.status !== 'active' || !getAdapter(connection.channel)) {
    throw Object.assign(new Error('Publishing connection is unavailable or unsupported'), { statusCode: 400 });
  }
  // Only article-backed formats currently have a reviewed-version workflow.
  // Do not let video or social exports silently bypass it.
  if (contentType !== 'article' && contentType !== 'podcast') {
    throw Object.assign(new Error('This content type does not have a supported publishing approval workflow'), { statusCode: 409 });
  }
  const adapter = getAdapter(connection.channel)!;
  const context = getDatabaseExecutionContext();
  const actor = publisher ?? (context?.scope === 'tenant' && context.userId ? { userId: context.userId, role: context.role } : undefined);
  if (!actor) throw Object.assign(new Error('An explicitly authorized publisher is required'), { statusCode: 403 });
  const job = await runWithSystemContext('exact publishing admission and reviewer revalidation', () => db.transaction(async (tx): Promise<PublishingJob> => {
    // Serialize identical requests across processes, including concurrent clicks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`publish:${teamId}:${connectionId}:${contentType}:${contentId}`}, 0))`);
    const publishingActor = { ...actor };
    // Global authority is not publishing consent. A platform administrator
    // must still have an actual current membership in the owning workspace.
    if (actor.role === 'platform_admin') {
      const [direct] = await tx.select().from(teamMembers).where(and(
        eq(teamMembers.userId, actor.userId), eq(teamMembers.teamId, teamId),
      )).for('share');
      if (!direct || !['owner', 'admin', 'member'].includes(direct.role))
        reconciliationError('Current owning-workspace publishing membership is required', 403);
      publishingActor.role = direct.role;
    }
    const publisherMembership = await assertCurrentActor(tx, { ...publishingActor, teamId }, ['owner', 'admin', 'member']);
    const [currentConnection] = await tx.select().from(publishingConnections).where(and(
      eq(publishingConnections.id, connectionId), eq(publishingConnections.teamId, teamId),
    )).for('share');
    if (!currentConnection) throw Object.assign(new Error('Destination not found'), { statusCode: 404 });
    const [article] = await tx.select().from(articles)
      .where(and(eq(articles.id, contentId), eq(articles.teamId, teamId), isNull(articles.deletedAt)))
      .for('update');
    if (!article) throw Object.assign(new Error('Content not found'), { statusCode: 404 });
    assertReviewedArticle(article);
    const snapshot = await assertBoundReview(tx, article, currentConnection, contentType);
    const hash = reviewHash({ publication: publicationHash(snapshot.formatted, currentConnection), reviewDigest: snapshot.digest });
    const priorOperations = await tx.select({ errorDetails: publishingJobs.errorDetails }).from(publishingJobs).where(and(
      eq(publishingJobs.teamId, teamId), eq(publishingJobs.connectionId, connectionId),
      eq(publishingJobs.contentType, contentType), eq(publishingJobs.articleId, contentId),
    ));
    if (priorOperations.some(prior => {
      const binding = dispatchContract(prior.errorDetails);
      return !binding?.reviewId || !binding.publisherUserId || !binding.publisherRole || !binding.publisherMembership;
    }))
      reconciliationError('A legacy operation lacks a trustworthy submission binding; a new request cannot bypass it');
    let original: PublishingJob | undefined;
    if (replacement) {
      if (replacement.operator.teamId !== teamId) reconciliationError('Wrong operator workspace', 403);
      await assertPublishingOperator(tx, replacement.operator);
      [original] = await tx.select().from(publishingJobs).where(and(
        eq(publishingJobs.id, replacement.originalJobId), eq(publishingJobs.teamId, teamId),
      )).for('update');
      if (!original || original.articleId !== contentId || original.connectionId !== connectionId ||
          original.contentType !== contentType) reconciliationError('Original operation does not match');
      const retained = reconciliationOf(original);
      if (original.status !== 'not_accepted' || retained.decision?.outcome !== 'not_accepted' ||
          retained.decision.decisionId !== replacement.decisionId ||
          !dispatchContract(original.errorDetails)?.submissionStarted ||
          detailsOf(original).reconciliationConflict === true)
        reconciliationError('A proven, fenced non-acceptance decision is required');
      const contradiction = await tx.select({ id: publishingCallbacks.id }).from(publishingCallbacks).where(and(
        eq(publishingCallbacks.publishingJobId, original.id),
        sql`(${publishingCallbacks.status} = 'success' OR
          (${publishingCallbacks.status} = 'native_evidence' AND
           ${publishingCallbacks.payload}->'receipt'->>'outcome' = 'accepted'))`,
      )).limit(1);
      if (contradiction.length) reconciliationError('Conflicting evidence prevents a replacement');
      if (retained.replacementJobId) {
        const [successor] = await tx.select().from(publishingJobs).where(and(
          eq(publishingJobs.id, retained.replacementJobId), eq(publishingJobs.teamId, teamId),
        ));
        if (!successor) reconciliationError('Retained replacement is unavailable');
        return successor;
      }
      if (hash !== dispatchContract(original.errorDetails)?.hash ||
          new URL(currentConnection.baseUrl!).origin !== dispatchContract(original.errorDetails)?.receiverOrigin ||
          currentConnection.apiKeyHash !== dispatchContract(original.errorDetails)?.receiverKeyHash)
        reconciliationError('Original content or receiver changed; replacement cannot be authorized');
    }
    const [existing] = await tx.select().from(publishingJobs).where(and(
      eq(publishingJobs.teamId, teamId), eq(publishingJobs.connectionId, connectionId),
      eq(publishingJobs.contentType, contentType), eq(publishingJobs.articleId, contentId),
      sql`${publishingJobs.status} <> 'cancelled'`,
      original ? ne(publishingJobs.id, original.id) : undefined,
      replacement ? sql`(${publishingJobs.status} <> 'not_accepted' OR coalesce(${publishingJobs.errorDetails}->>'reconciliationConflict', 'false') = 'true')` : undefined,
      sql`${publishingJobs.errorDetails}->'dispatchContract'->>'hash' = ${hash}`,
    )).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(publishingJobs).values({
    teamId,
    connectionId,
    contentType,
    articleId: contentId,
    campaignId: article.campaignId,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    errorDetails: { dispatchContract: { version: 1, hash, submissionStarted: false, reviewId: snapshot.reviewId,
      publisherUserId: publishingActor.userId, publisherRole: publishingActor.role, publisherMembership },
      ...(original ? { replacementOf: original.id, replacementDecisionId: replacement!.decisionId } : {}) },
    }).returning();
    if (original) {
      const retained = reconciliationOf(original);
      await tx.update(publishingJobs).set({
        errorDetails: { ...detailsOf(original), reconciliation: { ...retained, replacementJobId: created!.id,
          audit: [...(retained.audit ?? []), { action: 'replacement_authorized', actorId: replacement!.operator.userId,
            at: new Date().toISOString(), replacementJobId: created!.id, decisionId: replacement!.decisionId }] } },
        updatedAt: new Date(),
      }).where(and(eq(publishingJobs.id, original.id), eq(publishingJobs.teamId, teamId)));
    }
    return created!;
  }));
  if (job.status !== 'pending' || job.pgBossJobId) return job;

  // Enqueue in BullMQ so the publishing worker picks it up
  try {
    const pgBossId = await addPublishingJob({ dbJobId: job.id, teamId: job.teamId, campaignId: (job as any).campaignId ?? null });
    if (pgBossId) {
      await db.update(publishingJobs)
        .set({ pgBossJobId: pgBossId, updatedAt: new Date() })
        .where(and(eq(publishingJobs.id, job.id), eq(publishingJobs.status, 'pending')));
      job.pgBossJobId = pgBossId;
    }
  } catch (err) {
    // Non-fatal — the job is in DB and the recovery monitor will re-enqueue
    console.error(`⚠️ Failed to enqueue publishing job ${job.id} in BullMQ:`, err);
  }

  return job;
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
  if (!['pending', 'queued'].includes(job.status)) {
    return { success: false, error: 'Operation is already active or terminal', errorCode: 'JOB_NOT_CLAIMABLE' };
  }
  const initialContract = dispatchContract(job.errorDetails);
  if (initialContract?.submissionStarted || (!initialContract && job.lastAttemptAt)) {
    await markJobFailed(job.id, 'Prior submission requires reconciliation, not another send', 'OUTCOME_UNKNOWN', undefined, true);
    return { success: false, error: 'Prior submission requires reconciliation', errorCode: 'OUTCOME_UNKNOWN' };
  }
  
  // Get connection
  const [connection] = await db.select().from(publishingConnections)
    .where(and(eq(publishingConnections.id, job.connectionId), eq(publishingConnections.teamId, job.teamId), isNull(publishingConnections.deletedAt)))
    .limit(1);
  
  if (!connection || connection.status !== 'active') {
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
  
  let reviewedFormatted: FormattedContent | undefined;
  // Mark job as processing
  const claimed = await runWithSystemContext('exact publishing dispatch claim and reviewer revalidation', () => db.transaction(async (tx): Promise<{ id: number; lastAttemptAt: Date | null }[]> => {
    const [currentTeam] = await tx.select({
      deletedAt: teams.deletedAt, clientStatus: teams.clientStatus,
    }).from(teams).where(eq(teams.id, job.teamId)).for('share');
    if (!currentTeam || currentTeam.deletedAt || currentTeam.clientStatus !== 'active') return [];
    // A revocation committed before this dispatch claim fences the queued job.
    // Revocation cannot undo an external request that has already been claimed.
    const [currentConnection] = await tx.select().from(publishingConnections)
      .where(and(eq(publishingConnections.id, job.connectionId), eq(publishingConnections.teamId, job.teamId)))
      .for('update');
    if (!currentConnection || currentConnection.deletedAt || currentConnection.status !== 'active') return [];
    const contract = dispatchContract(job.errorDetails);
    if (!contract || contract.submissionStarted || !job.articleId) return [];
    if (detailsOf(job).replacementOf) {
      const [parent] = await tx.select().from(publishingJobs).where(and(
        eq(publishingJobs.id, Number(detailsOf(job).replacementOf)), eq(publishingJobs.teamId, job.teamId),
      )).for('share');
      if (!parent || parent.status !== 'not_accepted' || detailsOf(parent).reconciliationConflict === true ||
          reconciliationOf(parent).replacementJobId !== job.id ||
          reconciliationOf(parent).decision?.decisionId !== detailsOf(job).replacementDecisionId) return [];
    }
    const [currentArticle] = await tx.select().from(articles)
      .where(and(eq(articles.id, job.articleId), eq(articles.teamId, job.teamId), isNull(articles.deletedAt)))
      .for('update');
    if (!currentArticle) return [];
    try { assertReviewedArticle(currentArticle); } catch { return []; }
    try {
      if (!contract.reviewId || !contract.publisherUserId || !contract.publisherRole) return [];
      const membership = await assertCurrentActor(tx, { userId: contract.publisherUserId, role: contract.publisherRole, teamId: job.teamId }, ['owner', 'admin', 'member']);
      if (membership !== contract.publisherMembership) return [];
      const snapshot = await assertBoundReview(tx, currentArticle, currentConnection, job.contentType === 'podcast' ? 'podcast' : 'article');
      if (snapshot.reviewId !== contract.reviewId ||
          reviewHash({ publication: publicationHash(snapshot.formatted, currentConnection), reviewDigest: snapshot.digest }) !== contract.hash) return [];
      reviewedFormatted = reviewMediaPayload(snapshot);
    } catch { return []; }
    const currentAssets = await tx.select().from(articleAssets)
      .where(and(eq(articleAssets.articleId, currentArticle.id), isNull(articleAssets.deletedAt)))
      .orderBy(articleAssets.id);
    const [currentBatch] = currentArticle.batchId ? await tx.select({ businessName: jobBatches.businessName })
      .from(jobBatches).where(and(eq(jobBatches.id, currentArticle.batchId), eq(jobBatches.teamId, job.teamId))) : [];
    const reviewedContent: PublishableContent = {
      type: job.contentType === 'podcast' ? 'podcast' : 'article', article: currentArticle,
      articleAssets: currentAssets, businessName: currentBatch?.businessName ?? undefined,
    };
    // This row-locked claim is the authorization linearization point. Publish
    // this immutable in-memory snapshot, never a later mutable content lookup.
    content = reviewedContent;
    Object.assign(connection, currentConnection);
    return tx.update(publishingJobs)
    .set({ status: 'processing', attempts: sql`${publishingJobs.attempts} + 1`, lastAttemptAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(publishingJobs.id, job.id),
       inArray(publishingJobs.status, ['pending', 'queued']),
      or(isNull(publishingJobs.nextRetryAt), lte(publishingJobs.nextRetryAt, new Date())),
    )).returning({ id: publishingJobs.id, lastAttemptAt: publishingJobs.lastAttemptAt });
  }));
  if (!claimed.length) {
    await markJobFailed(job.id, 'Current approval, immutable payload binding, and active destination are required', 'DISPATCH_NOT_AUTHORIZED');
    return { success: false, error: 'Job is not authorized or is already claimed', errorCode: 'JOB_NOT_CLAIMABLE' };
  }
  const claimAt = claimed[0]!.lastAttemptAt!;
  // Use the locked and reviewed credential revision, never a stale ID cache.
  apiKey = connection.encryptedApiKey ? decryptApiKey(connection.encryptedApiKey) : undefined;
  let submissionStarted = false;
  
  try {
    // Validate
    const validation = await adapter.validate(content, connection);
    if (!validation.valid) {
      await markJobFailed(job.id, validation.errors?.join(', ') || 'Validation failed', 'VALIDATION_FAILED', claimAt);
      return { success: false, error: 'Validation failed', errorCode: 'VALIDATION_FAILED' };
    }
    
    // Format
    const formatted = reviewedFormatted!;
    
    // Publish
    const contract = dispatchContract(job.errorDetails)!;
    const submitted = await db.transaction(async tx => {
      if (detailsOf(job).replacementOf) {
        const [parent] = await tx.select().from(publishingJobs).where(and(
          eq(publishingJobs.id, Number(detailsOf(job).replacementOf)), eq(publishingJobs.teamId, job.teamId),
        )).for('share');
        if (!parent || parent.status !== 'not_accepted' || detailsOf(parent).reconciliationConflict === true ||
            reconciliationOf(parent).replacementJobId !== job.id ||
            reconciliationOf(parent).decision?.decisionId !== detailsOf(job).replacementDecisionId) return [];
        const originalReceiver = dispatchContract(parent.errorDetails);
        if (!originalReceiver?.receiverOrigin || !originalReceiver.receiverKeyHash ||
            originalReceiver.receiverOrigin !== new URL(connection.baseUrl!).origin ||
            originalReceiver.receiverKeyHash !== hashApiKey(apiKey!)) return [];
      }
      return tx.update(publishingJobs).set({
      errorDetails: sql`coalesce(${publishingJobs.errorDetails}, '{}'::jsonb) || ${JSON.stringify({
        dispatchContract: { ...contract, submissionStarted: true,
          receiverOrigin: new URL(connection.baseUrl!).origin, receiverKeyHash: hashApiKey(apiKey!),
        },
      })}::jsonb`,
    }).where(and(eq(publishingJobs.id, job.id), eq(publishingJobs.status, 'processing'), eq(publishingJobs.lastAttemptAt, claimAt)))
      .returning({ id: publishingJobs.id });
    });
    if (!submitted.length) return { success: false, error: 'Dispatch was superseded', errorCode: 'DISPATCH_SUPERSEDED' };
    submissionStarted = true;
    const result = await adapter.publish({
      ...formatted, payload: { ...formatted.payload, dispatchAttempt: claimAt.toISOString(),
        contentHash: contract.hash, receiverOrigin: new URL(connection.baseUrl!).origin },
    }, connection, apiKey!, job.publicId);
    
    if (result.success) {
      await db.update(publishingJobs)
        .set({
          status: 'sent',
          publishedUrl: result.publishedUrl,
          lastError: null,   // Clear any stale error from a prior failed attempt
          updatedAt: new Date(),
        })
        .where(and(eq(publishingJobs.id, job.id), eq(publishingJobs.status, 'processing'), eq(publishingJobs.lastAttemptAt, claimAt)));
      
      return { success: true };
    } else {
      const newAttempts = job.attempts + 1;
      // A failed response is not evidence that the receiver did nothing.
      // Without a reconciliation/idempotency contract no physical resend is safe.
      const shouldRetry = false;

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
          status: 'outcome_unknown',
          lastError: result.error,
          errorDetails: sql`coalesce(${publishingJobs.errorDetails}, '{}'::jsonb) || ${JSON.stringify({
            errorCode: result.errorCode ?? 'OUTCOME_UNKNOWN', reconciliationRequired: true,
          })}::jsonb`,
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(publishingJobs.id, job.id), eq(publishingJobs.status, 'processing'), eq(publishingJobs.lastAttemptAt, claimAt)));
      
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
    await markJobFailed(job.id, error, 'PUBLISH_ERROR', claimAt, submissionStarted);
    return { success: false, error, errorCode: 'PUBLISH_ERROR' };
  }
}

async function markJobFailed(jobId: number, error: string, errorCode: string, claimAt?: Date, outcomeUnknown = false): Promise<void> {
  await db.update(publishingJobs)
    .set({
      status: outcomeUnknown ? 'outcome_unknown' : 'failed',
      lastError: error,
      errorDetails: sql`coalesce(${publishingJobs.errorDetails}, '{}'::jsonb) || ${JSON.stringify({
        errorCode, ...(outcomeUnknown ? { reconciliationRequired: true } : {}),
      })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(publishingJobs.id, jobId),
       claimAt ? eq(publishingJobs.status, 'processing') : inArray(publishingJobs.status, ['pending', 'queued']),
      claimAt ? eq(publishingJobs.lastAttemptAt, claimAt) : undefined,
    ));
}

export { generateApiKey, hashApiKey } from './auth/hmac';
export * from './types';
