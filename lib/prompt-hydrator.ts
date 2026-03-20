/**
 * PROMPT HYDRATOR
 * ===============
 * Assembles the "hydrated" AI prompt block that gets injected into every
 * Gemini article generation call. Exported separately so tests can verify
 * the prompt contains the required SEO law language without running the
 * full generation pipeline.
 *
 * Used by:
 *  - lib/gemini.ts (generateArticleContent inlines this logic)
 *  - tests/seo-circuit-breaker.test.ts (verifies prompt law injection)
 */

import { GLOBAL_SEO_LAWS, SEO_LAW_REMINDER } from "./seo-ai-laws";

export interface HydratedPrompt {
  /** The assembled prompt block containing SEO laws + any dynamic warnings */
  block: string;
  /** True if Guardian failure warnings were injected from the learning ledger */
  hasGuardianWarnings: boolean;
  /** Number of distinct failure types injected */
  warningCount: number;
}

/**
 * Build the hydrated prompt block for a given team.
 * This is what gets appended to the Gemini article generation prompt
 * to close the Neural Loop.
 *
 * @param teamId  Team ID for scoped Guardian failure lookup (pass 0 or omit to skip ledger)
 * @param contentType  Content type for ledger query (default: "article")
 */
export async function generateHydratedPrompt(
  teamId?: number,
  contentType: string = "article"
): Promise<HydratedPrompt> {
  let guardianBlock = "";
  let warningCount = 0;

  if (teamId && teamId > 0) {
    try {
      const { getGuardianFailureWarnings } = await import("./learning-integration");
      guardianBlock = await getGuardianFailureWarnings(teamId, contentType);
      // Count the warning lines prefixed with "  -"
      warningCount = (guardianBlock.match(/^  - /gm) || []).length;
    } catch {
      // Non-fatal — ledger unavailable, continue without warnings
    }
  }

  const block = [
    "### CRITICAL SEO HYPERLINKING LAWS (MANDATORY — ENFORCED AT PUBLICATION):",
    GLOBAL_SEO_LAWS,
    guardianBlock,
    SEO_LAW_REMINDER,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    block,
    hasGuardianWarnings: warningCount > 0,
    warningCount,
  };
}
