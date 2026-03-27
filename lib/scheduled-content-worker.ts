import { neonHttpDb as db } from "./db";
import { contentSchedules, scheduleRuns, jobBatches } from "@/shared/schema";
import { eq, and, lte, isNull, sql } from "drizzle-orm";
import { generateTitlePool } from "./gemini";
import { addBatchGenerationJob } from "./queue";
import { smartResearch } from "./smart-topic-research";
import cronParser from "cron-parser";

const SCHEDULE_CHECK_INTERVAL = 60000;

function calculateNextRun(cronExpression: string, timezone: string): Date {
  try {
    const options = {
      currentDate: new Date(),
      tz: timezone || 'UTC',
    };
    const interval = cronParser.parse(cronExpression, options);
    return interval.next().toDate();
  } catch (error) {
    console.error(`Failed to parse cron expression "${cronExpression}":`, error);
    const fallback = new Date();
    fallback.setHours(fallback.getHours() + 24);
    return fallback;
  }
}

export async function executeScheduledRun(scheduleId: number): Promise<void> {
  console.log(`🕐 Executing scheduled run for schedule ${scheduleId}`);
  
  const nextRunTime = calculateNextRun("0 2 * * *", "UTC");
  const updateResult = await db
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
        lte(contentSchedules.nextRunAt, new Date())
      )
    )
    .returning();
  
  if (updateResult.length === 0) {
    console.log(`⚠️ Schedule ${scheduleId} already claimed by another worker or not due`);
    return;
  }
  
  const schedule = updateResult[0]!;
  
  const [runRow] = await db
    .insert(scheduleRuns)
    .values({
      scheduleId: schedule.id,
      status: "started",
      articlesRequested: schedule.articlesPerRun,
    })
    .returning();
  const run = runRow!;
  
  try {
    console.log(`📝 Generating title pool for schedule "${schedule.name}"`);
    
    // ENHANCED v4.0: Perform smart web research before title generation
    // Wrapped in try/catch for robustness - scheduled runs should not fail if research fails
    let researchData;
    try {
      console.log(`🔬 Performing smart research for "${schedule.coreTopic}" in "${schedule.geographicFocus}"...`);
      researchData = await smartResearch.researchTopic(
        schedule.coreTopic, 
        schedule.geographicFocus || 'United States',
        { maxSearches: 8, includeCompetitors: true }
      );
      console.log(`✅ Smart research complete: ${researchData.localEntities.length} entities, ${researchData.competitorTitles.length} competitor titles`);
    } catch (researchError) {
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
      researchData
    );
    
    if (!titlePoolResult.titles || titlePoolResult.titles.length === 0) {
      throw new Error("Failed to generate title pool - no titles returned");
    }
    
    const selectedTitles = titlePoolResult.titles.slice(0, schedule.articlesPerRun);
    
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
    });
    
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
    
    await db
      .update(scheduleRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
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

export async function checkDueSchedules(): Promise<void> {
  const now = new Date();
  
  const dueSchedules = await db
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
  
  const activeSchedules = await db
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
    const nextRun = calculateNextRun(schedule.cronExpression, schedule.timezone);
    await db
      .update(contentSchedules)
      .set({ nextRunAt: nextRun })
      .where(eq(contentSchedules.id, schedule.id));
    console.log(`📅 Set next run for "${schedule.name}": ${nextRun.toISOString()}`);
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
