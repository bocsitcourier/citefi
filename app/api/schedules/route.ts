import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { contentSchedules } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import cronParser from "cron-parser";

const createScheduleSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  coreTopic: z.string().min(1, "Topic is required"),
  targetUrl: z.string().url("Must be a valid URL"),
  businessName: z.string().min(1, "Business name is required").max(255),
  businessAddress: z.string().optional(),
  businessPhone: z.string().optional(),
  companyLogoUrl: z.string().optional(),
  articlesPerRun: z.number().int().min(1).max(25).default(5),
  tone: z.string().default("professional"),
  wordCountMin: z.number().int().min(500).max(5000).default(800),
  wordCountMax: z.number().int().min(500).max(5000).default(2000),
  geographicFocus: z.string().optional(),
  audience: z.string().optional(),
  cronExpression: z.string().min(1, "Schedule is required"),
  timezone: z.string().default("UTC"),
  autoPublishEnabled: z.boolean().default(true),
  autoPublishConnectionIds: z.array(z.number()).optional(),
});

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

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const schedules = await db
      .select()
      .from(contentSchedules)
      .where(
        and(
          eq(contentSchedules.teamId, teamId),
          isNull(contentSchedules.deletedAt)
        )
      )
      .orderBy(desc(contentSchedules.createdAt));

    return NextResponse.json({ success: true, data: schedules });
  } catch (error: any) {
    console.error("Error fetching schedules:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch schedules" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);

    const body = await request.json();
    const validatedData = createScheduleSchema.parse(body);

    const nextRunAt = calculateNextRun(validatedData.cronExpression, validatedData.timezone);

    const [schedule] = await db
      .insert(contentSchedules)
      .values({
        teamId,
        createdBy: userId,
        name: validatedData.name,
        coreTopic: validatedData.coreTopic,
        targetUrl: validatedData.targetUrl,
        businessName: validatedData.businessName,
        businessAddress: validatedData.businessAddress || null,
        businessPhone: validatedData.businessPhone || null,
        companyLogoUrl: validatedData.companyLogoUrl || null,
        articlesPerRun: validatedData.articlesPerRun,
        tone: validatedData.tone,
        wordCountMin: validatedData.wordCountMin,
        wordCountMax: validatedData.wordCountMax,
        geographicFocus: validatedData.geographicFocus || null,
        audience: validatedData.audience || null,
        cronExpression: validatedData.cronExpression,
        timezone: validatedData.timezone,
        autoPublishEnabled: validatedData.autoPublishEnabled ? 1 : 0,
        autoPublishConnectionIds: validatedData.autoPublishConnectionIds || null,
        status: "active",
        nextRunAt,
      })
      .returning();

    console.log(`📅 Created schedule "${schedule.name}" (ID: ${schedule.id}), next run: ${nextRunAt.toISOString()}`);

    return NextResponse.json({ success: true, data: schedule }, { status: 201 });
  } catch (error: any) {
    console.error("Error creating schedule:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error?.message || "Failed to create schedule" },
      { status: error?.statusCode || 500 }
    );
  }
}
