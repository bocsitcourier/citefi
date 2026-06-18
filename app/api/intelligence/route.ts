import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import {
  getClientBrandProfile,
  updateManualOverrides,
  addSeedExemplar,
  type ClientBrandProfileJson,
  type SeedExemplar,
} from "@/lib/client-brand-profile-service";
import { z } from "zod";

/** GET /api/intelligence — return the team's brand intelligence profile */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const profile = await getClientBrandProfile(teamId);
    return NextResponse.json({ profile });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    console.error("GET /api/intelligence error:", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("overrides"), overrides: z.record(z.unknown()) }),
  z.object({
    action: z.literal("add_exemplar"),
    exemplar: z.object({
      contentType: z.enum(["article", "social", "email", "ad"]),
      text: z.string().min(1),
      source: z.string().default("manual"),
      humanApproved: z.boolean().default(true),
      performanceNote: z.string().optional(),
    }),
  }),
]);

/** PATCH /api/intelligence — update manual overrides or add a seed exemplar */
export async function PATCH(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.parse(body);

    if (parsed.action === "overrides") {
      await updateManualOverrides(teamId, parsed.overrides as Partial<ClientBrandProfileJson>);
    } else if (parsed.action === "add_exemplar") {
      const result = await addSeedExemplar(teamId, parsed.exemplar as SeedExemplar);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    if (err.statusCode) return NextResponse.json({ error: err.message }, { status: err.statusCode });
    if (err.name === "ZodError") return NextResponse.json({ error: "Invalid input", details: err.errors }, { status: 400 });
    console.error("PATCH /api/intelligence error:", err);
    return NextResponse.json({ error: "Failed to update intelligence profile" }, { status: 500 });
  }
}
