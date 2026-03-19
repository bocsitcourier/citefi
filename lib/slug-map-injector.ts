/**
 * GLOBAL SLUG MAP INJECTOR
 * ========================
 * Single source of truth for ALL hyperlink injection across the platform.
 *
 * Architecture:
 *   buildSlugMap()               — reads crawled sitePages from DB + fallback terms → [{keyword, url}]
 *   injectLinksFromSlugMap()     — synchronous Cheerio injection (literal keyword matching)
 *   injectLinksWithIntent()      — async, AI-powered intent-driven injection (preferred)
 *
 * Intent-driven mode (default for articles):
 *   Uses Gemini to find verbatim phrases in the article that semantically
 *   match each crawled page's topic — not just literal title/topic strings.
 *   Falls back to literal matching if AI call fails or returns no results.
 *
 * Literal-matching mode (fallback / fix-hyperlinks route):
 *   Page titles and topics[] are used as exact keyword strings.
 *   Cheerio injects a link only when the string appears verbatim in the HTML.
 */

import { db } from "./db";
import { sitePages } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { applyHyperlinksDom, HyperlinkRule, extractPhrasesFromHtml } from "./keyword-hyperlink-pipeline";
import type { SitePage } from "../shared/schema";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface SlugMapEntry {
  keyword: string;
  url: string;
}

export interface InjectionResult {
  html: string;
  linksInjected: number;
  linkedKeywords: string[];
  mode: "intent" | "site-map" | "fallback" | "none";
}

// ---------------------------------------------------------------------------
// STOP WORDS — single-word stopwords that should never stand alone as anchors
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the","a","an","in","on","at","to","for","of","is","are","was","were",
  "and","or","but","this","that","these","those","it","its","we","our",
  "you","your","they","their","with","from","by","about","as","into",
  "how","what","when","where","which","who","why","be","been","being",
  "have","has","had","do","does","did","will","would","could","should",
  "may","might","must","shall","can","not","no","so","if","then","than",
  "also","more","most","any","all","each","both","few","many","some",
  "very","just","only","even","new","such","other","same","here","there",
  "learn","click","read","visit","contact","view","find","get","call",
  "more","info","information","details","page","home","menu","search",
]);

function isUsableKeyword(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/);
  if (words.length < 2) return false;
  if (words.length > 8) return false; // reject overly long phrases (e.g. full geo-focus lists)
  if (phrase.includes(",")) return false; // comma = multi-value list, never a good anchor
  if (phrase.length < 8) return false;
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return false;
  if (STOP_WORDS.has(first.toLowerCase())) return false;
  if (STOP_WORDS.has(last.toLowerCase())) return false;
  return true;
}

// ---------------------------------------------------------------------------
// DOMAIN UTILITIES
// ---------------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractRootDomain(domain: string): string {
  const parts = domain.replace(/^www\./, "").split(".");
  const penultimate = parts[parts.length - 2];
  const ccTLD = parts.length >= 3 && !!penultimate && penultimate.length <= 3;
  return ccTLD ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

// ---------------------------------------------------------------------------
// buildSlugMap
// ---------------------------------------------------------------------------

/**
 * Build the keyword→URL dictionary for a team + target URL.
 * Also returns the raw crawled pages so callers can pass them to injectLinksWithIntent().
 *
 * Priority 1 (site-map mode): Reads from `sitePages` crawled for this team/domain.
 *   Keywords come from page.title and page.topics[] — filtered to min 2 words.
 *   Each keyword points to its own page URL, enabling multi-URL internal linking.
 *
 * Priority 2 (fallback mode): When no crawl data exists, constructs candidates from
 *   coreTopic + businessName + geographicFocus combinations → all point to targetUrl.
 *
 * Result is deduped (case-insensitive) and sorted longest-first so the Cheerio
 * engine matches longer phrases before consuming text needed by shorter ones.
 */
