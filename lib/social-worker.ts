import type { Job } from "bullmq";

import { isBareGeoAnchor } from "./seo-policy";
import { db } from "./db";
import { createNotification } from "./notification-service";
import { logError } from "./error-logger";
import {
  socialPosts,
  socialPostVariants,
  socialPostAssets,
  socialPostJobs,
  socialPostLogs,
  ContentType,
  articles,
  type SocialPostVariant,
  type SocialPostAsset,
} from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { SocialPostJobData } from "./queue";
import { addVideoGenerationJob, SOCIAL_VIDEO_GENERATION_QUEUE } from "./queue";
import {
  assertEntityTeam,
  BillingSettlementError,
  currentTenantTeamId,
  isBillingSettlementError,
} from "./pipeline-worker";
import {
  canonicalizePlatform,
  canonicalizePlatforms,
  enforceSocialCaptionWithHashtags,
  findInvalidSocialUrls,
  getPlatformSpec,
  isValidSocialUrl,
} from "./social-validation";
import { learningService } from "./learning-service";
import { recordContentGenerated, getPromptEnhancement } from "./learning-integration";
import { runGenerationOrchestrator, sampleArmForType } from "./generation-orchestrator";
import { isProviderAccountingError } from "./cost-telemetry";
import { getStorageReadCandidates, objectStorageClient } from "./storage";
import { normalizeSocialImage } from "./social-image-normalizer";
import { safeFetchPageWithRedirects } from "./client-brand-profile-service";
import {
  assertSocialFinalizationQuality,
  FinalizationQualityGateError,
} from "./generation-finalization-gate";

const MAX_REUSABLE_HERO_BYTES = 2_000_000;
const LOCAL_OBJECT_URL_PREFIX = "/api/public-objects/";
const GENERATION_ATTEMPT_METADATA_KEY = "generationAttemptKey";

interface ReusableHeroBytes {
  buffer: Buffer;
  contentType: string;
}

export function getReusableHeroStorageKey(storageUrl: string): string | null {
  if (!storageUrl.startsWith(LOCAL_OBJECT_URL_PREFIX)) return null;
  const objectKey = storageUrl.slice(LOCAL_OBJECT_URL_PREFIX.length);
  if (
    !objectKey ||
    objectKey.includes("..") ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.includes("?") ||
    objectKey.includes("#")
  ) {
    throw new Error("article hero object URL is not a safe local object path");
  }
  return objectKey.startsWith("private/")
    ? objectKey
    : `public/${objectKey}`;
}

/**
 * Read a same-team object through the storage boundary rather than fetching
 * the public URL back through HTTP.  This keeps hero reuse local to the
 * worker, lets Sharp perform the crop, and gives the normalizer real bytes and
 * dimensions to persist.
 */
async function readLocalReusableHero(storageUrl: string): Promise<ReusableHeroBytes | null> {
  const storageKey = getReusableHeroStorageKey(storageUrl);
  if (!storageKey) return null;

  // Public URLs are served from public/<key>; private URLs already contain
  // the complete storage key.  Never blindly prefix `public/`: a private
  // object must remain private, and migrated objects must retain the existing
  // primary-then-legacy read candidate order.
  const candidates = getStorageReadCandidates(storageKey);
  if (candidates.length === 0) {
    throw new Error("article hero object storage is not configured");
  }

  let lastError: unknown;
  for (const file of candidates) {
    try {
      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType?.toLowerCase() ?? "";
      const contentLength = Number(metadata.size ?? 0);
      if (!contentType.startsWith("image/")) {
        throw new Error(`article hero object has unsupported content type "${contentType || "unknown"}"`);
      }
      if (contentLength > MAX_REUSABLE_HERO_BYTES) {
        throw new Error("article hero object exceeds the 2 MB safe fetch limit");
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      await new Promise<void>((resolve, reject) => {
        const stream = file.createReadStream();
        stream.on("data", (chunk: Buffer | string) => {
          const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          totalBytes += bytes.length;
          if (totalBytes > MAX_REUSABLE_HERO_BYTES) {
            (stream as NodeJS.ReadableStream & {
              destroy?: (error?: Error) => void;
            }).destroy?.(new Error("article hero object exceeds the 2 MB safe fetch limit"));
            return;
          }
          chunks.push(bytes);
        });
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });
      return { buffer: Buffer.concat(chunks), contentType };
    } catch (error) {
      lastError = error;
      // Try the next candidate only for a read/missing-object failure. A
      // malformed image or unsafe content type is diagnostic, not a reason to
      // read an unrelated object from the fallback store.
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("unsupported content type") ||
        message.includes("exceeds the 2 MB") ||
        message.includes("safe local object path")
      ) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("article hero object could not be read from configured storage");
}

function metadataAttemptKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[GENERATION_ATTEMPT_METADATA_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function socialHashtags(value: unknown): Array<{ tag: string; mailtoLink: string }> | null {
  if (!Array.isArray(value)) return null;
  const output: Array<{ tag: string; mailtoLink: string }> = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).tag !== "string" ||
      typeof (item as Record<string, unknown>).mailtoLink !== "string"
    ) {
      return null;
    }
    const record = item as Record<string, unknown>;
    output.push({
      tag: record.tag as string,
      mailtoLink: record.mailtoLink as string,
    });
  }
  return output;
}

function socialHyperlinks(value: unknown): Array<{ url: string }> | null {
  if (!Array.isArray(value)) return null;
  const output: Array<{ url: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).url !== "string") {
      return null;
    }
    output.push({ url: (item as Record<string, unknown>).url as string });
  }
  return output;
}

export interface SocialPlatformGeneratedDiagnostic {
  socialPostId: number;
  platform: string;
  characterCount: number;
  hashtagCount: number;
}

type SocialPlatformDiagnosticWriter = (
  diagnostic: SocialPlatformGeneratedDiagnostic,
) => Promise<unknown>;

/**
 * The READY variant update is the durable checkpoint.  Its diagnostic log is
 * intentionally best-effort: an unavailable audit sink must not turn a paid,
 * valid READY variant back into FAILED in the platform task's catch block.
 */
