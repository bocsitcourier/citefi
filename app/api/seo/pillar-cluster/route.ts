import { NextRequest, NextResponse } from "next/server";
import { generatePillarClusterStrategy } from "@/lib/seo-intelligence";
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
    const {
      main_topic,
      industry,
      target_audience,
      num_cluster_pages = 8,
    } = body;

    if (!main_topic || !industry || !target_audience) {
      return NextResponse.json(
        { error: "main_topic, industry, and target_audience are required" },
        { status: 400 }
      );
    }

    const strategy = await generatePillarClusterStrategy({
      main_topic,
      industry,
      target_audience,
      num_cluster_pages,
    });

    return NextResponse.json(strategy);
  } catch (error: any) {
    console.error("Pillar cluster strategy error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate pillar cluster strategy" },
      { status: error?.statusCode || 500 }
    );
  }
}
