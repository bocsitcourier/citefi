import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobBatches, jobEvents } from "@/shared/schema";
import { generateTitlePool, generateTitlePoolForMultipleCities, parseMultipleCities } from "@/lib/gemini";
import { eq, and } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const batchId = parseInt(id);
    
    if (isNaN(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID" },
        { status: 400 }
      );
    }

    // CRITICAL: Fetch batch filtered by team_id
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!batch) {
      return NextResponse.json(
        { error: "Batch not found or access denied" },
        { status: 404 }
      );
    }

    if (batch.status === "RUNNING") {
      return NextResponse.json(
        { error: "Cannot regenerate titles while batch is running" },
        { status: 400 }
      );
    }

    const generationParams = batch.generationParams as any || {};
    const tone = generationParams.tone;
    const geographicFocus = generationParams.geographicFocus;
    const audience = generationParams.audience;
    const numTitles = 50;

    if (!geographicFocus) {
      return NextResponse.json(
        { error: "Geographic focus is required. Please edit batch parameters first." },
        { status: 400 }
      );
    }

    const cities = parseMultipleCities(geographicFocus);
    const isMultiCity = cities.length > 1;

    console.log(`🔄 Regenerating titles for batch ${batchId}: "${batch.coreTopic}"`);
    if (isMultiCity) {
      console.log(`📍 Multi-city detected: ${cities.join(' | ')} (${cities.length} cities)`);
    }

    const startTime = Date.now();
    let titlePoolJson;
    let allTitles;
    let allKeywords;
    let strategy;

    if (isMultiCity) {
      const numTitlesPerCity = Math.ceil(numTitles / cities.length);
      const multiCityResult = await generateTitlePoolForMultipleCities(
        batch.coreTopic,
        batch.targetUrl,
        numTitlesPerCity,
        tone,
        geographicFocus,
        audience
      );

      titlePoolJson = {
        isMultiCity: true,
        cities: multiCityResult.cities,
        titles: multiCityResult.combinedTitles,
        primaryKeywords: multiCityResult.combinedKeywords,
        contentStrategy: `Multi-city strategy across ${cities.length} locations: ` + 
          multiCityResult.cities.map(c => c.contentStrategy).join(' | '),
      };

      allTitles = multiCityResult.combinedTitles;
      allKeywords = multiCityResult.combinedKeywords;
      strategy = titlePoolJson.contentStrategy;
    } else {
      const titlePoolResult = await generateTitlePool(
        batch.coreTopic,
        batch.targetUrl,
        numTitles,
        tone,
        geographicFocus,
        audience
      );

      titlePoolJson = {
        isMultiCity: false,
        titles: titlePoolResult.titles,
        primaryKeywords: titlePoolResult.primaryKeywords,
        contentStrategy: titlePoolResult.contentStrategy,
      };

      allTitles = titlePoolResult.titles;
      allKeywords = titlePoolResult.primaryKeywords;
      strategy = titlePoolResult.contentStrategy;
    }

    const duration = Date.now() - startTime;

    // CRITICAL: Update batch with team filter
    const [updatedBatch] = await db
      .update(jobBatches)
      .set({ titlePoolJson })
      .where(
        and(
          eq(jobBatches.id, batchId),
          eq(jobBatches.teamId, teamId) // CRITICAL TEAM FILTER ON UPDATE
        )
      )
      .returning();

    await db.insert(jobEvents).values({
      batchId,
      eventType: "TITLE_POOL_REGENERATED",
      stage: "GEMINI",
      message: `Regenerated ${allTitles.length} titles${isMultiCity ? ` across ${cities.length} cities` : ''}`,
      payloadJson: { 
        numTitles: allTitles.length, 
        isMultiCity,
        cities: isMultiCity ? cities : undefined
      },
      durationMs: duration,
      severity: "info",
    });

    console.log(`✅ Titles regenerated for batch ${batchId}${isMultiCity ? ` (${cities.length} cities, ${allTitles.length} total titles)` : ''}`);

    return NextResponse.json({
      success: true,
      batch: updatedBatch,
      isMultiCity,
      cities: isMultiCity ? cities : undefined,
      titles: allTitles,
      primaryKeywords: allKeywords,
      contentStrategy: strategy,
    });
  } catch (error) {
    console.error("❌ Title regeneration error:", error);
    
    await db.insert(jobEvents).values({
      batchId: parseInt((await context.params).id),
      eventType: "TITLE_POOL_REGENERATION_FAILED",
      stage: "GEMINI",
      message: `Failed to regenerate titles: ${error instanceof Error ? error.message : 'Unknown error'}`,
      severity: "error",
    });

    return NextResponse.json(
      { 
        error: "Failed to regenerate titles",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
