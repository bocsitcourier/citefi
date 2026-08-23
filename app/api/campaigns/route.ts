import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";
import {
  CAMPAIGN_GOALS,
  createOrReuseCampaign,
  linkBrandIntelligence,
  listCampaigns,
  markCampaignResearchQueued,
  type CampaignGoal,
  type CampaignResearchState,
} from "@/lib/campaign-service";
import {
  getClientBrandProfile,
  upsertClientBrandProfile,
} from "@/lib/client-brand-profile-service";
import { addIntelligenceResearchJob } from "@/lib/queue";

const locationSchema = z.object({
  label: z.string().min(1),
  region: z.string().optional(),
  country: z.string().optional(),
});

const assetBundleSchema = z.object({
  articles: z.number().int().min(0),
  socialPosts: z.number().int().min(0),
  videos: z.number().int().min(0),
});

const createSchema = z.object({
  requestId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  businessUrl: z.string().url(),
  companyName: z.string().min(1).max(255),
  goals: z.array(z.enum(CAMPAIGN_GOALS as unknown as [string, ...string[]])).min(1),
  locations: z.array(locationSchema).default([]),
  assetBundle: assetBundleSchema.optional(),
});

/**
 * GET /api/campaigns — list the team's campaigns with content counts.
 */
export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    const summaries = await listCampaigns(teamId);
    return NextResponse.json({
      success: true,
      campaigns: summaries.map(({ campaign, counts }) => ({
        ...campaign,
        counts,
      })),
    });
  } catch (err: any) {
    if (err.statusCode)
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("GET /api/campaigns error:", err);
    return NextResponse.json(
      { error: "Failed to list campaigns" },
      { status: err?.statusCode || 500 }
    );
  }
}

/**
 * POST /api/campaigns — idempotently create/reuse a campaign for the team.
 *
 * Composes: create/reuse (by team+requestId) → link current Brand Intelligence
 * → queue research only when needed → return the campaign plus research state.
 */
export async function POST(request: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const body = await request.json().catch(() => ({}));
    const parsed = createSchema.parse(body);

    const { campaign, reused } = await createOrReuseCampaign(teamId, userId, {
      requestId: parsed.requestId,
      name: parsed.name,
      businessUrl: parsed.businessUrl,
      companyName: parsed.companyName,
      goals: parsed.goals as CampaignGoal[],
      locations: parsed.locations,
      assetBundle: parsed.assetBundle,
    });

    // Link the current team's Brand Intelligence profile (if any).
    const link = await linkBrandIntelligence(teamId, campaign.id);

    // Queue research only when needed: no complete/running profile yet.
    let research: CampaignResearchState = {
      status: link.status,
      jobId: null,
      queued: false,
    };

    const needsResearch =
      link.status === "not_started" ||
      link.status === "pending" ||
      link.status === "failed";

    if (needsResearch) {
      const existing = await getClientBrandProfile(teamId);
      if (existing?.status === "running" && link.matched) {
        // Already running for the team — reflect that without re-queuing.
        research = { status: "running", jobId: null, queued: false };
        await markCampaignResearchQueued(teamId, campaign.id, null);
      } else {
        await upsertClientBrandProfile(
          teamId,
          parsed.businessUrl,
          parsed.companyName
        );
        const jobId = await addIntelligenceResearchJob({
          teamId,
          websiteUrl: parsed.businessUrl,
          companyName: parsed.companyName,
          campaignId: campaign.id,
        });
        await markCampaignResearchQueued(teamId, campaign.id, jobId ?? null);
        research = { status: "pending", jobId: jobId ?? null, queued: true };
      }
    }

    // Re-read the campaign so the response reflects the latest linked/queued state.
    const summaries = await listCampaigns(teamId);
    const current =
      summaries.find((s) => s.campaign.id === campaign.id)?.campaign ?? campaign;

    return NextResponse.json({
      success: true,
      reused,
      campaign: current,
      research,
    });
  } catch (err: any) {
    if (err.statusCode)
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    if (err.name === "ZodError")
      return NextResponse.json(
        { error: "Invalid input", details: err.errors },
        { status: 400 }
      );
    console.error("POST /api/campaigns error:", err);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: err?.statusCode || 500 }
    );
  }
}
