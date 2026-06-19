import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeys, journeySteps } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateStepSchema = z.object({
  status: z.enum(["pending", "queued", "generated", "published"]).optional(),
  articleId: z.number().int().positive().nullable().optional(),
  batchId: z.number().int().positive().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  topicAngle: z.string().max(1000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> }
) {
  try {
    const { id, stepId: stepIdStr } = await params;
    const { teamId } = await requireTeamMember(req);
    const journeyId = parseInt(id);
    const stepId = parseInt(stepIdStr);
    if (isNaN(journeyId) || isNaN(stepId))
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    // Verify journey belongs to team
    const [journey] = await db
      .select({ id: journeys.id })
      .from(journeys)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .limit(1);

    if (!journey) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const parsed = updateStepSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });

    const existing = await db
      .select({ id: journeySteps.id })
      .from(journeySteps)
      .where(and(eq(journeySteps.id, stepId), eq(journeySteps.journeyId, journeyId)))
      .limit(1);

    if (existing.length === 0) return NextResponse.json({ error: "Step not found" }, { status: 404 });

    const updateData: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.publishedAt !== undefined) {
      updateData.publishedAt = parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null;
    }

    const [updated] = await db
      .update(journeySteps)
      .set(updateData)
      .where(and(eq(journeySteps.id, stepId), eq(journeySteps.journeyId, journeyId)))
      .returning();

    // If all steps are generated/published, mark journey as completed
    if (parsed.data.status === "generated" || parsed.data.status === "published") {
      const allSteps = await db
        .select({ status: journeySteps.status })
        .from(journeySteps)
        .where(eq(journeySteps.journeyId, journeyId));

      const allDone = allSteps.every(
        (s) => s.status === "generated" || s.status === "published"
      );

      if (allDone && allSteps.length > 0) {
        await db
          .update(journeys)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(journeys.id, journeyId));
      }
    }

    return NextResponse.json({ step: updated });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/[id]/steps/[stepId] PATCH]", err);
    return NextResponse.json({ error: "Failed to update step" }, { status: 500 });
  }
}