export async function buildSlugMap(
  teamId: number,
  targetUrl: string,
  fallbackTerms: string[] = []
): Promise<{ entries: SlugMapEntry[]; mode: "site-map" | "fallback"; pages: SitePage[] }> {
  const domain = extractDomain(targetUrl);
  const rootDomain = extractRootDomain(domain);

  // Try exact domain, then root domain (handles subdomain mismatches)
  let pages = await db
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.teamId, teamId), eq(sitePages.domain, domain), eq(sitePages.isActive, 1)));

  if (pages.length === 0 && rootDomain !== domain) {
    pages = await db
      .select()
      .from(sitePages)
      .where(and(eq(sitePages.teamId, teamId), eq(sitePages.domain, rootDomain), eq(sitePages.isActive, 1)));
  }

  const raw: SlugMapEntry[] = [];

  if (pages.length > 0) {
    // ── SITE-MAP MODE ──────────────────────────────────────────────────────
    // Extract literal keywords from page titles and topics arrays.
    // These serve as the fallback when intent engine is not used.
    for (const page of pages) {
      const pageUrl = page.url;

      if (page.title && isUsableKeyword(page.title)) {
        raw.push({ keyword: page.title.trim(), url: pageUrl });
      }

      const topics: string[] = Array.isArray(page.topics) ? (page.topics as string[]) : [];
      for (const topic of topics) {
        if (topic && isUsableKeyword(topic)) {
          raw.push({ keyword: topic.trim(), url: pageUrl });
        }
      }
    }

    // Supplement with fallback terms pointing to targetUrl
    for (const term of fallbackTerms) {
      if (term && isUsableKeyword(term)) {
        raw.push({ keyword: term.trim(), url: targetUrl });
      }
    }

    const deduped = dedup(raw);
    console.log(`🗺️ Slug map (site-map mode): ${deduped.length} keywords from ${pages.length} crawled pages`);
    return { entries: deduped, mode: "site-map", pages };
  }

  // ── FALLBACK MODE ─────────────────────────────────────────────────────────
  // No crawl data — build candidates from batch context terms.
  for (const term of fallbackTerms) {
    if (term && isUsableKeyword(term)) {
      raw.push({ keyword: term.trim(), url: targetUrl });
    }
  }

  const deduped = dedup(raw);
  console.log(`🗺️ Slug map (fallback mode): ${deduped.length} keywords from batch context (no site crawl)`);
  return { entries: deduped, mode: deduped.length > 0 ? "fallback" : "fallback", pages: [] };
}

/**
 * Deduplicate entries (case-insensitive) and sort longest-first.
 * Longest-first prevents a 2-word phrase from consuming text needed by a 5-word phrase.
 */
function dedup(entries: SlugMapEntry[]): SlugMapEntry[] {
  const seen = new Map<string, SlugMapEntry>();
  for (const e of entries) {
    const key = e.keyword.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, e);
    }
  }
  return [...seen.values()].sort((a, b) => b.keyword.length - a.keyword.length);
}

// ---------------------------------------------------------------------------
// injectLinksWithIntent — ASYNC, intent-driven (preferred for new articles)
// ---------------------------------------------------------------------------

/**
 * Intent-driven hyperlink injection using AI anchor text selection.
 *
 * When crawled site pages are available:
 *   1. Calls Gemini to find verbatim article phrases that match each page's intent
 *   2. Falls back to literal keyword matching if AI returns < 2 results
 *   3. Supplements with literal fallback entries for any pages not intent-matched
 *
 * When only fallback terms exist (no site crawl):
 *   Falls back to literal keyword matching via the synchronous path.
 *
 * @param html          Final GPT-4-generated article HTML
 * @param entries       Literal slug map entries from buildSlugMap()
 * @param pages         Raw crawled SitePage rows from buildSlugMap()
 * @param targetUrl     Primary site URL (fallback for literal entries)
 * @param articleTitle  For log messages
 */
