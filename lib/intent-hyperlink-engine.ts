/**
 * INTENT-DRIVEN HYPERLINK ENGINE
 * ================================
 * Replaces literal keyword matching with AI-powered semantic anchor selection.
 *
 * Problem with the old system:
 *   buildSlugMap() extracted page.title and page.topics[] as keywords, then
 *   Cheerio looked for those EXACT strings in the article. Result: zero matches
 *   when the article was generated independently of the page titles, plus
 *   irrelevant anchors when matches did occur.
 *
 * This system instead:
 *   1. Understands what each crawled page is actually ABOUT (its intent)
 *   2. Reads the full generated article as prose
 *   3. Uses Gemini to find verbatim phrases in the article that naturally
 *      signal the same intent as each page — making them ideal anchor text
 *   4. Verifies every returned phrase exists literally in the article (no hallucination)
 *   5. Returns phrase→URL pairs for the Cheerio injector
 */

import { GoogleGenAI } from "@google/genai";
import { throttledGeminiRequest } from "./gemini";
import type { SitePage } from "../shared/schema";
import type { SlugMapEntry } from "./slug-map-injector";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Max pages to send to AI in one call — keeps prompt size manageable
const MAX_PAGES = 35;
// Max article characters sent to AI — 2.0-flash has 1M ctx but we cap for speed
const MAX_ARTICLE_CHARS = 14000;

interface AnchorSuggestion {
  phrase: string;
  url: string;
  confidence: number;
}

/**
 * Strips HTML tags and collapses whitespace to get clean prose text.
 * Preserves paragraph breaks as " | " so AI can understand article structure.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/p>/gi, " | ")
    .replace(/<\/li>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ \| +/g, " | ")
    .trim();
}

/**
 * AI-powered intent-driven anchor text selection.
 *
 * Given article HTML and crawled site pages, uses Gemini Flash to:
 * 1. Understand each page's topic/intent from title + topics + summary
 * 2. Find verbatim phrases in the article that match each page's intent
 * 3. Return validated phrase→URL pairs for Cheerio injection
 *
 * Every returned phrase is verified to exist verbatim in the article text
 * before being included — zero hallucination possible.
 *
 * @param articleHtml  Final generated article HTML
 * @param pages        Crawled site pages from sitePages DB table
 * @param targetUrl    Fallback/primary URL for the site
 * @returns            SlugMapEntry[] ready for applyHyperlinksDom()
 */
export async function buildIntentDrivenAnchors(
  articleHtml: string,
  pages: SitePage[],
  targetUrl: string
): Promise<SlugMapEntry[]> {
  if (!articleHtml || pages.length === 0) return [];

  const articleText = stripHtml(articleHtml).slice(0, MAX_ARTICLE_CHARS);

  // Build intent descriptions for each page — exclude low-signal pages
  const pageIntents = pages
    .filter((p) => p.title || (Array.isArray(p.topics) && (p.topics as string[]).length > 0))
    .slice(0, MAX_PAGES)
    .map((p) => {
      const topics = Array.isArray(p.topics) ? (p.topics as string[]).slice(0, 6).join(", ") : "";
      const summary = p.contentSummary ? p.contentSummary.slice(0, 120) : "";
      const parts = [p.title, topics, summary].filter(Boolean).join(" | ");
      return { url: p.url, intent: parts };
    });

  if (pageIntents.length === 0) return [];

  const pageList = pageIntents
    .map((p, i) => `${i + 1}. URL: ${p.url}\n   Intent: ${p.intent}`)
    .join("\n\n");

  const prompt = `You are an expert SEO specialist choosing internal hyperlink anchor text.

TASK: For each website page listed below, find ONE phrase from the article text that:
1. EXISTS VERBATIM in the article — copy it character-for-character, exact case
2. Naturally expresses the same topic or intent as that page
3. Is 3–8 words long (never a single word or just a service name)
4. Makes contextual sense as a hyperlink for a reader exploring that topic
5. Is the most specific, descriptive phrase available — not generic filler

ARTICLE TEXT:
${articleText}

WEBSITE PAGES (find anchor text for each relevant page):
${pageList}

STRICT RULES:
- ONLY return phrases that appear VERBATIM in the article text above
- Return 0 results for a page rather than invent a phrase
- Never use the same phrase for two different pages
- Prefer phrases with 4–7 words over shorter ones
- Skip pages whose topic has no relevant passage in the article
- Confidence: 1.0 = perfect contextual match, 0.5 = acceptable match, below 0.6 skip it

Return a JSON array. Only include pages where you found a genuine match.`;

  try {
    const result = await throttledGeminiRequest(() =>
      genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "array",
            items: {
              type: "object",
              properties: {
                phrase: {
                  type: "string",
                  description: "Verbatim phrase from the article text",
                },
                url: {
                  type: "string",
                  description: "Target page URL from the list above",
                },
                confidence: {
                  type: "number",
                  description: "Match quality: 0.6–1.0",
                },
              },
              required: ["phrase", "url", "confidence"],
            },
          },
          temperature: 0.1,
        },
      })
    );

    const raw = result.text;
    if (!raw) {
      console.warn("[IntentEngine] Empty response from Gemini");
      return [];
    }

    let suggestions: AnchorSuggestion[] = [];
    try {
      suggestions = JSON.parse(raw);
    } catch {
      console.warn("[IntentEngine] Failed to parse Gemini response as JSON");
      return [];
    }

    const articleLower = articleText.toLowerCase();
    const usedPhrases = new Set<string>();
    const usedUrls = new Set<string>();
    const validated: SlugMapEntry[] = [];

    for (const s of suggestions) {
      if (!s.phrase || !s.url) continue;

      // Filter low-confidence matches
      if (typeof s.confidence === "number" && s.confidence < 0.6) continue;

      const phraseLower = s.phrase.toLowerCase().trim();

      // CRITICAL: Verify phrase exists verbatim in article (prevents hallucination)
      if (!articleLower.includes(phraseLower)) {
        console.log(`[IntentEngine] Rejected hallucinated phrase: "${s.phrase.slice(0, 60)}"`);
        continue;
      }

      // Enforce minimum phrase quality
      const words = s.phrase.trim().split(/\s+/);
      if (words.length < 2) continue;
      if (s.phrase.trim().length < 6) continue;

      // Deduplicate
      if (usedPhrases.has(phraseLower)) continue;
      if (usedUrls.has(s.url)) continue;

      // Validate URL
      if (!s.url.match(/^https?:\/\//i)) continue;

      usedPhrases.add(phraseLower);
      usedUrls.add(s.url);
      validated.push({ keyword: s.phrase.trim(), url: s.url });
    }

    console.log(
      `🧠 [IntentEngine] ${validated.length}/${pageIntents.length} pages matched with intent-driven anchor text` +
        (validated.length > 0
          ? ` | Sample: "${validated[0].keyword.slice(0, 50)}" → ${new URL(validated[0].url).pathname}`
          : " (no matches)")
    );

    return validated;
  } catch (err) {
    console.error("[IntentEngine] Gemini call failed — falling back to literal matching:", err);
    return [];
  }
}
