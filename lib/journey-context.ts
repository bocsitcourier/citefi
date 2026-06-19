/**
 * Journey Context Service — Task #18 Cross-Content Coherence
 *
 * Provides a formatted prompt segment injected into every downstream step's
 * generation prompt to ensure consistent messaging across article, social,
 * podcast, and video pieces within the same journey.
 *
 * Also handles locale-aware context injection (Gap P):
 * When journey.locale is set and journey.localeConfig is populated, injects
 * market pricing, regulatory disclaimers, and locale-specific claims.
 *
 * Security: all DB lookups are scoped by teamId to prevent cross-team data leaks.
 */

import { db } from "./db";
import { journeys, journeySteps, articles, audiencePersonas } from "../shared/schema";
import { eq, and } from "drizzle-orm";

export interface JourneyContextResult {
  promptSegment: string;
  journeyName: string;
  terminalKpi: string;
  locale: string | null;
}

/**
 * Builds a journey context prompt segment for a specific step.
 *
 * @param journeyId - ID of the journey
 * @param stepIndex - which step is being generated (0 = pillar)
 * @param teamId - owning team (used to scope all sub-lookups, prevents cross-team leaks)
 * @returns formatted prompt segment, or null if journey not found / not owned
 */
export async function getJourneyContext(
  journeyId: number,
  stepIndex: number,
  teamId?: number
): Promise<JourneyContextResult | null> {
  try {
    // Load journey row — always scope by teamId when provided
    const journeyCondition = teamId
      ? and(eq(journeys.id, journeyId), eq(journeys.teamId, teamId))
      : eq(journeys.id, journeyId);

    const [journey] = await db
      .select()
      .from(journeys)
      .where(journeyCondition)
      .limit(1);

    if (!journey) return null;

    const resolvedTeamId = teamId ?? journey.teamId;

    // Find the pillar step (step 0) and its generated article
    const [pillarStep] = await db
      .select()
      .from(journeySteps)
      .where(and(eq(journeySteps.journeyId, journeyId), eq(journeySteps.stepIndex, 0)))
      .limit(1);

    let pillarSummary = "";
    let pillarTitle = "";

    if (pillarStep?.articleId) {
      const [pillarArticle] = await db
        .select({
          chosenTitle: articles.chosenTitle,
          bodyText: articles.bodyText,
        })
        .from(articles)
        // Scope article lookup by teamId to prevent cross-team leaks
        .where(and(eq(articles.id, pillarStep.articleId), eq(articles.teamId, resolvedTeamId)))
        .limit(1);

      if (pillarArticle) {
        pillarTitle = pillarArticle.chosenTitle ?? "";
        const raw = pillarArticle.bodyText ?? "";
        pillarSummary = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
        if (pillarSummary.length === 600) pillarSummary += "...";
      }
    }

    // Load persona info if journey was triggered from an article with a persona
    let personaGuidance = "";
    if (journey.triggerArticleId) {
      const [art] = await db
        .select({ batchId: articles.batchId })
        .from(articles)
        // Scope by teamId — prevents reading another team's article
        .where(and(eq(articles.id, journey.triggerArticleId), eq(articles.teamId, resolvedTeamId)))
        .limit(1);

      if (art?.batchId) {
        const { jobBatches } = await import("../shared/schema");
        const [batch] = await db
          .select({ personaId: jobBatches.personaId })
          .from(jobBatches)
          // Scope batch by teamId as well
          .where(and(eq(jobBatches.id, art.batchId), eq(jobBatches.teamId, resolvedTeamId)))
          .limit(1);

        if (batch?.personaId) {
          const [persona] = await db
            .select({ name: audiencePersonas.name, psychographicProfile: audiencePersonas.psychographicProfile })
            .from(audiencePersonas)
            // Scope persona by teamId
            .where(and(eq(audiencePersonas.id, batch.personaId), eq(audiencePersonas.teamId, resolvedTeamId)))
            .limit(1);

          if (persona) {
            const profile = persona.psychographicProfile as Record<string, unknown> | null;
            const painPoints = profile?.painPoints
              ? `Key pain points: ${(profile.painPoints as string[]).slice(0, 3).join("; ")}`
              : "";
            personaGuidance = `Target persona: ${persona.name}. ${painPoints}`.trim();
          }
        }
      }
    }

    // Build locale-aware context section (Gap P)
    let localeSection = "";
    if (journey.locale) {
      const localeConfig = journey.localeConfig as Record<string, unknown> | null;
      const parts: string[] = [];

      parts.push(`Write in the language and style appropriate for locale: ${journey.locale}.`);

      if (localeConfig?.pricingReferences) {
        parts.push(`Market pricing reference: ${localeConfig.pricingReferences}`);
      }
      if (localeConfig?.regulatoryDisclaimers) {
        parts.push(`Required regulatory disclaimer: ${localeConfig.regulatoryDisclaimers}`);
      }
      if (localeConfig?.localeSpecificClaims) {
        parts.push(`Locale-specific claims to include: ${localeConfig.localeSpecificClaims}`);
      }

      localeSection = `\nLOCALE CONTEXT:\n${parts.join(" ")}\n`;
    }

    // Build the final prompt segment
    const kpiGuidance: Record<string, string> = {
      conversion: "Drive the reader toward a specific conversion action (book, call, buy, sign up).",
      engagement: "Maximize time-on-content and social sharing. Use questions, stories, and relatable examples.",
      awareness: "Build brand recognition and topical authority. Focus on educating and informing.",
      subscription: "Encourage newsletter signup or membership. Emphasize ongoing value and exclusivity.",
    };

    const kpiInstruction = kpiGuidance[journey.terminalKpi] ?? "Drive meaningful audience action.";

    const pillarSection = pillarTitle
      ? `Pillar content title: "${pillarTitle}"\nKey themes from pillar: ${pillarSummary || "See pillar article."}`
      : "This is the first step in the journey (pillar content).";

    const stepContext = stepIndex === 0
      ? "You are generating the PILLAR content for this journey. It will anchor all downstream steps."
      : `You are generating step ${stepIndex + 1} in a content journey. All content must reinforce and reference the pillar piece.`;

    const promptSegment = `
=== JOURNEY CONTEXT ===
Journey: "${journey.name}" (ID: ${journeyId})
${stepContext}
${pillarSection}
${personaGuidance ? `\nAUDIENCE:\n${personaGuidance}` : ""}
CONVERSION GOAL: ${journey.terminalKpi.toUpperCase()} — ${kpiInstruction}
${stepIndex > 0 ? "CROSS-CONTENT RULE: Link back to the pillar article naturally in the content. Maintain consistent messaging, terminology, and brand voice across all journey steps." : ""}${localeSection}
=== END JOURNEY CONTEXT ===`.trim();

    return {
      promptSegment,
      journeyName: journey.name,
      terminalKpi: journey.terminalKpi,
      locale: journey.locale ?? null,
    };
  } catch (err) {
    console.error(`[journey-context] getJourneyContext(${journeyId}, ${stepIndex}) failed:`, err);
    return null;
  }
}

/**
 * Checks whether a journey's pillar step (step 0) has been generated.
 * Used by the scheduler to gate downstream podcast/video steps.
 *
 * Note: checks `articleId` IS NOT NULL as the definitive pillar-ready signal —
 * the step must have an actual article linked, not just status=generated.
 */
export async function isPillarGenerated(journeyId: number): Promise<boolean> {
  const [step] = await db
    .select({ articleId: journeySteps.articleId, status: journeySteps.status })
    .from(journeySteps)
    .where(and(eq(journeySteps.journeyId, journeyId), eq(journeySteps.stepIndex, 0)))
    .limit(1);

  // Pillar is ready only if it has a generated article linked
  return !!step && (step.status === "generated" || step.status === "published") && !!step.articleId;
}
