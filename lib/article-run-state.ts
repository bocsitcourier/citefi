import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, getTxDb } from "./db";
import { articleRuns, articles } from "@/shared/schema";

export const ARTICLE_RUN_LEASE_MS = 45 * 60 * 1000;
const SETTLEMENT_RETRY_BASE_MS = 5 * 60 * 1000;
const SETTLEMENT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

type RunType = "generation" | "regeneration" | "manual";

export interface ArticleResumePlan {
  skipGemini: boolean;
  skipChatgpt: boolean;
  skipGpt4: boolean;
  skipImage: boolean;
  settlementOnly: boolean;
}

export function getArticleResumePlan(input: {
  run?: {
    status?: string | null;
    geminiGeneratedAt?: Date | null;
    chatgptReviewedAt?: Date | null;
    textGeneratedAt?: Date | null;
    imageGeneratedAt?: Date | null;
    cachedGpt4Output?: unknown;
  } | null;
  article?: {
    articleStatus?: string | null;
    finalHtmlContent?: string | null;
  } | null;
}): ArticleResumePlan {
  const status = input.article?.articleStatus ?? "";
  const hasContent = Boolean(input.article?.finalHtmlContent);
  const legacyGemini = [
    "GEMINI_COMPLETE",
    "CHATGPT_REVIEWED",
    "GPT4_ENHANCED",
    "COMPLETE",
  ].includes(status);
  const legacyChatgpt = [
    "CHATGPT_REVIEWED",
    "GPT4_ENHANCED",
    "COMPLETE",
  ].includes(status);
  const cachedGpt4 = input.run?.cachedGpt4Output as { finalHtml?: unknown } | null;

  return {
    skipGemini: hasContent && (Boolean(input.run?.geminiGeneratedAt) || legacyGemini),
    skipChatgpt: hasContent && (Boolean(input.run?.chatgptReviewedAt) || legacyChatgpt),
    skipGpt4: Boolean(
      input.run?.textGeneratedAt &&
      cachedGpt4 &&
      typeof cachedGpt4.finalHtml === "string"
    ),
    skipImage: Boolean(input.run?.imageGeneratedAt),
    settlementOnly:
      input.run?.status === "billing_pending" && status === "COMPLETE",
  };
}

export function nextSettlementAttemptAt(
  attempts: number,
  now = new Date()
): Date {
  const exponent = Math.max(0, Math.min(attempts, 10));
  const delay = Math.min(
    SETTLEMENT_RETRY_BASE_MS * 2 ** exponent,
    SETTLEMENT_RETRY_MAX_MS
  );
  return new Date(now.getTime() + delay);
}

export function protectsDeliveredReservation(input: {
  articleRunStatus?: string | null;
  articleStatus?: string | null;
  billingRunId?: string | null;
  reservationRunId?: string | null;
}): boolean {
  return Boolean(
    input.billingRunId &&
    input.billingRunId === input.reservationRunId &&
    (
      input.articleRunStatus === "billing_pending" ||
      (
        input.articleRunStatus === "running" &&
        input.articleStatus === "COMPLETE"
      )
    )
  );
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export async function prepareArticleRunForEnqueue(input: {
  articleId: number;
  runId: string;
  runType: RunType;
  jobData?: unknown;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(articleRuns)
    .values({
      articleId: input.articleId,
      runId: input.runId,
      runType: input.runType,
      status: "queued",
      queuedAt: now,
      startedAt: now,
      jobDataJson: input.jobData,
    })
    .onConflictDoNothing();

  // A deliberate retry may reuse a run that previously failed before enqueue.
  // Never reset running/content-complete/completed rows back to queued.
  await db
    .update(articleRuns)
    .set({
      status: "queued",
      queuedAt: now,
      completedAt: null,
      enqueueFailedAt: null,
      enqueueError: null,
      leaseToken: null,
      leaseExpiresAt: null,
      ...(input.jobData !== undefined ? { jobDataJson: input.jobData } : {}),
    })
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        inArray(articleRuns.status, ["failed", "failed_enqueue"])
      )
    );
}

