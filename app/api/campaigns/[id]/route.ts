import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";
import {
  CAMPAIGN_GOALS,
  CAMPAIGN_STATUSES,
  getCampaignByPublicId,
  getCampaignDetailByPublicId,
  updateCampaignPlan,
  type CampaignGoal,
  type CampaignPlanUpdate,
  type CampaignStatus,
} from "@/lib/campaign-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  goals: z
    .array(z.enum(CAMPAIGN_GOALS as unknown as [string, ...string[]]))
    .min(1)
    .optional(),
  locations: z.array(locationSchema).optional(),
  assetBundle: assetBundleSchema.optional(),
  status: z
    .enum(CAMPAIGN_STATUSES as unknown as [string, ...string[]])
    .optional(),
});

/**
 * GET /api/campaigns/[id] — campaign detail (public UUID), tenant-safe.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const detail = await getCampaignDetailByPublicId(teamId, id);
    if (!detail) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const { campaign, ...workspace } = detail;
    return NextResponse.json({
      success: true,
      campaign: { ...campaign, ...workspace },
    });
  } catch (err: any) {
    if (err.statusCode)
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("GET /api/campaigns/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to load campaign" },
      { status: err?.statusCode || 500 }
    );
  }
}

/**
 * PATCH /api/campaigns/[id] — update campaign plan (public UUID), tenant-safe.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.parse(body);

    // Resolve the internal id under the team predicate first (tenant-safe).
    const campaign = await getCampaignByPublicId(teamId, id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const update: CampaignPlanUpdate = {
      name: parsed.name,
      goals: parsed.goals as CampaignGoal[] | undefined,
      locations: parsed.locations,
      assetBundle: parsed.assetBundle,
      status: parsed.status as CampaignStatus | undefined,
    };

    const updated = await updateCampaignPlan(teamId, campaign.id, update);
    if (!updated) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const detail = await getCampaignDetailByPublicId(teamId, id);
    const workspace = detail
      ? (({ campaign: _campaign, ...rest }) => rest)(detail)
      : null;
    return NextResponse.json({
      success: true,
      campaign: detail ? { ...detail.campaign, ...workspace } : updated,
    });
  } catch (err: any) {
    if (err.statusCode)
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    if (err.name === "ZodError")
      return NextResponse.json(
        { error: "Invalid input", details: err.errors },
        { status: 400 }
      );
    console.error("PATCH /api/campaigns/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: err?.statusCode || 500 }
    );
  }
}