export async function persistSocialPlatformGeneratedDiagnostic(
  diagnostic: SocialPlatformGeneratedDiagnostic,
  write: SocialPlatformDiagnosticWriter = async (entry) => {
    await db.insert(socialPostLogs).values({
      socialPostId: entry.socialPostId,
      eventType: "PLATFORM_GENERATED",
      stage: "GPT4",
      severity: "info",
      message: `Generated ${entry.platform} post (${entry.characterCount} chars, ${entry.hashtagCount} hashtags)`,
      payloadJson: {
        platform: entry.platform,
        characterCount: entry.characterCount,
        hashtagCount: entry.hashtagCount,
      },
    });
  },
): Promise<boolean> {
  try {
    await write(diagnostic);
    return true;
  } catch (error) {
    console.warn(
      `[SocialWorker] PLATFORM_GENERATED diagnostic write failed for ${diagnostic.platform}; ` +
        "retaining READY checkpoint:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * A READY variant is resumable only when it belongs to this exact queue
 * attempt and still passes the local final-output contract. A prior attempt's
 * READY row is diagnostic history, never a provider-free source for a new
 * attempt.
 */
export function isReusableSocialVariant(
  variant: Pick<
    SocialPostVariant,
    | "platform"
    | "caption"
    | "characterCount"
    | "hashtagsJson"
    | "hyperlinksJson"
    | "status"
    | "platformMetadata"
  >,
  attemptKey: string,
  sourceText?: string,
): boolean {
  if (variant.status !== "READY" || metadataAttemptKey(variant.platformMetadata) !== attemptKey) {
    return false;
  }
  const hashtags = socialHashtags(variant.hashtagsJson);
  const hyperlinks = socialHyperlinks(variant.hyperlinksJson);
  if (!hashtags || !hyperlinks || variant.characterCount !== variant.caption.length) return false;
  const compliance = enforceSocialCaptionWithHashtags(
    variant.caption,
    hashtags,
    variant.platform,
    sourceText,
  );
  if (!compliance.valid || compliance.caption !== variant.caption) return false;
  if (
    compliance.hashtags.length !== hashtags.length ||
    compliance.hashtags.some((hashtag, index) => hashtag.tag !== hashtags[index]?.tag)
  ) {
    return false;
  }
  return (
    hashtags.every(
      (hashtag) =>
        isValidSocialUrl(hashtag.mailtoLink) &&
        findInvalidSocialUrls(hashtag.tag).length === 0,
    ) &&
    hyperlinks.every((hyperlink) => isValidSocialUrl(hyperlink.url))
  );
}

/** A normalized image row is resumable only through its owning variant id. */
export function isReusableSocialAsset(
  asset: Pick<SocialPostAsset, "variantId" | "platform" | "assetType" | "storageUrl" | "aspectRatio" | "width" | "height">,
  platform: string,
  variantId: number,
): boolean {
  const spec = getPlatformSpec(platform);
  return (
    asset.variantId === variantId &&
    asset.platform === platform &&
    asset.assetType === "image" &&
    typeof asset.storageUrl === "string" &&
    asset.storageUrl.length > 0 &&
    asset.aspectRatio === spec.aspectRatio &&
    asset.width === spec.dimensions.width &&
    asset.height === spec.dimensions.height
  );
}

function isNonRetryableSocialOutputError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "MODEL_OUTPUT_INVALID" ||
      (error as { code?: unknown }).code === "QUALITY_GATE_FAILED")
  );
}

export async function awaitAllSocialPlatformTasks<T>(
  tasks: readonly Promise<T>[],
): Promise<PromiseSettledResult<T>[]> {
  // A final quality failure must not let Promise.all reject early while a
  // sibling is still creating provider work. Parent settlement happens only
  // after every platform reaches a terminal outcome.
  return Promise.allSettled(tasks);
}

export interface AutomaticVideoDependencies {
  addJob?: typeof addVideoGenerationJob;
  isMediaFeatureEnabled?: () => boolean;
}

/**
 * Metered follow-on used by social generation. It deliberately mirrors the
 * direct video route: advisory quota gate, spending-cap reservation, credit
 * reservation, atomic user slot, durable intent, then enqueue.
 */
export async function enqueueAutomaticSocialVideo(
  args: { socialPostId: number; teamId: number; userId: number; platform: string },
  dependencies: AutomaticVideoDependencies = {}
): Promise<string | null> {
  // This must be first: automatic video is optional, and a disabled media
  // capability must not consume quota, reserve cap/credits, or claim a slot.
  const isMediaFeatureEnabled =
    dependencies.isMediaFeatureEnabled ??
    (await import("./storage")).isMediaFeatureEnabled;
  if (!isMediaFeatureEnabled()) {
    console.warn(
      `[SocialWorker] Skipping automatic video for social post ${args.socialPostId}: media generation is disabled`
    );
    return null;
  }

  const { checkVideoGate, acquireVideoSlot, releaseVideoSlot } = await import("./user-gate");
  const { checkUsageCap, cancelCapReservation } = await import("./usage-caps");
  const { reserveCredits, releaseReservation } = await import("./billing");
  const creditRunId = `social-auto-video:${args.teamId}:${args.socialPostId}:${args.platform}`;

  const [current] = await db.select({
    videoCreditRunId: socialPosts.videoCreditRunId,
    videoStatus: socialPosts.videoStatus,
  }).from(socialPosts).where(and(
    eq(socialPosts.id, args.socialPostId),
    eq(socialPosts.teamId, args.teamId)
  )).limit(1);
  if (current?.videoCreditRunId === creditRunId &&
      ["PENDING", "GENERATING", "READY"].includes(current.videoStatus ?? "")) {
    return null;
  }

  const gate = await checkVideoGate(args.userId, args.teamId);
  if (!gate.allowed) throw new Error(gate.message ?? "Automatic video quota exceeded");

  let capReservationId: number | null = null;
  let slotAcquired = false;
  let reserved = false;
  let queueAccepted = false;
  try {
    capReservationId = await checkUsageCap(args.teamId, 15);
    const reservation = await reserveCredits({
      teamId: args.teamId,
      operationType: "video",
      runId: creditRunId,
      userId: args.userId,
    });
    if (!reservation.ok) throw new Error("Insufficient credits for automatic social video");
    reserved = true;

    slotAcquired = await acquireVideoSlot(args.userId, args.teamId);
    if (!slotAcquired) throw new Error("Automatic video concurrency limit reached");

    const [intent] = await db.update(socialPosts).set({
      videoCreditRunId: creditRunId,
      videoCapReservationId: capReservationId,
      videoStatus: "PENDING",
      videoStage: "queued",
      videoProgress: 0,
      videoBillingSettledAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(socialPosts.id, args.socialPostId),
      eq(socialPosts.teamId, args.teamId),
      sql`${socialPosts.videoCreditRunId} IS NULL OR ${socialPosts.videoCreditRunId} = ${creditRunId}`
    )).returning({ id: socialPosts.id });
    if (!intent) throw new Error("A different automatic video intent already exists");

    const jobId = await (dependencies.addJob ?? addVideoGenerationJob)({
      socialPostId: args.socialPostId,
      platform: args.platform,
      teamId: args.teamId,
      creditRunId,
      capReservationId,
      userId: args.userId,
    });
    if (!jobId) throw new Error("Video queue did not accept the automatic job");
    queueAccepted = true;
    await db.update(socialPosts).set({
      videoStatus: "GENERATING",
      updatedAt: new Date(),
    }).where(and(
      eq(socialPosts.id, args.socialPostId),
      eq(socialPosts.videoCreditRunId, creditRunId)
    ));
    return String(jobId);
  } catch (error) {
    // Once BullMQ accepts the job, preserve the durable billing identities and
    // concurrency hold for the worker/recovery path. A later checkpoint error
    // must not refund a job that may already be running.
    if (!queueAccepted && slotAcquired) {
      await releaseVideoSlot(args.userId).catch(() => {});
    }
    if (!queueAccepted && capReservationId !== null) {
      await cancelCapReservation(capReservationId).catch(() => {});
    }
    if (!queueAccepted && reserved) {
      await releaseReservation({
        teamId: args.teamId,
        runId: creditRunId,
        reason: `Automatic video enqueue failed for social post ${args.socialPostId}`,
      }).catch(() => {});
    }
    if (!queueAccepted) {
      await db.update(socialPosts).set({
        videoCreditRunId: null,
        videoCapReservationId: null,
        videoStatus: "FAILED_ENQUEUE",
        videoStage: null,
        updatedAt: new Date(),
      }).where(and(
        eq(socialPosts.id, args.socialPostId),
        eq(socialPosts.teamId, args.teamId),
        eq(socialPosts.videoCreditRunId, creditRunId)
      )).catch(() => {});
    }
    throw error;
  }
}

