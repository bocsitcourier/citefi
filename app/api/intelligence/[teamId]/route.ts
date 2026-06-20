import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { computeIntelligence, getIntelligence } from "@/lib/client-intelligence-service";
import { z } from "zod";

const recomputeSchema = z.object({
  windowDays: z.number().int().min(1).max(365).default(30),
  contentType: z.enum(["article", "social", "social_post", "podcast", "video"]).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId: authTeamId } = await requireTeamMember(req);
    const resolvedParams = await params;
    const requestedTeamId = parseInt(resolvedParams.teamId);

    if (isNaN(requestedTeamId)) {
      return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
    }

    // Users can only read their own team's intelligence; admins can read any
    if (authTeamId !== requestedTeamId) {
      // Try admin elevation
      try {
        await requireAdmin(req);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const url = new URL(req.url);
    const windowDays = parseInt(url.searchParams.get("windowDays") ?? "30");
    const contentTypeParam = url.searchParams.get("contentType");
    const limit = parseInt(url.searchParams.get("limit") ?? "100");

    const VALID_CONTENT_TYPES = ["article", "social", "social_post", "podcast", "video"];
    const contentType = contentTypeParam && VALID_CONTENT_TYPES.includes(contentTypeParam)
      ? (contentTypeParam === "social_post" ? "social" : contentTypeParam)
      : undefined;

    const rows = await getIntelligence(requestedTeamId, {
      contentType,
      windowDays: isNaN(windowDays) ? 30 : windowDays,
      limit: isNaN(limit) ? 100 : Math.min(limit, 500),
    });

    return NextResponse.json({ intelligence: rows, count: rows.length, windowDays });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[intelligence GET]", err);
    return NextResponse.json({ error: "Failed to fetch intelligence" }, { status: err?.statusCode || 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  try {
    const { teamId: authTeamId } = await requireTeamMember(req);
    const resolvedParams = await params;
    const requestedTeamId = parseInt(resolvedParams.teamId);

    if (isNaN(requestedTeamId)) {
      return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
    }

    if (authTeamId !== requestedTeamId) {
      try {
        await requireAdmin(req);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const parsed = recomputeSchema.safeParse(body);
    const { windowDays } = parsed.success ? parsed.data : { windowDays: 30 };

    const result = await computeIntelligence(requestedTeamId, windowDays);

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      windowDays,
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[intelligence POST]", err);
    return NextResponse.json({ error: "Failed to compute intelligence" }, { status: err?.statusCode || 500 });
  }
}
