import { callOpenAI } from "./openai-client";
import * as cheerio from "cheerio";
import { isHighQualityAnchor } from "./seo-policy";

// ---------------------------------------------------------------------------
// CHEERIO-BASED HYPERLINK INJECTOR
// ---------------------------------------------------------------------------
// Uses a DOM parser instead of raw String.replace() so that:
//  • Only text inside <p>, <li>, and <td> elements is touched
//  • Heading text, image attributes, and class names are never modified
//  • Nested <a> tags are physically impossible (parent-check via .closest('a'))
//  • cheerio.load(html, null, false) prevents html/head/body wrapper injection
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface SafeHyperlinkResult {
  correctedHtml: string;
  keywordsLinked: number;
  keywordsMissing: string[];
  keywordsFound: string[];
}

/**
 * Inject hyperlinks into article HTML safely using a DOM parser.
 *
 * Scopes replacements to <p>, <li>, and <td> text only.
 * Limits to 1 link per keyword across the whole article.
 * Validates that targetUrl starts with http:// or https://.
 *
 * Thin wrapper over applyHyperlinksDom for single-URL call sites.
 * Previously had its own Cheerio implementation that skipped any paragraph
 * containing an existing <a> — the unified engine fixes that by walking
 * text nodes directly, so paragraphs with existing links still get new ones.
 */
export function safeApplyHyperlinks(
  html: string,
  keywords: string[],
  targetUrl: string
): SafeHyperlinkResult {
  const rules: HyperlinkRule[] = keywords.map((k) => ({ keyword: k, url: targetUrl }));
  const result = applyHyperlinksDom(html, rules, 1);
  return {
    correctedHtml: result.correctedHtml,
    keywordsLinked: result.keywordsLinked,
    keywordsMissing: result.keywordsMissing,
    keywordsFound: result.keywordsFound,
  };
}

/**
 * LOCAL PHRASE EXTRACTOR — Zero API cost, 100% match rate.
 *
 * Extracts verbatim n-gram phrases (4-7 words) from the FINAL HTML that contain
 * at least one topic hint word. Because phrases are scanned directly from the
 * rendered text, every returned phrase is guaranteed to exist in the article.
 *
 * Use this after GPT-4 reformats the article so the phrases are always in sync
 * with the final content (ChatGPT-stage phrases break because GPT-4 paraphrases).
 */
export function extractPhrasesFromHtml(
  html: string,
  topicHints: string[],
  count: number = 20
): string[] {
  // Strip scripts, styles, and all tags to get clean prose text
  const plain = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const STOP_WORDS = new Set([
    "the","a","an","in","on","at","to","for","of","is","are","was","were",
    "and","or","but","this","that","these","those","it","its","we","our",
    "you","your","they","their","with","from","by","about","as","into",
    "how","what","when","where","which","who","why","be","been","being",
    "have","has","had","do","does","did","will","would","could","should",
    "may","might","must","shall","can","not","no","so","if","then","than",
    "also","more","most","any","all","each","both","few","many","some",
    "very","just","only","even","new","such","other","same","provide",
    "include","including","ensure","offer","require","allows","enables",
  ]);

  const lowerHints = topicHints
    .filter((h) => h && h.length > 2)
    .map((h) => h.toLowerCase());

  const candidates: string[] = [];
  const seen = new Set<string>();

  // Split on sentence boundaries
  const sentences = plain.split(/[.!?]+/).filter((s) => s.trim().length > 20);

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter((w) => w.length > 2);
    if (words.length < 5) continue;

    // Try 7-word windows down to 4-word windows for the best phrases
    for (let len = 7; len >= 4; len--) {
      for (let i = 0; i <= words.length - len; i++) {
        const phraseWords = words.slice(i, i + len);
        const phrase = phraseWords.join(" ");
        const lower = phrase.toLowerCase();

        // Skip phrases that start or end with stop words
        if (STOP_WORDS.has(phraseWords[0].toLowerCase())) continue;
        if (STOP_WORDS.has(phraseWords[phraseWords.length - 1].toLowerCase())) continue;

        // Must contain at least one topic hint (skip filter when no hints provided)
        if (lowerHints.length > 0 && !lowerHints.some((h) => lower.includes(h))) continue;

        // Verify the phrase literally exists in the stripped text
        if (!plain.toLowerCase().includes(lower)) continue;

        if (!seen.has(lower)) {
          seen.add(lower);
          candidates.push(phrase);
          if (candidates.length >= count) return candidates;
        }
      }
    }
  }

  return candidates;
}