// ============================================================================
// SEO/GEO HELPER FUNCTIONS
// ============================================================================

function generateSEOKeywords(topic: string, title: string, location: string, industry: string): string[] {
  const keywords: string[] = [];
  
  // Extract key terms from topic and title
  const topicTerms = topic.split(/\s+/).filter(t => t.length > 3);
  const titleTerms = title.split(/\s+/).filter(t => t.length > 3);
  
  // Location-based keywords — never emit bare city/state names (SEO policy §6)
  // Always pair location with a service/industry token for semantic context
  if (location) {
    // POLICY: skip bare geo (e.g. "Boston", "Boston MA") — must have service context
    if (!isBareGeoAnchor(location)) {
      keywords.push(location);
    }
    if (industry) keywords.push(`${industry} in ${location}`);
    if (topic) keywords.push(`${topic} in ${location}`);
  }
  
  // Industry keywords
  if (industry) {
    keywords.push(industry);
    if (topic) keywords.push(`${industry} ${topic}`);
  }
  
  // Topic keywords
  topicTerms.slice(0, 3).forEach(term => keywords.push(term.toLowerCase()));
  titleTerms.slice(0, 3).forEach(term => keywords.push(term.toLowerCase()));
  
  // Remove duplicates and return
  return Array.from(new Set(keywords)).slice(0, 15);
}

function generateGeoTags(location: string, platforms: string[]): Array<{ platform: string; tag: string }> {
  const geoTags: Array<{ platform: string; tag: string }> = [];
  
  if (!location) return geoTags;

  // POLICY: bare city/state-only geo tags are forbidden (SEO policy §6).
  // Generate NO geo-tag entries for bare location strings — they will be
  // resolved by the upstream AI social post generator with full service context.
  if (isBareGeoAnchor(location)) {
    console.log(`[SocialWorker] Skipped bare geo-tag for "${location}" — requires service/topic context`);
    return geoTags;
  }
  
  // Location already contains service context (e.g. "home care Boston") — safe to tag
  platforms.forEach(platform => {
    switch (platform) {
      case "x":
        geoTags.push({ platform, tag: `#${location.replace(/\s+/g, "")}` });
        break;
      case "instagram":
        geoTags.push({ platform, tag: `Location: ${location}` });
        break;
      case "facebook":
      case "linkedin":
      case "pinterest":
        geoTags.push({ platform, tag: location });
        break;
    }
  });
  
  return geoTags;
}

// ============================================================================
// SOCIAL POST GENERATION WORKER
// ============================================================================

