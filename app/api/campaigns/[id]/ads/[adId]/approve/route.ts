import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireClientReviewer } from "@/lib/api/auth";
import {
  getCampaignByPublicId,
  getCampaignForClientApprovalByPublicId,
} from "@/lib/campaign-service";
import { approveCampaignAd } from "@/lib/campaign-ads-service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  approvalType: z.enum(["client", "policy", "export"]),
  decision: z.enum(["approved", "rejected"]),
  humanAcknowledged: z.literal(true),
  acknowledgementText: z.string().min(3).max(2000),
});

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; adId: string }> }) {
  try {
    const { teamId: authTeamId, userId, role } = await requireClientReviewer(request);
    const { id, adId } = await context.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(adId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    const input = schema.parse(await request.json());
    const campaign = input.approvalType === "client"
      ? await getCampaignForClientApprovalByPublicId(authTeamId, id)
      : await getCampaignByPublicId(authTeamId, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const ad = await approveCampaignAd(campaign.teamId, userId, role, campaign.id, adId, input);
    if (!ad) return NextResponse.json({ error: "Ad pack not found" }, { status: 404 });
    return NextResponse.json({ success: true, ad, mode: "export_only", directPublishing: false });
  } catch (err: any) {
    if (err.name === "ZodError") return NextResponse.json({ error: "Invalid input", details: err.errors }, { status: 400 });
    const forbidden = /owner or admin|designated approver|compliance authorization|client team relationship|approval separation/i.test(err.message ?? "");
    const conflict = /before export|acknowledgement/i.test(err.message ?? "");
    return NextResponse.json({ error: err.message ?? "Approval failed" }, { status: err.statusCode ?? (forbidden ? 403 : conflict ? 409 : 500) });
  }
}