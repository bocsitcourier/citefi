import { db } from "./db";
import { cohortInsights } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";

export interface NBARecommendation {
  priority: number;
  actionType: "scale_up" | "review" | "link_primer" | "cover_gap" | "pause_guardrail" | "monitor" | "adjust_cadence";
  headline: string;
  rationale: string;
  cohortDimension: string;
  cohortValue: string;
  vsBaselineMultiplier: number;
  insightType: string;
  terminalKpi?: string | null;
  contentTypeBlocked?: string | null;
  sampleSize: number;
}

function buildRecommendation(insight: {
  insightType: string;
  cohortDimension: string;
  cohortValue: string;
  vsBaselineMultiplier: number;
  recommendationText: string | null;
  terminalKpi: string | null;
  contentTypeBlocked: string | null;
  sampleSize: number;
}): NBARecommendation | null {
  const m = insight.vsBaselineMultiplier;
  const ct = insight.cohortValue;
  const kpiLabel = insight.terminalKpi ? ` (KPI: ${insight.terminalKpi})` : "";

  switch (insight.insightType) {
    case "guardrail_conflict":
      return {
        priority: 1,
        actionType: "pause_guardrail",
        headline: `Guardrail conflict on ${ct} — resolve before scaling`,
        rationale:
          insight.recommendationText ??
          `${ct} shows improving performance metrics but reader return rate is declining${kpiLabel}. Investigate audience fatigue before scaling further.`,
        cohortDimension: insight.cohortDimension,
        cohortValue: ct,
        vsBaselineMultiplier: m,
        insightType: insight.insightType,
        terminalKpi: insight.terminalKpi,
        contentTypeBlocked: insight.contentTypeBlocked,
        sampleSize: insight.sampleSize,
      };

    case "pre_conversion_primer":
      return {
        priority: 2,
        actionType: "link_primer",
        headline: `Add internal links to this high-leverage primer`,
        rationale:
          insight.recommendationText ??
          `This article appears in converter reading paths ${(m / 100).toFixed(1)}× more than non-converter paths${kpiLabel}. Adding CTAs and internal links to conversion pages will amplify its impact.`,
        cohortDimension: insight.cohortDimension,
        cohortValue: ct,
        vsBaselineMultiplier: m,
        insightType: insight.insightType,
        terminalKpi: insight.terminalKpi,
        contentTypeBlocked: null,
        sampleSize: insight.sampleSize,
      };

    case "untapped_segment":
      return {
        priority: 3,
        actionType: "cover_gap",
        headline: `Zero coverage on high-potential topic: ${ct}`,
        rationale:
          insight.recommendationText ??
          `Competitors actively cover this topic and your similar content converts at ${m}% of baseline${kpiLabel}. Dedicating the next batch to this gap could unlock new converters.`,
        cohortDimension: insight.cohortDimension,
        cohortValue: ct,
        vsBaselineMultiplier: m,
        insightType: insight.insightType,
        terminalKpi: insight.terminalKpi,
        contentTypeBlocked: null,
        sampleSize: insight.sampleSize,
      };

    case "converter_cohort":
      if (m > 150) {
        return {
          priority: 3,
          actionType: "scale_up",
          headline: `Scale up ${ct} — converts at ${(m / 100).toFixed(1)}× baseline`,
          rationale:
            insight.recommendationText ??
            `${ct} content significantly outperforms the team baseline${kpiLabel}. Increasing production volume here is the highest-ROI move available.`,
          cohortDimension: insight.cohortDimension,
          cohortValue: ct,
          vsBaselineMultiplier: m,
          insightType: insight.insightType,
          terminalKpi: insight.terminalKpi,
          contentTypeBlocked: null,
          sampleSize: insight.sampleSize,
        };
      }
      if (m >= 120) {
        return {
          priority: 5,
          actionType: "scale_up",
          headline: `${ct} is above baseline — maintain momentum`,
          rationale:
            insight.recommendationText ??
            `${ct} content performs at ${m}% of team baseline${kpiLabel}. Consistent production is recommended.`,
          cohortDimension: insight.cohortDimension,
          cohortValue: ct,
          vsBaselineMultiplier: m,
          insightType: insight.insightType,
          terminalKpi: insight.terminalKpi,
          contentTypeBlocked: null,
          sampleSize: insight.sampleSize,
        };
      }
      return null;

    case "non_converter":
      if (m < 70) {
        return {
          priority: 4,
          actionType: "review",
          headline: `Review ${ct} content — ${100 - m}% below baseline`,
          rationale:
            insight.recommendationText ??
            `${ct} content performs at only ${m}% of team baseline${kpiLabel}. Review topic-market fit, content quality, and CTA placement.`,
          cohortDimension: insight.cohortDimension,
          cohortValue: ct,
          vsBaselineMultiplier: m,
          insightType: insight.insightType,
          terminalKpi: insight.terminalKpi,
          contentTypeBlocked: null,
          sampleSize: insight.sampleSize,
        };
      }
      return null;

    case "cadence_optimization": {
      // cohortValue format: "contentType:Nx_week" e.g. "social:2x_week"
      // vsBaselineMultiplier encodes % improvement (e.g. 140 = 40% gain)
      const parts = ct.split(":");
      const contentLabel = parts[0] ?? ct;
      const freqLabel = parts[1]?.replace(/_/g, " ") ?? "the recommended frequency";
      const gainPct = m > 100 ? m - 100 : 0;
      return {
        priority: 3,
        actionType: "adjust_cadence",
        headline: `Adjust ${contentLabel} cadence to ${freqLabel} for ${gainPct > 0 ? `+${gainPct}%` : "better"} performance`,
        rationale:
          insight.recommendationText ??
          `Data shows that publishing ${contentLabel} at ${freqLabel} correlates with ${gainPct > 0 ? `${gainPct}% higher` : "improved"} engagement${kpiLabel}. Shift to this cadence to maximize content ROI.`,
        cohortDimension: insight.cohortDimension,
        cohortValue: ct,
        vsBaselineMultiplier: m,
        insightType: insight.insightType,
        terminalKpi: insight.terminalKpi,
        contentTypeBlocked: null,
        sampleSize: insight.sampleSize,
      };
    }

    default:
      return null;
  }
}

export async function getNextBestActions(teamId: number): Promise<NBARecommendation[]> {
  const insights = await db
    .select()
    .from(cohortInsights)
    .where(eq(cohortInsights.teamId, teamId))
    .orderBy(desc(cohortInsights.computedAt))
    .limit(200);

  const candidates: NBARecommendation[] = [];

  for (const insight of insights) {
    const rec = buildRecommendation({
      insightType: insight.insightType,
      cohortDimension: insight.cohortDimension,
      cohortValue: insight.cohortValue,
      vsBaselineMultiplier: insight.vsBaselineMultiplier,
      recommendationText: insight.recommendationText ?? null,
      terminalKpi: (insight as any).terminalKpi ?? null,
      contentTypeBlocked: (insight as any).contentTypeBlocked ?? null,
      sampleSize: insight.sampleSize,
    });
    if (rec) candidates.push(rec);
  }

  // Sort: priority ASC, then multiplier DESC (highest uplift first within same priority)
  candidates.sort((a, b) => a.priority - b.priority || b.vsBaselineMultiplier - a.vsBaselineMultiplier);

  // Deduplicate: keep only the best recommendation per (actionType, cohortValue)
  const seen = new Set<string>();
  const deduped: NBARecommendation[] = [];
  for (const c of candidates) {
    const key = `${c.actionType}:${c.cohortValue}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
    if (deduped.length >= 5) break;
  }

  return deduped;
}
