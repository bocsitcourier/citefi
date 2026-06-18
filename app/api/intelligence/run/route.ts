import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { upsertClientBrandProfile } from "@/lib/client-brand-profile-service";
import { addIntelligenceResearchJob } from "@/lib/queue";
import { z } from "zod";

const runSchema = z.object({
  websiteUrl: z.string().url("Must be a valid URL"),
  companyName: z.string().min(1, "Company name is required").max(255),
});

/** POST /api/intelligence/run — upsert profile row + enqueue background research job */
export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const { websiteUrl, companyName } = runSchema.parse(body);

    await upsertClientBrandProfile(teamId, websiteUrl, companyName);
    await addIntelligenceResearchJob({ teamId, websiteUrl, companyName });

    return NextResponse.json({ success: true, message: "Brand intelligence research started" });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    if (err.name === "ZodError") return NextResponse.json({ error: "Invalid input", details: err.errors }, { status: 400 });
    console.error("POST /api/intelligence/run error:", err);
    return NextResponse.json({ error: "Failed to start research" }, { status: 500 });
  }
}
