import { NextRequest, NextResponse } from "next/server";
import { optimizeContentStructure } from "@/lib/seo-intelligence";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(req: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(req);
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured. Please set up your API key." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const {
      topic,
      target_audience,
      word_count_target = 1500,
      include_faq = true,
      include_definitions = true,
    } = body;

    if (!topic || !target_audience) {
      return NextResponse.json(
        { error: "topic and target_audience are required" },
        { status: 400 }
      );
    }

    const structure = await optimizeContentStructure({
      topic,
      target_audience,
      word_count_target,
      include_faq,
      include_definitions,
    });

    return NextResponse.json(structure);
  } catch (error: any) {
    console.error("Content structure optimization error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to optimize content structure" },
      { status: 500 }
    );
  }
}
