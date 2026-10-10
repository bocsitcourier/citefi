import { db, systemDb } from "./db";
import { runWithTenantContext } from "./tenant-context";
import { contentSchedules, scheduleRuns, jobBatches, usageEvents } from "@/shared/schema";
import { eq, and, lte, isNull, sql } from "drizzle-orm";
import { generateTitlePool } from "./gemini";
import { addBatchGenerationJob, AmbiguousBatchEnqueueError } from "./queue";
import { smartResearch } from "./smart-topic-research";
import { calculateNextRun } from "./schedule-time";
import { isProviderAttemptTerminalError } from "./provider-attempt-receipts";
import { cleanupUnacceptedReservations } from "./scheduled-reservation-cleanup";
import {
  isProviderAccountingError,
  isProviderSubmissionUncertainError,
} from "./cost-telemetry";

const SCHEDULE_CHECK_INTERVAL = 60000;

export async function executeScheduledRun(scheduleId: number): Promise<void> {
  console.log(`🕐 Executing scheduled run for schedule ${scheduleId}`);
  
  const claimed = await systemDb.transaction(async (tx) => {
    const now = new Date();
    const [due] = await tx.select().from(contentSchedules).where(and(
      eq(contentSchedules.id, scheduleId),
      eq(contentSchedules.status, "active"),
      isNull(contentSchedules.deletedAt),
      lte(contentSchedules.nextRunAt, now),
    )).for("update", { skipLocked: true });
    if (!due) return null;
    const nextRunTime = calculateNextRun(due.cronExpression, due.timezone, now);
    const [schedule] = await tx
    .update(contentSchedules)
    .set({
      nextRunAt: nextRunTime,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentSchedules.id, scheduleId),
        eq(contentSchedules.status, "active"),
        isNull(contentSchedules.deletedAt),
        lte(contentSchedules.nextRunAt, now)
      )
    )
    .returning();
    if (!schedule) return null;
    // Keep an interrupted-run audit record even if the process dies immediately
    // after the claim. Recovery must reconcile this identity, not replay blindly.
    const [run] = await tx.insert(scheduleRuns).values({
      scheduleId: schedule.id,
      status: "started",
      articlesRequested: schedule.articlesPerRun,
    }).returning();
    if (!run) throw new Error("Failed to persist scheduled run claim");
    return { schedule, run };
  });
  
  if (!claimed) {
    console.log(`⚠️ Schedule ${scheduleId} already claimed by another worker or not due`);
    return;
  }
  
  const { schedule, run } = claimed;
  return runWithTenantContext(
    {
      actorType: "worker",
      userId: null,
      teamId: schedule.teamId,
      role: "worker",
    },
    async () => {
  
  let capReservationId: number | null = null;
  const creditRunId = `scheduled:${schedule.id}:${run.id}`;
  let creditCostPerUnit = 0;
  let creditReservationCreated = false;
  let partialReleaseUncertain = false;
  let queueSubmissionStarted = false;
  let queueAccepted = false;
  try {
    // Paywall gate — skip scheduled run if team has no billing access
    const { checkTeamPaywall } = await import("./billing/paywall");
    const paywallResult = await checkTeamPaywall(schedule.teamId);
    if (!paywallResult.allowed) {
      throw new Error(`[scheduled-worker] Team ${schedule.teamId} blocked by paywall — run skipped`);
    }

    if (!Number.isInteger(schedule.articlesPerRun) || schedule.articlesPerRun <= 0) {
      throw new Error(`[scheduled-worker] Schedule ${schedule.id} must request a positive integer number of articles`);
    }
    if (!schedule.businessName?.trim()) {
      throw new Error(`[scheduled-worker] Schedule ${schedule.id} has no business name for batch generation`);
    }

    // Reserve capacity for the maximum scheduled output BEFORE any provider
    // work (research or title generation). If the title pool is shorter, shrink
    // the holds with an idempotent partial credit release and cap estimate.
    const { getCreditCost } = await import("./credit-menu");
    creditCostPerUnit = getCreditCost("article") ?? 10;
    const maxBillableArticles = Math.min(schedule.articlesPerRun, 50);
    const maxReservedCredits = creditCostPerUnit * maxBillableArticles;
    const { checkUsageCap, cancelCapReservation } = await import("./usage-caps");
    capReservationId = await checkUsageCap(schedule.teamId, maxReservedCredits);

    const { reserveCredits } = await import("./billing");
    const creditReserve = await reserveCredits({
      teamId: schedule.teamId,
      operationType: "article",
      runId: creditRunId,
      amount: maxReservedCredits,
      userId: schedule.createdBy,
    });
    if (!creditReserve.ok) {
      if (capReservationId !== null) {
        await cancelCapReservation(capReservationId);
        capReservationId = null;
      }
      throw new Error(`[scheduled-worker] Insufficient credits for team ${schedule.teamId}: balance too low for ${schedule.articlesPerRun} articles`);
    }
    creditReservationCreated = true;

    console.log(`📝 Generating title pool for schedule "${schedule.name}"`);
    
    // ENHANCED v4.0: Perform smart web research before title generation
    // Wrapped in try/catch for robustness - scheduled runs should not fail if research fails
    let researchData;
    try {
      console.log(`🔬 Performing smart research for "${schedule.coreTopic}" in "${schedule.geographicFocus}"...`);
      researchData = await smartResearch.researchTopic(
        schedule.coreTopic, 
        schedule.geographicFocus || 'United States',
        schedule.teamId,
        { maxSearches: 8, includeCompetitors: true }
      );
      console.log(`✅ Smart research complete: ${researchData.localEntities.length} entities, ${researchData.competitorTitles.length} competitor titles`);
    } catch (researchError) {
      if (
        isProviderAccountingError(researchError) ||
        isProviderSubmissionUncertainError(researchError)
      ) {
        throw researchError;
      }
      console.warn(`⚠️ Smart research failed for schedule "${schedule.name}", continuing without it:`, (researchError as Error).message);
      researchData = undefined;
    }
    
    const numTitles = Math.min(schedule.articlesPerRun * 2, 50);
    const titlePoolResult = await generateTitlePool(
      schedule.coreTopic,
      schedule.targetUrl,
      numTitles,
      schedule.tone || undefined,
      schedule.geographicFocus || undefined,
      schedule.audience || undefined,
      undefined, // redditQuestions - can be added later
      researchData,
      schedule.teamId
    );
    
    if (!titlePoolResult.titles || titlePoolResult.titles.length === 0) {
      throw new Error("Failed to generate title pool - no titles returned");
    }
    
    const selectedTitles = titlePoolResult.titles.slice(0, schedule.articlesPerRun);
    if (selectedTitles.length === 0) {
      throw new Error("Failed to generate title pool - no titles returned");
    }

    if (selectedTitles.length < maxBillableArticles) {
      const unusedCredits = creditCostPerUnit * (maxBillableArticles - selectedTitles.length);
      partialReleaseUncertain = true;
      await (await import("./billing")).releaseReservation({
        teamId: schedule.teamId,
        runId: creditRunId,
        amount: unusedCredits,
        releaseKey: `scheduled-unused:${run.id}`,
        reason: `Scheduled run ${run.id} returned fewer titles than requested`,
      });
      partialReleaseUncertain = false;

      if (capReservationId !== null) {
        const resized = await db.update(usageEvents)
          .set({ costEstimateCents: creditCostPerUnit * selectedTitles.length })
          .where(and(
            eq(usageEvents.id, capReservationId),
            eq(usageEvents.teamId, schedule.teamId),
            eq(usageEvents.status, "pending"),
          ))
          .returning({ id: usageEvents.id });
        if (resized.length !== 1) {
          throw new Error(`[scheduled-worker] Could not resize pending cap reservation ${capReservationId}`);
        }
      }
    }

    const [batchRow] = await db
      .insert(jobBatches)
      .values({
        userId: schedule.createdBy,
        teamId: schedule.teamId,
        coreTopic: schedule.coreTopic,
        targetUrl: schedule.targetUrl,
        status: "PENDING",
        numArticlesRequested: selectedTitles.length,
        titlePoolJson: titlePoolResult,
        generationParams: {
          tone: schedule.tone,
          wordCountMin: schedule.wordCountMin,
          wordCountMax: schedule.wordCountMax,
          geographicFocus: schedule.geographicFocus,
          audience: schedule.audience,
          creditRunId,
          creditCostPerUnit,
          capReservationId,
        },
        businessName: schedule.businessName,
        businessAddress: schedule.businessAddress,
        businessPhone: schedule.businessPhone,
        companyLogoUrl: schedule.companyLogoUrl,
        autoPublishEnabled: schedule.autoPublishEnabled,
        autoPublishConnectionIds: schedule.autoPublishConnectionIds,
      })
      .returning();
    const batch = batchRow!;
    
    console.log(`📦 Created batch ${batch.id} with ${selectedTitles.length} titles`);
    
    await db
      .update(scheduleRuns)
      .set({ batchId: batch.id })
      .where(eq(scheduleRuns.id, run.id));
    
    queueSubmissionStarted = true;
    const jobId = await addBatchGenerationJob({
      batchId: batch.id,
      userId: schedule.createdBy,
      teamId: schedule.teamId,
      selectedTitles,
      targetUrl: schedule.targetUrl,
      tone: schedule.tone,
      wordCountMin: schedule.wordCountMin,
      wordCountMax: schedule.wordCountMax,
      geographicFocus: schedule.geographicFocus || undefined,
      audience: schedule.audience || undefined,
      businessName: schedule.businessName,
      companyLogoUrl: schedule.companyLogoUrl || undefined,
      creditRunId,
      capReservationId,
      capReservationScope: "batch",
      creditCostPerUnit,
    });
    queueAccepted = true;
    
    console.log(`✅ Batch ${batch.id} queued with job ID: ${jobId}`);
    
    const nextRun = calculateNextRun(schedule.cronExpression, schedule.timezone);
    
    await db
      .update(contentSchedules)
      .set({
        lastRunAt: new Date(),
        nextRunAt: nextRun,
        totalRuns: sql`${contentSchedules.totalRuns} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(contentSchedules.id, schedule.id));
    
    await db
      .update(scheduleRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(scheduleRuns.id, run.id));
    
    console.log(`✅ Schedule "${schedule.name}" run completed, next run at ${nextRun.toISOString()}`);
    
  } catch (error) {
    console.error(`❌ Schedule run failed:`, error);

    const providerOutcomeUncertain =
      isProviderAccountingError(error) ||
      isProviderSubmissionUncertainError(error) ||
      isProviderAttemptTerminalError(error);
    const enqueueOutcomeUncertain =
      error instanceof AmbiguousBatchEnqueueError ||
      (typeof error === "object" && error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "BATCH_ENQUEUE_UNKNOWN") ||
      (queueSubmissionStarted && !(error instanceof Error &&
        /without (?:teamId|businessName)|invalid.*(?:job.?id|job options)|job name.*required/i.test(error.message)));
    let reconciliationError: string | undefined;
    let creditReleaseUncertain = false;

    if ((providerOutcomeUncertain || enqueueOutcomeUncertain || partialReleaseUncertain) &&
        creditReservationCreated) {
      try {
        const { markReservationForReconciliation } = await import("./billing");
        await markReservationForReconciliation({
          teamId: schedule.teamId,
          runId: creditRunId,
          reason: `Scheduled run ${run.id} requires reconciliation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } catch (markerError) {
        reconciliationError =
          `; reconciliation marker failed: ${markerError instanceof Error ? markerError.message : String(markerError)}`;
        console.error(
          `[scheduled-worker] Could not persist reconciliation hold for ${creditRunId}:`,
          markerError,
        );
      }
    }

    if (!queueAccepted && !providerOutcomeUncertain && !enqueueOutcomeUncertain && !partialReleaseUncertain) {
      const cleanup = await cleanupUnacceptedReservations({
        releaseCredits: creditReservationCreated ? async () => {
        const { releaseReservation } = await import("./billing");
        return releaseReservation({
          teamId: schedule.teamId,
          runId: creditRunId,
          reason: `Scheduled run ${run.id} failed before queue acceptance`,
        });
        } : undefined,
        cancelCap: capReservationId !== null ? async () => {
        const { cancelCapReservation } = await import("./usage-caps");
        return cancelCapReservation(capReservationId!);
        } : undefined,
      });
      if (cleanup.uncertain) {
        creditReleaseUncertain = true;
        reconciliationError =
          `; ${cleanup.stage} reservation cleanup failed; reconciliation required: ${cleanup.error instanceof Error ? cleanup.error.message : String(cleanup.error)}`;
        console.error(`[scheduled-worker] Reservation cleanup failed for ${creditRunId}:`, cleanup.error);
      }
    }

    await db
      .update(scheduleRuns)
      .set({
        status: queueAccepted ? "queued" :
          providerOutcomeUncertain || enqueueOutcomeUncertain || partialReleaseUncertain || creditReleaseUncertain
            ? "reconciliation_required"
            : "failed",
        error: `${error instanceof Error ? error.message : String(error)}${
          providerOutcomeUncertain || enqueueOutcomeUncertain || partialReleaseUncertain || creditReleaseUncertain
            ? ` [creditRunId=${creditRunId}; capReservationId=${capReservationId ?? "none"}]`
            : ""
        }${reconciliationError ?? ""}`,
        completedAt: new Date(),
      })
      .where(eq(scheduleRuns.id, run.id));
    
    const nextRun = calculateNextRun(schedule.cronExpression, schedule.timezone);
    await db
      .update(contentSchedules)
      .set({
        lastRunAt: new Date(),
        nextRunAt: nextRun,
        updatedAt: new Date(),
      })
      .where(eq(contentSchedules.id, schedule.id));
  }
    }
  );
}

