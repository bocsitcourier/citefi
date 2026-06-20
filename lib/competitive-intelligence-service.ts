/**
 * CompetitiveIntelligenceService
 *
 * Mines what performed in the market (not just what competitors posted) and
 * feeds transferable patterns into the learning loop and generator prompts.
 *
 * A competitor's viral post is a free A/B test result — extract the transferable
 * mechanics, seed them as unproven external candidates at low Wilson score, and
 * let the team's own audience validate them.
 *
 * Out of scope: direct social platform API scraping, paid CI tools, copying
 * competitor voice/catchphrases. Only transferable mechanics via Brave Search.
 */

import { GEMINI_FLASH_MODEL } from "./ai-config";
import { GoogleGenAI } from "@google/genai";
import { PATTERN_DIMENSION } from "./pattern-dimension-map";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ============================================================================
// Public Types
// ============================================================================

export type ContentTypeCI = "social" | "video" | "podcast";

export interface ExternalPattern {
  patternType: string;           // maps to PATTERN_DIMENSION keys
  patternName: string;
  patternValue: string;          // transferable mechanic description
  externalUrl?: string;          // source URL
  externalPlatform?: string;     // youtube | tiktok | instagram | linkedin | podcast
  confidenceNote?: string;       // why we trust (or don't) this signal
}

export interface GapOpportunity {
  angle: string;                 // underserved content angle
  evidence: string;              // why no one is covering it
  confidenceScore: number;       // 0-100
  suggestedFormats: string[];    // recommended content formats for this gap
}

export interface NicheResearchResult {
  topic: string;
  industry: string;
  location?: string;
  contentType: ContentTypeCI;
  topPerformers: Array<{
    title: string;
    url: string;
    platform: string;
    estimatedEngagement: "high" | "medium" | "low";
    signals: string[];           // observable signals (views, comments, shares estimates)
  }>;
  searchesPerformed: number;
  researchTimestamp: Date;
}

export interface CompetitiveIntelContext {
  externalHookPatterns: string[];      // top 3 external hook patterns
  gapAngles: string[];                 // underserved content angles
  platformSignals?: string[];          // video-specific: pacing, hold-rate proxies
  trustNote: string;                   // explains confidence level for this content type
}

// ============================================================================
// Platform-specific search strategies
// ============================================================================

function buildSearchQueries(
  topic: string,
  industry: string,
  location: string | undefined,
  contentType: ContentTypeCI
): string[] {
  const geo = location ? ` ${location}` : "";
  const base = `${topic}${geo} ${industry}`;

  switch (contentType) {
    case "video":
      return [
        `best YouTube videos ${base} most viewed`,
        `viral TikTok ${base} trending 2024 2025`,
        `top performing video content ${base} high engagement`,
        `YouTube top creators ${industry} ${topic}`,
      ];
    case "social":
      return [
        `top performing LinkedIn posts ${base}`,
        `viral Instagram content ${base} high engagement`,
        `best Facebook posts ${base} most shared`,
        `social media content that went viral ${base}`,
      ];
    case "podcast":
      return [
        `top podcast episodes ${base} most downloaded`,
        `best podcast shows ${industry} ${topic}`,
        `podcast directory ${base} popular episodes`,
        `Apple Podcasts Spotify top ${industry} shows`,
      ];
    default:
      return [`best performing content ${base}`];
  }
}

function detectPlatform(url: string, contentType: ContentTypeCI): string {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("facebook.com")) return "facebook";
  if (url.includes("spotify.com")) return "podcast";
  if (url.includes("podcasts.apple.com")) return "podcast";
  if (url.includes("buzzsprout") || url.includes("libsyn") || url.includes("anchor.fm")) return "podcast";
  return contentType === "video" ? "video" : contentType === "podcast" ? "podcast" : "social";
}