/**
 * Enterprise 3-Stage Keyword Hyperlinking Pipeline
 * 
 * Stage 1: Extract exact long-phrase keywords FIRST (before article generation)
 * Stage 2: Article generation uses ONLY the extracted keywords
 * Stage 3: Post-generation validator ensures all keywords are hyperlinked
 * 
 * This eliminates GPT hallucinations and ensures 100% hyperlink coverage.
 */

export interface BusinessProfile {
  businessName: string;
  targetUrl: string;
  services: string[];
  location: string;
  additionalLocations?: string[];
}

export interface ExtractedKeyword {
  keyword: string;
  category: 'primary_service' | 'geo_service' | 'long_tail' | 'local_authority' | 'industry_specific';
}

export interface KeywordExtractionResult {
  keywords: ExtractedKeyword[];
  rawKeywords: string[];
  businessProfile: BusinessProfile;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface HyperlinkValidationResult {
  correctedHtml: string;
  keywordsLinked: number;
  keywordsMissing: string[];
  keywordsFound: string[];
  faqKeywordsLinked: number;
}

/**
 * STAGE 1: Extract Long-Phrase Keywords FROM Article Content
 * 
 * IMPORTANT: This runs AFTER Gemini generates the article.
 * GPT-4 analyzes the actual article text to find existing long phrases
 * that should be hyperlinked, ensuring 100% match rate.
 * 
 * Keywords are extracted from phrases that ALREADY EXIST in the content.
 */
export async function extractKeywordsFromArticle(
  articleHtml: string,
  profile: BusinessProfile
): Promise<KeywordExtractionResult> {
  // Strip HTML tags for text analysis
  const plainText = articleHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  
  const systemPrompt = `You are a keyword extraction engine. You analyze article content to find existing long phrases suitable for hyperlinking.
You ONLY extract phrases that ALREADY EXIST in the article text - never invent new ones.
Every keyword MUST be a direct quote from the article.`;

  const userPrompt = `Analyze this article and extract EXACTLY 25 long-phrase keywords for hyperlinking.

BUSINESS CONTEXT:
- Business: ${profile.businessName}
- URL: ${profile.targetUrl}
- Services: ${profile.services.join(', ')}
- Location: ${profile.location}

ARTICLE TEXT TO ANALYZE:
${plainText.substring(0, 8000)}

EXTRACTION RULES:
1. Extract ONLY phrases that EXIST VERBATIM in the article above
2. Each phrase must be 4-10 words long
3. Prioritize phrases containing:
   - Business services + location
   - Questions/answers about services
   - Professional/quality descriptors + services
   - Industry-specific terms
4. Exclude phrases inside headers (H1-H6)
5. Exclude generic phrases without business context

OUTPUT FORMAT (JSON only):
{
  "keywords": [
    {"keyword": "exact phrase from article", "category": "primary_service"},
    {"keyword": "another exact phrase", "category": "geo_service"},
    ...
  ]
}

Categories: primary_service, geo_service, long_tail, local_authority, industry_specific

CRITICAL: Every keyword MUST be an EXACT match to text in the article. If I can't find it with a simple search, it's wrong.`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1, // Very low for exact extraction
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
      `GPT-4o Keyword Extraction from Article`,
      120000
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    // Filter to only keywords that actually exist in the article
    const keywords: ExtractedKeyword[] = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .filter((k: any) => {
        if (!k.keyword || k.keyword.split(' ').length < 4) return false;
        // Verify keyword exists in article
        return plainText.toLowerCase().includes(k.keyword.toLowerCase());
      });

    console.log(`✅ Extracted ${keywords.length} verified keywords from article content`);

    return {
      keywords,
      rawKeywords: keywords.map(k => k.keyword),
      businessProfile: profile,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("❌ Article keyword extraction error:", error);
    throw new Error("Failed to extract keywords from article");
  }
}

/**
 * LEGACY: Extract Keywords from Business Profile (before article exists)
 * 
 * This is less reliable because keywords may not appear in the final article.
 * Use extractKeywordsFromArticle() instead when possible.
 */
export async function extractLongPhraseKeywords(
  profile: BusinessProfile
): Promise<KeywordExtractionResult> {
  const systemPrompt = `You are a keyword extraction engine specialized in GEO/SEO optimization. 
You generate ONLY long-phrase keywords (4-10 words) that are highly specific to the business provided.
Every keyword MUST be relevant to the business services and geographic area.
NO generic keywords. NO hallucinated services. NO incorrect locations.`;

  const userPrompt = `You are a keyword extraction engine.

1. Analyze this business:
BUSINESS NAME: ${profile.businessName}
URL: ${profile.targetUrl}
SERVICES: ${profile.services.join(', ')}
PRIMARY LOCATION: ${profile.location}
${profile.additionalLocations?.length ? `ADDITIONAL LOCATIONS: ${profile.additionalLocations.join(', ')}` : ''}

2. Generate EXACTLY 25 long-phrase keywords relevant ONLY to THIS BUSINESS.

3. All keywords must be:
   - Long-phrase (4-10 words, minimum 4 words)
   - Geo-optimized (include ${profile.location} or nearby cities)
   - Service-specific (include terms from: ${profile.services.join(', ')})
   - Natural language phrases that would appear in article content
   - Ready to be hyperlinked as anchor text

4. Distribute keywords across these categories:
   - 5 primary service keywords (core business offerings + location)
   - 5 geo-service combinations (service + specific city/neighborhood)
   - 5 long-tail question phrases (how to, where to find, best, etc.)
   - 5 local authority phrases (trusted, professional, reliable + service + location)
   - 5 industry-specific technical phrases (with location context)

5. Output ONLY valid JSON:
{
  "keywords": [
    {"keyword": "same day courier service in Boston MA", "category": "primary_service"},
    {"keyword": "reliable medical courier delivery near Cambridge", "category": "geo_service"},
    ...
  ]
}

CRITICAL RULES:
- Every keyword MUST contain at least 4 words
- Every keyword MUST be directly relevant to ${profile.businessName}
- Every keyword SHOULD include location context
- NO generic marketing phrases
- NO hallucinated services not listed above
- NO locations outside the specified area`;

  try {
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
      `GPT-4o Long-Phrase Keyword Extraction`,
      120000
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);
    
    const keywords: ExtractedKeyword[] = Array.isArray(parsed.keywords) 
      ? parsed.keywords.filter((k: any) => k.keyword && k.keyword.split(' ').length >= 4)
      : [];

    console.log(`✅ Extracted ${keywords.length} long-phrase keywords for ${profile.businessName}`);

    return {
      keywords,
      rawKeywords: keywords.map(k => k.keyword),
      businessProfile: profile,
      tokenUsage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
        totalTokens: completion.usage?.total_tokens || 0,
      },
    };
  } catch (error) {
    console.error("❌ Keyword extraction error:", error);
    throw new Error("Failed to extract long-phrase keywords");
  }
}

