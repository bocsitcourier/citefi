import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas } from "@/shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { z } from "zod";

const createVideoIdeaSchema = z.object({
  ideaTitle: z.string().min(1, "Title is required").max(255),
  shortIdea: z.string().min(10, "Please provide more detail about your idea").max(2000),
  companyName: z.string().min(1, "Company name is required").max(255),
  targetAudience: z.string().max(255).optional(),
  website: z.string().url().optional().or(z.literal("")),
  callToAction: z.string().min(1).max(255).default("Get Started Today!"),
  companyLogoUrl: z.string().optional(),
  style: z.enum(["cinematic", "comedy", "emotional", "tech", "minimal", "retro", "luxury", "action"]).default("cinematic"),
  tone: z.enum(["professional", "playful", "inspirational", "urgent", "mysterious", "friendly"]).default("professional"),
});

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const body = await request.json();
    
    const validationResult = createVideoIdeaSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validationResult.error.flatten() },
        { status: 400 }
      );
    }
    
    const data = validationResult.data;
    
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
      style: data.style,
      tone: data.tone,
      status: "DRAFT",
      progress: 0,
    }).returning();
    const newIdea = newIdeaRow!;
    
    console.log(`✅ Video idea created: ${newIdea.publicId} - "${data.ideaTitle}"`);
    
    return NextResponse.json({
      success: true,
      videoIdea: {
        id: newIdea.id,
        publicId: newIdea.publicId,
        ideaTitle: newIdea.ideaTitle,
        style: newIdea.style,
        tone: newIdea.tone,
        status: newIdea.status,
        createdAt: newIdea.createdAt,
      }
    });
    
  } catch (error: any) {
    console.error("Error creating video idea:", error);
    return NextResponse.json(
      { error: "Failed to create video idea" },
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
      createdAt: videoIdeas.createdAt,
      generatedAt: videoIdeas.generatedAt,
    })
    .from(videoIdeas)
    .where(and(
      eq(videoIdeas.teamId, teamId),
      isNull(videoIdeas.deletedAt)
    ))
    .orderBy(desc(videoIdeas.createdAt))
    .limit(50);
    
    return NextResponse.json({ ideas });
    
  } catch (error: any) {
    console.error("Error fetching video ideas:", error);
    return NextResponse.json(
      { error: "Failed to fetch video ideas" },
      { status: error?.statusCode || 500 }
    );
  }
}
