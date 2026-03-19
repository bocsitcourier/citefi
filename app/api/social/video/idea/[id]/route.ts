import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(
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
    
    return NextResponse.json({
      idea: {
        id: idea.id,
        publicId: idea.publicId,
        ideaTitle: idea.ideaTitle,
        shortIdea: idea.shortIdea,
        companyName: idea.companyName,
        targetAudience: idea.targetAudience,
        website: idea.website,
        callToAction: idea.callToAction,
        companyLogoUrl: idea.companyLogoUrl,
        style: idea.style,
        tone: idea.tone,
        expandedConcept: idea.expandedConceptJson,
        script: idea.scriptJson,
        status: idea.status,
        progress: idea.progress,
        currentStage: idea.currentStage,
        errorMessage: idea.errorMessage,
        videoUrl: idea.videoUrl,
        thumbnailUrl: idea.thumbnailUrl,
        videoDuration: idea.videoDuration,
        videoResolution: idea.videoResolution,
        createdAt: idea.createdAt,
        updatedAt: idea.updatedAt,
        generatedAt: idea.generatedAt,
      }
    });
    
  } catch (error) {
    console.error("Error fetching video idea:", error);
    return NextResponse.json(
      { error: "Failed to fetch video idea" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
    
    await db.update(videoIdeas)
      .set({ deletedAt: new Date() })
      .where(eq(videoIdeas.id, ideaId));
    
    console.log(`🗑️ Video idea soft deleted: ${idea.publicId}`);
    
    return NextResponse.json({ success: true });
    
  } catch (error) {
    console.error("Error deleting video idea:", error);
    return NextResponse.json(
      { error: "Failed to delete video idea" },
      { status: 500 }
    );
  }
}
