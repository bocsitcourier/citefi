import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeys, journeySteps } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateJourneySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(["draft", "active", "completed", "paused"]).optional(),
  locale: z.string().max(20).nullable().optional(),
  localeConfig: z.record(z.unknown()).nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { teamId } = await requireTeamMember(req);
    const journeyId = parseInt(params.id);
    if (isNaN(journeyId)) return NextResponse.json({ error: "Invalid journey id" }, { status: 400 });

    const [journey] = await db
      .select()
      .from(journeys)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .limit(1);

    if (!journey) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const steps = await db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journeyId))
      .orderBy(journeySteps.stepIndex);

    return NextResponse.json({ journey, steps });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/[id] GET]", err);
    return NextResponse.json({ error: "Failed to fetch journey" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { teamId } = await requireTeamMember(req);
    const journeyId = parseInt(params.id);
    if (isNaN(journeyId)) return NextResponse.json({ error: "Invalid journey id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const parsed = updateJourneySchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });

    const existing = await db
      .select({ id: journeys.id })
      .from(journeys)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .limit(1);

    if (existing.length === 0) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const [updated] = await db
      .update(journeys)
      .set(parsed.data)
      .where(and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId)))
      .returning();

    return NextResponse.json({ journey: updated });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys/[id] PATCH]", err);
    return NextResponse.json({ error: "Failed to update journey" }, { status: 500 });
  }
}
