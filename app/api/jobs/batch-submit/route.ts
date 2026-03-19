import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jobBatches, articles } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { addBatchGenerationJob } from "@/lib/queue";
import { requireTeamMember } from "@/lib/api/auth";

const batchSubmitSchema = z.object({
  batchId: z.number(),
  selectedTitles: z.array(z.string()).min(1).max(100),
  targetUrl: z.string().url(),
  tone: z.string().optional(),
  wordCountMin: z.number().min(500).max(5000).default(800),
  wordCountMax: z.number().min(500).max(5000).default(2000),
  geographicFocus: z.string().optional(),
  audience: z.string().optional(),
  // NAP Data - businessName is REQUIRED to prevent AI hallucination in images/text
  businessName: z.string().transform(str => str.trim()).pipe(z.string().min(1, "Business name is required to ensure brand consistency")),
  businessAddress: z.string().optional(),
  businessPhone: z.string().optional(),
  // Accept both absolute URLs and relative paths (e.g., /api/public-objects/...)
  companyLogoUrl: z.string().optional().transform(val => val === "" ? undefined : val).refine(
    (val) => !val || val.startsWith('/') || val.startsWith('http://') || val.startsWith('https://'),
    { message: "Must be a valid URL or relative path" }
  ).optional(),
  // Advanced features
  competitorUrls: z.array(z.string().url()).max(5).optional(),
  semanticClusterId: z.number().optional(),
  serpFeatureTarget: z.enum(['Featured Snippet', 'PAA', 'List', 'Q&A']).optional(),
  // Auto-publishing
  autoPublishEnabled: z.boolean().optional().default(false),
  autoPublishConnectionIds: z.array(z.number()).optional(),
  // Psychographic targeting
  personaId: z.number().optional(),
}).refine((data) => data.wordCountMin <= data.wordCountMax, {
  message: "Minimum word count must be less than or equal to maximum word count",
  path: ["wordCountMin"],
});

export async function POST(request: NextRequest) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const validatedData = batchSubmitSchema.parse(body);

    const { 
      batchId, 
      selectedTitles, 
      targetUrl, 
      tone, 
      wordCountMin, 
      wordCountMax, 
      geographicFocus, 
      audience,
      // NAP Data
      businessName,
      businessAddress,
      businessPhone,
      companyLogoUrl,
      // Advanced features
      competitorUrls,
      semanticClusterId,
      serpFeatureTarget,
      // Auto-publishing
      autoPublishEnabled,
      autoPublishConnectionIds,
      // Psychographic targeting
      personaId,
    } = validatedData;

    // CRITICAL: Verify batch belongs to user's team
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

    if (batch.status !== "PENDING") {
      return NextResponse.json(
        { error: "Batch already submitted or completed" },
        { status: 400 }
      );
    }

    console.log(`📦 Submitting batch ${batchId} with ${selectedTitles.length} articles`);

    // CRITICAL: Merge with existing generationParams to preserve redditResearchCache
    const existingParams = batch.generationParams as Record<string, any> || {};
    const mergedParams = {
      ...existingParams, // Preserve existing data (especially redditResearchCache)
      tone, 
      wordCountMin, 
      wordCountMax, 
      geographicFocus, 
      audience,
    };

    await db
      .update(jobBatches)
      .set({
        generationParams: mergedParams,
        businessName: businessName,
        businessAddress: businessAddress || null,
        businessPhone: businessPhone || null,
        companyLogoUrl: companyLogoUrl || null,
        autoPublishEnabled: autoPublishEnabled ? 1 : 0,
        autoPublishConnectionIds: autoPublishConnectionIds && autoPublishConnectionIds.length > 0 
          ? autoPublishConnectionIds 
          : null,
        personaId: personaId || null,
      })
      .where(eq(jobBatches.id, batchId));

    const jobId = await addBatchGenerationJob({
      batchId,
      userId: batch.userId,
      teamId, // CRITICAL: Pass teamId for article creation
      selectedTitles,
      targetUrl,
      tone,
      wordCountMin,
      wordCountMax,
      geographicFocus,
      audience,
      businessName,
      companyLogoUrl,
      // Advanced features
      competitorUrls,
      semanticClusterId,
      serpFeatureTarget,
      personaId,
    });

    // CRITICAL: Verify job was actually queued
    if (!jobId) {
      console.error(`❌ Batch ${batchId} submission failed - job not queued`);
      return NextResponse.json(
        { error: "Failed to queue batch generation job. Please try again." },
        { status: 500 }
      );
    }

    console.log(`✅ Batch ${batchId} submitted successfully with job ID: ${jobId}`);

    return NextResponse.json({
      success: true,
      batchId,
      jobId,
      articlesQueued: selectedTitles.length,
      message: `Batch submitted successfully. ${selectedTitles.length} articles will be generated.`,
    });
  } catch (error) {
    console.error("Batch submission error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to submit batch", message: String(error) },
      { status: 500 }
    );
  }
}