export async function processSocialPostGeneration(job: Job<SocialPostJobData>) {
  const {
    socialPostId,
    userId,
    prompt,
    platforms: requestedPlatforms,
    tone,
    mood,
    industry,
    includeImage,
    generateVideos,
    userEmail,
  } = job.data;
  
  console.log(`🎭 Processing social post generation ${socialPostId} for ${requestedPlatforms.length} platforms${generateVideos ? ' (with video)' : ''}`);

  let deliveryCommitted = false;
  try {
    // Re-validate at the worker boundary as a defense against manually
    // enqueued jobs. This also guarantees aliases cannot reach providers.
    const platforms = canonicalizePlatforms(requestedPlatforms);
    const [postDetails] = await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.id, socialPostId));

    assertEntityTeam({
      entity: "socialPost",
      entityId: socialPostId,
      jobTeamId: currentTenantTeamId(),
      entityTeamId: postDetails?.teamId,
    });
    const validatedPostTeamId = postDetails?.teamId;
    if (!Number.isInteger(validatedPostTeamId) || (validatedPostTeamId ?? 0) <= 0) {
      throw new Error(`Social post ${socialPostId} has no validated team`);
    }
    const teamId = validatedPostTeamId!;
    // BullMQ keeps the same job id across attempts. It is the only durable
    // identity safe for resuming paid outputs; jobs without an id must not
    // guess at prior rows and therefore cannot resume them.
    const generationAttemptKey =
      job.id == null ? null : `social-generation:${socialPostId}:${String(job.id)}`;

    // READY is the durable delivery checkpoint. A retry after a debit failure
    // settles only; it must never call either content provider again.
    const needsCreditSettlement =
      Boolean(job.data.creditRunId) &&
      postDetails?.billingRunId === job.data.creditRunId;
    const needsCapSettlement = job.data.capReservationId != null;
    if (
      postDetails?.status === "READY" &&
      !postDetails.billingSettledAt &&
      (needsCreditSettlement || needsCapSettlement)
    ) {
      if (needsCreditSettlement && job.data.creditRunId) {
        const { debitReservation } = await import("@/lib/billing");
        let debitResult;
        try {
          debitResult = await debitReservation({
            teamId,
            runId: job.data.creditRunId,
            userId,
            jobId: String(job.id ?? ""),
          });
        } catch (cause) {
          throw new BillingSettlementError(
            `Debit settlement failed for delivered social post ${socialPostId}`,
            job.data.creditRunId,
            cause
          );
        }
        if (!debitResult.ok) {
          throw new BillingSettlementError(
            `Debit settlement failed for delivered social post ${socialPostId}`,
            job.data.creditRunId
          );
        }
      }
      if (job.data.capReservationId != null) {
        const { completeCapReservation } = await import("@/lib/usage-caps");
        try {
          await completeCapReservation({
            reservationId: job.data.capReservationId,
            teamId,
            jobId: String(job.id ?? ""),
            metadata: { socialPostId },
          });
        } catch (cause) {
          throw new BillingSettlementError(
            `Usage-cap settlement failed for delivered social post ${socialPostId}`,
            job.data.creditRunId ?? `social-cap:${job.data.capReservationId}`,
            cause
          );
        }
      }
      if (needsCreditSettlement && job.data.creditRunId) {
        try {
          await db.update(socialPosts)
            .set({ billingSettledAt: new Date(), updatedAt: new Date() })
            .where(and(
              eq(socialPosts.id, socialPostId),
              eq(socialPosts.teamId, teamId),
              eq(socialPosts.billingRunId, job.data.creditRunId)
            ));
        } catch (cause) {
          throw new BillingSettlementError(
            `Billing checkpoint update failed for delivered social post ${socialPostId}`,
            job.data.creditRunId,
            cause
          );
        }
      }
      await db
        .update(socialPostJobs)
        .set({ status: "COMPLETED", completedAt: new Date() })
        .where(eq(socialPostJobs.jobId, String(job.id ?? "")));
      return;
    }

    // A READY post is already delivered even when a legacy/manual job has no
    // billing fields. Never re-enter paid generation for it. The historical
    // one-line guard (`if (postDetails?.status === "READY") return`) remains
    // settlement-only; the checkpoint update below is the only added work.
    if (postDetails?.status === "READY") {
      await db
        .update(socialPostJobs)
        .set({ status: "COMPLETED", completedAt: new Date() })
        .where(eq(socialPostJobs.jobId, String(job.id ?? "")));
      return;
    }

    const reusableVariantsByPlatform = new Map<string, SocialPostVariant>();
    if (generationAttemptKey) {
      const existingVariants = await db
        .select()
        .from(socialPostVariants)
        .where(eq(socialPostVariants.socialPostId, socialPostId));
      for (const existingVariant of existingVariants) {
        if (
          isReusableSocialVariant(
            existingVariant,
            generationAttemptKey,
            prompt,
          )
        ) {
          reusableVariantsByPlatform.set(existingVariant.platform, existingVariant);
        }
      }
    }

    // Cost ceiling gate — INSIDE the try so BUDGET_EXCEEDED flows through this
    // catch (status=FAILED write) before createPipelineWorker releases the
    // reservation and stops retries. Keyed by the same creditRunId the wrapper
    // uses for run-context telemetry attribution.
    if (job.data.creditRunId) {
      const { assertRunBudget } = await import("@/lib/cost-ceilings");
      await assertRunBudget(job.data.creditRunId, "social_post", "text_gen");
    }

    // Update status to GENERATING
    await db
      .update(socialPosts)
      .set({ status: "GENERATING", jobId: job.id })
      .where(eq(socialPosts.id, socialPostId));

    // Log generation start
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "GENERATION_START",
      stage: "GEMINI",
      severity: "info",
      message: `Starting social post generation for ${platforms.length} platforms`,
      payloadJson: { platforms, tone, mood, industry },
    });

    // Register job in tracking table.
    // Use onConflictDoNothing so pg-boss retries are idempotent — a duplicate
    // job.id insert on retry simply no-ops instead of crashing the worker.
    await db.insert(socialPostJobs).values({
      socialPostId,
      jobId: String(job.id ?? ""),
      jobType: "GENERATION",
      status: "ACTIVE",
      startedAt: new Date(),
    }).onConflictDoNothing();

    // Import AI providers
    const { generateSocialPostWithGemini } = await import("./gemini-social");
    const { enhanceSocialPostWithGPT } = await import("./openai-social");
    
    const location = postDetails?.location || "";
    const topic = postDetails?.topic || "";
    const title = postDetails?.title || "";
    const landingPageUrl = postDetails?.landingPageUrl || undefined;
    const companyName = postDetails?.companyName || undefined;
    
    // Generate SEO keywords and geo-tags
    const seoKeywords = generateSEOKeywords(topic, title, location, industry || "");
    const geoTags = generateGeoTags(location, platforms);
    
    // Update post with SEO/GEO metadata
    await db
      .update(socialPosts)
      .set({ 
        seoKeywordsJson: seoKeywords,
        geoTagsJson: geoTags,
      })
      .where(eq(socialPosts.id, socialPostId));

    // Fetch learned patterns once — only when critic loop is active so we never
    // attribute patterns that didn't actually influence the generation run.
    const disableCriticLoop = process.env.DISABLE_CRITIC_LOOP === "true";
    const socialEnhancement = !disableCriticLoop
      ? await getPromptEnhancement(teamId, ContentType.SOCIAL, {
          stableId: String(socialPostId),
          campaignId: postDetails?.campaignId ?? null,
        })
          .catch(() => ({ patternsUsed: [] as number[], variantArmId: undefined }))
      : { patternsUsed: [] as number[], variantArmId: undefined };
    const capturedPatternIds = socialEnhancement.patternsUsed;
    const socialVariantArmId = socialEnhancement.variantArmId;

    // Pre-sample a SINGLE arm BEFORE launching concurrent platform promises.
    // All platforms belong to the same social post (same team+contentType), so
    // they must share one arm assignment. Sampling inside Promise.all would give
    // each platform a different random Thompson draw, and the ?= capture would
    // record whichever platform resolved first — non-deterministic and wrong.
    let capturedSocialArmId: number | undefined;
    if (!disableCriticLoop) {
      capturedSocialArmId = await sampleArmForType(teamId, ContentType.SOCIAL)
        .catch(() => undefined);
    }

    // CONCURRENT PROCESSING: Generate posts for all platforms in parallel
    console.log(`🚀 Generating ${platforms.length} platform variants concurrently...`);
    
    const platformPromises = platforms.map(async (platform) => {
      let variantId: number | null = null;
      const retryWithBackoff = async <T>(
        fn: () => Promise<T>,
        maxRetries = 3,
        platform: string
      ): Promise<T> => {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (error) {
            if (isProviderAccountingError(error)) throw error;
            if (isNonRetryableSocialOutputError(error)) throw error;
            lastError = error as Error;
            console.error(`❌ Attempt ${attempt}/${maxRetries} failed for ${platform}:`, error);
            if (attempt < maxRetries) {
              const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
              console.log(`⏳ Retrying ${platform} in ${delayMs / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
        }
        throw lastError;
      };

      try {
        console.log(`📱 Generating ${platform} post for social post ${socialPostId}`);

        const reusableVariant = reusableVariantsByPlatform.get(platform);
        if (reusableVariant) {
          // Durable pre-provider resume. The local contract above is the
          // diagnostic check; no LLM, critic, or paid repair is replayed.
          console.log(
            `♻️ Resuming same-attempt READY ${platform} variant ${reusableVariant.id} without provider calls`,
          );
          return {
            platform,
            success: true,
            variantId: reusableVariant.id,
            qualityScore: 80,
            resumed: true,
          };
        }

        // Create variant with GENERATING status
        const [variantRow] = await db.insert(socialPostVariants).values({
          socialPostId,
          platform,
          caption: "", // Will be updated after generation
          characterCount: 0,
          hashtagsJson: [],
          emojisJson: [],
          hyperlinksJson: [],
          characterLimit: getPlatformSpec(platform).characterLimit,
          platformMetadata: generationAttemptKey
            ? { [GENERATION_ATTEMPT_METADATA_KEY]: generationAttemptKey }
            : null,
          status: "GENERATING",
        }).returning();
        const variant = variantRow!;
        variantId = variant.id;

        // STAGE 1: Gemini generates initial content (with retry)
        const geminiResult = await retryWithBackoff(
          () => generateSocialPostWithGemini({
            prompt,
            platform,
            tone: tone || "professional",
            mood: mood || "informative",
            industry: industry || "general",
            characterLimit: getPlatformSpec(platform).characterLimit,
            location: location || undefined,
            topic: topic || undefined,
            title: title || undefined,
            companyName: companyName || undefined,
            teamId,
            socialPostId,
          }),
          3,
          platform
        );

        console.log(`✅ Gemini generated ${platform} post (${geminiResult.caption.length} chars)${location ? ` for ${location}` : ''}`);

        let platformQualityScore = 80;

        // STAGE 1.5: GenerationOrchestrator — critic-in-the-loop + patternsUsedJson attribution
        // Reviews the Gemini caption for structural / channel / humanness defects
        // and patches them before GPT enhancement. Bounded to 2 passes.
        // Controlled by DISABLE_CRITIC_LOOP=true env var (orchestrator handles flag internally).
        // contentId=socialPostId so content_review_service.socialPostId field is set correctly.
        // armIdOverride: pass the pre-sampled shared arm so each platform variant does NOT
        // fire an extra sampleArm() DB query (one arm per post, not one per platform).
        if (teamId) {
          try {
            const orchestratorResult = await runGenerationOrchestrator({
              teamId,
              campaignId: postDetails?.campaignId ?? null,
              contentType: ContentType.SOCIAL,
              contentId: socialPostId,
              content: geminiResult.caption,
              patternsUsed: capturedPatternIds,
              brief: { topic: topic || prompt, location: location || undefined },
              kind: "social",
              armIdOverride: capturedSocialArmId,
            });
            if (orchestratorResult.repairs > 0) {
              geminiResult.caption = orchestratorResult.content;
              console.log(
                `🔧 Stage 1.5: Critic applied ${orchestratorResult.repairs} repair(s) to ${platform} caption`
              );
            } else if (orchestratorResult.orchestrated) {
              console.log(`✅ Stage 1.5: ${platform} caption passed critic review`);
            }
            // Capture quality score for cross-platform aggregation at completion.
            // armId is pre-sampled above (shared for all platforms) — do NOT override.
            if (orchestratorResult.orchestrated && orchestratorResult.qualityScore > 0) {
              platformQualityScore = orchestratorResult.qualityScore;
            }
          } catch (criticError) {
            if (isProviderAccountingError(criticError)) throw criticError;
            console.warn(`⚠️ Social orchestrator failed, continuing:`, (criticError as Error).message);
          }
        }

        // STAGE 2: GPT-4 enhances with hashtags, emojis, hyperlinks (with retry)
        const gptResult = await retryWithBackoff(
          () => enhanceSocialPostWithGPT({
            caption: geminiResult.caption,
            platform,
            tone: tone || "professional",
            userEmail: userEmail || "contact@example.com",
            location: location || undefined,
            topic: topic || undefined,
            industry: industry || undefined,
            landingPageUrl: landingPageUrl || undefined,
            companyName: companyName || undefined,
          }),
          3,
          platform
        );

        const invalidHyperlink = (gptResult.hyperlinks || []).find(
          (hyperlink) => !isValidSocialUrl(hyperlink.url)
        );
        const invalidHashtagLink = (gptResult.hashtags || []).find(
          (hashtag) =>
            !isValidSocialUrl(hashtag.mailtoLink) ||
            findInvalidSocialUrls(hashtag.tag).length > 0
        );
        if (invalidHyperlink || invalidHashtagLink) {
          throw new FinalizationQualityGateError(
            [`Final ${platform} social output contains a broken URL`],
            "social",
          );
        }

        // This is intentionally after both the critic and GPT rewrite. GPT is
        // allowed to edit the caption, so the initial Gemini character check
        // cannot be the final persistence gate. The dashboard appends the
        // hashtag string after the caption, so fit both pieces together.
        const finalCaption = enforceSocialCaptionWithHashtags(
          gptResult.caption,
          gptResult.hashtags || [],
          platform,
          prompt
        );
        if (!finalCaption.valid) {
          throw new FinalizationQualityGateError(
            finalCaption.issues.map(
              (issue) => `Final ${platform} caption failed compliance: ${issue}`,
            ),
            "social",
          );
        }
        gptResult.caption = finalCaption.caption;
        gptResult.hashtags = finalCaption.hashtags;

        const finalSocialOutput = await assertSocialFinalizationQuality({
          teamId,
          campaignId: postDetails?.campaignId ?? null,
          socialPostId,
          platform,
          caption: gptResult.caption,
          hashtags: gptResult.hashtags,
          hyperlinks: gptResult.hyperlinks || [],
          sourceText: prompt,
          keyword: topic || undefined,
        });
        gptResult.caption = finalSocialOutput.caption;
        gptResult.hashtags = finalSocialOutput.hashtags;

        console.log(`✅ GPT-4 enhanced ${platform} post with ${gptResult.hashtags.length} hashtags`);

        // Build hashtags string for easy copy-paste
        const hashtagsString = gptResult.hashtags.map(h => h.tag).join(" ");

        // Update variant with final content and READY status
        await db
          .update(socialPostVariants)
          .set({
            caption: gptResult.caption,
            characterCount: gptResult.caption.length,
            hashtags: hashtagsString,
            hashtagsJson: gptResult.hashtags,
            emojisJson: gptResult.emojis || [],
            hyperlinksJson: gptResult.hyperlinks || [],
            platformMetadata: generationAttemptKey
              ? { [GENERATION_ATTEMPT_METADATA_KEY]: generationAttemptKey }
              : undefined,
            status: "READY",
          })
          .where(eq(socialPostVariants.id, variant.id));

        // Log platform completion after the READY variant checkpoint. This is
        // best-effort so an audit-sink failure cannot enter the variant catch
        // and downgrade an otherwise valid paid output.
        await persistSocialPlatformGeneratedDiagnostic({
          socialPostId,
          platform,
          characterCount: gptResult.caption.length,
          hashtagCount: gptResult.hashtags.length,
        });

        return { platform, success: true, variantId: variant.id, qualityScore: platformQualityScore };
      } catch (error) {
        console.error(`❌ Failed to generate ${platform} post after all retries:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Persist the failed variant before a typed quality/accounting failure
        // reaches the parent. A sibling may still be in flight, so do not throw
        // here and let Promise.all short-circuit parent settlement.
        try {
          await db
            .update(socialPostVariants)
            .set({
              status: "FAILED",
              errorMessage: errorMessage.slice(0, 500),
            })
            .where(
              variantId != null
                ? eq(socialPostVariants.id, variantId)
                : and(
                  eq(socialPostVariants.socialPostId, socialPostId),
                  eq(socialPostVariants.platform, platform),
                ),
            );
        } catch (persistError) {
          console.error(`❌ Failed to persist ${platform} variant failure:`, persistError);
        }

        // Log error via centralized logger (Slack + DB)
        await logError({
          errorType: "SOCIAL",
          errorMessage: `${platform} variant generation failed: ${errorMessage}`,
          stackTrace: error instanceof Error ? error.stack : undefined,
          severity: "error",
        }).catch((e) => console.error("[social-worker] logError failed:", e));

        return {
          platform,
          success: false,
          error: errorMessage,
          terminalError:
            isProviderAccountingError(error) || isNonRetryableSocialOutputError(error)
              ? error
              : undefined,
        };
      }
    });

    // Every task must finish (and persist its own terminal variant state)
    // before the parent failure reaches the pipeline handler/billing release.
    const settledPlatformTasks = await awaitAllSocialPlatformTasks(platformPromises);
    const platformResults = settledPlatformTasks.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
          platform: platforms[index]!,
          success: false,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          terminalError: result.reason,
        },
    );
    const successfulPlatforms = platformResults.filter(r => r.success);
    const failedPlatforms = platformResults.filter(r => !r.success);
    const terminalPlatformFailure = failedPlatforms.find(
      (result) => "terminalError" in result && result.terminalError,
    ) as { terminalError?: unknown } | undefined;
    if (terminalPlatformFailure?.terminalError) {
      throw terminalPlatformFailure.terminalError;
    }
    // Average quality score across all platforms that ran the orchestrator
    const avgQualityScore = successfulPlatforms.length > 0
      ? Math.round(
          successfulPlatforms.reduce((sum, r) => sum + ((r as any).qualityScore ?? 80), 0) /
            successfulPlatforms.length
        )
      : 80;

    console.log(`✅ Generated ${successfulPlatforms.length}/${platforms.length} platform variants`);
    if (failedPlatforms.length > 0) {
      console.warn(`⚠️ Failed platforms: ${failedPlatforms.map(r => r.platform).join(", ")}`);
    }

    const variantIdsByPlatform = new Map<string, number>(
      successfulPlatforms.flatMap((result) => {
        const variantId = (result as { variantId?: unknown }).variantId;
        return typeof variantId === "number"
          ? [[result.platform, variantId] as [string, number]]
          : [];
      }),
    );
    const reusableAssetPlatforms = new Set<string>();
    if (generationAttemptKey && includeImage && successfulPlatforms.length > 0) {
      const existingAssets = await db
        .select()
        .from(socialPostAssets)
        .where(eq(socialPostAssets.socialPostId, socialPostId));
      for (const existingAsset of existingAssets) {
        const canonicalAssetPlatform = canonicalizePlatform(existingAsset.platform);
        if (!canonicalAssetPlatform) continue;
        const variantId = variantIdsByPlatform.get(canonicalAssetPlatform);
        if (
          variantId != null &&
          isReusableSocialAsset(existingAsset, canonicalAssetPlatform, variantId)
        ) {
          reusableAssetPlatforms.add(canonicalAssetPlatform);
        }
      }
    }
    const imagePlatforms = successfulPlatforms
      .map((result) => result.platform)
      .filter((platform) => !reusableAssetPlatforms.has(platform));

    // STAGE 3: Attach image if requested
    // Strategy: reuse the parent article's hero image at $0.00 cost.
    // Only fall back to AI generation if no usable hero image exists.
    if (includeImage && imagePlatforms.length > 0) {
      let attachedImageUrl: string | null = null;

      // Try to reuse the parent article's hero image
      if (postDetails?.articleId) {
        try {
          const [parentArticle] = await db
            .select({
              heroImageUrl: articles.heroImageUrl,
              teamId: articles.teamId,
            })
            .from(articles)
            .where(and(
              eq(articles.id, postDetails.articleId),
              // An article hero is reusable only inside its owning team.
              eq(articles.teamId, teamId),
            ))
            .limit(1);

          const heroUrl = parentArticle?.heroImageUrl;
          if (
            heroUrl &&
            (heroUrl.startsWith(LOCAL_OBJECT_URL_PREFIX) || heroUrl.startsWith("http"))
          ) {
            attachedImageUrl = heroUrl;
            console.log(`♻️ Reusing article hero image for social post ${socialPostId}: ${heroUrl}`);
          }
        } catch (err) {
          console.warn(`⚠️ Could not fetch parent article hero image:`, err instanceof Error ? err.message : err);
        }
      }

      if (attachedImageUrl) {
        // Reused bytes must satisfy the same platform contract as generated
        // bytes. Download once, resize independently, and store the actual
        // normalized metadata rather than declaring every asset 16:9.
        try {
          const localHero = await readLocalReusableHero(attachedImageUrl);
          let heroBuffer: Buffer;
          if (localHero) {
            heroBuffer = localHero.buffer;
          } else {
            const heroResponse = await safeFetchPageWithRedirects(attachedImageUrl, 3);
            if (!heroResponse) {
              throw new Error("safe hero image fetch failed or was blocked");
            }
            if (!heroResponse.ok) {
              throw new Error(`hero image request returned HTTP ${heroResponse.status}`);
            }
            const contentType = heroResponse.headers.get("content-type")?.toLowerCase() ?? "";
            if (!contentType.startsWith("image/")) {
              throw new Error(`hero image returned unsupported content type "${contentType || "unknown"}"`);
            }
            const contentLength = Number(heroResponse.headers.get("content-length") ?? 0);
            if (contentLength > MAX_REUSABLE_HERO_BYTES) {
              throw new Error("hero image exceeds the 2 MB safe fetch limit");
            }
            heroBuffer = Buffer.from(await heroResponse.arrayBuffer());
            if (heroBuffer.length > MAX_REUSABLE_HERO_BYTES) {
              throw new Error("hero image exceeds the 2 MB safe fetch limit");
            }
          }
          const bucket = objectStorageClient.bucket(
            process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || ""
          );
          const timestamp = Date.now();
          const assetInserts = [];
          for (const platform of imagePlatforms) {
            const normalizedImage = await normalizeSocialImage(heroBuffer, platform);
            const fileName = `social-${socialPostId}-${platform}-${timestamp}.png`;
            const objectPath = `public/social-media/${fileName}`;
            await bucket.file(objectPath).save(normalizedImage.imageBuffer, {
              contentType: normalizedImage.mimeType,
              metadata: { cacheControl: "public, max-age=31536000" },
            });
            assetInserts.push({
              socialPostId,
              variantId: variantIdsByPlatform.get(platform) ?? null,
              platform,
              assetType: "image" as const,
              promptUsed: "reused_from_article_hero",
              storageUrl: `/api/public-objects/social-media/${fileName}`,
              altText: `${companyName || "Article"} hero image`,
              aspectRatio: normalizedImage.aspectRatio,
              fileFormat: normalizedImage.fileFormat,
              width: normalizedImage.width,
              height: normalizedImage.height,
            });
          }
          await db.insert(socialPostAssets).values(assetInserts);
        } catch (reuseError) {
          // A hero URL that cannot be read/normalized is not safe to persist.
          // Fall back to the provider path, whose bytes go through the same
          // Sharp normalization before storage.
          console.warn(
            `⚠️ Could not normalize article hero image; generating platform images instead:`,
            reuseError instanceof Error ? reuseError.message : reuseError
          );
          attachedImageUrl = null;
        }
      }

      if (attachedImageUrl) {

        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "IMAGE_REUSED",
          stage: "IMAGE_GEN",
          severity: "info",
          message: `Reused article hero image for ${imagePlatforms.length} platform(s) — $0.00 AI cost`,
          payloadJson: { platforms: imagePlatforms, sourceArticleId: postDetails?.articleId, heroImageUrl: attachedImageUrl },
        });

        console.log(`✅ Hero image reused for ${imagePlatforms.length} social platform(s)`);
      } else {
        // Fallback: generate new AI social images (no parent article or no hero image available)
        console.log(`🎨 No reusable hero image — generating social images via AI`);
        const { generateSocialImages } = await import("./gemini-social-image-generator");

        const imageResults = await generateSocialImages({
          socialPostId,
          teamId,
          prompt,
          platforms: imagePlatforms,
          variantIds: Object.fromEntries(
            imagePlatforms.map((platform) => [platform, variantIdsByPlatform.get(platform)]),
          ),
          industry: industry || "general",
          companyName: companyName || undefined,
        });

        console.log(`🖼️ Generated ${imageResults.length} platform-specific images`);

        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "IMAGE_GENERATED",
          stage: "IMAGE_GEN",
          severity: "info",
          message: `Generated ${imageResults.length} images for platforms: ${imagePlatforms.join(", ")}`,
          payloadJson: { imageCount: imageResults.length },
        });
      }
    }

    // STAGE 4: Queue video generation if requested
    if (generateVideos && companyName) {
      try {
        console.log(`🎬 Queueing video generation for social post ${socialPostId}`);
        
        const videoJobId = await enqueueAutomaticSocialVideo({
          socialPostId,
          platform: "tiktok",
          teamId,
          userId,
        });

        if (videoJobId) {
          // Update post with video status
          await db
            .update(socialPosts)
            .set({ videoStatus: "GENERATING", videoProgress: 0, videoStage: "queued" })
            .where(eq(socialPosts.id, socialPostId));

          // Log video queue event
          await db.insert(socialPostLogs).values({
            socialPostId,
            eventType: "VIDEO_QUEUED",
            stage: "VIDEO_GEN",
            severity: "info",
            message: `Video generation queued with job ${videoJobId}`,
            payloadJson: { jobId: videoJobId, platform: "tiktok" },
          });

          console.log(`✅ Video generation queued for social post ${socialPostId} (job: ${videoJobId})`);
        } else {
          console.warn(`⚠️ Failed to queue video generation for social post ${socialPostId}`);
        }
      } catch (videoError) {
        console.error(`❌ Video queueing failed for social post ${socialPostId}:`, videoError);
        // Don't fail the whole job - video is optional
        await db.insert(socialPostLogs).values({
          socialPostId,
          eventType: "VIDEO_QUEUE_FAILED",
          stage: "VIDEO_GEN",
          severity: "warning",
          message: `Video queueing failed: ${videoError instanceof Error ? videoError.message : String(videoError)}`,
        });
      }
    } else if (generateVideos && !companyName) {
      console.warn(`⚠️ Video generation requested but no company name provided for social post ${socialPostId}`);
      await db.insert(socialPostLogs).values({
        socialPostId,
        eventType: "VIDEO_SKIPPED",
        stage: "VIDEO_GEN",
        severity: "warning",
        message: "Video generation skipped: company name is required",
      });
    }

    // Only mark READY when at least one platform variant succeeded.
    // If ALL platforms failed, throw so pg-boss retries the job and the
    // post does not sit silently in READY with zero usable variants.
    const finalStatus = successfulPlatforms.length > 0 ? "READY" : "FAILED";

    // Scope the update to both id AND teamId for defence-in-depth write isolation.
    const postTeamId = job.data.teamId ?? postDetails?.teamId;
    const updateWhere = postTeamId
      ? and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, postTeamId))
      : eq(socialPosts.id, socialPostId);

    await db
      .update(socialPosts)
      .set({
        status: finalStatus,
        billingRunId: finalStatus === "READY" ? (job.data.creditRunId ?? null) : null,
        updatedAt: new Date(),
      })
      .where(updateWhere);
    if (finalStatus === "READY") {
      deliveryCommitted = true;
    }

    if (finalStatus === "FAILED") {
      // Throw so pg-boss retries; billing reservation will be released by the outer catch.
      throw new Error(
        `All ${platforms.length} platform variants failed for social post ${socialPostId}. ` +
        `Failed platforms: ${failedPlatforms.map((r) => r.platform).join(", ")}.`
      );
    }

    // Mark job as completed
    await db
      .update(socialPostJobs)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(socialPostJobs.jobId, String(job.id ?? "")));

    // Log final completion with accurate variant counts
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "READY",
      stage: "COMPLETE",
      severity: "info",
      message: `Social post generation completed for ${successfulPlatforms.length}/${platforms.length} platforms`,
      payloadJson: { 
        platforms, 
        variantsGenerated: successfulPlatforms.length,
        imagesGenerated: includeImage ? successfulPlatforms.length : 0,
        failedPlatforms: failedPlatforms.map((r) => r.platform),
      },
    });

    console.log(`✅ Social post ${socialPostId} generation completed successfully`);

    void createNotification({
      teamId: job.data.teamId ?? postDetails?.teamId,
      type: "success",
      category: "social_post",
      title: "Social Post Ready",
      message: `Your social post has been generated successfully across ${successfulPlatforms.length} platform(s).`,
      entityId: socialPostId,
      entityType: "social_post",
      actionUrl: `/social/${socialPostId}`,
    }).catch(() => {});

    // Two-bucket billing: DEBIT reservation on success
    const teamIdForBilling = job.data.teamId ?? postDetails?.teamId;
    if (job.data.creditRunId && teamIdForBilling) {
      const { debitReservation } = await import("@/lib/billing");
      let debitResult;
      try {
        debitResult = await debitReservation({
          teamId: teamIdForBilling,
          runId: job.data.creditRunId,
          jobId: String(job.id ?? ""),
        });
      } catch (cause) {
        throw new BillingSettlementError(
          `Debit settlement failed for delivered social post ${socialPostId}`,
          job.data.creditRunId,
          cause
        );
      }
      if (!debitResult.ok) {
        throw new BillingSettlementError(
          `Debit settlement failed for delivered social post ${socialPostId}`,
          job.data.creditRunId
        );
      }
      if (job.data.capReservationId != null) {
        // Settle the original pending cap row in place. Do not insert a
        // second completed usage event beside the reservation.
        const { completeCapReservation } = await import("@/lib/usage-caps");
        try {
          await completeCapReservation({
            reservationId: job.data.capReservationId,
            teamId: teamIdForBilling,
            jobId: String(job.id ?? ""),
            metadata: { socialPostId },
          });
        } catch (cause) {
          throw new BillingSettlementError(
            `Usage-cap settlement failed for delivered social post ${socialPostId}`,
            job.data.creditRunId,
            cause
          );
        }
      } else {
        // Legacy/unlimited jobs have no pending cap row to settle.
        const { recordUsageEvent } = await import("@/lib/usage-caps");
        await recordUsageEvent({
          teamId: teamIdForBilling,
          campaignId: postDetails?.campaignId ?? null,
          action: "social_post",
          units: 1,
          costEstimateCents: 5,
          jobId: String(job.id ?? ""),
          metadata: { socialPostId },
        }).catch((err) => console.warn(`[usage-caps] recordUsageEvent failed (non-fatal): ${err?.message}`));
      }
      try {
        await db.update(socialPosts)
          .set({ billingSettledAt: new Date(), updatedAt: new Date() })
          .where(and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, teamIdForBilling)));
      } catch (cause) {
        throw new BillingSettlementError(
          `Billing checkpoint update failed for delivered social post ${socialPostId}`,
          job.data.creditRunId,
          cause
        );
      }
    } else if (job.data.capReservationId != null && teamIdForBilling) {
      // A manually enqueued legacy job may carry a cap reservation without a
      // credit run. Successful delivery still must settle that original row.
      const { completeCapReservation } = await import("@/lib/usage-caps");
      try {
        await completeCapReservation({
          reservationId: job.data.capReservationId,
          teamId: teamIdForBilling,
          jobId: String(job.id ?? ""),
          metadata: { socialPostId },
        });
      } catch (cause) {
        throw new BillingSettlementError(
          `Usage-cap settlement failed for delivered social post ${socialPostId}`,
          `social-cap:${job.data.capReservationId}`,
          cause
        );
      }
    }

    // Record generation for AI Learning System
    try {
      if (postDetails?.teamId) {
        await recordContentGenerated(
          postDetails.teamId,
          ContentType.SOCIAL,
          socialPostId,
          capturedPatternIds,
          avgQualityScore,
          { armId: capturedSocialArmId, variantArmId: socialVariantArmId }
        );
        console.log(`📊 Recorded social post generation for AI Learning`);
      }
    } catch (learningError) {
      console.warn(`⚠️ Failed to record learning metrics:`, learningError);
    }
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    if (isBillingSettlementError(error)) {
      // Delivery is durable. Preserve READY metadata and let the shared
      // pipeline handler retry settlement without releasing the reservation.
      throw error;
    }
    if (deliveryCommitted) {
      // READY is durable delivery. Any later failure is settlement-only and
      // must not mark the post FAILED or replay paid provider work.
      throw new BillingSettlementError(
        `Settlement failed after delivered social post ${socialPostId}`,
        job.data.creditRunId,
        error
      );
    }
    console.error(`❌ Social post generation failed for ${socialPostId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update status to FAILED — scope by teamId for defence-in-depth write isolation.
    const catchTeamId = job.data.teamId;
    const catchUpdateWhere = catchTeamId
      ? and(eq(socialPosts.id, socialPostId), eq(socialPosts.teamId, catchTeamId))
      : eq(socialPosts.id, socialPostId);
    await db
      .update(socialPosts)
      .set({ 
        status: "FAILED", 
        errorMessage: errorMessage.slice(0, 500),
        updatedAt: new Date() 
      })
      .where(catchUpdateWhere);

    // Mark job as failed
    await db
      .update(socialPostJobs)
      .set({ 
        status: "FAILED", 
        errorMessage: errorMessage.slice(0, 500),
        completedAt: new Date() 
      })
      .where(eq(socialPostJobs.jobId, String(job.id ?? "")));

    // Log to error_logs table via centralized logger (Slack + DB)
    await logError({
      errorType: "SOCIAL",
      errorMessage: `Social post generation failed: ${errorMessage}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
      severity: "error",
    }).catch((e) => console.error("[social-worker] logError failed:", e));

    // Log failure event
    await db.insert(socialPostLogs).values({
      socialPostId,
      eventType: "FAILED",
      stage: "ERROR",
      severity: "error",
      message: `Generation failed: ${errorMessage.slice(0, 500)}`,
      payloadJson: { 
        error: errorMessage,
        platforms: requestedPlatforms,
      },
    });

    void createNotification({
      teamId: job.data.teamId,
      type: "error",
      category: "social_post",
      title: "Social Post Failed",
      message: `Social post generation failed: ${errorMessage.slice(0, 200)}`,
      entityId: socialPostId,
      entityType: "social_post",
      actionUrl: `/social/${socialPostId}`,
    }).catch(() => {});

    // Rethrow — createPipelineWorker (the only registration point) classifies
    // the error, releases the credit reservation on the final attempt, and
    // converts fatal codes to UnrecoverableError.
    throw error;
  }
}
