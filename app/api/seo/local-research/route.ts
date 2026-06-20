import { NextRequest, NextResponse } from "next/server";
import { researchLocalSEO } from "@/lib/seo-intelligence";
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
    const { location, business_type, core_topic } = body;

    if (!location || !business_type) {
      return NextResponse.json(
        { error: "location and business_type are required" },
        { status: 400 }
      );
    }

    const research = await researchLocalSEO({
      location,
      business_type,
      core_topic,
    });

    return NextResponse.json(research);
  } catch (error: any) {
    console.error("Local SEO research error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to research local SEO" },
      { status: error?.statusCode || 500 }
    );
  }
}
