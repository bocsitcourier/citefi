import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { contentReviewService } from "@/lib/content-review-service";

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    const body = await request.json();
    const contentType = body.contentType || "article";
    const limit = Math.min(body.limit || 200, 500);
    const judgeSampleRate = body.judgeSampleRate ?? 0.15;

    const result = await contentReviewService.mineCorpus(teamId, contentType, {
      limit,
      judgeSampleRate,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    if (error.message === "Unauthorized" || error.message?.includes("auth")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Mine corpus error:", error);
    return NextResponse.json({ error: "Failed to mine corpus" }, { status: 500 });
  }
}
