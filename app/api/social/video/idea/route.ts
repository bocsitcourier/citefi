import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas, campaigns } from "@/shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { z } from "zod";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Task #151 — resolve an optional caller-supplied campaign reference (public UUID
 * or numeric ID) to a canonical numeric campaign id under the authenticated team.
 * Returns null when no reference is supplied; throws a 404-tagged error when the
 * reference is inaccessible / cross-team (never silently dropped).
 */
async function resolveTeamCampaignId(
  teamId: number,
  ref: string | undefined | null
): Promise<number | null> {
  if (ref == null || ref === "") return null;
  const where = UUID_RE.test(ref)
    ? and(eq(campaigns.publicId, ref), eq(campaigns.teamId, teamId), isNull(campaigns.deletedAt))
    : /^\d+$/.test(ref)
      ? and(eq(campaigns.id, parseInt(ref, 10)), eq(campaigns.teamId, teamId), isNull(campaigns.deletedAt))
      : null;
  if (!where) {
    const err: any = new Error("Campaign not found or access denied");
    err.statusCode = 404;
    throw err;
  }
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(where)
    .limit(1);
  if (!campaign) {
    const err: any = new Error("Campaign not found or access denied");
    err.statusCode = 404;
    throw err;
  }
  return campaign.id;
}

const createVideoIdeaSchema = z.object({
  campaignId: z.string().optional(),
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

    // Task #151 — link the idea to an explicit team-owned campaign when supplied.
    const resolvedCampaignId = await resolveTeamCampaignId(teamId, data.campaignId);

    const [newIdeaRow] = await db.insert(videoIdeas).values({
      userId,
      teamId,
      campaignId: resolvedCampaignId,
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
    if (error?.statusCode && error.statusCode < 500) {
      return NextResponse.json(
        { error: error.message || "Request rejected" },
        { status: error.statusCode }
      );
    }
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
