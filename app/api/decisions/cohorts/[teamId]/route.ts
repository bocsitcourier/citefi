import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember, requireAdmin } from "@/lib/api/auth";
import { getCohortStrategy } from "@/lib/cohort-strategy-service";

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

    // Users can only read their own team's cohort strategy; admins can read any
    if (authTeamId !== requestedTeamId) {
      try {
        await requireAdmin(req);
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const url = new URL(req.url);

    const contentTypeParam = url.searchParams.get("contentType");
    const VALID_CONTENT_TYPES = ["article", "social", "social_post", "podcast", "video"];
    const contentType = contentTypeParam && VALID_CONTENT_TYPES.includes(contentTypeParam)
      ? (contentTypeParam === "social_post" ? "social" : contentTypeParam)
      : undefined;

    const minImpressions = parseInt(url.searchParams.get("minImpressions") ?? "30");
    const minLiftPct = parseFloat(url.searchParams.get("minLift") ?? "0.05");
    const minProbability = parseFloat(url.searchParams.get("minProbability") ?? "0.8");

    const result = await getCohortStrategy(requestedTeamId, {
      contentType,
      minImpressions: isNaN(minImpressions) ? 30 : Math.max(1, minImpressions),
      minLift: isNaN(minLiftPct) ? 0.05 : Math.max(0, minLiftPct),
      minProbabilityBeatsHoldout: isNaN(minProbability) ? 0.8 : Math.min(1, Math.max(0, minProbability)),
    });

    return NextResponse.json(result);
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[cohorts GET]", err);
    return NextResponse.json({ error: "Failed to compute cohort strategy" }, { status: err?.statusCode || 500 });
  }
}
