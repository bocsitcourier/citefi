/**
 * GLOBAL SEO AI LAWS
 * ===================
 * Single source of truth for SEO constraints injected into EVERY AI prompt
 * across the platform — article generation, GPT-4 formatting, social posts.
 *
 * IMPORTANT: This file contains PROMPT TEXT (strings for AI consumption).
 * Runtime validation logic lives in lib/seo-policy.ts (code validators).
 *
 * Import GLOBAL_SEO_LAWS or buildSeoLawBlock() and inject into system prompts.
 */

/**
 * The master set of SEO laws injected into AI prompts as a non-negotiable
 * behavior contract. Written to be understood directly by LLMs.
 */
export const GLOBAL_SEO_LAWS = `
=== GLOBAL SEO LAWS (NON-NEGOTIABLE) ===

HYPERLINK & ANCHOR TEXT RULES:
1. NEVER use a bare city or state name as anchor text. "Boston", "Boston MA", "Weston MA", "Massachusetts" are FORBIDDEN as stand-alone hyperlinks. Violating this causes SEO penalties.
2. ALL anchor text MUST be a Semantic Cluster: a phrase of 4-7 words that pairs a SERVICE or TOPIC with optional location context.
   GOOD: "professional in-home memory care services", "compassionate post-hospital discharge support", "private caregiver services near Boston"
   BAD:  "Boston", "Boston MA", "Weston", "home care" (too short), "MA" (bare state)
3. PRIORITIZE the longest matching phrase first — link "specialized memory care training for families" before you link "memory care training".
4. FAQ sections (questions and answers) MUST contain at least 2 internal hyperlinks with 4-7 word anchor text.

CONTENT & GEO RULES:
5. NEVER list more than 2 city names in a single paragraph. Instead of listing locations, identify 4-7 word "Semantic Clusters" that describe the SERVICE in that location.
6. ALWAYS pair location mentions with a service, action, or benefit. "Boston" alone adds no topical value — "in-home care near Boston" does.
7. Do NOT pad content by listing city names to hit keyword density. You will be penalized if you list cities without service context.

=== END SEO LAWS ===
`.trim();

/**
 * Returns a formatted SEO laws block for injection into AI prompts.
 * Optionally include context-specific additional rules.
 *
 * @param additionalContext  Extra rules specific to the current task (optional)
 */
export function buildSeoLawBlock(additionalContext?: string): string {
  if (!additionalContext) return GLOBAL_SEO_LAWS;
  return `${GLOBAL_SEO_LAWS}\n\nADDITIONAL RULES FOR THIS TASK:\n${additionalContext}`;
}

/**
 * Short version of the laws for injection into user-turn prompts
 * (system prompt gets the full version; user prompt gets this reminder).
 */
export const SEO_LAW_REMINDER = `
REMINDER — SEO LAWS:
- Anchor text MUST be 4-7 words. Never hyperlink bare city names.
- Always pair location with a service: "private caregiver in Boston" not "Boston".
- FAQ section must contain at least 2 internal hyperlinks.
`.trim();
