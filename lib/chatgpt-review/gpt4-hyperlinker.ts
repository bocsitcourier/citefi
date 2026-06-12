import { callOpenAI } from "../openai-client";
import { isHighQualityAnchor, isBareGeoAnchor } from "../seo-policy";
import { GLOBAL_SEO_LAWS } from "../seo-ai-laws";

/**
 * GPT-4 Intelligent Hyperlinking System for GEO Optimization
 * 
 * This module implements two-phase hyperlinking strategy:
 * 1. Main Article Body: 5-7 contextual links (excludes H2/H3 headers)
 * 2. FAQ Section: 1 high-quality link per FAQ answer
 *
 * PLATINUM UPGRADE: Both phases enforce isHighQualityAnchor() post-parse.
 * Bare city/state anchors ("Boston", "Boston MA") are rejected before storage.
 * The GLOBAL_SEO_LAWS block is injected into every system prompt so the AI
 * never generates a geo-only anchor in the first place.
 */

export interface ArticleBodyLink {
  anchorText: string;
  destinationUrl: string;
  explanation: string;
}

export interface FAQLink {
  questionNumber: number;
  anchorText: string;
  destinationUrl: string;
  revisedAnswer: string;
}

export interface ArticleBodyLinkResult {
  links: ArticleBodyLink[];
  totalLinks: number;
  rejectedCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface FAQLinkResult {
  links: FAQLink[];
  revisedFaqHtml: string;
  totalLinks: number;
  rejectedCount: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Validates a single anchor text against the SEO quality policy.
 * Returns the reason for rejection, or null if accepted.
 */
function validateAnchor(anchorText: string): string | null {
  if (!anchorText || anchorText.trim().length === 0) return "empty";
  if (isBareGeoAnchor(anchorText.trim())) return "bare_geo";
  if (!isHighQualityAnchor(anchorText.trim())) return "too_short_or_invalid";
  return null; // accepted
}

/**
 * Phase 1: Intelligent hyperlinking for main article body
 * 
 * Uses GPT-4 to identify 5-7 high-quality contextual link placements that:
 * - Build topical authority and content clusters
 * - Exclude all H1, H2, H3 headers
 * - Focus on natural placement within paragraphs and lists
 * - Use 4-7 word semantic anchor text (enforced post-parse by policy)
 */
export async function generateArticleBodyLinks(
  articleHtml: string,
  entityHomeUrl: string,
  clusterPageUrls: string[] = [],
  geographicFocus?: string
): Promise<ArticleBodyLinkResult> {
  const systemPrompt = `You are a highly specialized SEO expert for internal linking strategies focused on Generative Engine Optimization (GEO). Your task is to analyze article content and identify optimal link placements that build topical authority and signal semantic relationships to AI models.

${GLOBAL_SEO_LAWS}`;

  const userPrompt = `Act as a highly specialized SEO expert for internal linking strategies. Your task is to analyze the complete article draft provided below and insert contextually relevant internal links to reinforce our site's Topical Authority and connect this content to the central Entity Home.

**Link Destination Inputs:**
- Target Entity Home: ${entityHomeUrl}
${clusterPageUrls.length > 0 ? `- Supporting Cluster Pages:\n${clusterPageUrls.map(url => `  • ${url}`).join('\n')}` : ''}
${geographicFocus ? `- Geographic Focus: ${geographicFocus}` : ''}

**Placement Mandate:**
- **CRITICAL**: Exclude all H1, H2, and H3 headings from link placement
- Links must be placed naturally within the body paragraphs or bulleted/numbered lists only
- Focus on textual flow, adhering to best practices for non-spammy, contextual linking
- Enhance user navigation and demonstrate topical coverage depth

**Anchor Text Quality (ENFORCED — violations auto-rejected):**
- Anchor text MUST be 4-7 words — this is a hard requirement
- NEVER use a bare city or state as anchor text ("Boston", "Boston MA", "Weston" are BANNED)
- NEVER use phrases under 4 words ("home care", "in-home care" are TOO SHORT)
- ALWAYS use Semantic Clusters: "professional in-home memory care services" ✅
- Pair location with a service: "private caregiver support near Boston" ✅ not "Boston" ❌
- Avoid generic phrases like "click here" or forced exact match keywords

**Output Requirements:**
- Identify exactly 5-7 high-quality link placements
- Return a JSON object with this structure:
{
  "links": [
    {
      "anchorText": "4-7 word semantic phrase found verbatim in article body (NOT in headers)",
      "destinationUrl": "target URL from provided list",
      "explanation": "brief reason why this link supports topical authority"
    }
  ]
}

**Article HTML to Analyze:**
${articleHtml}

**IMPORTANT**: Scan the entire article from beginning to end, including the FAQ section. Select phrases that appear in PARAGRAPHS, LISTS, and FAQ ANSWERS only — never in H1, H2, or H3 tags. Every anchor text MUST be 4-7 words. Return exactly 5-7 contextual links distributed throughout the article, including at least 2 from the FAQ section.`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
      `GPT-4o Article Body Hyperlinker`,
      600000
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    const rawLinks: ArticleBodyLink[] = Array.isArray(parsed.links) ? parsed.links : [];

    // PLATINUM: Post-parse validation — reject any link that violates SEO policy
    let rejectedCount = 0;
    const validLinks = rawLinks.filter((link) => {
      const reason = validateAnchor(link.anchorText);
      if (reason) {
        console.warn(`[GPT4Linker] Rejected body link "${link.anchorText.slice(0, 50)}" — reason: ${reason}`);
        rejectedCount++;
        return false;
      }
      return true;
    });

    if (rejectedCount > 0) {
      console.log(`[GPT4Linker] Body: ${validLinks.length} accepted, ${rejectedCount} rejected by SEO policy`);
    }

    return {
      links: validLinks,
      totalLinks: validLinks.length,
      rejectedCount,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("❌ GPT-4 article body hyperlink generation error:", error);
    throw new Error("Failed to generate article body hyperlinks with GPT-4");
  }
}

/**
 * Phase 2: Intelligent hyperlinking for FAQ section
 * 
 * Uses GPT-4 to insert 1 high-quality link per FAQ answer that:
 * - Provides deeper context or supporting documentation
 * - Reinforces E-E-A-T signals (Trustworthiness and Expertise)
 * - Uses 4-7 word descriptive anchor text (enforced post-parse by policy)
 * - Returns the complete revised FAQ HTML ready for integration
 */
export async function generateFAQLinks(
  faqHtml: string,
  targetUrls: string[] = [],
  geographicFocus?: string
): Promise<FAQLinkResult> {
  const systemPrompt = `You are a highly specialized SEO expert focused on FAQ optimization for Generative Engine Optimization (GEO). Your task is to enhance FAQ sections with strategic internal links that reinforce E-E-A-T signals and provide deeper authority.

${GLOBAL_SEO_LAWS}`;

  const targetUrlsText = targetUrls.length > 0 
    ? `Target URLs for linking:\n${targetUrls.map(url => `  • ${url}`).join('\n')}` 
    : "No target URLs provided - use your judgment for relevant internal links";

  const userPrompt = `Analyze the FAQ section below. Your goal is to insert one high-quality internal link into the answer of each FAQ entry, transforming the short answer into a gateway for deeper authority and expertise.

**Link Destination Inputs:**
${targetUrls.length > 0 ? `${targetUrlsText}` : 'Use entity home and cluster pages for internal linking'}
${geographicFocus ? `- Geographic Focus: ${geographicFocus}` : ''}

**Placement Mandate:**
- The link must be placed within the answer text itself, NOT the question
- The link should point to a page that offers verifiable detail or complete explanation
- Links within answers act as citable references or "read more" opportunities
- Enhances answer credibility and content depth

**Anchor Text Quality (ENFORCED — violations auto-rejected):**
- Anchor text MUST be 4-7 words — HARD REQUIREMENT
- NEVER use a bare city/state name as anchor text ("Boston", "Weston MA" are BANNED)
- NEVER use short phrases under 4 words ("home care", "in-home care" are TOO SHORT)
- ALWAYS use Semantic Clusters that pair service with context:
  ✅ "professional memory care support services"
  ✅ "compassionate post-hospital discharge assistance"
  ✅ "private in-home caregiver support near Boston"
  ❌ "Boston" — bare city name
  ❌ "Boston MA" — city + state only

**Output Requirements:**
- Provide the revised FAQ section with new internal links fully integrated
- Return a JSON object with this structure:
{
  "links": [
    {
      "questionNumber": 1,
      "anchorText": "4-7 word semantic cluster used as link anchor",
      "destinationUrl": "target URL",
      "revisedAnswer": "complete FAQ answer with link integrated as HTML"
    }
  ],
  "revisedFaqHtml": "complete FAQ section HTML with all links integrated"
}

**FAQ Section HTML to Analyze:**
${faqHtml}

**IMPORTANT**: Insert exactly ONE high-quality 4-7 word link per FAQ answer. Return the complete revised FAQ HTML ready for seamless integration into the article.`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
      `GPT-4o FAQ Hyperlinker`,
      600000
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    const rawLinks: FAQLink[] = Array.isArray(parsed.links) ? parsed.links : [];
    const revisedFaqHtml = parsed.revisedFaqHtml || faqHtml;

    // PLATINUM: Post-parse validation — reject FAQ links that violate SEO policy
    let rejectedCount = 0;
    const validLinks = rawLinks.filter((link) => {
      const reason = validateAnchor(link.anchorText);
      if (reason) {
        console.warn(`[GPT4Linker] Rejected FAQ link "${link.anchorText.slice(0, 50)}" (Q${link.questionNumber}) — reason: ${reason}`);
        rejectedCount++;
        return false;
      }
      return true;
    });

    if (rejectedCount > 0) {
      console.log(`[GPT4Linker] FAQ: ${validLinks.length} accepted, ${rejectedCount} rejected by SEO policy`);
    }

    return {
      links: validLinks,
      revisedFaqHtml,
      totalLinks: validLinks.length,
      rejectedCount,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("❌ GPT-4 FAQ hyperlink generation error:", error);
    throw new Error("Failed to generate FAQ hyperlinks with GPT-4");
  }
}
