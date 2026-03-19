import { callOpenAI } from "../openai-client";

/**
 * GPT-4 Intelligent Hyperlinking System for GEO Optimization
 * 
 * This module implements two-phase hyperlinking strategy:
 * 1. Main Article Body: 5-7 contextual links (excludes H2/H3 headers)
 * 2. FAQ Section: 1 high-quality link per FAQ answer
 */

export interface ArticleBodyLink {
  anchorText: string;
  destinationUrl: string;
  explanation: string; // Why this link supports topical authority
}

export interface FAQLink {
  questionNumber: number;
  anchorText: string;
  destinationUrl: string;
  revisedAnswer: string; // FAQ answer with link integrated
}

export interface ArticleBodyLinkResult {
  links: ArticleBodyLink[];
  totalLinks: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface FAQLinkResult {
  links: FAQLink[];
  revisedFaqHtml: string; // Complete FAQ section with links integrated
  totalLinks: number;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Phase 1: Intelligent hyperlinking for main article body
 * 
 * Uses GPT-4 to identify 5-7 high-quality contextual link placements that:
 * - Build topical authority and content clusters
 * - Exclude all H1, H2, H3 headers
 * - Focus on natural placement within paragraphs and lists
 * - Use semantically relevant anchor text
 */
export async function generateArticleBodyLinks(
  articleHtml: string,
  entityHomeUrl: string,
  clusterPageUrls: string[] = [],
  geographicFocus?: string
): Promise<ArticleBodyLinkResult> {
  const systemPrompt = `You are a highly specialized SEO expert for internal linking strategies focused on Generative Engine Optimization (GEO). Your task is to analyze article content and identify optimal link placements that build topical authority and signal semantic relationships to AI models.`;

  const clusterPagesText = clusterPageUrls.length > 0 
    ? `Supporting Cluster Pages: ${clusterPageUrls.join(", ")}` 
    : "No supporting cluster pages provided - focus on Entity Home only";

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

**Anchor Text Quality:**
- Anchor text must be natural, descriptive, and semantically relevant to the destination page's content
- Avoid generic phrases like "click here" or forced exact match keywords
- Use long-tail phrases (3-7 words) that would appear naturally in the content
- Prioritize phrases that demonstrate expertise and authority

**Output Requirements:**
- Identify exactly 5-7 high-quality link placements
- Return a JSON object with this structure:
{
  "links": [
    {
      "anchorText": "natural phrase found in article body (not in headers)",
      "destinationUrl": "target URL from provided list",
      "explanation": "brief reason why this link supports topical authority"
    }
  ]
}

**Article HTML to Analyze:**
${articleHtml}

**IMPORTANT**: Scan the entire article from beginning to end. Select phrases that appear in PARAGRAPHS and LISTS only - never in H1, H2, or H3 tags. Return exactly 5-7 contextual links distributed throughout the article.`;

  try {
    // GPT-4o supports JSON mode for intelligent link placement (extended timeout: 600s)
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
      `GPT-4o Article Body Hyperlinker`,
      600000 // 10 minutes for GPT-4o intelligent analysis
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    const links: ArticleBodyLink[] = Array.isArray(parsed.links) ? parsed.links : [];

    return {
      links,
      totalLinks: links.length,
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
 * - Uses descriptive anchor text
 * - Returns the complete revised FAQ HTML ready for integration
 */
export async function generateFAQLinks(
  faqHtml: string,
  targetUrls: string[] = [],
  geographicFocus?: string
): Promise<FAQLinkResult> {
  const systemPrompt = `You are a highly specialized SEO expert focused on FAQ optimization for Generative Engine Optimization (GEO). Your task is to enhance FAQ sections with strategic internal links that reinforce E-E-A-T signals and provide deeper authority.`;

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

**Anchor Text Quality:**
- Anchor text must clearly describe the content of the target URL
- Use relevant long-tail phrases or entity names
- Improves contextual relevance and topical authority

**Output Requirements:**
- Provide the revised FAQ section with new internal links fully integrated
- Return a JSON object with this structure:
{
  "links": [
    {
      "questionNumber": 1,
      "anchorText": "descriptive phrase used as link anchor",
      "destinationUrl": "target URL",
      "revisedAnswer": "complete FAQ answer with link integrated as HTML"
    }
  ],
  "revisedFaqHtml": "complete FAQ section HTML with all links integrated"
}

**FAQ Section HTML to Analyze:**
${faqHtml}

**IMPORTANT**: Insert exactly ONE high-quality link per FAQ answer. Return the complete revised FAQ HTML ready for seamless integration into the article.`;

  try {
    // GPT-4o supports JSON mode for intelligent FAQ link placement (extended timeout: 600s)
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
      `GPT-4o FAQ Hyperlinker`,
      600000 // 10 minutes for GPT-4o intelligent analysis
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    const links: FAQLink[] = Array.isArray(parsed.links) ? parsed.links : [];
    const revisedFaqHtml = parsed.revisedFaqHtml || faqHtml; // Fallback to original if not provided

    return {
      links,
      revisedFaqHtml,
      totalLinks: links.length,
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
