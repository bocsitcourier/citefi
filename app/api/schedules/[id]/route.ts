import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { contentSchedules, scheduleRuns } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  coreTopic: z.string().min(1).optional(),
  targetUrl: z.string().url().optional(),
  businessName: z.string().min(1).max(255).optional(),
  businessAddress: z.string().optional().nullable(),
  businessPhone: z.string().optional().nullable(),
  companyLogoUrl: z.string().optional().nullable(),
  articlesPerRun: z.number().int().min(1).max(25).optional(),
  tone: z.string().optional(),
  wordCountMin: z.number().int().min(500).max(5000).optional(),
  wordCountMax: z.number().int().min(500).max(5000).optional(),
  geographicFocus: z.string().optional().nullable(),
  audience: z.string().optional().nullable(),
  cronExpression: z.string().optional(),
  timezone: z.string().optional(),
  autoPublishEnabled: z.boolean().optional(),
  autoPublishConnectionIds: z.array(z.number()).optional().nullable(),
  status: z.enum(["active", "paused", "disabled"]).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const scheduleId = parseInt(id);

    const [schedule] = await db
      .select()
      .from(contentSchedules)
      .where(
        and(
          eq(contentSchedules.id, scheduleId),
          eq(contentSchedules.teamId, teamId),
          isNull(contentSchedules.deletedAt)
        )
      );

    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    const runs = await db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.scheduleId, scheduleId))
      .orderBy(desc(scheduleRuns.startedAt))
      .limit(10);

    return NextResponse.json({ success: true, data: { schedule, runs } });
  } catch (error: any) {
    console.error("Error fetching schedule:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch schedule" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const scheduleId = parseInt(id);

    const [existing] = await db
      .select()
      .from(contentSchedules)
      .where(
        and(
          eq(contentSchedules.id, scheduleId),
          eq(contentSchedules.teamId, teamId),
          isNull(contentSchedules.deletedAt)
        )
      );

    if (!existing) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    const body = await request.json();
    const validatedData = updateScheduleSchema.parse(body);

    const updateData: any = {
      ...validatedData,
      updatedAt: new Date(),
    };

    if (validatedData.autoPublishEnabled !== undefined) {
      updateData.autoPublishEnabled = validatedData.autoPublishEnabled ? 1 : 0;
    }

    const [updated] = await db
      .update(contentSchedules)
      .set(updateData)
      .where(eq(contentSchedules.id, scheduleId))
      .returning();

    console.log(`📅 Updated schedule "${updated.name}" (ID: ${updated.id})`);

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    console.error("Error updating schedule:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error?.message || "Failed to update schedule" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    const scheduleId = parseInt(id);

    const [existing] = await db
      .select()
      .from(contentSchedules)
      .where(
        and(
          eq(contentSchedules.id, scheduleId),
          eq(contentSchedules.teamId, teamId),
          isNull(contentSchedules.deletedAt)
        )
      );

    if (!existing) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    await db
      .update(contentSchedules)
      .set({ deletedAt: new Date(), status: "disabled" })
      .where(eq(contentSchedules.id, scheduleId));

    console.log(`🗑️ Deleted schedule "${existing.name}" (ID: ${scheduleId})`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting schedule:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete schedule" },
      { status: error?.statusCode || 500 }
    );
  }
}
