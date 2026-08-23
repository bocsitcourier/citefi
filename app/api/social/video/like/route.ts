import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { videoIdeas, campaigns } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireTeamMember } from "@/lib/api/auth";
import { validateExternalUrl } from "@/lib/url-validation";
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

const likeVideoSchema = z.object({
  // Optional explicit campaign link and/or a source idea to duplicate the
  // campaign linkage from. Both are strictly team-scoped when supplied.
  campaignId: z.string().optional(),
  sourceVideoIdeaId: z.number().int().positive().optional(),
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

    // Task #151 — resolve campaign linkage for the new "like" idea.
    // A duplicated idea canonically inherits its source idea's campaign; an
    // explicit reference is honoured but must not contradict the source.
    const explicitCampaignId = await resolveTeamCampaignId(teamId, data.campaignId);
    let resolvedCampaignId: number | null = explicitCampaignId;
    if (data.sourceVideoIdeaId != null) {
      const [sourceIdea] = await db
        .select({ campaignId: videoIdeas.campaignId })
        .from(videoIdeas)
        .where(
          and(
            eq(videoIdeas.id, data.sourceVideoIdeaId),
            eq(videoIdeas.teamId, teamId),
            isNull(videoIdeas.deletedAt)
          )
        )
        .limit(1);
      if (!sourceIdea) {
        return NextResponse.json(
          { error: "Source video idea not found or access denied" },
          { status: 404 }
        );
      }
      if (sourceIdea.campaignId != null) {
        if (explicitCampaignId != null && explicitCampaignId !== sourceIdea.campaignId) {
          return NextResponse.json(
            { error: "Supplied campaignId does not match the source video idea's campaign" },
            { status: 409 }
          );
        }
        resolvedCampaignId = sourceIdea.campaignId;
      }
    }

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
    if (error?.statusCode && error.statusCode < 500) {
      return NextResponse.json(
        { error: error.message || "Request rejected" },
        { status: error.statusCode }
      );
    }
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