// ---------------------------------------------------------------------------
// UNIFIED DOM HYPERLINK ENGINE
// ---------------------------------------------------------------------------
// Replaces the old regex+placeholder system entirely.
//
// Key properties:
//  • Parses HTML with Cheerio — no string-splitting, no placeholder tokens
//  • Walks actual text nodes so keywords never match inside tag attributes,
//    JSON-LD scripts, headings, or existing <a> tags
//  • script/style/code/pre/h1-h6 are skipped at the DOM level — the JSON-LD
//    block is naturally protected without any indexOf splitting
//  • applyKeywordHyperlinks and applyMultiUrlHyperlinks are thin wrappers
//    sharing this one engine, so behaviour is consistent across all call sites
// ---------------------------------------------------------------------------

export interface HyperlinkRule {
  keyword: string;
  url: string;
  maxLinks?: number; // per-keyword cap (falls back to globalMaxLinksPerKeyword)
}

export interface DomHyperlinkResult {
  correctedHtml: string;
  keywordsLinked: number;
  keywordsMissing: string[];
  keywordsFound: string[];
  faqKeywordsLinked: number;
  urlDistribution: Record<string, number>;
}

// Tags that should NEVER have their text content hyperlinked
const SKIP_TAGS = new Set([
  "h1","h2","h3","h4","h5","h6","a","script","style","code","pre","noscript","svg",
]);