export async function markArticleRunEnqueueFailed(input: {
  articleId: number;
  runId: string;
  error: unknown;
}): Promise<boolean> {
  const message = errorMessage(input.error);
  const now = new Date();
  const updated = await db
    .update(articleRuns)
    .set({
      status: "failed_enqueue",
      enqueueFailedAt: now,
      enqueueError: message,
      completedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        eq(articleRuns.status, "queued")
      )
    )
    .returning({ id: articleRuns.id });

  if (updated.length === 0) return false;

  await db
    .update(articles)
    .set({
      articleStatus: "FAILED",
      errorMessage: `FAILED_ENQUEUE: ${message.slice(0, 500)}`,
      updatedAt: now,
    })
    .where(
      and(
        eq(articles.id, input.articleId),
        eq(articles.articleStatus, "PENDING")
      )
    );
  return true;
}

export interface ArticleRunClaim {
  leaseToken: string;
  previousStatus: string;
}

export async function claimArticleRun(input: {
  articleId: number;
  runId: string;
  deliveryToken?: string | null;
}): Promise<ArticleRunClaim | null> {
  const [existing] = await db
    .select()
    .from(articleRuns)
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId)
      )
    )
    .limit(1);

  if (!existing) {
    await prepareArticleRunForEnqueue({
      articleId: input.articleId,
      runId: input.runId,
      runType: "generation",
    });
    return claimArticleRun(input);
  }

  if (existing.status === "completed") return null;

  const now = new Date();
  const leaseToken = input.deliveryToken ?? crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + ARTICLE_RUN_LEASE_MS);
  const claimable = or(
    inArray(articleRuns.status, [
      "queued",
      "failed",
      "failed_enqueue",
    ]),
    and(
      inArray(articleRuns.status, ["running", "billing_pending"]),
      or(
        isNull(articleRuns.leaseExpiresAt),
        lt(articleRuns.leaseExpiresAt, now)
      )
    )
  );

  const claimed = await db
    .update(articleRuns)
    .set({
      status: "running",
      startedAt: now,
      completedAt: null,
      leaseToken,
      leaseExpiresAt,
    })
    .where(
      and(
        eq(articleRuns.id, existing.id),
        claimable
      )
    )
    .returning({ id: articleRuns.id });

  return claimed.length > 0
    ? { leaseToken, previousStatus: existing.status }
    : null;
}

export async function heartbeatArticleRunLease(input: {
  articleId: number;
  runId: string;
  leaseToken: string;
}): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(articleRuns)
    .set({
      leaseExpiresAt: new Date(now.getTime() + ARTICLE_RUN_LEASE_MS),
    })
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        eq(articleRuns.leaseToken, input.leaseToken),
        eq(articleRuns.status, "running"),
        gt(articleRuns.leaseExpiresAt, now)
      )
    )
    .returning({ id: articleRuns.id });
  return updated.length > 0;
}

export async function isArticleRunLeaseOwned(input: {
  articleId: number;
  runId: string;
  leaseToken: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const [owned] = await db
    .select({ id: articleRuns.id })
    .from(articleRuns)
    .where(and(
      eq(articleRuns.articleId, input.articleId),
      eq(articleRuns.runId, input.runId),
      eq(articleRuns.leaseToken, input.leaseToken),
      eq(articleRuns.status, "running"),
      gt(articleRuns.leaseExpiresAt, now)
    ))
    .limit(1);
  return Boolean(owned);
}

/**
 * Fence an article mutation behind the durable run-row lock. Updating the run
 * row first serializes this transaction against a competing lease claim; the
 * article write can never commit after ownership was transferred or expired.
 */
export async function updateArticleForOwnedRun(input: {
  articleId: number;
  runId: string;
  leaseToken: string;
  values: Partial<typeof articles.$inferInsert>;
}): Promise<boolean> {
  const txDb = getTxDb();
  return txDb.transaction(async (tx) => {
    const now = new Date();
    const [owned] = await tx
      .update(articleRuns)
      .set({
        leaseExpiresAt: sql`${articleRuns.leaseExpiresAt}`,
      })
      .where(and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        eq(articleRuns.leaseToken, input.leaseToken),
        eq(articleRuns.status, "running"),
        gt(articleRuns.leaseExpiresAt, now)
      ))
      .returning({ id: articleRuns.id });
    if (!owned) return false;

    const updated = await tx
      .update(articles)
      .set(input.values)
      .where(eq(articles.id, input.articleId))
      .returning({ id: articles.id });
    if (updated.length === 0) {
      throw new Error(`Article ${input.articleId} disappeared during owned update`);
    }
    return true;
  });
}

