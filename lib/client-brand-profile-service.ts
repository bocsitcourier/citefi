/**
 * ============================================================================
 * CLIENT BRAND PROFILE SERVICE — Task #15 Client Intelligence Engine
 * ============================================================================
 *
 * Deep research pipeline that synthesizes 8 dimensions of brand intelligence
 * from a client's website + competitive landscape into a persistent profile
 * that is injected into every content generation call.
 *
 * Architecture: leaf module — imports only db, schema, AI SDK, and env vars.
 * No circular imports into learning-service or orchestrator.
 *
 * Pipeline stages (run as a pg-boss background job):
 *   1. analyzeClientWebsite   — brand voice, positioning, local intelligence
 *   2. discoverCompetitors    — Brave Search + Gemini competitor profiling
 *   3. analyzeGapsAndFailures — competitive gap + failure pattern analysis
 *   4. buildBrandPolicyPack   — content constraints derived from research
 *   5. assembleProfile        — compose ClientBrandProfileJson + persist to DB
 *
 * Context injection: getClientBrandContext(teamId) returns a compact prompt
 * segment injected into every generation call via buildOptimizationContext().
 * ============================================================================
 */

import { db } from "./db";
import { clientBrandProfiles } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { GEMINI_FLASH_MODEL } from "./ai-config";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ============================================================================
// TYPES — ClientBrandProfileJson and its 8 dimensions
// ============================================================================

export interface BrandVoice {
  toneAdjectives: string[];
  personalityTraits: string[];
  brandValues: string[];
  voiceExamples: string[];
  avoidedPhrases: string[];
}

export interface CoreService {
  name: string;
  description: string;
  differentiator?: string;
}

export interface Positioning {
  uniqueValueProposition: string;
  coreServices: CoreService[];
  pricingTier: "budget" | "mid" | "premium" | "unknown";
  trustSignals: string[];
  contentGaps: string[];
}

export interface TargetAudience {
  primaryPersona: string;
  demographics: string[];
  statedPainPoints: string[];
  actualPainPoints: string[];
  decisionDrivers: string[];
}

export interface Competitor {
  name: string;
  url: string;
  positioningStatement: string;
  contentAngle: string;
  strengths: string[];
  weaknesses: string[];
}

export interface CompetitiveGaps {
  clientAdvantages: string[];
  clientWeaknesses: string[];
  opportunityTopics: string[];
}

export interface FailureAnalysis {
  likelyLossReasons: string[];
  messagingProblems: string[];
  trustSignalGaps: string[];
  contentDepthGaps: string[];
}

export interface ContentOpportunities {
  uncoveredTopics: string[];
  unansweredQuestions: string[];
  highValueKeywords: string[];
}

export interface LocalNicheIntelligence {
  locationSignals: string[];
  localAuthorities: string[];
  regulatoryContext: string[];
  locationPainPoints: string[];
}

export interface ToneLexicon {
  approved: string[];
  offBrand: string[];
}

export interface LocaleConstraint {
  locale: string;
  regions: string[];
  marketPricingRefs: string[];
  regulatoryDisclaimers: string[];
  localeClaims: string[];
  prohibitedClaims: string[];
}

export interface BrandPolicyPack {
  approvedClaims: string[];
  prohibitedClaims: string[];
  prohibitedPhrases: string[];
  requiredDisclaimers: string[];
  toneLexicon: ToneLexicon;
  localeConstraints: LocaleConstraint[];
}

export interface SeedExemplar {
  contentType: "article" | "social" | "email" | "ad";
  text: string;
  source: string;
  humanApproved: boolean;
  performanceNote?: string;
}

export interface ClientBrandProfileJson {
  brandVoice: BrandVoice;
  positioning: Positioning;
  targetAudience: TargetAudience;
  competitorLandscape: Competitor[];
  competitiveGaps: CompetitiveGaps;
  failureAnalysis: FailureAnalysis;
  contentOpportunities: ContentOpportunities;
  localNicheIntelligence: LocalNicheIntelligence;
  brandPolicyPack: BrandPolicyPack;
  seedExemplars: SeedExemplar[];
  generatedAt: string;
}

