import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, creditReservations, jobBatches, jobEvents } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import {
  addArticleJob,
  ArticleEnqueueUncertainError,
  findArticleGenerationJob,
} from "@/lib/queue";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import {
  markReservationForReconciliation,
  releaseReservation,
  reserveCredits,
} from "@/lib/billing";
import { checkTeamPaywall, paywallErrorBody } from "@/lib/billing/paywall";
import { getCreditCost, getEffectiveCreditCost } from "@/lib/credit-menu";
import { cancelCapReservation, checkUsageCap } from "@/lib/usage-caps";
import { createHash } from "node:crypto";

/**
 * article_runs.run_id is a UUID-shaped legacy column.  Keep the request
 * identity in creditRunId, but derive a deterministic UUID for the worker run
 * so a replay can use exactly the same article-run row without exceeding the
 * column's historical width.
 */
function stableArticleRunId(seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    return await withAuthenticatedTeamContext(request, async (auth) => {
      const { teamId, userId } = auth;
    const { id } = await context.params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)));

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { articleIds } = body;

    if (!articleIds || !Array.isArray(articleIds)) {
      return NextResponse.json(
        { error: "articleIds array is required" },
        { status: 400 }
      );
    }

    const succeeded: number[] = [];
    const failed: { id: number; reason: string }[] = [];
    const skipped: { id: number; reason: string }[] = [];
    const pending: { id: number; reason: string }[] = [];

    // A request key is only used to replay the same logical attempt.  The UI
    // currently omits the header, in which case each deliberate retry gets a
    // new key (and therefore a new, billable reservation). Network retries
    // which do provide the key never create a second reservation.
    const rawRequestKey = request.headers.get("X-Idempotency-Key") ?? crypto.randomUUID();
    const requestKey = createHash("sha256").update(rawRequestKey).digest("hex");

    const creditCost =
      (await getEffectiveCreditCost("article", teamId)) ??
      getCreditCost("article") ??
      10;

    // A retry is billable work just like first-run generation.  Check the
    // team's paywall before claiming any article row so a blocked request
    // cannot leave an article stuck in PENDING.
    const paywall = await checkTeamPaywall(teamId);
    if (!paywall.allowed) {
      return NextResponse.json(paywallErrorBody(paywall), { status: 402 });
    }

    const resetClaimedArticle = async (articleId: number) => {
      // Only undo this request's claim.  If a worker somehow won the race,
      // never move its active run back to FAILED.
      await db
        .update(articles)
        .set({
          articleStatus: "FAILED",
          errorMessage: "Article retry could not be queued. Please retry.",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(articles.id, articleId),
            eq(articles.teamId, teamId),
            eq(articles.articleStatus, "PENDING"),
          ),
        )
        .catch(() => {});
    };

    for (const articleId of articleIds) {
      try {
        const [article] = await db
          .select()
          .from(articles)
          .where(
            and(
              eq(articles.id, articleId),
              eq(articles.batchId, batchId),
              eq(articles.teamId, teamId),
            ),
          )
          .limit(1);

        if (!article) {
          skipped.push({ id: articleId, reason: "Article not found in this batch" });
          continue;
        }

        const creditRunId = `article-requeue:${batchId}:${articleId}:${requestKey}`;
        const runId = stableArticleRunId(
          `article-requeue:${batchId}:${articleId}:${requestKey}`,
        );

        // Check the durable billing owner before looking at article status.
        // This is the replay path for a request whose response was lost after
        // reservation or queue acceptance; it must not reserve or enqueue
        // again, even if the article is still PENDING.
        const [existingReservation] = await db
          .select({
            status: creditReservations.status,
            reconciliationRequiredAt: creditReservations.reconciliationRequiredAt,
          })
          .from(creditReservations)
          .where(
            and(
              eq(creditReservations.teamId, teamId),
              eq(creditReservations.runId, creditRunId),
            ),
          )
          .limit(1);
        if (existingReservation) {
          const existingJob = await findArticleGenerationJob(runId);
          if (
            existingJob ||
            existingReservation.status === "DEBITED" ||
            existingReservation.status === "RELEASED"
          ) {
            succeeded.push(articleId);
            continue;
          }

          pending.push({
            id: articleId,
            reason: existingReservation.reconciliationRequiredAt
              ? "Retry billing/queue state requires reconciliation"
              : "Retry is already reserved and awaiting queue acceptance",
          });
          continue;
        }

        if (article.articleStatus !== "FAILED") {
          skipped.push({
            id: articleId,
            reason: `Status is '${article.articleStatus}', expected 'FAILED'`,
          });
          continue;
        }

        // Claim FAILED -> PENDING atomically before any billing or queue work.
        // Concurrent clicks therefore have one owner; the loser cannot create
        // a second hold or a second paid worker job.
        const [claimedArticle] = await db
          .update(articles)
          .set({ articleStatus: "PENDING", errorMessage: null, updatedAt: new Date() })
          .where(
            and(
              eq(articles.id, articleId),
              eq(articles.batchId, batchId),
              eq(articles.teamId, teamId),
              eq(articles.articleStatus, "FAILED"),
            ),
          )
          .returning();
        if (!claimedArticle) {
          // The winner may have inserted its reservation between our first
          // read and this conditional update. Re-check the durable owner once
          // before reporting a normal in-progress conflict.
          const [racedReservation] = await db
            .select({ status: creditReservations.status })
            .from(creditReservations)
            .where(
              and(
                eq(creditReservations.teamId, teamId),
                eq(creditReservations.runId, creditRunId),
              ),
            )
            .limit(1);
          if (racedReservation) {
            succeeded.push(articleId);
          } else {
            skipped.push({
              id: articleId,
              reason: "Article retry is already in progress",
            });
          }
          continue;
        }

        let capReservationId: number | null = null;
        let reservationCreated = false;
        try {
          // Both gates are before addArticleJob(), and therefore before any
          // worker/provider can run. Each retry owns a fresh cap and credit
          // reservation; the failed original batch reservation is untouched.
          capReservationId = await checkUsageCap(
            teamId,
            creditCost,
            batch.campaignId ?? null,
          );
          const reservation = await reserveCredits({
            teamId,
            operationType: "article",
            runId: creditRunId,
            amount: creditCost,
            userId,
          });
          if (!reservation.ok) {
            if (capReservationId !== null) {
              await cancelCapReservation(capReservationId).catch(() => {});
            }
            await resetClaimedArticle(articleId);
            failed.push({
              id: articleId,
              reason: `You need ${reservation.requiredCredits} credits to retry this article.`,
            });
            continue;
          }
          reservationCreated = true;

          const params = (batch.generationParams as any) || {};
          await db.insert(jobEvents).values({
            articleId,
            batchId,
            eventType: "ARTICLE_REGENERATION_REQUESTED",
            stage: "ORCHESTRATION",
            message: "Article retry requested from batch failure UI",
            payloadJson: {
              source: "batch-requeue",
              requestKey,
              runId,
              creditRunId,
              creditCost,
              capReservationId,
            },
            severity: "info",
          });

          // The worker receives the exact reservation and cap identities it
          // later uses for debit/settlement. Never let it infer billing from
          // the old batch reservation.
          await addArticleJob({
            articleId: article.id,
            batchId: article.batchId,
            teamId,
            runId,
            title: article.chosenTitle,
            targetUrl: batch.targetUrl,
            wordCountMin: params.wordCountMin || 800,
            wordCountMax: params.wordCountMax || 2000,
            tone: params.tone,
            geographicFocus: params.geographicFocus,
            audience: params.audience,
            businessName: batch.businessName || undefined,
            companyLogoUrl: batch.companyLogoUrl || undefined,
            competitorUrls: (batch.competitorUrlsJson as string[]) || undefined,
            semanticClusterId: batch.semanticClusterId || undefined,
            serpFeatureTarget: batch.serpFeatureTarget || undefined,
            creditRunId,
            creditCostPerUnit: creditCost,
            capReservationId,
            capReservationScope: "article",
            campaignId: batch.campaignId ?? null,
          });

          succeeded.push(articleId);
        } catch (itemStartError) {
          if (itemStartError instanceof ArticleEnqueueUncertainError) {
            // Redis may have accepted the write even though the request timed
            // out. Keep both holds and make the operator/reconciler the owner;
            // retrying this request must never purchase another attempt.
            await markReservationForReconciliation({
              teamId,
              runId: creditRunId,
              reason: `Article ${articleId} batch retry queue acceptance is uncertain`,
            }).catch(() => {});
            pending.push({
              id: articleId,
              reason: "Queue acceptance is uncertain; billing capacity remains held for reconciliation",
            });
            continue;
          }

          // A proven pre-enqueue failure can safely release only this retry's
          // reservation/cap hold. The original batch reservation is unrelated.
          if (reservationCreated) {
            try {
              await releaseReservation({
                teamId,
                runId: creditRunId,
                userId,
                reason: `Release: article ${articleId} batch retry queue failure`,
              });
              if (capReservationId !== null) {
                await cancelCapReservation(capReservationId);
              }
            } catch (releaseError) {
              await markReservationForReconciliation({
                teamId,
                runId: creditRunId,
                reason: `Article ${articleId} retry setup failed and release was not durable: ${
                  releaseError instanceof Error ? releaseError.message : String(releaseError)
                }`,
              }).catch(() => {});
              pending.push({
                id: articleId,
                reason: "Retry billing hold requires reconciliation",
              });
              continue;
            }
          } else if (capReservationId !== null) {
            await cancelCapReservation(capReservationId).catch(() => {});
          }
          await resetClaimedArticle(articleId);
          throw itemStartError;
        }
      } catch (itemErr: any) {
        failed.push({ id: articleId, reason: itemErr?.message || "Unknown error" });
      }
    }

    // A held/ambiguous item is deliberately not reported as a successful
    // requeue.  202 tells the caller not to issue a second paid retry.
    const responseBody = {
      success: true,
      requeuedCount: succeeded.length,
      succeeded,
      failed,
      skipped,
      pending,
      pendingCount: pending.length,
      message: `${succeeded.length} requeued. ${failed.length} error(s). ${skipped.length} skipped.`,
    };
    return NextResponse.json(responseBody, { status: pending.length > 0 ? 202 : 200 });
      });
  } catch (error: any) {
    console.error("Error requeuing articles:", error);
    return NextResponse.json(
      { error: "Failed to requeue articles", message: error?.message },
      { status: error?.statusCode || 500 }
    );
  }
}