/**
 * Persist provider output and its checkpoint in one lease-fenced transaction.
 */
export async function commitArticleRunStage(input: {
  articleId: number;
  runId: string;
  leaseToken: string;
  articleValues: Partial<typeof articles.$inferInsert>;
  runValues: Partial<typeof articleRuns.$inferInsert>;
}): Promise<boolean> {
  const txDb = getTxDb();
  return txDb.transaction(async (tx) => {
    const now = new Date();
    const checkpoint = await tx
      .update(articleRuns)
      .set(input.runValues)
      .where(and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        eq(articleRuns.leaseToken, input.leaseToken),
        eq(articleRuns.status, "running"),
        gt(articleRuns.leaseExpiresAt, now)
      ))
      .returning({ id: articleRuns.id });
    if (checkpoint.length === 0) return false;

    const updated = await tx
      .update(articles)
      .set(input.articleValues)
      .where(eq(articles.id, input.articleId))
      .returning({ id: articles.id });
    if (updated.length === 0) {
      throw new Error(`Article ${input.articleId} disappeared during stage commit`);
    }
    return true;
  });
}

export async function updateClaimedArticleRun(input: {
  articleId: number;
  runId: string;
  leaseToken: string;
  values: Partial<typeof articleRuns.$inferInsert>;
}): Promise<boolean> {
  const updated = await db
    .update(articleRuns)
    .set(input.values)
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        eq(articleRuns.leaseToken, input.leaseToken)
      )
    )
    .returning({ id: articleRuns.id });
  return updated.length > 0;
}

export async function updateActiveArticleRun(input: {
  articleId: number;
  runId: string;
  leaseToken: string;
  values: Partial<typeof articleRuns.$inferInsert>;
}): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(articleRuns)
    .set(input.values)
    .where(and(
      eq(articleRuns.articleId, input.articleId),
      eq(articleRuns.runId, input.runId),
      eq(articleRuns.leaseToken, input.leaseToken),
      eq(articleRuns.status, "running"),
      gt(articleRuns.leaseExpiresAt, now)
    ))
    .returning({ id: articleRuns.id });
  return updated.length > 0;
}

