/**
 * POST /api/journey/next
 * Returns the best content arm for a visitor and records the impression.
 *
 * Body: { teamId, visitorId, contentType?, locale?, personaId?, channel? }
 * Requires team membership; cross-team access requires global admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { getNextContent } from "@/lib/journey-orchestrator-service";

const bodySchema = z.object({
  teamId: z.number().int().positive(),
  visitorId: z.string().min(1).max(128),
  contentType: z.enum(["article", "social_post"]).optional(),
  locale: z.string().max(100).optional(),
  personaId: z.number().int().positive().optional(),
  channel: z.string().max(50).optional(),
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

    const { teamId, visitorId, contentType, locale, personaId, channel } = parsed.data;

    if (authTeamId !== teamId) {
      try {
        await requireAdmin(req);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const result = await getNextContent({
      teamId,
      visitorId,
      contentType: contentType ?? "article",
      locale,
      personaId,
      channel,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status ?? 500;
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status }
    );
  }
}
