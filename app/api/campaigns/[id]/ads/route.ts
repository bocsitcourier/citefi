import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";
import { debitReservation, releaseReservation, reserveCredits } from "@/lib/billing";
import { getCampaignByPublicId } from "@/lib/campaign-service";
import { createCampaignAdPack, getCampaignAdByRequestKey, listCampaignAdApprovals, listCampaignAds } from "@/lib/campaign-ads-service";
import { EXTERNAL_PLATFORM_APPROVALS } from "@/lib/launch-governance";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const createSchema = z.object({
  requestKey: z.string().min(8).max(255),
  landingUrl: z.string().url().max(2048),
  brief: z.string().max(4000).optional(),
  approveUtmOverwrite: z.boolean().optional().default(false),
});

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    const campaign = await getCampaignByPublicId(teamId, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const ads = await listCampaignAds(teamId, campaign.id);
    const approvals = await listCampaignAdApprovals(teamId, campaign.id);
    return NextResponse.json({
      success: true, ads, approvals,
      readiness: {
        brandConfirmed: campaign.brandStatus === "confirmed" && Boolean(campaign.brandConfirmedAt),
        generationReady: campaign.brandStatus === "confirmed" && Boolean(campaign.brandConfirmedAt),
      },
      mode: "export_only", directPublishing: false,
      platformApprovals: {
        google: EXTERNAL_PLATFORM_APPROVALS.googleAds.status,
        meta: EXTERNAL_PLATFORM_APPROVALS.metaAds.status,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to list ads" }, { status: err.statusCode ?? 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let reservation: { teamId: number; userId: number; runId: string } | null = null;
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    const input = createSchema.parse(await request.json());
    const campaign = await getCampaignByPublicId(teamId, id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const existing = await getCampaignAdByRequestKey(teamId, campaign.id, input.requestKey);
    const runId = `ads:${campaign.id}:${input.requestKey}`;
    if (existing) {
      const settled = await debitReservation({ teamId, userId, runId });
      if (!settled.ok) return NextResponse.json({
        error: "Ad pack exists but credit settlement is still pending. Retry this request before export.",
      }, { status: 503 });
      return NextResponse.json({ success: true, reused: true, ad: existing });
    }
    reservation = { teamId, userId, runId };
    const held = await reserveCredits({ teamId, userId, runId, operationType: "ads_export_pack" });
    if (!held.ok) return NextResponse.json({
      error: "Insufficient credits", requiredCredits: held.requiredCredits,
      availableCredits: held.totalRemaining, upgradeUrl: "/settings/billing",
    }, { status: 402 });
    const ad = await createCampaignAdPack(teamId, userId, campaign.id, input);
    if (!ad) throw new Error("Campaign not found");
    // Provider work is now persisted. From this point the reservation must never
    // be released: a failed debit is retried idempotently with the same request key.
    reservation = null;
    const debited = await debitReservation({ teamId, userId, runId });
    if (!debited.ok) return NextResponse.json({
      error: "Ad pack was generated but credit settlement is pending. Retry this request before export.",
    }, { status: 503 });
    return NextResponse.json({ success: true, reused: false, ad }, { status: 201 });
  } catch (err: any) {
    if (reservation) await releaseReservation({ ...reservation, reason: "ads_export_pack_failed" }).catch(() => undefined);
    if (err.name === "ZodError") return NextResponse.json({ error: "Invalid input", details: err.errors }, { status: 400 });
    const clientError = /required|invalid|must|domain|HTTPS|UTM|confirmed|align/i.test(err.message ?? "");
    return NextResponse.json({ error: err.message ?? "Failed to generate ad pack" }, { status: err.statusCode ?? (clientError ? 400 : 500) });
  }
}