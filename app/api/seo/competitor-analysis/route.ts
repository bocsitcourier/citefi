import { NextRequest, NextResponse } from "next/server";
import { analyzeCompetitor } from "@/lib/seo-intelligence";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(req: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(req);
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured. Please set up your API key." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { competitor_url, your_business_type, focus_areas } = body;

    if (!competitor_url || !your_business_type) {
      return NextResponse.json(
        { error: "competitor_url and your_business_type are required" },
        { status: 400 }
      );
    }

    const analysis = await analyzeCompetitor({
      competitor_url,
      your_business_type,
      focus_areas,
    });

    return NextResponse.json(analysis);
  } catch (error: any) {
    console.error("Competitor analysis error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze competitor" },
      { status: error?.statusCode || 500 }
    );
  }
}
