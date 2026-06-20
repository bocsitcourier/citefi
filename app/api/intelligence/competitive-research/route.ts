import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { z } from "zod";
import { competitiveIntelligenceService, type ContentTypeCI } from "@/lib/competitive-intelligence-service";
import { LearningService } from "@/lib/learning-service";

const bodySchema = z.object({
  topic: z.string().min(1),
  industry: z.string().min(1),
  location: z.string().optional(),
  contentType: z.enum(["social", "video", "podcast"]),
});

/**
 * POST /api/intelligence/competitive-research
 *
 * Runs the full competitive research + extraction + gap-analysis pipeline,
 * seeds external patterns into the learning system, and returns the gap
 * analysis summary and seeding stats.
 *
 * Body: { topic, industry, location?, contentType }
 */
export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.parse(body);

    const { topic, industry, location, contentType } = parsed;

    console.log(`[CI Route] Starting competitive research: topic="${topic}" industry="${industry}" contentType=${contentType} teamId=${teamId}`);

    // Phase 1: Research niche performance
    const research = await competitiveIntelligenceService.researchNichePerformance(
      topic,
      industry,
      location,
      contentType as ContentTypeCI
    );

    // Phase 2 & 3: Extract patterns + gap analysis in parallel
    const [patterns, gaps] = await Promise.all([
      competitiveIntelligenceService.extractTransferablePatterns(research, contentType as ContentTypeCI),
      competitiveIntelligenceService.performGapAnalysis(research, topic, industry),
    ]);

    // Phase 4: Seed external patterns into learning system
    const learningService = LearningService.getInstance();
    const seedResult = await learningService.seedExternalPatterns(teamId, contentType, patterns);

    // Build prompt context summary (for UI display)
    const intelContext = competitiveIntelligenceService.buildPromptContext(patterns, gaps, contentType as ContentTypeCI);

    console.log(`[CI Route] Done: ${seedResult.seeded} patterns seeded, ${gaps.length} gaps found`);

    return NextResponse.json({
      success: true,
      topPerformersFound: research.topPerformers.length,
      searchesPerformed: research.searchesPerformed,
      patternsExtracted: patterns.length,
      patternsSeeded: seedResult.seeded,
      patternsSkipped: seedResult.skipped,
      gaps,
      intelContext,
    });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    if (err.name === "ZodError") return NextResponse.json({ error: "Invalid input", details: err.errors }, { status: 400 });
    console.error("POST /api/intelligence/competitive-research error:", err);
    return NextResponse.json({ error: "Competitive research failed" }, { status: 500 });
  }
}
