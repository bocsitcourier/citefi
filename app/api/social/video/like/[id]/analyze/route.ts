import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { analyzeVideoStyle } from "@/lib/video-style-analyzer";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;

    const ideaId = parseInt(id, 10);
    if (isNaN(ideaId)) {
      return NextResponse.json({ error: "Invalid idea ID" }, { status: 400 });
    }

    const [idea] = await db.select()
      .from(videoIdeas)
      .where(and(
        eq(videoIdeas.id, ideaId),
        eq(videoIdeas.teamId, teamId),
        isNull(videoIdeas.deletedAt)
      ))
      .limit(1);

    if (!idea) {
      return NextResponse.json({ error: "Video idea not found" }, { status: 404 });
    }

    if (!idea.referenceVideoUrl) {
      return NextResponse.json(
        { error: "No reference video URL found for this idea" },
        { status: 400 }
      );
    }

    await db.update(videoIdeas)
      .set({
        status: "ANALYZING",
        progress: 5,
        currentStage: "analyze_reference",
        updatedAt: new Date(),
      })
      .where(eq(videoIdeas.id, ideaId));

    console.log(`🔍 Starting video style analysis for idea ${ideaId}: ${idea.referenceVideoUrl.slice(0, 60)}...`);

    const analysis = await analyzeVideoStyle(idea.referenceVideoUrl, true);

    const inferredStyle = inferStyleFromAnalysis(analysis.mood);
    const inferredTone = inferToneFromAnalysis(analysis.mood);

    await db.update(videoIdeas)
      .set({
        referenceAnalysisJson: analysis as any,
        stylePrompt: analysis.stylePrompt,
        style: inferredStyle,
        tone: inferredTone,
        status: "ANALYZED",
        progress: 20,
        currentStage: "analysis_complete",
        updatedAt: new Date(),
      })
      .where(eq(videoIdeas.id, ideaId));

    console.log(`✅ Video style analysis complete for idea ${ideaId}`);

    return NextResponse.json({
      success: true,
      analysis: {
        duration: analysis.duration,
        resolution: analysis.resolution,
        pacing: analysis.pacing,
        sceneCount: analysis.sceneCount,
        avgShotDuration: analysis.avgShotDuration,
        mood: analysis.mood,
        colorPalette: analysis.colorPalette,
        cameraWork: analysis.cameraWork,
        editingStyle: analysis.editingStyle,
        styleDescription: analysis.styleDescription,
        stylePrompt: analysis.stylePrompt,
      },
      inferredStyle,
      inferredTone,
    });

  } catch (error: any) {
    console.error("Error analyzing reference video:", error);

    try {
      const { id } = await params;
      const ideaId = parseInt(id, 10);
      if (!isNaN(ideaId)) {
        await db.update(videoIdeas)
          .set({
            status: "FAILED",
            progress: 0,
            errorMessage: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
            updatedAt: new Date(),
          })
          .where(eq(videoIdeas.id, ideaId));
      }
    } catch {}

    return NextResponse.json(
      { error: `Failed to analyze video: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: error?.statusCode || 500 }
    );
  }
}

function inferStyleFromAnalysis(mood: string): string {
  const moodLower = mood.toLowerCase();
  if (moodLower.includes("cinematic") || moodLower.includes("dramatic")) return "cinematic";
  if (moodLower.includes("funny") || moodLower.includes("humor") || moodLower.includes("comedy")) return "comedy";
  if (moodLower.includes("emotional") || moodLower.includes("warm") || moodLower.includes("heartfelt")) return "emotional";
  if (moodLower.includes("tech") || moodLower.includes("modern") || moodLower.includes("digital")) return "tech";
  if (moodLower.includes("minimal") || moodLower.includes("clean") || moodLower.includes("simple")) return "minimal";
  if (moodLower.includes("retro") || moodLower.includes("vintage") || moodLower.includes("nostalgic")) return "retro";
  if (moodLower.includes("luxury") || moodLower.includes("elegant") || moodLower.includes("premium")) return "luxury";
  if (moodLower.includes("action") || moodLower.includes("energetic") || moodLower.includes("fast")) return "action";
  return "cinematic";
}

function inferToneFromAnalysis(mood: string): string {
  const moodLower = mood.toLowerCase();
  if (moodLower.includes("professional") || moodLower.includes("corporate")) return "professional";
  if (moodLower.includes("playful") || moodLower.includes("fun") || moodLower.includes("light")) return "playful";
  if (moodLower.includes("inspirational") || moodLower.includes("uplifting") || moodLower.includes("motivat")) return "inspirational";
  if (moodLower.includes("urgent") || moodLower.includes("intense") || moodLower.includes("bold")) return "urgent";
  if (moodLower.includes("mysterious") || moodLower.includes("dark") || moodLower.includes("moody")) return "mysterious";
  if (moodLower.includes("friendly") || moodLower.includes("warm") || moodLower.includes("inviting")) return "friendly";
  return "professional";
}
