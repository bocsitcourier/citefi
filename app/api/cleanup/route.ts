import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cleanupJobs, cleanupConfig } from "@/shared/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { addCleanupJob } from "@/lib/queue";
import { getDefaults, clearConfigCache } from "@/lib/cleanup-policy";
import { requireAdmin } from "@/lib/api/auth";

// GET /api/cleanup - Get cleanup configuration and recent jobs
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const jobType = searchParams.get("jobType");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

    // Fetch recent cleanup jobs
    const jobsQuery = db
      .select()
      .from(cleanupJobs)
      .orderBy(desc(cleanupJobs.createdAt))
      .limit(limit);

    const jobs = jobType
      ? await jobsQuery.where(eq(cleanupJobs.jobType, jobType as any))
      : await jobsQuery;

    // Fetch cleanup configuration
    const configs = await db.select().from(cleanupConfig);

    // Get default policies
    const defaults = getDefaults();

    return NextResponse.json({
      jobs,
      config: configs,
      defaults,
    });
  } catch (error) {
    console.error("Failed to fetch cleanup data:", error);
    return NextResponse.json(
      { error: "Failed to fetch cleanup data" },
      { status: 500 }
    );
  }
}

// POST /api/cleanup - Trigger a cleanup job manually
const triggerSchema = z.object({
  jobType: z.enum(["media", "logs", "orphans", "sessions"]),
  dryRun: z.boolean().default(true),
  retentionDays: z.number().int().min(7).max(365).optional(),
  teamId: z.number().int().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const userId = await requireAdmin(request);
    const body = await request.json();
    const data = triggerSchema.parse(body);

    console.log(
      `🧹 Manual cleanup triggered: type=${data.jobType}, dryRun=${data.dryRun}, userId=${userId}`
    );

    // Queue cleanup job
    const jobId = await addCleanupJob({
      jobType: data.jobType,
      dryRun: data.dryRun,
      retentionDays: data.retentionDays,
      teamId: data.teamId,
    });

    // Log to activity logs
    const { activityLogs } = await import("@/shared/schema");
    await db.insert(activityLogs).values({
      userId,
      teamId: data.teamId || null,
      action: "cleanup_triggered",
      resource: "cleanup",
      targetType: data.jobType,
      details: {
        jobId,
        jobType: data.jobType,
        dryRun: data.dryRun,
        retentionDays: data.retentionDays,
      },
      severity: "info",
    });

    return NextResponse.json(
      {
        success: true,
        jobId,
        jobType: data.jobType,
        dryRun: data.dryRun,
        message: data.dryRun
          ? "Dry run cleanup job queued"
          : "Cleanup job queued and will execute soon",
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error("Failed to trigger cleanup:", error);
    return NextResponse.json(
      {
        error: "Failed to trigger cleanup",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// PATCH /api/cleanup - Update cleanup configuration
const configSchema = z.object({
  settingKey: z.string().min(1),
  settingValue: z.record(z.string(), z.number()),
  description: z.string().optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const userId = await requireAdmin(request);
    const body = await request.json();
    const data = configSchema.parse(body);

    // Upsert configuration
    const [config] = await db
      .insert(cleanupConfig)
      .values({
        settingKey: data.settingKey,
        settingValue: data.settingValue as any,
        description: data.description || null,
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: cleanupConfig.settingKey,
        set: {
          settingValue: data.settingValue as any,
          description: data.description || null,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Clear config cache to force reload
    clearConfigCache();

    // Log configuration change
    const { activityLogs } = await import("@/shared/schema");
    await db.insert(activityLogs).values({
      userId,
      action: "cleanup_config_updated",
      resource: "cleanup_config",
      targetType: "config",
      details: {
        settingKey: data.settingKey,
        settingValue: data.settingValue,
      },
      severity: "info",
    });

    return NextResponse.json({
      success: true,
      config,
      message: "Cleanup configuration updated successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error("Failed to update cleanup config:", error);
    return NextResponse.json(
      {
        error: "Failed to update cleanup configuration",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