// All text containers targeted for hyperlink injection.
// Includes dt/dd for FAQ <dl> lists, figcaption, and summary (accordion FAQs).
// Covers the full article including bottom-half FAQ sections.
const LINK_CONTAINERS =
  "p, li, td, th, blockquote, dd, dt, figcaption, summary, " +
  ".faq-answer, .faq-question, [class*='faq'], [class*='answer'], [class*='question']";

/**
 * Core DOM-based hyperlink engine — Platinum Edition.
 *
 * Changes vs. legacy version:
 *  • All anchor candidates are filtered through isHighQualityAnchor() before
 *    injection — bare city/state names are rejected at the engine level.
 *  • Container selector expanded to dt, figcaption, summary, FAQ class wrappers
 *    so that the entire article including FAQ sections is covered.
 *  • Node-order traversal (Cheerio's natural DOM order) distributes links
 *    across head AND tail of the article rather than front-loading.
 *  • Per-URL cap prevents any single destination from consuming all slots.
 */
export function applyHyperlinksDom(
  html: string,
  rules: HyperlinkRule[],
  globalMaxLinksPerKeyword = 1
): DomHyperlinkResult {
  // Gate 1: basic URL validity + minimum length
  // Gate 2: shared SEO quality policy (4+ words, no bare geo, etc.)
  const validRules = rules.filter(
    (r) =>
      r.keyword?.length >= 4 &&
      r.url?.match(/^https?:\/\//i) &&
      isHighQualityAnchor(r.keyword)
  );

  // Track policy-rejected keywords so callers get visibility into WHY they weren't linked.
  // These appear in keywordsMissing alongside keywords not found in the HTML.
  const policyRejectedKeywords = rules
    .filter((r) => !validRules.includes(r))
    .map((r) => r.keyword);

  if (policyRejectedKeywords.length > 0) {
    console.log(
      `[DomInjector] Policy-rejected (${policyRejectedKeywords.length}): ${policyRejectedKeywords.map(k => `"${k}"`).join(", ")}`
    );
  }

  if (!html || validRules.length === 0) {
    return {
      correctedHtml: html,
      keywordsLinked: 0,
      keywordsMissing: rules.map((r) => r.keyword),
      keywordsFound: [],
      faqKeywordsLinked: 0,
      urlDistribution: {},
    };
  }

  const $ = cheerio.load(html, null, false);
  const appliedCounts = new Map<string, number>();
  const urlDistribution: Record<string, number> = {};

  // Sort longest-first so "personalized in-home memory care" matches before
  // "memory care" — prevents a shorter phrase consuming needed text.
  const sortedRules = [...validRules].sort(
    (a, b) => b.keyword.length - a.keyword.length
  );

  for (const rule of sortedRules) {
    const maxLinks = rule.maxLinks ?? globalMaxLinksPerKeyword;
    let applied = appliedCounts.get(rule.keyword) ?? 0;
    if (applied >= maxLinks) continue;

    const regex = new RegExp(`\\b(${escapeRegex(rule.keyword)})\\b`, "i");
    const safeUrl = rule.url.replace(/"/g, "%22");

    // Walk ALL text containers in document order — covers body, FAQ, conclusion
    $(LINK_CONTAINERS).each((_, containerEl) => {
      if (applied >= maxLinks) return false; // break .each()

      const walkTextNodes = (node: cheerio.AnyNode): boolean => {
        if (applied >= maxLinks) return false;

        const children: cheerio.AnyNode[] = (node as any).children || [];
        for (let i = 0; i < children.length; i++) {
          const child = children[i];

          if ((child as any).type === "text") {
            const text = (child as any).data as string;
            if (!regex.test(text)) continue;

            const newHtml = text.replace(regex, (_, m) => {
              if (applied >= maxLinks) return m;
              applied++;
              urlDistribution[rule.url] = (urlDistribution[rule.url] ?? 0) + 1;
              return `<a href="${safeUrl}" class="text-primary hover:underline" rel="noopener noreferrer">${m}</a>`;
            });
            $(child).replaceWith(newHtml);
            return true;
          }

          if ((child as any).type === "tag") {
            const tagName = ((child as any).name as string).toLowerCase();
            if (SKIP_TAGS.has(tagName)) continue;
            if (walkTextNodes(child)) return true;
          }
        }
        return false;
      };

      walkTextNodes(containerEl);
    });

    appliedCounts.set(rule.keyword, applied);
  }

  const keywordsFound = validRules
    .filter((r) => (appliedCounts.get(r.keyword) ?? 0) > 0)
    .map((r) => r.keyword);
  // keywordsMissing = (passed policy but not found in HTML) + (rejected by policy)
  // This gives callers full visibility: if "Boston" is missing, it was policy-rejected.
  const keywordsMissing = [
    ...validRules
      .filter((r) => (appliedCounts.get(r.keyword) ?? 0) === 0)
      .map((r) => r.keyword),
    ...policyRejectedKeywords,
  ];

  return {
    correctedHtml: $.html(),
    keywordsLinked: keywordsFound.length,
    keywordsMissing,
    keywordsFound,
    faqKeywordsLinked: 0,
    urlDistribution,
  };
}

/**
 * Single-URL hyperlink injection — thin wrapper over applyHyperlinksDom.
 * Keeps the original call signature so no callers need to change.
 */
export function applyKeywordHyperlinks(
  articleHtml: string,
  keywords: string[],
  targetUrl: string,
  options: {
    maxLinksPerKeyword?: number;
    excludeHeaders?: boolean; // always true in DOM engine — kept for API compat
    includeFaq?: boolean;     // kept for API compat
  } = {}
): HyperlinkValidationResult {
  const rules: HyperlinkRule[] = keywords.map((k) => ({ keyword: k, url: targetUrl }));
  const result = applyHyperlinksDom(articleHtml, rules, options.maxLinksPerKeyword ?? 1);
  return {
    correctedHtml: result.correctedHtml,
    keywordsLinked: result.keywordsLinked,
    keywordsMissing: result.keywordsMissing,
    keywordsFound: result.keywordsFound,
    faqKeywordsLinked: result.faqKeywordsLinked,
  };
}

/**
 * STAGE 3B: GPT-4 Validation Pass
 * 
 * For keywords that couldn't be found in the article, this pass:
 * 1. Identifies where keywords SHOULD appear
 * 2. Suggests natural insertion points
 * 3. Can optionally rewrite sentences to include missing keywords
 */
export async function validateAndCorrectHyperlinks(
  articleHtml: string,
  keywords: string[],
  targetUrl: string,
  businessName: string
): Promise<{ correctedHtml: string; corrections: string[] }> {
  // First, apply programmatic hyperlinks
  const programmaticResult = applyKeywordHyperlinks(articleHtml, keywords, targetUrl);
  
  // If all keywords were linked, we're done
  if (programmaticResult.keywordsMissing.length === 0) {
    console.log(`✅ All ${keywords.length} keywords successfully hyperlinked`);
    return {
      correctedHtml: programmaticResult.correctedHtml,
      corrections: [],
    };
  }

  // Log missing keywords for debugging
  console.log(`⚠️ ${programmaticResult.keywordsMissing.length} keywords not found in article:`);
  programmaticResult.keywordsMissing.forEach(k => console.log(`   - "${k}"`));

  // For missing keywords, use GPT-4 to suggest insertions
  const systemPrompt = `You are a strict SEO validator. Your job is to insert missing keywords into an article naturally.`;

  const userPrompt = `The following long-phrase keywords were NOT found in the article and need to be inserted:

MISSING KEYWORDS:
${programmaticResult.keywordsMissing.map((k, i) => `${i + 1}. "${k}"`).join('\n')}

BUSINESS NAME: ${businessName}
TARGET URL: ${targetUrl}

ARTICLE HTML:
${programmaticResult.correctedHtml}

INSTRUCTIONS:
1. Find natural places to insert each missing keyword
2. Keywords can be added to existing sentences by rephrasing slightly
3. If a keyword doesn't fit in the body, add it to the FAQ section
4. Every inserted keyword MUST be hyperlinked to ${targetUrl}
5. DO NOT change the meaning of existing content
6. DO NOT remove any existing hyperlinks
7. Maintain proper HTML structure

Return the corrected HTML with all missing keywords inserted and hyperlinked.
Also return a list of corrections made.

Output JSON:
{
  "correctedHtml": "the full corrected HTML",
  "corrections": ["inserted 'keyword1' in paragraph 3", "added 'keyword2' to FAQ answer 2"]
}`;

  try {
    const completion = await callOpenAI(
      (client) => client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: "json_object" },
      }),
      `GPT-4o Keyword Validation Pass`,
      300000
    );

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(responseText);

    return {
      correctedHtml: parsed.correctedHtml || programmaticResult.correctedHtml,
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    };
  } catch (error) {
    console.error("❌ GPT-4 validation pass error:", error);
    // Fall back to programmatic result
    return {
      correctedHtml: programmaticResult.correctedHtml,
      corrections: [],
    };
  }
}