export async function reconcilePendingArticleBilling(
  now = new Date(),
  limit = 100,
  onlyRunIds?: string[]
): Promise<{ settled: number; deferred: number }> {
  const due = await db
    .select({
      articleId: articleRuns.articleId,
      runId: articleRuns.runId,
      billingTeamId: articleRuns.billingTeamId,
      billingRunId: articleRuns.billingRunId,
      billingAmount: articleRuns.billingAmount,
      billingJobId: articleRuns.billingJobId,
      settlementAttempts: articleRuns.settlementAttempts,
      articleStatus: articles.articleStatus,
    })
    .from(articleRuns)
    .innerJoin(articles, eq(articles.id, articleRuns.articleId))
    .where(
      and(
        or(
          eq(articleRuns.status, "billing_pending"),
          and(
            eq(articleRuns.status, "running"),
            eq(articles.articleStatus, "COMPLETE"),
            isNotNull(articleRuns.billingTeamId),
            isNotNull(articleRuns.billingRunId),
            isNotNull(articleRuns.billingAmount),
            isNotNull(articleRuns.billingJobId)
          )
        ),
        or(
          isNull(articleRuns.settlementNextAttemptAt),
          lte(articleRuns.settlementNextAttemptAt, now)
        ),
        or(
          isNull(articleRuns.leaseExpiresAt),
          lt(articleRuns.leaseExpiresAt, now)
        ),
        onlyRunIds?.length ? inArray(articleRuns.runId, onlyRunIds) : undefined
      )
    )
    .limit(limit);

  let settled = 0;
  let deferred = 0;

  for (const run of due) {
    const claim = await claimArticleRun({
      articleId: run.articleId,
      runId: run.runId,
    });
    const settlementEligible = Boolean(
      claim &&
      (
        claim.previousStatus === "billing_pending" ||
        (
          claim.previousStatus === "running" &&
          run.articleStatus === "COMPLETE"
        )
      )
    );
    if (!claim || !settlementEligible) continue;

    const attempts = (run.settlementAttempts ?? 0) + 1;
    const defer = async (error: unknown) => {
      deferred += 1;
      await updateClaimedArticleRun({
        articleId: run.articleId,
        runId: run.runId,
        leaseToken: claim.leaseToken,
        values: {
          status: "billing_pending",
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          settlementAttempts: attempts,
          settlementLastError: errorMessage(error),
          settlementNextAttemptAt: nextSettlementAttemptAt(attempts, now),
        },
      });
    };

    if (
      !run.billingTeamId ||
      !run.billingRunId ||
      !run.billingAmount ||
      !run.billingJobId
    ) {
      await defer(
        new Error("Billing settlement metadata is incomplete; operator repair required")
      );
      continue;
    }

    try {
      const { debitReservation } = await import("./billing");
      const result = await debitReservation({
        teamId: run.billingTeamId,
        runId: run.billingRunId,
        amount: run.billingAmount,
        jobId: run.billingJobId,
      });
      if (!result.ok) {
        await defer(new Error("Reservation debit returned ok:false"));
        continue;
      }

      const completed = await updateClaimedArticleRun({
        articleId: run.articleId,
        runId: run.runId,
        leaseToken: claim.leaseToken,
        values: {
          status: "completed",
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          settlementAttempts: attempts,
          settlementLastError: null,
          settlementNextAttemptAt: null,
        },
      });
      if (completed) settled += 1;
    } catch (error) {
      await defer(error);
    }
  }

  return { settled, deferred };
}

export async function claimArticleImageStage(input: {
  articleId: number;
  runId: string;
}): Promise<string | null> {
  const now = new Date();
  const imageLeaseToken = crypto.randomUUID();
  const claimed = await db
    .update(articleRuns)
    .set({
      imageLeaseToken,
      imageLeaseExpiresAt: new Date(now.getTime() + ARTICLE_RUN_LEASE_MS),
    })
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        isNull(articleRuns.imageGeneratedAt),
        or(
          isNull(articleRuns.imageLeaseExpiresAt),
          lt(articleRuns.imageLeaseExpiresAt, now)
        )
      )
    )
    .returning({ id: articleRuns.id });
  return claimed.length > 0 ? imageLeaseToken : null;
}

export async function completeArticleImageStage(input: {
  articleId: number;
  runId: string;
  imageLeaseToken: string;
  heroImageUrl?: string | null;
}): Promise<boolean> {
  const txDb = getTxDb();
  return txDb.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(articleRuns)
      .set({
        imageGeneratedAt: new Date(),
        imageLeaseToken: null,
        imageLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(articleRuns.articleId, input.articleId),
          eq(articleRuns.runId, input.runId),
          eq(articleRuns.imageLeaseToken, input.imageLeaseToken),
          gt(articleRuns.imageLeaseExpiresAt, now),
          isNull(articleRuns.imageGeneratedAt)
        )
      )
      .returning({ id: articleRuns.id });
    if (updated.length === 0) {
      throw new Error(`LEASE_LOST: cannot commit image stage for run ${input.runId}`);
    }
    if (input.heroImageUrl) {
      await tx
        .update(articles)
        .set({ heroImageUrl: input.heroImageUrl })
        .where(eq(articles.id, input.articleId));
    }
    return true;
  });
}

export async function releaseArticleImageStage(input: {
  articleId: number;
  runId: string;
  imageLeaseToken: string;
}): Promise<void> {
  const now = new Date();
  await db
    .update(articleRuns)
    .set({
      imageLeaseToken: null,
      imageLeaseExpiresAt: null,
    })
    .where(
      and(
        eq(articleRuns.articleId, input.articleId),
        eq(articleRuns.runId, input.runId),
        eq(articleRuns.imageLeaseToken, input.imageLeaseToken),
        gt(articleRuns.imageLeaseExpiresAt, now)
      )
    );
}