// ============================================================================
// HTML UTILITIES
// Strips noise tags (noscript, template, svg, base64 URIs) before sending to
// Gemini — prevents token waste and hallucination from injected content.
// ============================================================================

async function safeFetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ApexContentBot/1.0 (Brand Intelligence Analyzer)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    const text = await response.text();
    return text.slice(0, 300_000);
  } catch {
    return null;
  }
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/data:[a-z]+\/[a-z;]+;base64,[A-Za-z0-9+/=]{20,}/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 9_000);
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  const links: string[] = [];
  const hrefRe = /href=["']([^"'#?]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    try {
      const full = new URL(m[1]!, origin).href;
      if (full.startsWith(origin)) links.push(full);
    } catch { /* ignore */ }
  }
  return [...new Set(links)];
}

// ============================================================================
// DEFAULT FALLBACKS
// ============================================================================

function emptyBrandVoice(): BrandVoice {
  return { toneAdjectives: [], personalityTraits: [], brandValues: [], voiceExamples: [], avoidedPhrases: [] };
}

function emptyPositioning(): Positioning {
  return { uniqueValueProposition: "", coreServices: [], pricingTier: "unknown", trustSignals: [], contentGaps: [] };
}

function emptyLocalIntel(): LocalNicheIntelligence {
  return { locationSignals: [], localAuthorities: [], regulatoryContext: [], locationPainPoints: [] };
}

function emptyBrandPolicy(): BrandPolicyPack {
  return { approvedClaims: [], prohibitedClaims: [], prohibitedPhrases: [], requiredDisclaimers: [], toneLexicon: { approved: [], offBrand: [] }, localeConstraints: [] };
}

// ============================================================================
// STEP 1 — WEBSITE BRAND EXTRACTION
// Fetches homepage + up to 3 secondary key pages and extracts structured
// brand intelligence via Gemini.
// ============================================================================

async function analyzeClientWebsite(websiteUrl: string, companyName: string): Promise<{
  brandVoice: BrandVoice;
  positioning: Positioning;
  targetAudience: Partial<TargetAudience>;
  localNicheIntelligence: LocalNicheIntelligence;
  rawText: string;
}> {
  const homeHtml = await safeFetchPage(websiteUrl);
  if (!homeHtml) {
    console.warn(`⚠️ Could not fetch homepage for ${websiteUrl}`);
    return {
      brandVoice: emptyBrandVoice(),
      positioning: emptyPositioning(),
      targetAudience: {},
      localNicheIntelligence: emptyLocalIntel(),
      rawText: "",
    };
  }

  const origin = new URL(websiteUrl).origin;
  const internalLinks = extractInternalLinks(homeHtml, websiteUrl);
  const priorityPaths = ["/about", "/services", "/what-we-do", "/our-services", "/pricing", "/solutions"];
  const keyPages: string[] = [];

  for (const path of priorityPaths) {
    if (keyPages.length >= 3) break;
    const candidate = internalLinks.find(l => {
      try { return new URL(l).pathname.toLowerCase().startsWith(path); } catch { return false; }
    }) ?? `${origin}${path}`;
    const html = await safeFetchPage(candidate);
    if (html) keyPages.push(cleanHtml(html));
  }

  const allContent = [cleanHtml(homeHtml), ...keyPages]
    .join("\n\n---\n\n")
    .slice(0, 14_000);

  const prompt = `You are a brand intelligence analyst. Analyze this website content for "${companyName}" and extract structured brand intelligence.

WEBSITE CONTENT:
${allContent}

Return a JSON object with EXACTLY this structure (all fields required):
{
  "brandVoice": {
    "toneAdjectives": ["descriptive words for communication tone — up to 6, e.g. 'authoritative', 'warm', 'direct'"],
    "personalityTraits": ["brand personality characteristics — up to 5"],
    "brandValues": ["core values evident from content — up to 5"],
    "voiceExamples": ["direct quotes or paraphrases showing their actual voice — up to 3"],
    "avoidedPhrases": ["phrases/words that feel off-brand for this company — up to 5"]
  },
  "positioning": {
    "uniqueValueProposition": "their core UVP in one precise sentence",
    "coreServices": [{"name": "service name", "description": "brief description", "differentiator": "what makes it different from generic offerings"}],
    "pricingTier": "budget|mid|premium|unknown",
    "trustSignals": ["specific trust signals: awards, certifications, years in business, specific testimonial claims, guarantees — up to 6"],
    "contentGaps": ["topic areas their content doesn't cover that customers would search for — up to 4"]
  },
  "targetAudience": {
    "primaryPersona": "one sentence describing the primary customer archetype",
    "demographics": ["inferred audience characteristics — up to 4"],
    "statedPainPoints": ["problems they explicitly say they solve — up to 6"]
  },
  "localNicheIntelligence": {
    "locationSignals": ["geographic signals: cities, regions, service areas mentioned"],
    "localAuthorities": ["local regulatory bodies, certification organizations, or community entities mentioned"],
    "regulatoryContext": ["industry regulations, compliance requirements, or licensing signals"],
    "locationPainPoints": ["location-specific pain points or regional challenges mentioned"]
  }
}`;

  try {
    const result = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(result.text ?? "{}");
    return {
      brandVoice: parsed.brandVoice ?? emptyBrandVoice(),
      positioning: parsed.positioning ?? emptyPositioning(),
      targetAudience: parsed.targetAudience ?? {},
      localNicheIntelligence: parsed.localNicheIntelligence ?? emptyLocalIntel(),
      rawText: allContent.slice(0, 3_000),
    };
  } catch (err) {
    console.error("analyzeClientWebsite Gemini error:", err);
    return { brandVoice: emptyBrandVoice(), positioning: emptyPositioning(), targetAudience: {}, localNicheIntelligence: emptyLocalIntel(), rawText: "" };
  }
}

