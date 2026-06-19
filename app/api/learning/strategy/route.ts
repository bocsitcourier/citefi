import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { cohortInsights } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50");
    const limit = isNaN(limitParam) ? 50 : Math.min(limitParam, 200);

    const insights = await db
      .select()
      .from(cohortInsights)
      .where(eq(cohortInsights.teamId, teamId))
      .orderBy(desc(cohortInsights.computedAt))
      .limit(limit);

    const guardrailConflicts = insights.filter(i => i.insightType === "guardrail_conflict");
    const converterCohorts  = insights.filter(i => i.insightType === "converter_cohort");
    const primers           = insights.filter(i => i.insightType === "pre_conversion_primer");
    const untapped          = insights.filter(i => i.insightType === "untapped_segment");

    const nextBestActions = insights
      .filter(i => i.vsBaselineMultiplier !== 100)
      .sort((a, b) => b.vsBaselineMultiplier - a.vsBaselineMultiplier)
      .slice(0, 3);

    return NextResponse.json({
      insights,
      summary: {
        total: insights.length,
        guardrailConflicts: guardrailConflicts.length,
        converterCohorts: converterCohorts.length,
        primers: primers.length,
        untapped: untapped.length,
      },
      nextBestActions,
    });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[learning/strategy GET]", err);
    return NextResponse.json({ error: "Failed to fetch strategy insights" }, { status: 500 });
  }
}
