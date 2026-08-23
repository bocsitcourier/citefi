import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { upsertClientBrandProfile, getClientBrandProfile } from "@/lib/client-brand-profile-service";
import { addIntelligenceResearchJob } from "@/lib/queue";
import { z } from "zod";

const runSchema = z.object({
  websiteUrl: z.string().url("Must be a valid URL"),
  companyName: z.string().min(1, "Company name is required").max(255),
  /** Set to true to force a re-run even if one is already running */
  force: z.boolean().optional().default(false),
  /** Optional campaign to sync research status back onto after completion. */
  campaignId: z.number().int().positive().optional(),
});

/**
 * POST /api/intelligence/run
 * Idempotent: if a run is already in progress, returns 200 with alreadyRunning:true
 * unless force:true is passed. Returns jobId on enqueue.
 */
export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const { websiteUrl, companyName, force, campaignId } = runSchema.parse(body);

    // Verify the optional campaign belongs to this team before threading its id
    // into the job — never trust a caller-supplied campaignId cross-tenant.
    let canonicalCampaignId: number | null = null;
    if (campaignId != null) {
      const { db } = await import("@/lib/db");
      const { campaigns } = await import("@/shared/schema");
      const { and, eq, isNull } = await import("drizzle-orm");
      const [row] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, campaignId),
            eq(campaigns.teamId, teamId),
            isNull(campaigns.deletedAt)
          )
        )
        .limit(1);
      canonicalCampaignId = row?.id ?? null;
    }

    // Idempotency guard — don't queue a second concurrent run
    const existing = await getClientBrandProfile(teamId);
    if (existing?.status === "running" && !force) {
      return NextResponse.json({
        success: true,
        alreadyRunning: true,
        status: "running",
        progressStep: existing.progressStep,
        message: "Brand intelligence research is already in progress.",
      });
    }

    await upsertClientBrandProfile(teamId, websiteUrl, companyName);
    const jobId = await addIntelligenceResearchJob({
      teamId,
      websiteUrl,
      companyName,
      campaignId: canonicalCampaignId,
    });

    // Reflect the queued state onto the linked campaign (tenant-safe).
    if (canonicalCampaignId != null) {
      const { markCampaignResearchQueued } = await import("@/lib/campaign-service");
      await markCampaignResearchQueued(teamId, canonicalCampaignId, jobId).catch(
        (e) => console.warn("[intelligence/run] campaign sync failed:", e)
      );
    }

    return NextResponse.json({ success: true, jobId, message: "Brand intelligence research started" });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    if (err.name === "ZodError") return NextResponse.json({ error: "Invalid input", details: err.errors }, { status: 400 });
    console.error("POST /api/intelligence/run error:", err);
    return NextResponse.json({ error: "Failed to start research" }, { status: err?.statusCode || 500 });
  }
}
