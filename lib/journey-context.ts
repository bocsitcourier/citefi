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
 */

import { db } from "./db";
import { journeys, journeySteps, articles, audiencePersonas } from "../shared/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";

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
 * @returns formatted prompt segment, or null if journey not found
 */
export async function getJourneyContext(
  journeyId: number,
  stepIndex: number
): Promise<JourneyContextResult | null> {
  try {
    // Load journey row
    const [journey] = await db
      .select()
      .from(journeys)
      .where(eq(journeys.id, journeyId))
      .limit(1);

    if (!journey) return null;

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
        .where(eq(articles.id, pillarStep.articleId))
        .limit(1);

      if (pillarArticle) {
        pillarTitle = pillarArticle.chosenTitle ?? "";
        // Extract first 600 chars of body text as a brief summary
        const raw = pillarArticle.bodyText ?? "";
        pillarSummary = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
        if (pillarSummary.length === 600) pillarSummary += "...";
      }
    }

    // Load persona info if journey was triggered from a batch with a persona
    let personaGuidance = "";
    if (journey.triggerArticleId) {
      const [art] = await db
        .select({ batchId: articles.batchId })
        .from(articles)
        .where(eq(articles.id, journey.triggerArticleId))
        .limit(1);

      if (art?.batchId) {
        const { jobBatches } = await import("../shared/schema");
        const [batch] = await db
          .select({ personaId: jobBatches.personaId })
          .from(jobBatches)
          .where(eq(jobBatches.id, art.batchId))
          .limit(1);

        if (batch?.personaId) {
          const [persona] = await db
            .select({ name: audiencePersonas.name, psychographicProfile: audiencePersonas.psychographicProfile })
            .from(audiencePersonas)
            .where(eq(audiencePersonas.id, batch.personaId))
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
 * Used by the scheduler to gate downstream steps that need a pillar article.
 */
export async function isPillarGenerated(journeyId: number): Promise<boolean> {
  const [step] = await db
    .select({ articleId: journeySteps.articleId, status: journeySteps.status })
    .from(journeySteps)
    .where(and(eq(journeySteps.journeyId, journeyId), eq(journeySteps.stepIndex, 0)))
    .limit(1);

  return !!step && (step.status === "generated" || step.status === "published");
}
