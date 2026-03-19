import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { auditArticle } from "@/lib/content-audit";

export async function POST(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);

    const body = await request.json();
    const { articleId } = body;

    if (!articleId) {
      return NextResponse.json(
        { error: "Article ID is required" },
        { status: 400 }
      );
    }

    console.log(`📊 Content audit requested for article ${articleId} by user ${userId}`);

    // Perform comprehensive audit
    const auditResult = await auditArticle(articleId, teamId);

    return NextResponse.json(auditResult);
  } catch (error: any) {
    console.error("Content audit error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to audit content" },
      { status: 500 }
    );
  }
}
