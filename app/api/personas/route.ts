import { NextRequest, NextResponse } from "next/server";
import { psychographicService } from "@/lib/psychographic-service";
import { requireTeamMember } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const personas = await psychographicService.getTeamPersonas(teamId);

    return NextResponse.json({
      success: true,
      personas,
    });
  } catch (error: any) {
    console.error("Failed to get personas:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to get personas" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const body = await request.json();
    const {
      name,
      description,
      openness,
      conscientiousness,
      extraversion,
      agreeableness,
      neuroticism,
      riskTolerance,
      decisionStyle,
      valueOrientation,
      preferredTone,
      preferredContentLength,
      painPoints,
      motivations,
      objections,
      emotionalTriggers,
      isDefault,
    } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 }
      );
    }

    const persona = await psychographicService.createPersona(teamId, {
      name,
      description,
      openness,
      conscientiousness,
      extraversion,
      agreeableness,
      neuroticism,
      riskTolerance,
      decisionStyle,
      valueOrientation,
      preferredTone,
      preferredContentLength,
      painPoints,
      motivations,
      objections,
      emotionalTriggers,
      isDefault,
    });

    return NextResponse.json({
      success: true,
      persona,
    });
  } catch (error: any) {
    console.error("Failed to create persona:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to create persona" },
      { status: error?.statusCode || 500 }
    );
  }
}
