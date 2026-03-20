import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { ingestFactsFromResearch, extractFactsFromContent, getFactCoverageReport } from "@/lib/fact-validated-generators";

export async function POST(req: NextRequest) {
  let teamId: number, userId: number;
  try {
    const auth = await requireTeamMember(req);
    teamId = auth.teamId;
    userId = auth.userId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "ingest") {
      const { facts } = body as {
        action: string;
        facts: Array<{
          text: string;
          source: string;
          sourceUrl?: string;
          confidence?: number;
          entityType?: string;
          entityName?: string;
          category?: string;
        }>;
      };

      if (!facts || !Array.isArray(facts) || facts.length === 0) {
        return NextResponse.json({ error: "facts array is required" }, { status: 400 });
      }

      const result = await ingestFactsFromResearch(teamId, { facts }, userId);
      return NextResponse.json({
        success: true,
        created: result.created,
        failed: result.failed,
        errors: result.errors,
      });
    }

    if (action === "extract") {
      const { content, entityType, entityName, category, minConfidence } = body as {
        action: string;
        content: string;
        entityType?: string;
        entityName?: string;
        category?: string;
        minConfidence?: number;
      };

      if (!content) {
        return NextResponse.json({ error: "content is required for extraction" }, { status: 400 });
      }

      const extractedFacts = await extractFactsFromContent(content, teamId, {
        entityType,
        entityName,
        category,
        minConfidence,
      });

      return NextResponse.json({
        success: true,
        extractedFacts,
        count: extractedFacts.length,
      });
    }

    if (action === "coverage") {
      const { topic, entityTypes } = body as {
        action: string;
        topic?: string;
        entityTypes?: string[];
      };

      const report = await getFactCoverageReport(teamId, topic, entityTypes);
      return NextResponse.json({
        success: true,
        report,
      });
    }

    return NextResponse.json({ error: "Invalid action. Use: ingest, extract, or coverage" }, { status: 400 });
  } catch (error) {
    console.error("[API] /api/facts/ingest error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process request" },
      { status: 500 }
    );
  }
}