// ============================================================================
// STEP 2 — COMPETITOR DISCOVERY
// Uses Brave Search if BRAVE_API_KEY is set; falls back to Gemini-only
// inference from business type + location signals.
// ============================================================================

/** Fetch a competitor's homepage meta description + H1 to enrich positioning data */
async function fetchCompetitorPageMeta(url: string): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ApexContentBot/1.0)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Extract meta description (both attribute orderings)
    const descMatch =
      html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,300})["']/i) ??
      html.match(/<meta[^>]*content=["']([^"']{10,300})["'][^>]*name=["']description["']/i);
    const h1Match = html.match(/<h1[^>]*>([^<]{10,150})<\/h1>/i);
    const og = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']{10,300})["']/i);
    const parts = [descMatch?.[1], og?.[1], h1Match?.[1]].filter(Boolean);
    return parts.join(" | ").slice(0, 300);
  } catch {
    return "";
  }
}

async function discoverCompetitors(
  companyName: string,
  positioning: Positioning,
  localNiche: LocalNicheIntelligence,
  rawWebsiteText: string
): Promise<Competitor[]> {
  let searchSnippets = "";
  const braveApiKey = process.env.BRAVE_API_KEY;
  const businessType = positioning.coreServices[0]?.name ?? "professional services";
  const location = localNiche.locationSignals[0] ?? "";
  const companySlug = companyName.toLowerCase().replace(/\s+/g, "");

  if (braveApiKey) {
    // Two Brave queries: broad competitor discovery + review/alternative discovery
    const queries = [
      `top ${businessType} companies${location ? ` in ${location}` : ""} competitors alternatives`,
      `best ${businessType} reviews vs alternatives 2024`,
    ];
    const allResults: any[] = [];
    for (const q of queries) {
      try {
        const res = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`,
          { headers: { Accept: "application/json", "X-Subscription-Token": braveApiKey } }
        );
        if (res.ok) {
          const data = await res.json();
          allResults.push(...(data.web?.results ?? []));
        }
      } catch { /* fall through */ }
    }
    // Deduplicate by URL and exclude the client's own domain
    const seen = new Set<string>();
    const filtered = allResults.filter(r => {
      if (!r.url || r.url.includes(companySlug) || seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    searchSnippets = filtered
      .slice(0, 8)
      .map(r => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.description}`)
      .join("\n\n");
  }

  const prompt = `You are a competitive intelligence analyst. Identify and profile 4-5 real competitors of "${companyName}".

ABOUT ${companyName.toUpperCase()}:
${rawWebsiteText.slice(0, 3_000)}

${searchSnippets ? `SEARCH CONTEXT:\n${searchSnippets}\n` : ""}

Return a JSON object:
{
  "competitors": [
    {
      "name": "exact competitor company name",
      "url": "their website URL or empty string if unknown",
      "positioningStatement": "how they position themselves in one sentence",
      "contentAngle": "their dominant content/marketing angle (e.g. 'price-leader', 'trust/authority', 'niche specialist')",
      "strengths": ["up to 3 factual or inferred strengths"],
      "weaknesses": ["up to 3 weaknesses vs ${companyName}"]
    }
  ]
}

Use real companies — not placeholder names. If Brave results are provided, prioritize those.`;

  try {
    const result = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(result.text ?? "{}");
    const rawCompetitors: Competitor[] = Array.isArray(parsed.competitors) ? parsed.competitors : [];

    // Enrich each competitor with live page meta for more accurate positioning
    const enriched = await Promise.allSettled(
      rawCompetitors.map(async (c) => {
        if (!c.url) return c;
        const liveMeta = await fetchCompetitorPageMeta(c.url);
        if (liveMeta) {
          return { ...c, positioningStatement: liveMeta || c.positioningStatement };
        }
        return c;
      })
    );
    return enriched.map(r => (r.status === "fulfilled" ? r.value : null)).filter(Boolean) as Competitor[];
  } catch (err) {
    console.error("discoverCompetitors Gemini error:", err);
    return [];
  }
}

// ============================================================================
// STEP 2.5 — REDDIT PAIN-POINT SYNTHESIS
// Fetches real customer complaints and questions from Reddit using the public
// JSON API (no credentials needed). Results feed into analyzeGapsAndFailures
// to ground the gap analysis in genuine customer language.
// ============================================================================

async function fetchRedditPainPoints(businessType: string): Promise<string[]> {
  const painPoints: string[] = [];
  const queries = [
    `${businessType} problems complaints frustrated`,
    `${businessType} worst experience bad reviews`,
  ];

  for (const q of queries) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=top&t=year&limit=8&type=link`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ApexContentBot/1.0; +research)" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const posts: any[] = data?.data?.children ?? [];
      for (const post of posts) {
        const title = (post?.data?.title ?? "").trim();
        if (title.length > 20) painPoints.push(title);
      }
      // Polite rate limit between Reddit requests
      await new Promise(r => setTimeout(r, 700));
    } catch {
      // Non-fatal — continue with empty pain points if Reddit is unavailable
    }
  }

  return [...new Set(painPoints)].slice(0, 18);
}

// ============================================================================
// STEP 3 — COMPETITIVE GAP + FAILURE ANALYSIS
// Single Gemini call: client profile × competitor profiles × Reddit voice →
// gaps, failures, actual pain points, decision drivers, content opportunities.
// ============================================================================

async function analyzeGapsAndFailures(
  companyName: string,
  positioning: Positioning,
  targetAudience: Partial<TargetAudience>,
  competitors: Competitor[],
  redditPainPoints: string[]
): Promise<{
  competitiveGaps: CompetitiveGaps;
  failureAnalysis: FailureAnalysis;
  contentOpportunities: ContentOpportunities;
  actualPainPoints: string[];
  decisionDrivers: string[];
}> {
  const competitorSummary = competitors
    .map(c => `- ${c.name} (${c.url}): ${c.positioningStatement}\n  Strengths: ${c.strengths.join(", ")}\n  Weaknesses vs client: ${c.weaknesses.join(", ")}`)
    .join("\n");

  const businessType = positioning.coreServices[0]?.name ?? "this business type";
  const redditSection = redditPainPoints.length > 0
    ? `\nREDDIT VOICE-OF-CUSTOMER (real posts about "${businessType}" pain points):\n${redditPainPoints.map(p => `- "${p}"`).join("\n")}`
    : "";

  const prompt = `You are a strategic marketing consultant. Perform a deep competitive gap and customer psychology analysis.

CLIENT: ${companyName}
UVP: ${positioning.uniqueValueProposition}
CORE SERVICES: ${positioning.coreServices.map(s => s.name).join(", ")}
TRUST SIGNALS: ${positioning.trustSignals.join("; ")}
STATED CUSTOMER PAIN POINTS: ${targetAudience.statedPainPoints?.join("; ")}
PRICING TIER: ${positioning.pricingTier}
CONTENT GAPS ALREADY IDENTIFIED: ${positioning.contentGaps.join("; ")}

COMPETITORS:
${competitorSummary || "No competitor data available — infer from business type."}
${redditSection}

Return a JSON object:
{
  "competitiveGaps": {
    "clientAdvantages": ["things ${companyName} genuinely does better that their content undersells — up to 5"],
    "clientWeaknesses": ["honest weaknesses vs the competitive field — up to 4"],
    "opportunityTopics": ["high-value content topics competitors haven't covered that attract ${companyName}'s ideal buyer — up to 6"]
  },
  "failureAnalysis": {
    "likelyLossReasons": ["why ${companyName} loses deals to competitors based on the positioning gap — up to 4"],
    "messagingProblems": ["specific messaging gaps or weaknesses — up to 3"],
    "trustSignalGaps": ["trust signals they lack that competitors have — up to 3"],
    "contentDepthGaps": ["content areas where they are shallower than industry expects — up to 4"]
  },
  "contentOpportunities": {
    "uncoveredTopics": ["high-value topics no competitor covers well yet — up to 6"],
    "unansweredQuestions": ["specific buyer questions nobody answers well — up to 6"],
    "highValueKeywords": ["high buyer-intent search phrases to target — up to 8"]
  },
  "actualPainPoints": ["real customer fears/frustrations grounded in Reddit voice-of-customer — up to 8. Use verbatim language where possible."],
  "decisionDrivers": ["the real psychological triggers that move a prospect from research to purchase — up to 5"]
}`;

  try {
    const result = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(result.text ?? "{}");
    return {
      competitiveGaps: parsed.competitiveGaps ?? { clientAdvantages: [], clientWeaknesses: [], opportunityTopics: [] },
      failureAnalysis: parsed.failureAnalysis ?? { likelyLossReasons: [], messagingProblems: [], trustSignalGaps: [], contentDepthGaps: [] },
      contentOpportunities: parsed.contentOpportunities ?? { uncoveredTopics: [], unansweredQuestions: [], highValueKeywords: [] },
      actualPainPoints: parsed.actualPainPoints ?? [],
      decisionDrivers: parsed.decisionDrivers ?? [],
    };
  } catch (err) {
    console.error("analyzeGapsAndFailures Gemini error:", err);
    return {
      competitiveGaps: { clientAdvantages: [], clientWeaknesses: [], opportunityTopics: [] },
      failureAnalysis: { likelyLossReasons: [], messagingProblems: [], trustSignalGaps: [], contentDepthGaps: [] },
      contentOpportunities: { uncoveredTopics: [], unansweredQuestions: [], highValueKeywords: [] },
      actualPainPoints: [],
      decisionDrivers: [],
    };
  }
}

// ============================================================================
// STEP 4 — BRAND POLICY PACK
// Derives content constraints (approved/prohibited claims, tone lexicon,
// locale rules) from the synthesized research data.
// ============================================================================

async function buildBrandPolicyPack(
  companyName: string,
  brandVoice: BrandVoice,
  positioning: Positioning,
  competitiveGaps: CompetitiveGaps,
  failureAnalysis: FailureAnalysis,
  localNiche: LocalNicheIntelligence
): Promise<BrandPolicyPack> {
  const prompt = `You are a brand compliance expert. Create a Brand Policy Pack for "${companyName}" to enforce consistent, accurate AI content generation.

BRAND VOICE (adjectives): ${brandVoice.toneAdjectives.join(", ")}
BRAND VALUES: ${brandVoice.brandValues.join(", ")}
UVP: ${positioning.uniqueValueProposition}
TRUST SIGNALS: ${positioning.trustSignals.join("; ")}
CLIENT ADVANTAGES: ${competitiveGaps.clientAdvantages.join("; ")}
CLIENT WEAKNESSES: ${competitiveGaps.clientWeaknesses.join("; ")}
MESSAGING PROBLEMS: ${failureAnalysis.messagingProblems.join("; ")}
LOCATION: ${localNiche.locationSignals.slice(0, 3).join(", ")}
REGULATORY CONTEXT: ${localNiche.regulatoryContext.slice(0, 3).join("; ")}

Return a JSON object:
{
  "approvedClaims": ["factual claims the business CAN make, grounded in their trust signals and real advantages — up to 8"],
  "prohibitedClaims": ["claims to AVOID because they'd be misleading or expose weaknesses — up to 6"],
  "prohibitedPhrases": ["generic marketing phrases that dilute brand voice: 'world-class', 'industry-leading', 'best-in-class', etc — up to 10"],
  "requiredDisclaimers": ["legal or industry disclaimers required in this space — up to 3"],
  "toneLexicon": {
    "approved": ["vocabulary and phrases that match this brand's authentic voice — up to 10"],
    "offBrand": ["vocabulary to avoid that feels generic or misaligned — up to 8"]
  },
  "localeConstraints": [
    {
      "locale": "primary geographic market (e.g. 'Phoenix Metro', 'New South Wales')",
      "regions": ["specific cities or sub-regions served"],
      "marketPricingRefs": ["local market pricing references if applicable, else []"],
      "regulatoryDisclaimers": ["jurisdiction-specific disclaimers"],
      "localeClaims": ["claims specific to this locale that are approved"],
      "prohibitedClaims": ["claims specifically prohibited in this locale"]
    }
  ]
}`;

  try {
    const result = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(result.text ?? "{}");
    return {
      approvedClaims: parsed.approvedClaims ?? [],
      prohibitedClaims: parsed.prohibitedClaims ?? [],
      prohibitedPhrases: parsed.prohibitedPhrases ?? [],
      requiredDisclaimers: parsed.requiredDisclaimers ?? [],
      toneLexicon: parsed.toneLexicon ?? { approved: [], offBrand: [] },
      localeConstraints: parsed.localeConstraints ?? [],
    };
  } catch (err) {
    console.error("buildBrandPolicyPack Gemini error:", err);
    return emptyBrandPolicy();
  }
}

// ============================================================================
// DEEP MERGE — manual overrides win at every leaf
// ============================================================================

function deepMerge<T extends object>(base: T, overrides: Partial<T> | null | undefined): T {
  if (!overrides) return base;
  const result: any = { ...base };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const ov = overrides[key];
    if (ov === undefined || ov === null) continue;
    if (Array.isArray(ov)) {
      result[key] = ov; // arrays: override wins entirely
    } else if (typeof ov === "object" && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], ov as any);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

export function mergeProfileWithOverrides(
  profile: ClientBrandProfileJson,
  overrides: Partial<ClientBrandProfileJson> | null | undefined
): ClientBrandProfileJson {
  return deepMerge(profile, overrides);
}

// ============================================================================
// MAIN PIPELINE — runIntelligenceResearch
// Called by the pg-boss intelligence-research worker.
// Progress steps written to DB so the UI can show live status.
// ============================================================================

export async function runIntelligenceResearch(
  teamId: number,
  websiteUrl: string,
  companyName: string
): Promise<void> {
  const setProgress = async (step: string) => {
    await db.update(clientBrandProfiles)
      .set({ progressStep: step, updatedAt: new Date() })
      .where(eq(clientBrandProfiles.teamId, teamId));
  };

  try {
    await db.update(clientBrandProfiles)
      .set({ status: "running", progressStep: "website", errorMessage: null, updatedAt: new Date() })
      .where(eq(clientBrandProfiles.teamId, teamId));

    // ── Step 1: Website brand extraction ──────────────────────────────────
    console.log(`🧠 [team:${teamId}] Step 1/5 — Analyzing ${websiteUrl}`);
    const websiteData = await analyzeClientWebsite(websiteUrl, companyName);

    // ── Step 2: Competitor discovery ──────────────────────────────────────
    await setProgress("competitors");
    console.log(`🧠 [team:${teamId}] Step 2/6 — Discovering competitors`);
    const competitors = await discoverCompetitors(
      companyName,
      websiteData.positioning,
      websiteData.localNicheIntelligence,
      websiteData.rawText
    );

    // ── Step 2.5: Reddit pain-point synthesis ─────────────────────────────
    await setProgress("reddit");
    const businessType = websiteData.positioning.coreServices[0]?.name ?? "professional services";
    console.log(`🧠 [team:${teamId}] Step 3/6 — Mining Reddit pain points for "${businessType}"`);
    const redditPainPoints = await fetchRedditPainPoints(businessType);
    console.log(`🧠 [team:${teamId}] Reddit: ${redditPainPoints.length} pain points extracted`);

    // ── Step 3: Gap + failure analysis ────────────────────────────────────
    await setProgress("gaps");
    console.log(`🧠 [team:${teamId}] Step 4/6 — Analyzing competitive gaps`);
    const gapAnalysis = await analyzeGapsAndFailures(
      companyName,
      websiteData.positioning,
      websiteData.targetAudience,
      competitors,
      redditPainPoints
    );

    // ── Step 4: Brand policy pack ─────────────────────────────────────────
    await setProgress("policy");
    console.log(`🧠 [team:${teamId}] Step 4/5 — Building brand policy pack`);
    const brandPolicyPack = await buildBrandPolicyPack(
      companyName,
      websiteData.brandVoice,
      websiteData.positioning,
      gapAnalysis.competitiveGaps,
      gapAnalysis.failureAnalysis,
      websiteData.localNicheIntelligence
    );

    // ── Step 5: Assemble + persist ────────────────────────────────────────
    await setProgress("assembling");
    console.log(`🧠 [team:${teamId}] Step 5/5 — Assembling profile`);

    const profileJson: ClientBrandProfileJson = {
      brandVoice: websiteData.brandVoice,
      positioning: websiteData.positioning,
      targetAudience: {
        primaryPersona: websiteData.targetAudience.primaryPersona ?? "",
        demographics: websiteData.targetAudience.demographics ?? [],
        statedPainPoints: websiteData.targetAudience.statedPainPoints ?? [],
        actualPainPoints: gapAnalysis.actualPainPoints,
        decisionDrivers: gapAnalysis.decisionDrivers,
      },
      competitorLandscape: competitors,
      competitiveGaps: gapAnalysis.competitiveGaps,
      failureAnalysis: gapAnalysis.failureAnalysis,
      contentOpportunities: gapAnalysis.contentOpportunities,
      localNicheIntelligence: websiteData.localNicheIntelligence,
      brandPolicyPack,
      seedExemplars: [],
      generatedAt: new Date().toISOString(),
    };

    const rawResearchJson = {
      websiteAnalysis: { rawText: websiteData.rawText },
      competitors,
      gapAnalysis,
    };

    await db.update(clientBrandProfiles)
      .set({
        status: "complete",
        progressStep: null,
        profileJson: profileJson as any,
        rawResearchJson: rawResearchJson as any,
        lastRunAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(clientBrandProfiles.teamId, teamId));

    console.log(`✅ [team:${teamId}] Intelligence research complete for "${companyName}"`);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ [team:${teamId}] Intelligence research failed:`, message);
    await db.update(clientBrandProfiles)
      .set({ status: "failed", progressStep: null, errorMessage: message, updatedAt: new Date() })
      .where(eq(clientBrandProfiles.teamId, teamId));
    throw error;
  }
}