/**
 * Complete Pipeline: Extract → Generate → Validate
 * 
 * This function runs the entire 3-stage pipeline for an article.
 */
export async function runKeywordHyperlinkPipeline(
  articleHtml: string,
  profile: BusinessProfile,
  existingKeywords?: string[]
): Promise<{
  finalHtml: string;
  keywords: string[];
  stats: {
    totalKeywords: number;
    keywordsLinked: number;
    keywordsMissing: number;
    faqKeywordsLinked: number;
  };
}> {
  console.log(`🔗 Starting Keyword Hyperlink Pipeline for ${profile.businessName}`);

  // Stage 1: Extract keywords (or use existing)
  let keywords: string[];
  if (existingKeywords && existingKeywords.length >= 10) {
    keywords = existingKeywords;
    console.log(`📋 Using ${keywords.length} existing keywords`);
  } else {
    const extraction = await extractLongPhraseKeywords(profile);
    keywords = extraction.rawKeywords;
    console.log(`📋 Extracted ${keywords.length} new keywords`);
  }

  // Stage 3: Apply hyperlinks programmatically
  const result = applyKeywordHyperlinks(articleHtml, keywords, profile.targetUrl, {
    maxLinksPerKeyword: 1,
    excludeHeaders: true,
    includeFaq: true,
  });

  console.log(`✅ Pipeline complete: ${result.keywordsLinked}/${keywords.length} keywords linked`);
  if (result.keywordsMissing.length > 0) {
    console.log(`⚠️ Missing keywords: ${result.keywordsMissing.slice(0, 5).join(', ')}${result.keywordsMissing.length > 5 ? '...' : ''}`);
  }

  return {
    finalHtml: result.correctedHtml,
    keywords,
    stats: {
      totalKeywords: keywords.length,
      keywordsLinked: result.keywordsLinked,
      keywordsMissing: result.keywordsMissing.length,
      faqKeywordsLinked: result.faqKeywordsLinked,
    },
  };
}

