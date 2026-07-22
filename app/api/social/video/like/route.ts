import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { validateExternalUrl } from "@/lib/url-validation";
import { z } from "zod";

const likeVideoSchema = z.object({
  referenceVideoUrl: z.string().url("Must be a valid video URL"),
  ideaTitle: z.string().min(1, "Title is required").max(255),
  shortIdea: z.string().min(5, "Describe what you want in the video").max(2000),
  companyName: z.string().min(1, "Company name is required").max(255),
  targetAudience: z.string().max(255).optional(),
  website: z.string().url().optional().or(z.literal("")),
  callToAction: z.string().min(1).max(255).default("Get Started Today!"),
  companyLogoUrl: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();

    const validationResult = likeVideoSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    try {
      validateExternalUrl(data.referenceVideoUrl);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Invalid video URL" },
        { status: 400 }
      );
    }

    const [newIdeaRow] = await db.insert(videoIdeas).values({
      userId,
      teamId,
      ideaTitle: data.ideaTitle,
      shortIdea: data.shortIdea,
      companyName: data.companyName,
      targetAudience: data.targetAudience || null,
      website: data.website || null,
      callToAction: data.callToAction,
      companyLogoUrl: data.companyLogoUrl || null,
      style: "cinematic",
      tone: "professional",
      status: "DRAFT",
      progress: 0,
      isLikeVideo: true,
      referenceVideoUrl: data.referenceVideoUrl,
    }).returning();
    const newIdea = newIdeaRow!;

    console.log(`✅ Like Video idea created: ${newIdea.publicId} - "${data.ideaTitle}" (ref: ${data.referenceVideoUrl.slice(0, 60)}...)`);

    return NextResponse.json({
      success: true,
      videoIdea: {
        id: newIdea.id,
        publicId: newIdea.publicId,
        ideaTitle: newIdea.ideaTitle,
        status: newIdea.status,
        isLikeVideo: true,
        referenceVideoUrl: newIdea.referenceVideoUrl,
        createdAt: newIdea.createdAt,
      }
    });

  } catch (error: any) {
    console.error("Error creating like video idea:", error);
    return NextResponse.json(
      { error: "Failed to create like video idea" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const ideas = await db.select({
      id: videoIdeas.id,
      publicId: videoIdeas.publicId,
      ideaTitle: videoIdeas.ideaTitle,
      shortIdea: videoIdeas.shortIdea,
      companyName: videoIdeas.companyName,
      style: videoIdeas.style,
      tone: videoIdeas.tone,
      status: videoIdeas.status,
      progress: videoIdeas.progress,
      currentStage: videoIdeas.currentStage,
      videoUrl: videoIdeas.videoUrl,
      thumbnailUrl: videoIdeas.thumbnailUrl,
      isLikeVideo: videoIdeas.isLikeVideo,
      referenceVideoUrl: videoIdeas.referenceVideoUrl,
      stylePrompt: videoIdeas.stylePrompt,
      createdAt: videoIdeas.createdAt,
      generatedAt: videoIdeas.generatedAt,
    })
    .from(videoIdeas)
    .where(and(
      eq(videoIdeas.teamId, teamId),
      eq(videoIdeas.isLikeVideo, true),
      isNull(videoIdeas.deletedAt)
    ))
    .orderBy(desc(videoIdeas.createdAt))
    .limit(50);

    return NextResponse.json({ ideas });

  } catch (error: any) {
    console.error("Error fetching like video ideas:", error);
    return NextResponse.json(
      { error: "Failed to fetch like video ideas" },
      { status: error?.statusCode || 500 }
    );
  }
}
