import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { journeys, journeySteps, journeyTemplates, jobBatches, articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/batches/[id]/launch-journey
 *
 * Creates a Local SEO Journey from the batch's top completed article and immediately
 * triggers it. This is the "Launch Journey" one-click flow from completed batch pages.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { teamId } = await requireTeamMember(req);
    const batchId = parseInt(id);
    if (isNaN(batchId)) return NextResponse.json({ error: "Invalid batch id" }, { status: 400 });

    // Validate batch ownership
    const [batch] = await db
      .select({ id: jobBatches.id, coreTopic: jobBatches.coreTopic, status: jobBatches.status, teamId: jobBatches.teamId })
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)))
      .limit(1);

    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

    // Find the top completed article (use first COMPLETE one)
    const [topArticle] = await db
      .select({ id: articles.id, chosenTitle: articles.chosenTitle })
      .from(articles)
      .where(and(eq(articles.batchId, batchId), eq(articles.articleStatus, "COMPLETE"), eq(articles.teamId, teamId)))
      .limit(1);

    if (!topArticle) {
      return NextResponse.json({ error: "No completed articles found in this batch" }, { status: 422 });
    }

    // Find the local_seo builtin template
    const [template] = await db
      .select()
      .from(journeyTemplates)
      .where(and(eq(journeyTemplates.templateType, "local_seo"), eq(journeyTemplates.isBuiltin, true)))
      .limit(1);

    if (!template) {
      return NextResponse.json({ error: "Local SEO template not found" }, { status: 500 });
    }

    const stepsConfig = template.stepsConfig as Array<{
      stepIndex: number;
      contentType: string;
      dayOffset: number;
      topicAngle: string;
      channel?: string;
    }>;

    // Create the journey
    const journeyName = `Local SEO: ${batch.coreTopic.slice(0, 80)}`;
    const [journey] = await db
      .insert(journeys)
      .values({
        teamId,
        name: journeyName,
        templateType: template.templateType,
        templateId: template.id,
        triggerType: "manual",
        status: "draft",
        terminalKpi: "conversion",
        triggerArticleId: topArticle.id,
      })
      .returning();

    // Create steps from template config
    for (const stepDef of stepsConfig) {
      await db.insert(journeySteps).values({
        journeyId: journey.id,
        stepIndex: stepDef.stepIndex,
        contentType: stepDef.contentType,
        dayOffset: stepDef.dayOffset,
        topicAngle: stepDef.topicAngle ?? null,
        channel: stepDef.channel ?? null,
        status: "pending",
      });
    }

    // Immediately trigger the journey with the top article
    const now = new Date();
    const steps = await db.select().from(journeySteps).where(eq(journeySteps.journeyId, journey.id));
    for (const step of steps) {
      const scheduledFor = new Date(now.getTime() + step.dayOffset * 24 * 60 * 60 * 1000);
      await db.update(journeySteps).set({ scheduledFor, status: "pending" }).where(eq(journeySteps.id, step.id));
    }

    const [activatedJourney] = await db
      .update(journeys)
      .set({ status: "active", triggeredAt: now })
      .where(eq(journeys.id, journey.id))
      .returning();

    return NextResponse.json({
      journey: activatedJourney,
      triggerArticle: { id: topArticle.id, title: topArticle.chosenTitle },
      message: `Journey "${journeyName}" created and activated with ${steps.length} steps.`,
    }, { status: 201 });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403)
      return NextResponse.json({ error: err.message }, { status });
    console.error("[batches/[id]/launch-journey POST]", err);
    return NextResponse.json({ error: "Failed to launch journey" }, { status: err?.statusCode || 500 });
  }
}