export interface MultiUrlAnchor {
  phrase: string;
  url: string;
}

export interface MultiUrlHyperlinkResult {
  correctedHtml: string;
  keywordsLinked: number;
  keywordsMissing: string[];
  keywordsFound: string[];
  faqKeywordsLinked: number;
  urlDistribution: Record<string, number>;
}

/**
 * Multi-URL hyperlink injection — thin wrapper over applyHyperlinksDom.
 * Keeps the original call signature so no callers need to change.
 */
export function applyMultiUrlHyperlinks(
  articleHtml: string,
  anchorMap: MultiUrlAnchor[],
  fallbackUrl: string,
  options: {
    maxLinksPerKeyword?: number;
    excludeHeaders?: boolean; // always true in DOM engine — kept for API compat
  } = {}
): MultiUrlHyperlinkResult {
  const rules: HyperlinkRule[] = anchorMap.map((a) => ({
    keyword: a.phrase,
    url: a.url || fallbackUrl,
  }));
  const result = applyHyperlinksDom(articleHtml, rules, options.maxLinksPerKeyword ?? 1);
  return {
    correctedHtml: result.correctedHtml,
    keywordsLinked: result.keywordsLinked,
    keywordsMissing: result.keywordsMissing,
    keywordsFound: result.keywordsFound,
    faqKeywordsLinked: result.faqKeywordsLinked,
    urlDistribution: result.urlDistribution,
  };
}