// ============================================================================
// CONTEXT INJECTION — getClientBrandContext(teamId)
// Called from buildOptimizationContext() in lib/learning-service.ts.
// Returns a compact, structured prompt segment; empty string when no profile.
// ============================================================================

export async function getClientBrandContext(teamId: number): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(clientBrandProfiles)
      .where(eq(clientBrandProfiles.teamId, teamId))
      .limit(1);

    if (!row || row.status !== "complete" || !row.profileJson) return "";

    const profile = mergeProfileWithOverrides(
      row.profileJson as ClientBrandProfileJson,
      row.manualOverridesJson as Partial<ClientBrandProfileJson> | null
    );

    const { brandVoice: v, positioning: p, targetAudience: a, competitiveGaps: g,
            contentOpportunities: o, failureAnalysis: f, brandPolicyPack: pack,
            localNicheIntelligence: loc } = profile;

    const lines = [
      "=== CLIENT BRAND INTELLIGENCE (apply to all content) ===",
      `BRAND TONE: ${v.toneAdjectives.slice(0, 5).join(", ")}`,
      `BRAND VALUES: ${v.brandValues.slice(0, 4).join(", ")}`,
      `UNIQUE VALUE PROPOSITION: ${p.uniqueValueProposition}`,
      `TRUST SIGNALS: ${p.trustSignals.slice(0, 4).join("; ")}`,
      `TARGET PERSONA: ${a.primaryPersona}`,
      `ACTUAL PAIN POINTS (unstated): ${a.actualPainPoints.slice(0, 4).join("; ")}`,
      `DECISION DRIVERS: ${a.decisionDrivers.slice(0, 3).join("; ")}`,
      `COMPETITIVE ADVANTAGES (currently undersold): ${g.clientAdvantages.slice(0, 3).join("; ")}`,
      `CONTENT OPPORTUNITIES: ${o.uncoveredTopics.slice(0, 4).join("; ")}`,
      `HIGH-VALUE KEYWORDS: ${o.highValueKeywords.slice(0, 5).join(", ")}`,
      `APPROVED CLAIMS: ${pack.approvedClaims.slice(0, 4).join("; ")}`,
      `PROHIBITED CLAIMS: ${pack.prohibitedClaims.slice(0, 4).join("; ")}`,
      `PROHIBITED PHRASES: ${pack.prohibitedPhrases.slice(0, 6).join(", ")}`,
      `ON-BRAND VOCABULARY: ${pack.toneLexicon.approved.slice(0, 6).join(", ")}`,
      `OFF-BRAND VOCABULARY: ${pack.toneLexicon.offBrand.slice(0, 6).join(", ")}`,
      `MESSAGING PROBLEMS TO AVOID: ${f.messagingProblems.slice(0, 3).join("; ")}`,
      `SERVICE AREA: ${loc.locationSignals.slice(0, 3).join(", ")}`,
      "=== END CLIENT BRAND INTELLIGENCE ===",
    ];

    return lines.filter(l => !l.includes(": ") || !l.endsWith(": ")).join("\n");
  } catch {
    return "";
  }
}