export async function checkDueSchedules(): Promise<void> {
  const now = new Date();
  
  const dueSchedules = await systemDb
    .select({ id: contentSchedules.id })
    .from(contentSchedules)
    .where(
      and(
        eq(contentSchedules.status, "active"),
        isNull(contentSchedules.deletedAt),
        lte(contentSchedules.nextRunAt, now)
      )
    );
  
  if (dueSchedules.length > 0) {
    console.log(`🕐 Found ${dueSchedules.length} due schedules`);
    
    for (const schedule of dueSchedules) {
      try {
        await executeScheduledRun(schedule.id);
      } catch (error) {
        console.error(`❌ Error executing schedule ${schedule.id}:`, error);
      }
    }
  }
}

export async function initializeScheduler(): Promise<void> {
  console.log("🕐 Initializing content scheduler...");
  
  const activeSchedules = await systemDb
    .select()
    .from(contentSchedules)
    .where(
      and(
        eq(contentSchedules.status, "active"),
        isNull(contentSchedules.deletedAt),
        isNull(contentSchedules.nextRunAt)
      )
    );
  
  for (const schedule of activeSchedules) {
    try {
    const nextRun = calculateNextRun(schedule.cronExpression, schedule.timezone);
    await systemDb
      .update(contentSchedules)
      .set({ nextRunAt: nextRun })
      .where(eq(contentSchedules.id, schedule.id));
    console.log(`📅 Set next run for "${schedule.name}": ${nextRun.toISOString()}`);
    } catch (error) {
      // One invalid legacy schedule must not prevent valid schedules from starting.
      console.error(`Invalid configuration for schedule ${schedule.id}; not initialized:`, error);
    }
  }
  
  setInterval(async () => {
    try {
      await checkDueSchedules();
    } catch (error) {
      console.error("❌ Schedule check error:", error);
    }
  }, SCHEDULE_CHECK_INTERVAL);
  
  console.log(`✅ Content scheduler initialized - checking every ${SCHEDULE_CHECK_INTERVAL / 1000}s`);
}
