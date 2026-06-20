import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { getPgBoss } from "@/lib/queue";

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

    if (!idea.stylePrompt) {
      return NextResponse.json(
        { error: "Video must be analyzed first before generation. Run the analyze step first." },
        { status: 400 }
      );
    }

    if (!idea.companyName) {
      return NextResponse.json(
        { error: "Company name is required for video generation" },
        { status: 400 }
      );
    }

    const activeStatuses = ["EXPANDING", "SCRIPTING", "GENERATING", "STITCHING"];
    if (activeStatuses.includes(idea.status)) {
      return NextResponse.json({
        success: true,
        message: "Video generation already in progress",
        alreadyQueued: true,
        ideaId: idea.id,
        currentStage: idea.currentStage,
        currentProgress: idea.progress,
      });
    }

    console.log(`🎬 Queueing Like Video generation for ID ${ideaId}: "${idea.ideaTitle}"`);

    await db.update(videoIdeas)
      .set({
        status: "EXPANDING",
        progress: 0,
        currentStage: "queued",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(videoIdeas.id, ideaId));

    const queue = await getPgBoss();

    const jobId = await queue.send(
      "video-idea-generation",
      { videoIdeaId: ideaId },
      {
        retryLimit: 0, // No retries - each attempt costs money
        retryDelay: 0,
        expireInSeconds: 5400,
      }
    );

    if (!jobId) {
      await db.update(videoIdeas)
        .set({
          status: "FAILED",
          progress: 0,
          errorMessage: "Failed to queue job - please try again",
        })
        .where(eq(videoIdeas.id, ideaId));

      return NextResponse.json(
        { error: "Failed to queue video generation job" },
        { status: 500 }
      );
    }

    await db.update(videoIdeas)
      .set({ jobId })
      .where(eq(videoIdeas.id, ideaId));

    console.log(`✅ Like Video generation job queued: ${jobId}`);

    return NextResponse.json({
      success: true,
      jobId,
      ideaId: idea.id,
      message: "Like Video generation started. The style from your reference video will be applied.",
      estimatedTime: "60-80 minutes",
    });

  } catch (error: any) {
    console.error("Error starting like video generation:", error);
    return NextResponse.json(
      { error: "Failed to start like video generation" },
      { status: error?.statusCode || 500 }
    );
  }
}