// ============================================================================
// DB HELPERS
// ============================================================================

export async function getClientBrandProfile(teamId: number) {
  const [row] = await db
    .select()
    .from(clientBrandProfiles)
    .where(eq(clientBrandProfiles.teamId, teamId))
    .limit(1);
  if (!row) return null;

  const merged = row.profileJson && row.status === "complete"
    ? mergeProfileWithOverrides(
        row.profileJson as ClientBrandProfileJson,
        row.manualOverridesJson as Partial<ClientBrandProfileJson> | null
      )
    : null;

  return { ...row, mergedProfile: merged };
}

export async function upsertClientBrandProfile(
  teamId: number,
  websiteUrl: string,
  companyName: string
): Promise<void> {
  await db
    .insert(clientBrandProfiles)
    .values({ teamId, websiteUrl, companyName, status: "pending" })
    .onConflictDoUpdate({
      target: clientBrandProfiles.teamId,
      set: { websiteUrl, companyName, status: "pending", progressStep: null, errorMessage: null, updatedAt: new Date() },
    });
}

export async function updateManualOverrides(
  teamId: number,
  overrides: Partial<ClientBrandProfileJson>
): Promise<void> {
  const [row] = await db
    .select({ current: clientBrandProfiles.manualOverridesJson })
    .from(clientBrandProfiles)
    .where(eq(clientBrandProfiles.teamId, teamId))
    .limit(1);

  const existing = (row?.current ?? {}) as Partial<ClientBrandProfileJson>;
  const merged = deepMerge(existing, overrides);

  await db.update(clientBrandProfiles)
    .set({ manualOverridesJson: merged as any, updatedAt: new Date() })
    .where(eq(clientBrandProfiles.teamId, teamId));
}

export async function addSeedExemplar(
  teamId: number,
  exemplar: SeedExemplar
): Promise<void> {
  const [row] = await db
    .select({ profile: clientBrandProfiles.profileJson })
    .from(clientBrandProfiles)
    .where(eq(clientBrandProfiles.teamId, teamId))
    .limit(1);

  if (!row?.profile) return;
  const profile = row.profile as ClientBrandProfileJson;
  const updated = {
    ...profile,
    seedExemplars: [...(profile.seedExemplars ?? []), exemplar],
  };

  await db.update(clientBrandProfiles)
    .set({ profileJson: updated as any, updatedAt: new Date() })
    .where(eq(clientBrandProfiles.teamId, teamId));
}
