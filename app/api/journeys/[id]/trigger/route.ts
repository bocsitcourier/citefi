import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeys, journeySteps } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const triggerSchema = z.object({
  triggerArticleId: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { teamId } = await requireTeamMember(req);
    const journeyId = parseInt(params.id);
    if (isNaN(journeyId)) return NextResponse.json({ error: "Invalid journey id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const parsed = triggerSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });

    const [journey] = await db
      .select()
      .from(journeys)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .limit(1);

    if (!journey) return NextResponse.json({ error: "Journey not found" }, { status: 404 });
    if (journey.status === "active")
      return NextResponse.json({ error: "Journey is already active" }, { status: 409 });
    if (journey.status === "completed")
      return NextResponse.json({ error: "Journey has already completed" }, { status: 409 });

    const now = new Date();

    // Schedule all pending steps: scheduledFor = now + dayOffset days
    const steps = await db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journeyId));

    for (const step of steps) {
      const scheduledFor = new Date(now.getTime() + step.dayOffset * 24 * 60 * 60 * 1000);
      await db
        .update(journeySteps)
        .set({ scheduledFor, status: "pending" })
        .where(eq(journeySteps.id, step.id));
    }

    // Activate journey
    const [updated] = await db
      .update(journeys)
      .set({
        status: "active",
        triggeredAt: now,
        triggerArticleId: parsed.data.triggerArticleId ?? null,
      })
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .returning();

    const scheduledSteps = await db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journeyId))
      .orderBy(journeySteps.stepIndex);

    return NextResponse.json({ journey: updated, steps: scheduledSteps });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/[id]/trigger POST]", err);
    return NextResponse.json({ error: "Failed to trigger journey" }, { status: 500 });
  }
}