export async function injectLinksWithIntent(
  html: string,
  entries: SlugMapEntry[],
  pages: SitePage[],
  targetUrl: string,
  articleTitle = "article",
  fallbackTopicHints: string[] = []
): Promise<InjectionResult> {
  if (!html) {
    return { html, linksInjected: 0, linkedKeywords: [], mode: "none" };
  }

  const hasCrawledPages = pages.length > 0;
  let intentEntries: SlugMapEntry[] = [];

  if (hasCrawledPages) {
    // ── SITE-MAP MODE: AI intent engine finds semantically matched phrases ──
    try {
      const { buildIntentDrivenAnchors } = await import("./intent-hyperlink-engine");
      intentEntries = await buildIntentDrivenAnchors(html, pages, targetUrl);
    } catch (err) {
      console.warn("[SlugMap] Intent engine import/call failed, using literal fallback:", err);
    }
  } else {
    // ── FALLBACK MODE: content-first extraction — guaranteed verbatim matches ──
    //
    // ARCHITECT FIX: Instead of hunting for pre-defined keyword strings that
    // may not exist verbatim in the article (because GPT-4 paraphrases them),
    // extract real 4-7 word n-gram phrases that ALREADY EXIST in the article
    // text and relate to the topic. 100% match rate by construction.
    //
    // Topic hints = coreTopic + businessName + split city names + gemini keywords
    const hints = [
      ...fallbackTopicHints,
      ...entries.map((e) => e.keyword),
    ].filter((h) => h && h.trim().length > 2);

    const extractedPhrases = extractPhrasesFromHtml(html, hints, 12);
    console.log(`[SlugMap] Fallback content-first extraction: ${extractedPhrases.length} phrases from article for "${articleTitle}"`);

    for (const phrase of extractedPhrases) {
      if (isUsableKeyword(phrase)) {
        intentEntries.push({ keyword: phrase, url: targetUrl });
      }
    }
  }

  // ── MERGE STRATEGY ─────────────────────────────────────────────────────────
  // Always dedupe by phrase to prevent double-anchoring the same text.
  // URL dedupe is ONLY applied in site-map mode where multiple URLs exist.
  // In fallback mode every candidate points to the same targetUrl, so URL
  // deduplication would incorrectly eliminate all but the first candidate.
  const usedPhrases = new Set(intentEntries.map((e) => e.keyword.toLowerCase()));
  const usedUrls = new Set(hasCrawledPages ? intentEntries.map((e) => e.url) : []);

  const supplementEntries: SlugMapEntry[] = [];
  for (const e of entries) {
    const phraseKey = e.keyword.toLowerCase();
    const urlConflict = hasCrawledPages && usedUrls.has(e.url);
    if (!usedPhrases.has(phraseKey) && !urlConflict) {
      supplementEntries.push(e);
      usedPhrases.add(phraseKey);
      if (hasCrawledPages) usedUrls.add(e.url);
    }
  }

  const mergedEntries = [...intentEntries, ...supplementEntries];

  if (mergedEntries.length === 0) {
    const mode = hasCrawledPages ? "site-map" : "fallback";
    console.log(`[Pipeline] No anchor candidates — skipping hyperlink injection for "${articleTitle}"`);
    return { html, linksInjected: 0, linkedKeywords: [], mode };
  }

  const rules: HyperlinkRule[] = mergedEntries.map((e) => ({
    keyword: e.keyword,
    url: e.url,
    maxLinks: 1,
  }));

  const result = applyHyperlinksDom(html, rules, 1);

  const injectionMode: InjectionResult["mode"] =
    intentEntries.length >= 2
      ? "intent"
      : hasCrawledPages
      ? "site-map"
      : "fallback";

  console.log(
    `[Pipeline] Added ${result.keywordsLinked} hyperlinks to "${articleTitle}" ` +
      `(${injectionMode} mode, ${mergedEntries.length} candidates).` +
      (result.keywordsLinked > 0
        ? ` Linked: ${result.keywordsFound.slice(0, 5).join(", ")}${result.keywordsFound.length > 5 ? "…" : ""}`
        : " (no keyword matches found in article text)")
  );

  return {
    html: result.correctedHtml,
    linksInjected: result.keywordsLinked,
    linkedKeywords: result.keywordsFound,
    mode: injectionMode,
  };
}

// ---------------------------------------------------------------------------
// injectLinksFromSlugMap — synchronous legacy (kept for fix-hyperlinks routes)
// ---------------------------------------------------------------------------

