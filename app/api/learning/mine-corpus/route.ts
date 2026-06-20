import { NextRequest, NextResponse } from "next/server";
import { contentReviewService } from "@/lib/content-review-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);

    const body = await req.json();
    const { contentType, limit, judgeSampleRate } = body;

    if (!contentType) {
      return NextResponse.json({ error: "contentType is required" }, { status: 400 });
    }

    const result = await contentReviewService.mineCorpus(teamId, contentType, {
      limit: typeof limit === "number" ? limit : 500,
      judgeSampleRate: typeof judgeSampleRate === "number" ? judgeSampleRate : 0.2,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Mine corpus error:", error);
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to mine corpus" }, { status: error?.statusCode || 500 });
  }
}
