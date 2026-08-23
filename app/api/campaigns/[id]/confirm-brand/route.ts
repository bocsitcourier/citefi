import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import {
  confirmBrandSnapshot,
  getCampaignByPublicId,
  getCampaignDetailByPublicId,
} from "@/lib/campaign-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/campaigns/[id]/confirm-brand — freeze the current Brand
 * Intelligence snapshot onto the campaign (public UUID), tenant-safe.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const campaign = await getCampaignByPublicId(teamId, id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const result = await confirmBrandSnapshot(teamId, campaign.id);
    if (!result.ok) {
      if (result.reason === "research_incomplete") {
        return NextResponse.json(
          {
            error: "Brand Intelligence research is not complete yet.",
            reason: result.reason,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const detail = await getCampaignDetailByPublicId(teamId, id);
    if (!detail) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const { campaign: confirmedCampaign, ...workspace } = detail;
    return NextResponse.json({
      success: true,
      campaign: { ...confirmedCampaign, ...workspace },
    });
  } catch (err: any) {
    if (err.statusCode)
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("POST /api/campaigns/[id]/confirm-brand error:", err);
    return NextResponse.json(
      { error: "Failed to confirm brand snapshot" },
      { status: err?.statusCode || 500 }
    );
  }
}
