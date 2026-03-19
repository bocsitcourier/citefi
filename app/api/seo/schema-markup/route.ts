import { NextRequest, NextResponse } from "next/server";
import { generateSchemaMarkup } from "@/lib/seo-intelligence";
import { requireTeamMember } from "@/lib/api/auth";

export async function POST(req: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(req);
    const body = await req.json();
    const { content_type, data } = body;

    if (!content_type || !data) {
      return NextResponse.json(
        { error: "content_type and data are required" },
        { status: 400 }
      );
    }

    if (!["Article", "HowTo", "FAQPage", "LocalBusiness"].includes(content_type)) {
      return NextResponse.json(
        { error: "Invalid content_type. Must be: Article, HowTo, FAQPage, or LocalBusiness" },
        { status: 400 }
      );
    }

    const schema = await generateSchemaMarkup({
      content_type,
      data,
    });

    return NextResponse.json(schema);
  } catch (error: any) {
    console.error("Schema markup generation error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate schema markup" },
      { status: 500 }
    );
  }
}