/**
 * Synchronous hyperlink injection from a pre-built slug map dictionary.
 * Uses literal keyword matching via the Cheerio DOM engine.
 *
 * Use injectLinksWithIntent() for new article generation — it uses AI to
 * find semantically relevant anchor phrases instead of literal title matches.
 *
 * @param html        Final GPT-4-generated article HTML
 * @param entries     Slug map entries from buildSlugMap()
 * @param articleTitle For the success log message
 */
export function injectLinksFromSlugMap(
  html: string,
  entries: SlugMapEntry[],
  articleTitle = "article"
): InjectionResult {
  if (!html || entries.length === 0) {
    console.log(`[Pipeline] No slug map entries — skipping hyperlink injection for "${articleTitle}"`);
    return { html, linksInjected: 0, linkedKeywords: [], mode: "none" };
  }

  const rules: HyperlinkRule[] = entries.map((e) => ({
    keyword: e.keyword,
    url: e.url,
    maxLinks: 1,
  }));

  const result = applyHyperlinksDom(html, rules, 1);

  const mode: InjectionResult["mode"] = result.keywordsLinked > 0 ? "site-map" : "fallback";

  console.log(
    `[Pipeline Success] Added ${result.keywordsLinked} hyperlinks to "${articleTitle}" using Cheerio DOM injection.` +
      (result.keywordsLinked > 0
        ? ` Linked: ${result.keywordsFound.slice(0, 5).join(", ")}${result.keywordsFound.length > 5 ? "…" : ""}`
        : " (no keyword matches found in article text)")
  );

  return {
    html: result.correctedHtml,
    linksInjected: result.keywordsLinked,
    linkedKeywords: result.keywordsFound,
    mode,
  };
}

// ---------------------------------------------------------------------------
// buildFallbackTerms — helper to construct fallback term list from batch data
// ---------------------------------------------------------------------------

/**
 * Builds the fallback term list from batch fields.
 * Call this before buildSlugMap() to construct the fallbackTerms argument.
 *
 * Sources (in priority order):
 *   1. coreTopic (often 3-6 words — perfect anchor text)
 *   2. geographicFocus (e.g. "Boston, MA")
 *   3. businessName
 *   4. Gemini-generated keywords (top 8, filtered to >=4 words)
 *   5. Service+geo combinations built from coreTopic × geographicFocus
 */
export function buildFallbackTerms(opts: {
  coreTopic?: string | null;
  geographicFocus?: string | null;
  businessName?: string | null;
  geminiKeywords?: string[];
}): string[] {
  const { coreTopic, geographicFocus, businessName, geminiKeywords = [] } = opts;
  const terms: string[] = [];

  if (coreTopic) terms.push(coreTopic.trim());

  // Split multi-city geographic focus into individual city terms so each city
  // gets its own link rather than the entire comma-separated list being wrapped
  // in one giant anchor tag (e.g. "Boston MA, Cambridge MA, Newton MA" → 3 terms).
  const geoTerms: string[] = [];
  if (geographicFocus) {
    const cities = geographicFocus.split(",").map((c) => c.trim()).filter((c) => c.length > 2);
    for (const city of cities) {
      geoTerms.push(city);
      terms.push(city);
    }
  }

  if (businessName) terms.push(businessName.trim());

  // Combine with the PRIMARY city only to avoid monster-length anchor text
  const primaryGeo = geoTerms[0] ?? null;
  if (coreTopic && primaryGeo) {
    terms.push(`${coreTopic.trim()} in ${primaryGeo}`);
    terms.push(`${coreTopic.trim()} ${primaryGeo}`);
  }
  if (businessName && primaryGeo) {
    terms.push(`${businessName.trim()} ${primaryGeo}`);
  }

  for (const kw of geminiKeywords.slice(0, 8)) {
    if (kw && kw.trim().split(/\s+/).length >= 3) {
      terms.push(kw.trim());
    }
  }

  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key) || !isUsableKeyword(t)) return false;
    seen.add(key);
    return true;
  });
}
