import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeys, journeySteps, journeyTemplates } from "@/shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const createJourneySchema = z.object({
  name: z.string().min(1).max(255),
  terminalKpi: z.enum(["conversion", "engagement", "awareness", "subscription"]),
  triggerType: z.enum(["manual", "on_publish", "scheduled"]).default("manual"),
  templateId: z.number().int().positive().optional(),
  templateType: z.string().max(50).optional(),
  locale: z.string().max(20).optional(),
  localeConfig: z.record(z.unknown()).optional(),
  // Custom steps override (when not using a template)
  customSteps: z
    .array(
      z.object({
        stepIndex: z.number().int().min(0),
        contentType: z.enum(["article", "social", "podcast", "video"]),
        dayOffset: z.number().int().min(0).default(0),
        topicAngle: z.string().optional(),
        channel: z.string().max(50).optional(),
      })
    )
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    const conditions = status
      ? and(eq(journeys.teamId, teamId), eq(journeys.status, status))
      : eq(journeys.teamId, teamId);

    const rows = await db
      .select()
      .from(journeys)
      .where(conditions)
      .orderBy(desc(journeys.createdAt));

    // Enrich each journey with step summary so the dashboard can show
    // accurate progress (% complete) and next-due step without a second request.
    const enriched = await Promise.all(
      rows.map(async (j) => {
        const steps = await db
          .select()
          .from(journeySteps)
          .where(eq(journeySteps.journeyId, j.id))
          .orderBy(journeySteps.stepIndex);

        const totalSteps = steps.length;
        const completedSteps = steps.filter(
          (s) => s.status === "generated" || s.status === "published"
        ).length;
        const nextDueStep = steps.find(
          (s) => s.status === "pending" || s.status === "queued"
        ) ?? null;

        return {
          ...j,
          steps,
          totalSteps,
          completedSteps,
          nextDueStep,
        };
      })
    );

    return NextResponse.json({ journeys: enriched });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys GET]", err);
    return NextResponse.json({ error: "Failed to fetch journeys" }, { status: err?.statusCode || 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const parsed = createJourneySchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });

    const { name, terminalKpi, triggerType, templateId, templateType, locale, localeConfig, customSteps } =
      parsed.data;

    // Determine step definitions: from template or from customSteps
    let stepDefs: Array<{
      stepIndex: number;
      contentType: string;
      dayOffset: number;
      topicAngle?: string;
      channel?: string;
    }> = [];

    if (templateId) {
      const [tmpl] = await db
        .select()
        .from(journeyTemplates)
        .where(eq(journeyTemplates.id, templateId))
        .limit(1);
      if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
      stepDefs = (tmpl.stepsConfig as typeof stepDefs) ?? [];
    } else if (customSteps && customSteps.length > 0) {
      stepDefs = customSteps;
    }

    // Create journey
    const [journey] = await db
      .insert(journeys)
      .values({
        teamId,
        name,
        terminalKpi,
        triggerType,
        templateId: templateId ?? null,
        templateType: templateType ?? null,
        locale: locale ?? null,
        localeConfig: localeConfig ?? null,
        status: "draft",
      })
      .returning();

    // Create steps if we have definitions
    if (stepDefs.length > 0) {
      await db.insert(journeySteps).values(
        stepDefs.map((s) => ({
          journeyId: journey.id,
          stepIndex: s.stepIndex,
          contentType: s.contentType,
          dayOffset: s.dayOffset,
          topicAngle: s.topicAngle ?? null,
          channel: s.channel ?? null,
          status: "pending" as const,
        }))
      );
    }

    // Reload with steps
    const steps = await db
      .select()
      .from(journeySteps)
      .where(eq(journeySteps.journeyId, journey.id))
      .orderBy(journeySteps.stepIndex);

    return NextResponse.json({ journey, steps }, { status: 201 });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[journeys POST]", err);
    return NextResponse.json({ error: "Failed to create journey" }, { status: err?.statusCode || 500 });
  }
}
