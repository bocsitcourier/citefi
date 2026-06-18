/**
 * POST /api/journey/convert
 * Records a conversion event for a visitor's assigned arm.
 * Idempotent — safe to call multiple times for the same visitor+policy.
 * Verifies policyId belongs to the caller's teamId (inside the service).
 * Cross-team access requires global admin.
 *
 * Body: { teamId, visitorId, policyId }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { recordConversion } from "@/lib/journey-orchestrator-service";

const bodySchema = z.object({
  teamId: z.number().int().positive(),
  visitorId: z.string().min(1).max(128),
  policyId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const { teamId: authTeamId } = await requireTeamMember(req);

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { teamId, visitorId, policyId } = parsed.data;

    if (authTeamId !== teamId) {
      try {
        await requireAdmin(req);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // recordConversion verifies policyId belongs to teamId before mutating
    const result = await recordConversion(policyId, teamId, visitorId);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status ?? 500;
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status }
    );
  }
}