function estimateEngagement(result: {
  title?: string;
  description?: string;
  url?: string;
}): "high" | "medium" | "low" {
  const title = result.title || "";
  const desc = result.description || "";
  const combined = `${title} ${desc}`.toLowerCase();

  let score = 0;
  if (combined.match(/\d+[km]?\s*(views|subscribers|followers|likes)/i)) score += 3;
  if (combined.match(/viral|trending|popular|top|best|most/i)) score += 2;
  if (title.match(/^\d+/)) score += 1;
  if (title.match(/(how|what|why|when)/i)) score += 1;
  if (combined.match(/million|10k|100k|1m/i)) score += 2;
  if ((result.url || "").includes("youtube.com")) score += 1;

  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function extractSignals(result: {
  title?: string;
  description?: string;
}): string[] {
  const signals: string[] = [];
  const combined = `${result.title || ""} ${result.description || ""}`.toLowerCase();

  const viewMatch = combined.match(/(\d[\d,.]+[km]?)\s*views?/i);
  if (viewMatch) signals.push(`~${viewMatch[1]} views`);

  const subMatch = combined.match(/(\d[\d,.]+[km]?)\s*(subscribers?|followers?)/i);
  if (subMatch) signals.push(`${subMatch[1]} ${subMatch[2]}`);

  if (combined.match(/trending/i)) signals.push("trending");
  if (combined.match(/viral/i)) signals.push("viral");
  if (combined.match(/featured|top|best|award/i)) signals.push("top-ranked");

  return signals;
}

// ============================================================================
// Brave Search helper
// ============================================================================

async function braveSearch(query: string, apiKey: string): Promise<any[]> {
  const params = new URLSearchParams({ q: query, count: "10", safesearch: "moderate" });
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });
  if (!response.ok) throw new Error(`Brave API error: ${response.status}`);
  const data = await response.json() as any;
  return data.web?.results || [];
}

// ============================================================================
// Core Service
// ============================================================================

