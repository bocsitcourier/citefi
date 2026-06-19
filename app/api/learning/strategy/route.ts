import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { cohortInsights } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";
import { getNextBestActions } from "@/lib/next-best-action";

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "100");
    const limit = isNaN(limitParam) ? 100 : Math.min(limitParam, 300);

    const [insights, nextBestActions] = await Promise.all([
      db
        .select()
        .from(cohortInsights)
        .where(eq(cohortInsights.teamId, teamId))
        .orderBy(desc(cohortInsights.computedAt))
        .limit(limit),
      getNextBestActions(teamId).catch((err) => {
        console.error("[strategy/NBA]", err);
        return [];
      }),
    ]);

    const guardrailConflicts = insights.filter((i) => i.insightType === "guardrail_conflict");
    const converterCohorts   = insights.filter((i) => i.insightType === "converter_cohort");
    const nonConverters      = insights.filter((i) => i.insightType === "non_converter");
    const primers            = insights.filter((i) => i.insightType === "pre_conversion_primer");
    const untapped           = insights.filter((i) => i.insightType === "untapped_segment");

    return NextResponse.json({
      insights,
      summary: {
        total: insights.length,
        guardrailConflicts: guardrailConflicts.length,
        converterCohorts: converterCohorts.length,
        nonConverters: nonConverters.length,
        primers: primers.length,
        untapped: untapped.length,
      },
      // Segmented lists for the UI sections
      guardrailConflicts,
      converterCohorts,
      nonConverters,
      primers,
      untapped,
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