export class CompetitiveIntelligenceService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.BRAVE_API_KEY;
  }

  /**
   * Phase 1: Research what top performers in the niche look like.
   * Uses Brave Search with content-type-specific query strategies.
   */
  async researchNichePerformance(
    topic: string,
    industry: string,
    location: string | undefined,
    contentType: ContentTypeCI
  ): Promise<NicheResearchResult> {
    const result: NicheResearchResult = {
      topic,
      industry,
      location,
      contentType,
      topPerformers: [],
      searchesPerformed: 0,
      researchTimestamp: new Date(),
    };

    if (!this.apiKey) {
      console.warn("[CompetitiveIntel] No BRAVE_API_KEY — returning fallback research");
      return this.getFallbackResearch(topic, industry, location, contentType);
    }

    const queries = buildSearchQueries(topic, industry, location, contentType);
    const seen = new Set<string>();

    for (const query of queries.slice(0, 4)) {
      try {
        const raw = await braveSearch(query, this.apiKey);
        result.searchesPerformed++;

        for (const r of raw.slice(0, 6)) {
          const url = r.url || "";
          if (!url || seen.has(url)) continue;
          seen.add(url);

          result.topPerformers.push({
            title: r.title || "",
            url,
            platform: detectPlatform(url, contentType),
            estimatedEngagement: estimateEngagement(r),
            signals: extractSignals(r),
          });
        }
      } catch (err) {
        console.warn(`[CompetitiveIntel] Search failed for "${query}":`, (err as Error).message);
      }
    }

    // Sort by engagement
    result.topPerformers.sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return rank[b.estimatedEngagement] - rank[a.estimatedEngagement];
    });

    result.topPerformers = result.topPerformers.slice(0, 15);
    console.log(
      `[CompetitiveIntel] Research complete: ${result.topPerformers.length} performers, ${result.searchesPerformed} searches`
    );
    return result;
  }

  /**
   * Phase 2: Extract transferable mechanics from research results via Gemini.
   * Strips brand voice, catchphrases, audience-trust factors that don't transfer.
   */
  async extractTransferablePatterns(
    results: NicheResearchResult,
    contentType: ContentTypeCI
  ): Promise<ExternalPattern[]> {
    const { topic, industry, topPerformers } = results;

    if (topPerformers.length === 0) return this.getFallbackPatterns(contentType);

    const summaryLines = topPerformers
      .slice(0, 10)
      .map(
        (p, i) =>
          `${i + 1}. [${p.platform.toUpperCase()}] "${p.title}" — engagement: ${p.estimatedEngagement}${p.signals.length ? ` (${p.signals.join(", ")})` : ""}\n   URL: ${p.url}`
      )
      .join("\n");

    const contentTypeGuidance: Record<ContentTypeCI, string> = {
      social: `Focus on: hook formulas (question vs statement vs curiosity-gap), opening structure (problem-first vs answer-first vs story-first), post format choices (list vs narrative vs question thread).`,
      video: `Focus on: hook hold-rate patterns (first 3 seconds), scene pacing (cut frequency), opening question style, thumbnail title formula patterns (number-based vs question vs bold-claim), CTA placement timing (early vs mid vs end).`,
      podcast: `Focus on: cold-open style (mid-story vs stat vs question), episode structure (problem-solution vs interview-style vs storytelling), topic framing patterns. DO NOT include hook-strength claims since download/completion data is private.`,
    };

    const prompt = `You are an expert content strategist analyzing top-performing ${contentType} content in the ${industry} / ${topic} niche.

Below are the top performers discovered via search:
${summaryLines}

Your task: extract TRANSFERABLE CONTENT MECHANICS only — structural patterns, hook formulas, format choices, pacing descriptors.

CRITICAL RULES:
1. DO NOT copy any brand-specific voice, catchphrases, or audience-trust factors from specific creators.
2. DO NOT mention specific creator names or brands.
3. ONLY extract patterns that ANY brand could apply after adapting to their own voice.
4. ${contentTypeGuidance[contentType]}

Return a JSON array of 4-7 patterns. Each pattern must map to one of these types: hook, opening_style, pacing, format, structure, cta, visual_style, engagement.

Format:
[
  {
    "patternType": "hook",
    "patternName": "Direct Question Hook",
    "patternValue": "Open with a direct question that names the viewer's pain point in under 5 words. Top performers in this niche use this in 60%+ of high-engagement posts.",
    "externalPlatform": "youtube",
    "confidenceNote": "Observed across 3+ high-engagement performers"
  }
]

Return ONLY valid JSON array, no markdown, no explanations.`;

    try {
      const response = await genAI.models.generateContent({
        model: GEMINI_FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.3, maxOutputTokens: 2048 },
      });

      const text = (response.text || "").trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in Gemini response");

      const raw = JSON.parse(jsonMatch[0]) as any[];

      const validTypes = new Set(Object.keys(PATTERN_DIMENSION));
      const patterns: ExternalPattern[] = raw
        .filter((p) => p.patternType && p.patternName && p.patternValue)
        .map((p) => ({
          patternType: validTypes.has(p.patternType) ? p.patternType : "hook",
          patternName: String(p.patternName).slice(0, 255),
          patternValue: String(p.patternValue).slice(0, 2000),
          externalUrl: topPerformers.find(
            (t) => p.externalPlatform && t.platform === p.externalPlatform
          )?.url,
          externalPlatform: p.externalPlatform || undefined,
          confidenceNote: p.confidenceNote || undefined,
        }));

      console.log(`[CompetitiveIntel] Extracted ${patterns.length} transferable patterns`);
      return patterns;
    } catch (err) {
      console.warn("[CompetitiveIntel] Pattern extraction failed:", (err as Error).message);
      return this.getFallbackPatterns(contentType);
    }
  }

  /**
   * Phase 3: Gap analysis — underserved angles top creators are ignoring.
   */
  async performGapAnalysis(
    results: NicheResearchResult,
    topic: string,
    industry: string
  ): Promise<GapOpportunity[]> {
    const { topPerformers } = results;

    if (topPerformers.length === 0) return this.getFallbackGaps(topic, industry);

    const titleList = topPerformers
      .slice(0, 12)
      .map((p, i) => `${i + 1}. "${p.title}" [${p.platform}]`)
      .join("\n");

    const prompt = `You are an expert content strategist identifying content gaps in the ${industry} / ${topic} niche.

The top-performing content in this niche currently covers:
${titleList}

Your task: identify 3-5 UNDERSERVED ANGLES — questions no one answers well, formats nobody uses in this niche, angles the big creators are too large to bother with, or perspectives that would resonate with a local or SME audience.

For each gap, provide:
- angle: specific underserved content angle
- evidence: why no one is covering it (what you see in the existing titles above)
- confidenceScore: 0-100 (how confident you are this is genuinely underserved)
- suggestedFormats: 2-3 content formats that would work well for this angle

Return JSON array only:
[
  {
    "angle": "The overlooked regulatory side of ${topic} that affects local businesses",
    "evidence": "All top performers focus on how-to content; no one addresses compliance or local rules",
    "confidenceScore": 75,
    "suggestedFormats": ["explainer video", "Q&A podcast", "checklist social post"]
  }
]

Return ONLY valid JSON, no markdown.`;

    try {
      const response = await genAI.models.generateContent({
        model: GEMINI_FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { temperature: 0.5, maxOutputTokens: 1536 },
      });

      const text = (response.text || "").trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in response");

      const raw = JSON.parse(jsonMatch[0]) as any[];
      const gaps: GapOpportunity[] = raw
        .filter((g) => g.angle && g.evidence)
        .map((g) => ({
          angle: String(g.angle),
          evidence: String(g.evidence),
          confidenceScore: Math.min(100, Math.max(0, Number(g.confidenceScore) || 50)),
          suggestedFormats: Array.isArray(g.suggestedFormats) ? g.suggestedFormats.slice(0, 3) : [],
        }))
        .slice(0, 5);

      console.log(`[CompetitiveIntel] Gap analysis found ${gaps.length} opportunities`);
      return gaps;
    } catch (err) {
      console.warn("[CompetitiveIntel] Gap analysis failed:", (err as Error).message);
      return this.getFallbackGaps(topic, industry);
    }
  }

  /**
   * Build a CompetitiveIntelContext ready to inject into generator prompts.
   */
  buildPromptContext(
    patterns: ExternalPattern[],
    gaps: GapOpportunity[],
    contentType: ContentTypeCI
  ): CompetitiveIntelContext {
    const topHooks = patterns
      .filter((p) => ["hook", "opening_style", "opening"].includes(p.patternType))
      .slice(0, 3)
      .map((p) => `• ${p.patternName}: ${p.patternValue}`);

    const gapAngles = gaps
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 3)
      .map((g) => `• ${g.angle} (confidence: ${g.confidenceScore}%)`);

    const platformSignals =
      contentType === "video"
        ? patterns
            .filter((p) => ["pacing", "visual_style"].includes(p.patternType))
            .slice(0, 2)
            .map((p) => `• ${p.patternName}: ${p.patternValue}`)
        : undefined;

    const trustNotes: Record<ContentTypeCI, string> = {
      social: "Signals sourced from public engagement data (likes/shares counts are partly observable).",
      video: "Signals sourced from YouTube/TikTok search results — view counts and engagement are partly observable, making these medium-high confidence.",
      podcast: "Signals sourced from podcast directory listings — download/completion data is private, so treat these as topic/format inspiration only, not proven engagement patterns.",
    };

    return {
      externalHookPatterns: topHooks,
      gapAngles,
      platformSignals,
      trustNote: trustNotes[contentType],
    };
  }

  // ============================================================================
  // Fallbacks
  // ============================================================================

  private getFallbackResearch(
    topic: string,
    industry: string,
    location: string | undefined,
    contentType: ContentTypeCI
  ): NicheResearchResult {
    return {
      topic,
      industry,
      location,
      contentType,
      topPerformers: [],
      searchesPerformed: 0,
      researchTimestamp: new Date(),
    };
  }

  private getFallbackPatterns(contentType: ContentTypeCI): ExternalPattern[] {
    const fallbacks: Record<ContentTypeCI, ExternalPattern[]> = {
      social: [
        {
          patternType: "hook",
          patternName: "Curiosity-Gap Question",
          patternValue: "Open with a question that implies the audience is missing something valuable. 'What do most [audience] get wrong about [topic]?'",
          confidenceNote: "Common high-engagement pattern across social platforms",
        },
        {
          patternType: "format",
          patternName: "Numbered Insight List",
          patternValue: "Lead with a number: '3 things [topic experts] don't tell you about [topic]'. Numbers increase click-through by signaling bounded effort.",
          confidenceNote: "Consistent pattern in top social content",
        },
      ],
      video: [
        {
          patternType: "hook",
          patternName: "First-3-Second Direct Question",
          patternValue: "State the core problem or question in the first 3 seconds before any intro. 'If you're struggling with [problem], this is for you.'",
          confidenceNote: "High-retention pattern based on YouTube best practices",
        },
        {
          patternType: "pacing",
          patternName: "Fast Hook, Slow Value",
          patternValue: "Quick cuts for the first 10 seconds to hold attention, then slower pacing for key value-delivery sections.",
          confidenceNote: "Pacing pattern observed in high-retention video content",
        },
      ],
      podcast: [
        {
          patternType: "opening",
          patternName: "Mid-Story Cold Open",
          patternValue: "Begin in the middle of a compelling story or scenario before any introduction. Listeners will stay to find out what happened.",
          confidenceNote: "Topic/format signal — engagement data not available for podcasts",
        },
        {
          patternType: "structure",
          patternName: "Problem-Insight-Action Arc",
          patternValue: "Structure the episode: name a painful problem (2 min), share surprising insight (main body), close with one actionable step.",
          confidenceNote: "Format pattern common in top-ranked podcast shows",
        },
      ],
    };
    return fallbacks[contentType] || [];
  }

  private getFallbackGaps(topic: string, industry: string): GapOpportunity[] {
    return [
      {
        angle: `The local compliance and regulatory side of ${topic}`,
        evidence: "Most top content focuses on how-to; local rules and regulations are rarely covered in depth",
        confidenceScore: 60,
        suggestedFormats: ["explainer video", "Q&A podcast", "checklist social post"],
      },
      {
        angle: `${topic} from the perspective of a beginner audience in ${industry}`,
        evidence: "Existing top content assumes intermediate knowledge; true beginner content is underrepresented",
        confidenceScore: 65,
        suggestedFormats: ["educational social post", "step-by-step video", "beginner podcast series"],
      },
    ];
  }
}

export const competitiveIntelligenceService = new CompetitiveIntelligenceService();
