import { GoogleGenAI } from "@google/genai";
import Bottleneck from "bottleneck";
import { createBrandLockPromptSegment } from "./branding";
import { smartResearch, SmartResearchResult } from "./smart-topic-research";
import { getContentOptimizationContext, ContentOptimizationContext } from "./persona-content-integration";
import { validateContentWithFacts, FactValidationOptions } from "./fact-validated-generators";
import { humanizeArticle } from "./deterministic-humanizer";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Gemini 2.0 Flash: 10 RPM (requests per minute) limit - ACTUAL quota from Google
// Using Bottleneck for proper time-based rate limiting with retry on 429
const GEMINI_REQUESTS_PER_MINUTE = parseInt(process.env.GEMINI_RATE_LIMIT || "10");

// Dynamic concurrent limit based on rate limit tier
// Tier 1 (2000 RPM) needs higher concurrency than free tier (10 RPM)
const MAX_CONCURRENT_REQUESTS = Math.min(
  parseInt(process.env.ARTICLE_WORKER_CONCURRENCY || "50"),
  Math.max(10, Math.floor(GEMINI_REQUESTS_PER_MINUTE / 20)) // Scale with quota
);

// Bottleneck rate limiter with time-based quota enforcement
const geminiRateLimiter = new Bottleneck({
  reservoir: GEMINI_REQUESTS_PER_MINUTE, // Total requests allowed
  reservoirRefreshAmount: GEMINI_REQUESTS_PER_MINUTE, // Refill amount
  reservoirRefreshInterval: 60 * 1000, // Refill every 60 seconds
  maxConcurrent: MAX_CONCURRENT_REQUESTS, // Scale with API tier
  minTime: Math.floor((60 * 1000) / GEMINI_REQUESTS_PER_MINUTE), // Minimum time between requests
});

// Exponential backoff on 429 errors
geminiRateLimiter.on("failed", async (error, jobInfo) => {
  const isRateLimitError = error?.message?.includes("429") || error?.message?.includes("RESOURCE_EXHAUSTED");
  if (isRateLimitError && jobInfo.retryCount < 3) {
    const delay = Math.min(1000 * Math.pow(2, jobInfo.retryCount) + Math.random() * 1000, 10000);
    console.warn(`⚠️  Gemini rate limit hit, retrying in ${delay}ms (attempt ${jobInfo.retryCount + 1}/3)`);
    return delay;
  }
  return undefined;
});

console.log(`🔧 Gemini rate limiter initialized: ${GEMINI_REQUESTS_PER_MINUTE} requests/minute, max ${MAX_CONCURRENT_REQUESTS} concurrent`);

/**
 * US State abbreviation to full name mapping
 */
const US_STATES: Record<string, string> = {
  'al': 'Alabama', 'ak': 'Alaska', 'az': 'Arizona', 'ar': 'Arkansas',
  'ca': 'California', 'co': 'Colorado', 'ct': 'Connecticut', 'de': 'Delaware',
  'fl': 'Florida', 'ga': 'Georgia', 'hi': 'Hawaii', 'id': 'Idaho',
  'il': 'Illinois', 'in': 'Indiana', 'ia': 'Iowa', 'ks': 'Kansas',
  'ky': 'Kentucky', 'la': 'Louisiana', 'me': 'Maine', 'md': 'Maryland',
  'ma': 'Massachusetts', 'mi': 'Michigan', 'mn': 'Minnesota', 'ms': 'Mississippi',
  'mo': 'Missouri', 'mt': 'Montana', 'ne': 'Nebraska', 'nv': 'Nevada',
  'nh': 'New Hampshire', 'nj': 'New Jersey', 'nm': 'New Mexico', 'ny': 'New York',
  'nc': 'North Carolina', 'nd': 'North Dakota', 'oh': 'Ohio', 'ok': 'Oklahoma',
  'or': 'Oregon', 'pa': 'Pennsylvania', 'ri': 'Rhode Island', 'sc': 'South Carolina',
  'sd': 'South Dakota', 'tn': 'Tennessee', 'tx': 'Texas', 'ut': 'Utah',
  'vt': 'Vermont', 'va': 'Virginia', 'wa': 'Washington', 'wv': 'West Virginia',
  'wi': 'Wisconsin', 'wy': 'Wyoming', 'dc': 'District of Columbia'
};

/**
 * Common US city abbreviations to full names
 * Covers top 30 metros to handle 80%+ of real-world use cases
 */
const CITY_ABBREVIATIONS: Record<string, string> = {
  'la': 'los angeles',
  'sf': 'san francisco',
  'sd': 'san diego',
  'nyc': 'new york city',
  'phx': 'phoenix',
  'stl': 'st louis',
  'kc': 'kansas city',
  'dc': 'washington',
  'atl': 'atlanta',
  'chi': 'chicago',
  'hou': 'houston',
  'dal': 'dallas',
  'sa': 'san antonio',
  'philly': 'philadelphia',
  'vegas': 'las vegas',
  'pdx': 'portland',
  'sea': 'seattle',
  'den': 'denver',
  'mia': 'miami',
  'bos': 'boston',
};

/**
 * Normalize state to full name
 * Handles both abbreviations and full names (case-insensitive)
 */
function normalizeState(state: string): string {
  const stateLower = state.toLowerCase().trim();
  
  // Check if it's an abbreviation
  if (US_STATES[stateLower]) {
    return US_STATES[stateLower];
  }
  
  // Check if it's already a full state name
  const stateValues = Object.values(US_STATES).map(s => s.toLowerCase());
  if (stateValues.includes(stateLower)) {
    // Return with proper capitalization
    return Object.values(US_STATES).find(s => s.toLowerCase() === stateLower) || state;
  }
  
  // Not a recognized state, return as-is
  return state;
}

/**
 * Check if a string is a US state (abbreviation or full name)
 */
function isUSState(text: string): boolean {
  const textLower = text.toLowerCase().trim();
  
  // Check abbreviations
  if (US_STATES[textLower]) {
    return true;
  }
  
  // Check full names
  const stateValues = Object.values(US_STATES).map(s => s.toLowerCase());
  return stateValues.includes(textLower);
}

/**
 * Parse multiple cities from a comma-separated string
 * Handles formats like:
 * - "Boston, Massachusetts, Hartford, CT, NY, NY"
 * - "Boston, Hartford, Albany"  
 * - "Seattle, WA"
 * - "Austin, Texas, Miami, FL"
 * 
 * Returns array of normalized city locations with full state names
 */
export function parseMultipleCities(geographicFocus: string): string[] {
  if (!geographicFocus || !geographicFocus.trim()) {
    return [];
  }

  // Split by both comma AND pipe, then clean up each part
  const parts = geographicFocus
    .split(/[,|]/)
    .map(p => p.trim())
    .map(p => p.replace(/\.$/, '')) // Strip trailing periods (e.g., "MA." → "MA")
    .filter(Boolean);
  
  if (parts.length === 0) return [];
  if (parts.length === 1) return [parts[0]!];
  if (parts.length === 2) {
    // Single city, state pair - normalize state (after stripping punctuation)
    const [city, state] = parts as [string, string];
    if (isUSState(state)) {
      return [`${city}, ${normalizeState(state)}`];
    }
    return [geographicFocus.trim()];
  }

  const cities: string[] = [];
  let i = 0;

  while (i < parts.length) {
    const currentPart = parts[i]!;
    const nextPart = i + 1 < parts.length ? parts[i + 1]! : null;

    // Check if next part is a US state (after punctuation has been stripped)
    const isNextPartState = nextPart && isUSState(nextPart);

    if (isNextPartState) {
      // Combine current part with normalized state
      cities.push(`${currentPart}, ${normalizeState(nextPart!)}`);
      i += 2; // Skip both parts
    } else {
      // Standalone city
      cities.push(currentPart);
      i += 1;
    }
  }

  return cities;
}

export async function throttledGeminiRequest<T>(fn: () => Promise<T>): Promise<T> {
  return geminiRateLimiter.schedule(() => fn());
}

export function getGeminiRateLimitConfig() {
  return {
    requestsPerMinute: GEMINI_REQUESTS_PER_MINUTE,
    concurrentLimit: GEMINI_REQUESTS_PER_MINUTE,
    isThrottlingEnabled: true,
  };
}

export interface TitleWithUniqueness {
  title: string;
  uniquenessScore: number;
  wasRefined: boolean;
  refinementReason?: string;
}

export interface TitlePoolResult {
  titles: string[];
  primaryKeywords: string[];
  contentStrategy: string;
  coverageMapping: Array<{
    title: string;
    subtopicCategory: 'types' | 'costs' | 'laws' | 'providers' | 'faqs' | 'best_practices' | 'neighborhoods';
    clusterPillar: string;
    eatSignals: Array<'experience' | 'expertise' | 'authoritativeness' | 'trustworthiness'>;
    answerFirstFraming: boolean;
  }>;
  titlesWithScores?: TitleWithUniqueness[];
  critiqueSummary?: string;
  removedCount?: number;
  refinedCount?: number;
}

export interface MultiCityTitlePoolResult {
  cities: {
    location: string;
    titles: string[];
    primaryKeywords: string[];
    contentStrategy: string;
    titlesWithScores?: TitleWithUniqueness[];
  }[];
  combinedTitles: string[];
  combinedKeywords: string[];
  combinedTitlesWithScores?: TitleWithUniqueness[];
  critiqueSummary?: string;
  totalRemovedCount?: number;
  totalRefinedCount?: number;
}

export async function generateTitlePool(
  coreTopic: string,
  targetUrl: string,
  numTitles: number = 50,
  tone?: string,
  geographicFocus?: string,
  audience?: string,
  redditQuestions?: Array<{question: string, upvotes: number, subreddit: string}>,
  researchData?: SmartResearchResult
): Promise<TitlePoolResult> {
  // Require geographic focus for local SEO
  if (!geographicFocus) {
    throw new Error("Geographic focus is required for location-optimized SEO titles");
  }

  // Dynamic year for freshness signals
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  const audienceContext = audience ? `\nTarget Audience: ${audience}` : "";
  const toneContext = tone ? `\nTone: ${tone}` : "";
  
  // ENHANCED v4.0: Smart web research integration for hyper-relevant titles
  let smartResearchContext = "";
  if (researchData && (researchData.localEntities.length > 0 || researchData.competitorTitles.length > 0)) {
    smartResearchContext = `\n\n**🔬 SMART WEB RESEARCH - REAL LOCAL INTELLIGENCE (HIGHEST PRIORITY):**

We performed web research for "${coreTopic}" in ${geographicFocus}. Use this data to create hyper-relevant, locally-optimized titles.

`;

    // Add local entities (hospitals, providers, etc.)
    if (researchData.localEntities.length > 0) {
      smartResearchContext += `**📍 LOCAL ENTITIES DISCOVERED (CONTEXT ONLY - DO NOT name these in titles):**
${researchData.localEntities.slice(0, 10).map((e, i) => `${i+1}. ${e.name} (${e.type}) - ${e.snippet || 'Local provider'}`).join('\n')}

**INSTRUCTION:** Use these entities to understand the local landscape and inform your topic angles. Do NOT include business names, company names, provider names, or competitor names in any title. Titles must be about the TOPIC, not about specific companies. Example of what NOT to do: "How [CompanyName] Handles Home Care in Miami" — instead write: "How Home Care Works in Miami: What Families Need to Know".

`;
    }

    // Add competitor titles that rank well
    if (researchData.competitorTitles.length > 0) {
      smartResearchContext += `**🏆 TOP-RANKING COMPETITOR TITLES (LEARN FROM WHAT WORKS):**
${researchData.competitorTitles.slice(0, 8).map((t, i) => `${i+1}. "${t.title}" (${t.estimatedEngagement} engagement, patterns: ${t.titlePatterns.join(', ')})`).join('\n')}

**INSTRUCTION:** Study these winning title patterns and create BETTER versions. Notice the patterns they use (numbers, questions, years) and apply them.

`;
    }

    // Add suggested angles
    if (researchData.suggestedAngles.length > 0) {
      smartResearchContext += `**💡 HIGH-POTENTIAL CONTENT ANGLES:**
${researchData.suggestedAngles.slice(0, 5).map((a, i) => `${i+1}. ${a}`).join('\n')}

`;
    }

    // Add keywords
    if (researchData.keywords.length > 0) {
      smartResearchContext += `**🔑 RELEVANT KEYWORDS (incorporate naturally):**
${researchData.keywords.slice(0, 15).join(', ')}

`;
    }
  }
  
  // ENHANCED v3.0: Reddit research integration for intent-based title generation
  // SAFETY: Include Reddit context only if data is actually available
  const redditContext = redditQuestions && redditQuestions.length > 0 
    ? `\n\n**🔥 REDDIT RESEARCH - REAL USER INTENT (HIGH PRIORITY):**

We've mined ${redditQuestions.length} actual questions from Reddit that real ${geographicFocus} users are asking about ${coreTopic}. These are AUTHENTIC user intents - prioritize them!

**Top Reddit Questions (sorted by upvotes - highest engagement first):**
${redditQuestions.slice(0, 15).map((q, i) => `${i+1}. "${q.question}" (${q.upvotes} upvotes on r/${q.subreddit})`).join('\n')}

**INSTRUCTION:** Use these Reddit questions as the foundation for your titles. Transform them into answer-first, location-optimized titles that directly address these real user needs. These questions reveal actual pain points and information gaps - your titles should promise to answer them comprehensively.

Examples of Reddit-to-Title transformation:
- Reddit: "What's the average cost?" → Title: "How Much Does ${coreTopic} Cost in ${geographicFocus}? ${currentYear} Price Analysis"
- Reddit: "Are there any good providers near me?" → Title: "Best ${coreTopic} Providers in ${geographicFocus}: Expert Ratings & Reviews"
- Reddit: "What are the regulations?" → Title: "What are ${geographicFocus} ${coreTopic} Laws? Complete Regulatory Guide ${currentYear}"
` 
    : `\n\n**NOTE:** Reddit research data not available for this batch. Generate titles based on standard SEO best practices and coverage pillars.`;

  const prompt = `You are an expert content strategist implementing Lily Ray's AEO (Answer Engine Optimization) methodology, specializing in E-E-A-T signals and answer-first structure for AI citations. Generate ${numTitles} unique, strategic article titles optimized for both traditional SEO and AI Overviews.

**CORE PARAMETERS:**
Core Topic: ${coreTopic}
Target URL: ${targetUrl}
Geographic Location (REQUIRED): ${geographicFocus}${audienceContext}${toneContext}${smartResearchContext}${redditContext}

**CRITICAL REQUIREMENT:** EVERY SINGLE TITLE MUST INCLUDE LOCATION INFORMATION

**ANSWER-FIRST TITLE FRAMING (Lily Ray Methodology):**

Titles must promise DIRECT, COMPLETE ANSWERS that AI can extract and cite:
- Use question-based formats: "What is...", "How to...", "Why [LOCATION] Needs...", "When to..."
- Promise immediate value: "Complete Guide to...", "Expert Analysis:", "[TOPIC] Explained"
- Front-load the answer hint: "Yes, [TOPIC] is... (Here's What [LOCATION] Residents Should Know)"
- Make titles quotable: Use authoritative language AI models will cite

GOOD EXAMPLES (Answer-First):
✓ "What is [TOPIC] in ${geographicFocus}? Complete ${currentYear} Guide with Local Regulations"
✓ "How ${geographicFocus} [TOPIC] Works: Expert Analysis with Neighborhood Data"
✓ "Why ${geographicFocus} Needs [TOPIC]: Statistics, Laws, and Local Solutions"
✓ "${geographicFocus} [TOPIC] Guide: What You Need to Know (Costs, Regulations, Providers)"

BAD EXAMPLES (Vague, No Answer Promise):
✗ "Everything About [TOPIC]" (no location, no specificity)
✗ "The Ultimate ${geographicFocus} Guide" (no clear answer)
✗ "Learn More About [TOPIC]" (weak promise)

**COVERAGE PILLAR MAPPING (Content Cluster Architecture):**

Distribute titles across these subtopic categories (aim for balanced coverage):

1. **Types/Options** (15-20% of titles):
   - "Types of [TOPIC] Available in ${geographicFocus}: Complete ${currentYear} Comparison"
   - "What [TOPIC] Options Exist in ${geographicFocus}? Expert Breakdown"

2. **Costs/Pricing** (15-20%):
   - "How Much Does [TOPIC] Cost in ${geographicFocus}? ${currentYear} Price Analysis"
   - "${geographicFocus} [TOPIC] Pricing Guide: What to Expect in [Neighborhoods]"

3. **Laws/Regulations** (10-15%):
   - "What are ${geographicFocus} [TOPIC] Laws? Complete Regulatory Guide ${currentYear}"
   - "${geographicFocus} [TOPIC] Regulations: What Local Businesses Must Know"

4. **Providers/Services** (15-20%):
   - "Best [TOPIC] Providers in ${geographicFocus}: Expert Ratings & Reviews"
   - "How to Choose [TOPIC] Services in ${geographicFocus}: Local Comparison"

5. **FAQs/Common Questions** (10-15%):
   - "Top 10 ${geographicFocus} [TOPIC] Questions Answered by Local Experts"
   - "What ${geographicFocus} Residents Ask About [TOPIC]: Complete FAQ"

6. **Best Practices/How-To** (15-20%):
   - "How to [ACTION] in ${geographicFocus}: Step-by-Step Expert Guide"
   - "Best Practices for [TOPIC] in ${geographicFocus}: ${currentYear} Expert Recommendations"

7. **Neighborhood/ZIP-Specific** (10-15%):
   - "[Specific Neighborhood] [TOPIC] Guide: What Makes This Area Unique"
   - "[ZIP Code] [TOPIC]: Local Statistics, Regulations, and Options"

**E-E-A-T SIGNAL REQUIREMENTS (Google Quality Guidelines):**

Titles must demonstrate Experience, Expertise, Authoritativeness, Trustworthiness:

**Experience Signals:**
- "Our 15-Year Guide to ${geographicFocus} [TOPIC]"
- "${geographicFocus} [TOPIC]: Insights from 500+ Local Cases"

**Expertise Signals:**
- "Expert Analysis: ${geographicFocus} [TOPIC] Technical Deep-Dive"
- "Professional Guide to ${geographicFocus} [TOPIC]: Industry Insights"

**Authoritativeness Signals:**
- "Comprehensive ${geographicFocus} [TOPIC] Resource: Data-Backed Analysis"
- "Definitive ${geographicFocus} [TOPIC] Guide: Research & Statistics"

**Trustworthiness Signals:**
- "${geographicFocus} [TOPIC] Guide: ${currentYear} Updated with Latest Regulations"
- "${geographicFocus} [TOPIC]: Verified Data from Official Sources"

**LOCAL SEO OPTIMIZATION (MANDATORY):**

Every title MUST include location information:
- City-level: "${geographicFocus} [TOPIC]"
- Neighborhood-level: "[Actual Neighborhood Name] [TOPIC] Guide"
- ZIP-specific: "[ZIP Code] Area [TOPIC]: What Residents Need to Know"
- Proximity: "[TOPIC] Near ${geographicFocus}", "[TOPIC] in the ${geographicFocus} Area"

USE REAL NAMES ONLY - Never use [brackets], [placeholders], or generic terms like [Hospital], [Landmark]

**TECHNICAL SEO REQUIREMENTS:**

1. **Length**: 50-70 characters optimal (can go to 80 for long-tail)
2. **Intent Mix**: Distribute across informational (40%), transactional (30%), navigational (30%)
3. **Keyword Placement**: Target keyword in first 5 words when possible
4. **Freshness**: Include "${currentYear}", "Latest", "Updated" for time-sensitive topics
5. **Schema-Ready**: Use formats AI can easily extract (Q&A, How-To, List)

**STRATEGIC DEPTH:**

- Go beyond surface-level topics - show LOCAL thought leadership
- Include frameworks, methodologies specific to ${geographicFocus} market
- Address complex scenarios in the local context
- Create content worthy of local bookmarking and AI citation

**REQUIRED OUTPUT STRUCTURE:**

Return ONLY valid JSON with enhanced coverage mapping:

{
  "titles": ["title1", "title2", ... ${numTitles} titles total],
  "primaryKeywords": ["keyword1", "keyword2", ... 10 keywords],
  "contentStrategy": "brief strategy recommendation",
  "coverageMapping": [
    {
      "title": "exact title from titles array",
      "subtopicCategory": "types | costs | laws | providers | faqs | best_practices | neighborhoods",
      "clusterPillar": "main topic pillar",
      "eatSignals": ["experience", "expertise", "authoritativeness", "trustworthiness"],
      "answerFirstFraming": true | false
    }
  ]
}

**QUALITY CHECKLIST (Self-Audit Before Returning):**
✓ Every title includes ${geographicFocus} or specific neighborhood/ZIP
✓ At least 60% of titles use answer-first question formats
✓ Coverage categories balanced across 7 pillars
✓ Each title has at least 1 E-E-A-T signal
✓ No generic/vague titles - all promise specific value
✓ No [placeholders] or [brackets] - only real names
✓ Titles optimized for AI extraction and citation
✓ ZERO company names, business names, provider names, or competitor names in any title — titles are about the TOPIC only`;

  console.log(`🤖 Calling Gemini API for ${numTitles} titles...`);
  const result = await throttledGeminiRequest(() => genAI.models.generateContent({
    model: "gemini-2.0-flash",  // Stable production model with 2000 RPM Tier 1 quota
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          titles: {
            type: "array",
            items: { type: "string" },
            description: `Array of ${numTitles} unique, answer-first SEO-optimized article titles`
          },
          primaryKeywords: {
            type: "array",
            items: { type: "string" },
            description: "Top 10 primary keywords for SEO strategy"
          },
          contentStrategy: {
            type: "string",
            description: "Brief content strategy recommendation (2-3 sentences)"
          },
          coverageMapping: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                subtopicCategory: { 
                  type: "string",
                  enum: ["types", "costs", "laws", "providers", "faqs", "best_practices", "neighborhoods"]
                },
                clusterPillar: { type: "string" },
                eatSignals: { 
                  type: "array",
                  items: { 
                    type: "string",
                    enum: ["experience", "expertise", "authoritativeness", "trustworthiness"]
                  }
                },
                answerFirstFraming: { type: "boolean" }
              },
              required: ["title", "subtopicCategory", "clusterPillar", "eatSignals", "answerFirstFraming"]
            },
            description: "Coverage pillar mapping for content cluster architecture"
          }
        },
        required: ["titles", "primaryKeywords", "contentStrategy", "coverageMapping"]
      }
    }
  }));
  console.log(`✅ Gemini API returned response`);

  let responseText = result.text || "";
  if (!responseText) {
    throw new Error("No response text from Gemini");
  }
  
  // Strip markdown code fences if present
  responseText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  
  const parsed = JSON.parse(responseText) as TitlePoolResult;
  
  if (!parsed.titles || parsed.titles.length < numTitles - 5) {
    throw new Error(`Expected ${numTitles} titles, received ${parsed.titles?.length || 0}`);
  }

  // CRITICAL: Validate that titles include geographic location
  // This enforces the mandatory location-based SEO requirement
  // We allow hyper-local variations (neighborhoods, districts) which are superior for local SEO
  
  // Common stop words to filter out (but keep geographic abbreviations)
  const stopWords = new Set(['in', 'of', 'the', 'and', 'or', 'at', 'to', 'for', 'on']);
  
  // Build location tokens from the raw input
  // Strip punctuation (especially trailing periods like "MA.") before tokenizing
  const rawTokens = geographicFocus
    .toLowerCase()
    .replace(/\.$/, '') // Remove trailing periods
    .split(/[\s,|]+/) // Split on spaces, commas, and pipes
    .map(token => token.replace(/\.$/, '')) // Strip periods from individual tokens
    .filter(token => {
      // Keep if not a stop word and has length
      return Boolean(token) && !stopWords.has(token);
    });
  
  // Add normalized state names for any state abbreviations
  const stateTokens: string[] = [];
  for (const token of rawTokens) {
    // Token is already cleaned of punctuation
    if (US_STATES[token]) {
      const fullStateName = US_STATES[token].toLowerCase();
      stateTokens.push(fullStateName); // e.g., "new york"
      // Also add words from multi-word state names
      const stateWords = fullStateName.split(/\s+/).filter(w => w.length > 2);
      stateTokens.push(...stateWords); // e.g., ["new", "york"]
    }
  }
  
  // Add normalized city names for common abbreviations
  const cityTokens: string[] = [];
  for (const token of rawTokens) {
    if (CITY_ABBREVIATIONS[token]) {
      const fullCityName = CITY_ABBREVIATIONS[token];
      cityTokens.push(fullCityName); // e.g., "los angeles"
      // Also add words from multi-word city names
      const cityWords = fullCityName.split(/\s+/).filter(w => w.length > 2);
      cityTokens.push(...cityWords); // e.g., ["los", "angeles"]
    }
  }
  
  // Combine all tokens - includes abbreviations + full names for both cities and states
  const locationTokens = [...new Set([...rawTokens, ...stateTokens, ...cityTokens])].filter(Boolean);
  
  console.log(`🔍 Location validation tokens for "${geographicFocus}": ${locationTokens.join(', ')}`);
  
  const hyperLocalIndicators = [
    'local', 'neighborhood', 'area', 'district', 'downtown', 'near',
    'community', 'region', 'zone', 'metro'
  ];
  
  let titlesWithLocation = 0;
  const titlesWithoutLocation: string[] = [];
  
  for (const title of parsed.titles) {
    const titleLower = title.toLowerCase();
    
    // Check if title contains main location tokens OR hyper-local indicators
    const hasMainLocation = locationTokens.some(token => titleLower.includes(token));
    const hasHyperLocal = hyperLocalIndicators.some(indicator => titleLower.includes(indicator));
    
    // Title is valid if it has main location OR is clearly hyper-local
    if (hasMainLocation || hasHyperLocal) {
      titlesWithLocation++;
    } else {
      titlesWithoutLocation.push(title);
    }
  }
  
  // Require at least 80% of titles to have location/hyper-local context
  // This allows for some variation while ensuring strong local SEO focus
  const locationPercentage = (titlesWithLocation / parsed.titles.length) * 100;
  const REQUIRED_PERCENTAGE = 80;
  
  if (locationPercentage < REQUIRED_PERCENTAGE) {
    const errorDetails = titlesWithoutLocation.slice(0, 3).join('", "');
    throw new Error(
      `Location validation failed: Only ${Math.round(locationPercentage)}% of titles contain location context (minimum: ${REQUIRED_PERCENTAGE}%). ` +
      `${titlesWithoutLocation.length} title(s) lack geographic focus "${geographicFocus}". ` +
      `Examples: "${errorDetails}". Please try again.`
    );
  }
  
  console.log(`✅ Location validation passed: ${titlesWithLocation}/${parsed.titles.length} titles (${Math.round(locationPercentage)}%) include location or hyper-local context`);

  // Calculate uniqueness scores and run agentic critique
  if (researchData && researchData.competitorTitles.length > 0) {
    console.log('📊 Calculating uniqueness scores against competitor titles...');
    
    const competitorTitleStrings = researchData.competitorTitles.map(ct => ct.title);
    
    // Run agentic critique to refine titles (removes hallucinations, clichés, etc.)
    try {
      const industry = parsed.coverageMapping?.[0]?.clusterPillar || 'general services';
      const critiqueResult = await smartResearch.critiqueAndRefineTitles(
        parsed.titles,
        researchData,
        industry
      );
      
      // Update titles with critique results
      parsed.titlesWithScores = critiqueResult.refinedTitles.map(t => ({
        title: t.title,
        uniquenessScore: t.uniquenessScore,
        wasRefined: t.wasRefined,
        refinementReason: t.refinementReason
      }));
      
      // If titles were refined, update the main titles array
      if (critiqueResult.refinedTitles.length > 0) {
        const refinedTitleStrings = critiqueResult.refinedTitles.map(t => t.title);
        // Only update if we got valid results
        if (refinedTitleStrings.length >= parsed.titles.length * 0.5) {
          parsed.titles = refinedTitleStrings;
        }
      }
      
      parsed.critiqueSummary = critiqueResult.critiqueSummary;
      parsed.removedCount = critiqueResult.removedCount;
      parsed.refinedCount = critiqueResult.refinedCount;
      
      console.log(`🧠 Critique complete: ${critiqueResult.removedCount} removed, ${critiqueResult.refinedCount} refined`);
      
    } catch (critiqueError) {
      console.warn('⚠️ Critique failed, using scores only:', (critiqueError as Error).message);
      
      // Fallback: Calculate uniqueness scores without critique
      parsed.titlesWithScores = parsed.titles.map(title => ({
        title,
        uniquenessScore: smartResearch.calculateUniquenessScore(title, competitorTitleStrings),
        wasRefined: false
      }));
      parsed.critiqueSummary = 'Critique skipped due to error';
      parsed.removedCount = 0;
      parsed.refinedCount = 0;
    }
    
    // Log stats
    const avgUniqueness = parsed.titlesWithScores.reduce((sum, t) => sum + t.uniquenessScore, 0) / parsed.titlesWithScores.length;
    const highlyUnique = parsed.titlesWithScores.filter(t => t.uniquenessScore >= 70).length;
    
    console.log(`📈 Uniqueness stats: avg=${Math.round(avgUniqueness)}%, ${highlyUnique}/${parsed.titlesWithScores.length} titles with 70%+ uniqueness`);
  } else {
    // No research data - still provide scores structure but all at 100 (unknown)
    parsed.titlesWithScores = parsed.titles.map(title => ({
      title,
      uniquenessScore: -1, // -1 indicates "not calculated" (no competitor data)
      wasRefined: false
    }));
    parsed.critiqueSummary = 'No competitor data for comparison';
    parsed.removedCount = 0;
    parsed.refinedCount = 0;
  }

  return parsed;
}

/**
 * Generate titles for multiple cities
 * Splits geographic focus into multiple cities and generates separate title pools for each
 */
export async function generateTitlePoolForMultipleCities(
  coreTopic: string,
  targetUrl: string,
  numTitlesPerCity: number = 25,
  tone?: string,
  geographicFocus?: string,
  audience?: string,
  researchData?: SmartResearchResult
): Promise<MultiCityTitlePoolResult> {
  if (!geographicFocus) {
    throw new Error("Geographic focus is required for location-optimized SEO titles");
  }

  // Parse multiple cities from the input
  const cities = parseMultipleCities(geographicFocus);
  
  if (cities.length === 0) {
    throw new Error("No valid cities found in geographic focus");
  }

  console.log(`📍 Detected ${cities.length} cities: ${cities.join(' | ')}`);
  console.log(`🚀 Generating ${numTitlesPerCity} titles for EACH city (${cities.length * numTitlesPerCity} total titles)`);

  // Generate titles for each city in parallel, passing smart research data
  let totalRemovedCount = 0;
  let totalRefinedCount = 0;
  const critiqueSummaries: string[] = [];
  
  const cityResults = await Promise.all(
    cities.map(async (city) => {
      console.log(`  🏙️ Generating titles for: ${city}`);
      
      // For multi-city, we can optionally run per-city research
      // For now, we pass the shared research data to each city
      const result = await generateTitlePool(
        coreTopic,
        targetUrl,
        numTitlesPerCity,
        tone,
        city, // Each city gets its own title pool
        audience,
        undefined, // redditQuestions
        researchData // Pass smart research data to each city
      );
      
      console.log(`  ✅ Generated ${result.titles.length} titles for ${city}`);
      
      // Aggregate critique stats
      if (result.removedCount) totalRemovedCount += result.removedCount;
      if (result.refinedCount) totalRefinedCount += result.refinedCount;
      if (result.critiqueSummary) critiqueSummaries.push(`${city}: ${result.critiqueSummary}`);
      
      return {
        location: city,
        titles: result.titles,
        primaryKeywords: result.primaryKeywords,
        contentStrategy: result.contentStrategy,
        titlesWithScores: result.titlesWithScores,
      };
    })
  );

  // Combine all titles, keywords, and scores
  const combinedTitles = cityResults.flatMap(r => r.titles);
  const allKeywords = cityResults.flatMap(r => r.primaryKeywords);
  const combinedKeywords = [...new Set(allKeywords)]; // Deduplicate keywords
  const combinedTitlesWithScores = cityResults.flatMap(r => r.titlesWithScores || []);

  console.log(`✅ Multi-city title generation complete: ${combinedTitles.length} total titles across ${cities.length} cities`);
  console.log(`📊 Multi-city critique stats: ${totalRemovedCount} removed, ${totalRefinedCount} refined`);

  return {
    cities: cityResults,
    combinedTitles,
    combinedKeywords,
    combinedTitlesWithScores,
    critiqueSummary: critiqueSummaries.length > 0 ? critiqueSummaries.join(' | ') : 'Multi-city critique complete',
    totalRemovedCount,
    totalRefinedCount,
  };
}

export interface ArticleCritiqueMetadata {
  qualityScore: number;
  eeatScore: {
    experience: number;
    expertise: number;
    authoritativeness: number;
    trustworthiness: number;
    overall: number;
  };
  factChecks: Array<{
    claim: string;
    verified: boolean;
    confidence: number;
  }>;
  clichesRemoved: string[];
  improvements: string[];
  critiqueSummary: string;
}

export interface FactValidationResult {
  enabled: boolean;
  factCount: number;
  confidenceRange: { min: number; max: number };
  safetyScore?: number;
  validClaims?: number;
  rejectedClaims?: number;
  gapReport?: {
    status: "INSUFFICIENT_DATA";
    missing: string[];
    suggestedActions: string[];
  };
}

export interface ArticleGenerationResult {
  articleText: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  keywords: string[];
  hashtags: string[];
  faq: Array<{ question: string; answer: string }>;
  imagePrompts: string[];
  wordCount: number;
  critique?: ArticleCritiqueMetadata;
  factValidation?: FactValidationResult;
}

export async function generateArticleContent(
  title: string,
  targetUrl: string,
  wordCountMin: number = 800,
  wordCountMax: number = 2000,
  tone?: string,
  geographicFocus?: string,
  audience?: string,
  businessName?: string,
  customInstructions?: string,
  companyLogoUrl?: string,
  batchId?: number, // Batch ID for SEO cache lookup
  teamId?: number, // Psychographic targeting: team ID for persona lookup
  personaId?: number, // Psychographic targeting: persona ID for content adaptation
  enableFactValidation?: boolean, // Anti-Hallucination: enable fact-based validation
  articleId?: number // Article ID for fact claims audit trail
): Promise<ArticleGenerationResult> {
  // Dynamic year for freshness signals
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  // CRITICAL: Require businessName to prevent generic placeholder generation
  if (!businessName || businessName.trim().length === 0) {
    throw new Error(
      "CRITICAL: businessName is REQUIRED for article generation. " +
      "Cannot generate content with generic 'company' placeholders - this defeats brand lock protection. " +
      "All image prompts and content must reference the actual business name to prevent AI hallucination."
    );
  }
  
  // OPTIMIZATION: Fetch batch-level SEO cache if available (30-50% API call reduction)
  let batchSeoContext: string = "";
  if (batchId) {
    try {
      const { getBatchSeoCache } = await import("./batch-seo-cache");
      const seoCache = await getBatchSeoCache(batchId);
      
      if (seoCache) {
        console.log(`✅ [CACHE HIT] Using batch SEO cache for article generation (batch ${batchId})`);
        
        // NULL-SAFE: Provide defaults for array fields to prevent .join() errors
        const landmarks = seoCache.locationAnalysis?.landmarks || [];
        const locationKeywords = seoCache.locationKeywords || [];
        const primaryTopics = seoCache.semanticClusters?.primary || [];
        const secondaryTopics = seoCache.semanticClusters?.secondary || [];
        const relatedTopics = seoCache.semanticClusters?.related || [];
        const expertiseAreas = seoCache.topicalAuthority?.expertiseAreas || [];
        const trustSignals = seoCache.topicalAuthority?.trustSignals || [];
        const commonThemes = seoCache.competitorInsights?.commonThemes || [];
        const contentGaps = seoCache.competitorInsights?.contentGaps || [];
        const uniqueAngles = seoCache.competitorInsights?.uniqueAngles || [];
        const competitorKeywords = seoCache.competitorKeywords || [];
        
        // NULL-SAFE: Extract v2.0 enhanced fields
        const zipCodes = seoCache.locationAnalysis?.zipCodes || [];
        const neighborhoods = seoCache.locationAnalysis?.neighborhoods || [];
        const population = seoCache.locationAnalysis?.population || '';
        const medianIncome = seoCache.locationAnalysis?.medianIncome || '';
        const localRegulations = seoCache.localRegulations || [];
        const authorityEntities = seoCache.authorityEntities || [];
        const keyStatistics = seoCache.keyStatistics || [];
        
        // NULL-SAFE: Extract v3.0 Reddit research (intent-based content gap analysis)
        const redditQuestions = seoCache.redditResearch?.questions || [];
        const redditDiscussions = seoCache.redditResearch?.discussions || [];
        const redditContentGaps = seoCache.redditResearch?.contentGaps || [];
        const redditSubreddits = seoCache.redditResearch?.subreddits || [];
        
        // PHASE 1: Consolidated Intent Outline (structured H2 themes from raw Reddit data)
        const consolidatedOutline = seoCache.redditResearch?.consolidatedOutline;
        
        // Inject cached SEO context into prompt (v3.0 ENHANCED with Reddit)
        batchSeoContext = `\n\n**PRE-GENERATED BATCH SEO CONTEXT v3.0** (MANDATORY: Use this deep local intelligence + Reddit research):

**Location Intelligence** (${geographicFocus}):
- Demographics: ${seoCache.locationAnalysis?.demographics || 'Not provided'}
- Key Landmarks: ${landmarks.length > 0 ? landmarks.join(", ") : 'Not provided'}
- Local Culture: ${seoCache.locationAnalysis?.localCulture || 'Not provided'}
- Economic Context: ${seoCache.locationAnalysis?.economicContext || 'Not provided'}
${zipCodes.length > 0 ? `- **ZIP Codes** (MENTION IN FIRST 3 PARAGRAPHS): ${zipCodes.join(", ")}` : ''}
${neighborhoods.length > 0 ? `- **Neighborhoods** (MENTION IN FIRST 3 PARAGRAPHS): ${neighborhoods.join(", ")}` : ''}
${population ? `- **Population**: ${population}` : ''}
${medianIncome ? `- **Median Income**: ${medianIncome}` : ''}

**Location-Specific Keywords** (naturally weave these into content):
${locationKeywords.length > 0 ? locationKeywords.join(", ") : 'Not provided'}

${localRegulations.length > 0 ? `**Local Regulations** (CITE FOR AUTHORITY):
${localRegulations.map(r => `- ${r.title} (${r.category}): ${r.description}${r.effectiveDate ? ` [Effective: ${r.effectiveDate}]` : ''}${r.sourceUrl ? ` [Source: ${r.sourceUrl}]` : ''}`).join('\n')}` : ''}

${authorityEntities.length > 0 ? `**Authority Entities** (CITE FOR E-E-A-T):
${authorityEntities.map(e => `- ${e.name} (${e.type}): ${e.description}${e.citationUrl ? ` [${e.citationUrl}]` : ''}${e.freshnessYear ? ` [${e.freshnessYear}]` : ''}`).join('\n')}` : ''}

${keyStatistics.length > 0 ? `**Key Statistics** (USE IN FIRST 2-3 PARAGRAPHS):
${keyStatistics.map(s => `- ${s.claim}: ${s.value} (Source: ${s.source}, ${s.year})`).join('\n')}` : ''}

${consolidatedOutline && consolidatedOutline.consolidatedIntents?.length > 0 ? `**🔥 PHASE 1: CONSOLIDATED REDDIT OUTLINE - STRUCTURED USER INTENT** (HIGHEST PRIORITY):

This is a professionally analyzed outline derived from ${redditQuestions.length} Reddit discussions. Each theme below represents a cluster of user questions transformed into AEO-compliant H2 headings with authentic experience proof.

**Target Audience:** ${consolidatedOutline.targetAudience}
**Overall Theme:** ${consolidatedOutline.overallTheme}

**YOUR ARTICLE STRUCTURE (USE THESE H2 HEADINGS):**

${consolidatedOutline.consolidatedIntents.map((intent: any, i: number) => `
${i+1}. **H2:** "${intent.h2Question}"
   - **Core Intent:** ${intent.coreIntent}
   - **Coverage Pillar:** ${intent.coveragePillar}
   - **Experience Proof (E-E-A-T):** ${intent.experienceProof}
   - **Prevalence:** ${intent.prevalence}
   - **Supporting Questions:** ${intent.supportingQuestions.slice(0, 3).join('; ')}
   
   **INSTRUCTION:** Create a comprehensive section answering this H2. Incorporate the experience proof naturally as real-world evidence. Reference it as "Users in ${geographicFocus} report...", "According to local community discussions...", or "Real experiences from ${geographicFocus} residents show..."
`).join('\n')}

**CRITICAL REQUIREMENTS:**
1. Use the H2 questions EXACTLY as written above (they are pre-optimized for AEO)
2. Each H2 section must incorporate its experience proof authentically
3. Structure follows user intent priority (most prevalent themes first)
4. Answer each H2 comprehensively in 2-4 paragraphs (Mike King format)
5. Include relevant supporting questions as H3 subsections where appropriate` : (
// FALLBACK: If Phase 1 consolidation failed, use raw Reddit data
redditQuestions.length > 0 || redditDiscussions.length > 0 ? `**🔥 REDDIT RESEARCH - REAL USER INTENT & E-E-A-T PROOF** (HIGHEST PRIORITY):

${redditQuestions.length > 0 ? `**Reddit Questions Mined** (${redditQuestions.length} total from ${redditSubreddits.join(', ')}):
Use these as H2/H3 headings and answer them directly in the article:
${redditQuestions.slice(0, 10).map((q: any, i: number) => `${i+1}. "${q.question}" (${q.upvotes} upvotes on r/${q.subreddit})`).join('\n')}

**INSTRUCTION:** Structure your H2/H3 headings based on these questions. For example:
- Reddit Q: "What's the average cost?" → H2: "What Does ${title.split(':')[0]} Cost in ${geographicFocus}?"
- Reddit Q: "Are there any regulations?" → H2: "What ${geographicFocus} Regulations Apply to ${title.split(':')[0]}?"` : ''}

${redditDiscussions.length > 0 ? `\n**Reddit Discussions for E-E-A-T Proof** (${redditDiscussions.length} upvoted discussions):
Use these as Experience signals - reference real user experiences:
${redditDiscussions.slice(0, 5).map((d: any, i: number) => `${i+1}. "${d.title}" (${d.upvotes} upvotes on r/${d.subreddit})\n   E-E-A-T Proof: ${d.eatProof}`).join('\n\n')}

**E-E-A-T INTEGRATION:** Reference these discussions as "Reddit users in ${geographicFocus} report...", "Common experiences shared in local forums...", "According to ${geographicFocus} community discussions..."` : ''}

${redditContentGaps.length > 0 ? `\n**Content Gaps to Address** (What Reddit users want but can't find):
${redditContentGaps.map((gap: any) => `- ${gap.gap} (${gap.prevalence} mentions across ${gap.subreddits.join(', ')})`).join('\n')}

**INSTRUCTION:** Make sure your article addresses these specific gaps that competitors are missing.` : ''}
` : ''
)}

${seoCache.competitorInsights && (commonThemes.length > 0 || contentGaps.length > 0) ? `**Competitive Intelligence**:
${commonThemes.length > 0 ? `- Common Themes: ${commonThemes.join(", ")}` : ''}
${contentGaps.length > 0 ? `- Content Gaps to Exploit: ${contentGaps.join(", ")}` : ''}
${uniqueAngles.length > 0 ? `- Unique Differentiation Angles: ${uniqueAngles.join(", ")}` : ''}

${competitorKeywords.length > 0 ? `**Competitor Keywords** (avoid overusing, focus on differentiation):
${competitorKeywords.join(", ")}` : ''}` : ''}

**Semantic Keyword Clusters** (use naturally throughout):
${primaryTopics.length > 0 ? `- Primary Topics: ${primaryTopics.join(", ")}` : ''}
${secondaryTopics.length > 0 ? `- Secondary Concepts: ${secondaryTopics.join(", ")}` : ''}
${relatedTopics.length > 0 ? `- Related Terms: ${relatedTopics.join(", ")}` : ''}

**Topical Authority Markers** (emphasize these):
${expertiseAreas.length > 0 ? `- Expertise Areas: ${expertiseAreas.join(", ")}` : ''}
${trustSignals.length > 0 ? `- Trust Signals: ${trustSignals.join(", ")}` : ''}

**MANDATORY USAGE REQUIREMENTS:**
- MUST mention at least 1 ZIP code or neighborhood in first 3 paragraphs (if provided in batch cache)
- MUST cite at least 2 authority entities for credibility (if provided in batch cache)
- MUST include at least 2 key statistics with sources and years (if provided in batch cache)
- MUST reference at least 1 local regulation (if provided in batch cache)
- If batch cache fields are empty, focus on ${geographicFocus} context using general knowledge

**CRITICAL - HEADING RULES (H2/H3):**
- H2 and H3 headings must be TOPIC-FOCUSED questions or statements only
- NEVER include business names, company names, provider names, or competitor names in any H2 or H3 heading
- Authority entities, local entities, and provider names are for citation INSIDE paragraph body text only
- BAD heading: "How Acme Home Care Helps Miami Seniors" — WRONG: company name in heading
- GOOD heading: "How Home Care Services Work for Miami Seniors" — RIGHT: topic-focused
`;
      } else {
        console.log(`⏩ [CACHE MISS] No batch SEO cache found for batch ${batchId} - generating without cache`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch batch SEO cache for batch ${batchId}:`, error);
      // Continue without cache - non-fatal error
    }
  }
  
  const geographicContext = geographicFocus ? `\nGeographic Focus: ${geographicFocus}` : "";
  const audienceContext = audience ? `\nTarget Audience: ${audience}` : "";
  const toneContext = tone ? `\nTone: ${tone} - Write the entire article in this tone` : "";
  const customContext = customInstructions ? `\n\n**CUSTOM REGENERATION INSTRUCTIONS:**\n${customInstructions}\n\nPlease apply these specific changes while maintaining all other quality standards and requirements below.` : "";
  const brandLockContext = createBrandLockPromptSegment(businessName);
  
  // PSYCHOGRAPHIC TARGETING: Fetch persona + learning optimization context
  let personaContext = "";
  let optimizationContext: ContentOptimizationContext | null = null;
  if (teamId) {
    try {
      optimizationContext = await getContentOptimizationContext(teamId, "article", {
        personaId,
        industry: undefined,
        audience,
      });
      
      if (optimizationContext.combinedSystemPrompt || optimizationContext.combinedUserPrompt) {
        console.log(`🧠 [PSYCHOGRAPHIC] Applying persona targeting + learned patterns for article generation`);
        personaContext = `\n\n**PSYCHOGRAPHIC TARGETING & LEARNED PATTERNS:**${optimizationContext.combinedSystemPrompt}${optimizationContext.combinedUserPrompt}`;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch psychographic context:`, error);
    }
  }

  // NEURAL LOOP: Inject Guardian failure warnings so the AI learns from past mistakes.
  // Fetches the top recurring failures from the ai_learning_ledger for this team and
  // injects them as hard "negative constraints" at the top of the prompt. If the AI
  // previously used a bare city anchor or missed FAQ links, the next generation opens
  // with a specific warning about that exact error type.
  let guardianWarningsContext = "";
  if (teamId) {
    try {
      const { getGuardianFailureWarnings } = await import("./learning-integration");
      guardianWarningsContext = await getGuardianFailureWarnings(teamId, "article");
      if (guardianWarningsContext) {
        console.log(`🧠 [NEURAL LOOP] Injecting ${guardianWarningsContext.split("\n").filter(l => l.startsWith("  -")).length} Guardian failure warning(s) into Gemini prompt`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch Guardian failure warnings:`, error);
    }
  }

  const prompt = `You are an expert content strategist implementing a composite 3-layer methodology combining Lily Ray's Answer-First structure, Mike King's passage-level optimization, and Kevin Indig's citation optimization for maximum AI visibility and E-E-A-T signals.

Article Title: ${title}
Target URL for Internal Linking: ${targetUrl}
Word Count Range: ${wordCountMin}-${wordCountMax} words${geographicContext}${audienceContext}${toneContext}${customContext}
${brandLockContext}${batchSeoContext}${personaContext}${guardianWarningsContext}

**CRITICAL CONTENT FOCUS - THIS IS EDUCATIONAL CONTENT, NOT AN ADVERTISEMENT:**
The article MUST be ABOUT THE TOPIC/SUBJECT MATTER, NOT about ${businessName}.
- WRONG: "10 Ways ${businessName} Helps You..." (article ABOUT the company = advertisement)
- CORRECT: "10 Ways to Solve [Problem]" (article ABOUT the topic = educational content)
- Focus on educating readers about the INDUSTRY/SUBJECT with genuinely helpful information
- Write as if you are a journalist or educator, NOT a salesperson

**COMPANY MENTION RULES:**
- ${businessName} should ONLY appear in the CONCLUSION section as a brief CTA
- Do NOT mention ${businessName} in the introduction, body, or FAQ sections
- Do NOT use "our team," "we offer," "we help," or any first-person promotional language
- The body of the article must be 100% informational and educational
- Save all company references for ONE brief CTA paragraph at the very end

**CONCLUSION/CTA FORMAT (only place for company mention):**
"For ${geographicFocus} residents seeking [topic-related service], ${businessName} provides [brief service description]. Contact [phone/website] to learn more."
- This CTA should be 1-2 sentences maximum
- It should feel like a helpful suggestion, not a sales pitch

**COMPOSITE 3-LAYER METHODOLOGY (ALL LAYERS MANDATORY):**

═══════════════════════════════════════════════════════════════════
LAYER 1: LILY RAY'S ANSWER-FIRST STRUCTURE (AEO Optimization)
═══════════════════════════════════════════════════════════════════

1. **ANSWER-FIRST OPENING PARAGRAPH (150-200 words) - CRITICAL:**
   
   ⚠️ **EXCEPTION TO 3-5 SENTENCE RULE**: This opening paragraph is exempt from the strict sentence limit and should be 8-12 sentences to reach 150-200 words.
   
   - Provide a COMPLETE, DIRECT answer to the main query in the title
   - Front-load the most important facts and evidence
   - Make this paragraph quotable and citable by AI systems
   - Include target keyword naturally 2-3 times
   - Use clear, authoritative language
   - Think: "If AI only reads this paragraph, does it get the full answer?"
   
   **Formula:** [Direct Answer] + [Key Facts] + [Evidence/Statistics] + [Local Context for ${geographicFocus}] + [Practical Implication]
   
   **Example Structure (8-12 sentences, 150-200 words):**
   "${title} involves [direct answer in 2-3 sentences]. ${geographicFocus} residents/businesses face [specific local challenge]. According to [authority entity name], [key statistic with source and year]. The primary considerations include [3-4 key factors]. For ${geographicFocus} specifically, [local regulation or neighborhood-specific context]. [Additional supporting evidence]. [Final implication or practical takeaway]."

2. **E-E-A-T SIGNALS THROUGHOUT CONTENT:**
   
   **Experience (Real-World Evidence - NOT promotional):**
   - Share practical insights based on industry experience
   - Use third-party case studies and examples from ${geographicFocus}
   - Reference what practitioners/experts in the field have observed
   - AVOID: "Our team," "We help," "Our experience" - this sounds like an ad
   
   **Expertise (Technical Depth):**
   - Demonstrate deep knowledge with technical details
   - Explain complex concepts clearly for ${geographicFocus} context
   - Use industry-specific terminology with explanations
   - Reference ${geographicFocus}-specific standards or practices
   
   **Authoritativeness (Credible Citations):**
   - MANDATORY: Cite at least 2 authority entities from batch SEO cache
   - Include statistics with sources and years from batch cache
   - Reference local regulations provided in batch context
   - Cite government data, industry reports, local authorities
   
   **Trustworthiness (Accuracy & Transparency):**
   - Be accurate and fact-check all claims against batch SEO cache
   - Be transparent about limitations or uncertainties
   - Provide balanced perspectives
   - Use recent data (${previousYear}-${currentYear}) and cite years

3. **LOCAL/GEO OPTIMIZATION (MANDATORY IN FIRST 3 PARAGRAPHS):**
   - MUST include ${geographicFocus}-specific data in first 3 paragraphs
   - MUST mention at least 1 ZIP code OR neighborhood (if provided in batch cache above)
   - Reference local demographics, regulations, or trends (use batch cache if available)
   - Cite local authority entities where relevant (if provided in batch cache above)
   - Add ${geographicFocus}-specific examples using available data or general knowledge

4. **FRESHNESS SIGNALS:**
   - Include current year (${currentYear}) in opening paragraph
   - Reference latest developments (${previousYear}-${currentYear})
   - Use phrases: "As of ${currentYear}...", "Latest data shows...", "Recent trends in ${geographicFocus}..."

═══════════════════════════════════════════════════════════════════
LAYER 2: MIKE KING'S PASSAGE-LEVEL OPTIMIZATION (AI Extraction)
═══════════════════════════════════════════════════════════════════

**CRITICAL: STRICT PARAGRAPH LENGTH LIMITS**

⚠️ **IMPORTANT**: Opening paragraph is EXEMPT from this rule (see Layer 1). ALL OTHER paragraphs must follow:

Every paragraph (EXCEPT opening) MUST be:
- **3-5 sentences maximum** (STRICT)
- Self-contained (can stand alone as a complete answer)
- Contains ONE clear idea only
- Includes context (don't assume reader read previous paragraphs)
- Optimized for AI extraction

**PARAGRAPH FORMULA (Use This Pattern):**
"[Topic/Question] is [Definition/Answer]. [Supporting detail 1 with evidence]. [Supporting detail 2 with local context]. [Practical implication]. [Specific relevance to ${geographicFocus}]."

**Example (5 sentences max):**
"${title} requires understanding local regulations in ${geographicFocus}. [Local regulation from batch cache] mandates specific requirements for businesses. According to [authority entity from batch cache], [statistic with source]. This affects [ZIP code area from batch cache] residents differently than other neighborhoods. Compliance ensures [practical benefit]."

**COMPRESSION RULES (Mike King):**
- Remove ALL unnecessary words
- Get to the point IMMEDIATELY
- Front-load key information in EVERY paragraph
- Use active voice exclusively
- Eliminate redundancy completely
- No fluff, no filler, no transitional waffle

**🚨 BANNED AI LANGUAGE - NEVER USE THESE 🚨**
OPENINGS TO AVOID:
- "In today's fast-paced world..." / "In this day and age..." / "In today's digital age..."
- "As we navigate..." / "In the ever-evolving landscape..."
- "It's important to note that..." / "It's worth mentioning..."
- "When it comes to..." / "Let's dive into..." / "Let's explore..."

FILLER WORDS TO AVOID:
- "Furthermore" / "Moreover" / "Additionally" / "Consequently"
- "Thus" / "Hence" / "Therefore" / "Nevertheless"
- "Firstly" / "Secondly" / "Thirdly" / "Lastly"
- "Certainly" / "Absolutely" / "Undoubtedly"

HYPE WORDS TO AVOID:
- "Revolutionary" / "Game-changer" / "Cutting-edge" / "State-of-the-art"
- "Seamless" / "Robust" / "Holistic" / "Transformative"
- "Leverage" / "Empower" / "Elevate" / "Optimize" / "Streamline"
- "Plethora" / "Myriad" / "Multifaceted" / "Nuanced"

CONCLUSIONS TO AVOID:
- "In conclusion..." / "To sum up..." / "In summary..."
- "All in all..." / "At the end of the day..."

INSTEAD: Write like a knowledgeable local expert talking to a neighbor. Be direct, specific, and conversational. Use simple words. Start sentences with the subject, not with fillers.

**BAD (Too Long, Vague, AI-sounding):**
"When it comes to understanding the various aspects of this topic, there are many different factors that one should consider, especially when looking at the local context and all of the various regulations that might apply to different situations..."

**GOOD (Compressed, Specific, Human):**
"${title} in ${geographicFocus} requires three key considerations. First, [local regulation from batch cache] sets mandatory standards. Second, [ZIP code] residents face unique challenges. Third, compliance costs average [statistic from batch cache]."

═══════════════════════════════════════════════════════════════════
LAYER 3: KEVIN INDIG'S CITATION OPTIMIZATION (Schema-Ready)
═══════════════════════════════════════════════════════════════════

1. **SCHEMA-READY STRUCTURE:**
   - Use question-based H2 headings: "What is...", "How does...", "Why...", "When to..."
   - Each H2 section = 2-3 H3 subsections maximum
   - Include numbered lists for step-by-step processes (HowTo schema)
   - Create 5-8 natural Q&As in FAQ section (FAQPage schema)
   - Use semantic HTML structure

2. **🚨 CRITICAL AEO CONSTRAINT: 40-60 WORD DIRECT ANSWERS 🚨**
   
   **MANDATORY FOR EVERY H2 AND H3 HEADING:**
   
   The FIRST paragraph immediately following each H2 or H3 heading MUST be:
   - **Exactly 40-60 words** (count carefully!)
   - A complete, direct, non-promotional answer to the heading question
   - Optimized for AI Overview citation and featured snippets
   - Front-loaded with the most critical information
   - Self-contained (understandable without context)
   
   **Formula for H2/H3 Direct Answers (40-60 words):**
   "[Direct answer in 1-2 sentences]. [Key supporting fact with evidence]. [Local context for ${geographicFocus}]. [Practical implication or next step]."
   
   **Example for H2: "What Are the Requirements for [Topic] in ${geographicFocus}?"**
   "[Topic] in ${geographicFocus} requires three primary elements: [requirement 1], [requirement 2], and [requirement 3]. According to [authority entity], [key statistic]. ${geographicFocus} residents in [ZIP code/neighborhood] must also comply with [local regulation]. This ensures [practical benefit]." (58 words)
   
   **Example for H3: "How Much Does [Topic] Cost?"**
   "[Topic] costs between $[low] and $[high] in ${geographicFocus}, depending on [factor 1] and [factor 2]. [Authority entity] reports that ${geographicFocus} prices average [statistic]. [Neighborhood]-specific pricing varies by [factor]. Budget accordingly for [practical consideration]." (45 words)
   
   ⚠️ **AFTER** the 40-60 word direct answer paragraph, you may continue with additional detail in standard 3-5 sentence paragraphs.

3. **AUTHOR ENTITY INTEGRATION (E-E-A-T Authority Signal):**
   
   **IMPORTANT: This is NOT promotional content. Write as an informative expert, NOT as a salesperson.**
   
   - Reference industry expertise WITHOUT self-promotion
   - Use third-person authority: "Licensed professionals recommend...", "Industry experts advise..."
   - Cite external credentials: "Board-certified specialists," "state-licensed providers"
   - Reference general practitioner experience: "Experienced providers in ${geographicFocus} typically..."
   
   **Example Integration (Non-promotional):**
   "Licensed care providers in ${geographicFocus} typically recommend [approach] based on local regulations and client needs. Professionals serving neighborhoods like [neighborhood 1] and [neighborhood 2] have observed that [practical insight]."
   
   **AVOID promotional language like:**
   - "Our team..." / "We offer..." / "Contact us..."
   - "Our experienced professionals..." / "We have helped..."
   - Any first-person promotional language in the body content

4. **FRONT-LOAD EVIDENCE (First 2-3 Paragraphs):**
   - Paragraph 1 (Answer-first): Include primary statistic
   - Paragraph 2: Cite authority entity by name only (no internal scores)
   - Paragraph 3: Reference local regulation or neighborhood data
   - Use format: "[Claim] + [Evidence with source] + [Implication]"
   
   **Example:**
   "[Statistic claim]: [value]. [Authority entity] reports [evidence]. For ${geographicFocus} residents, this means [implication]."

5. **COMPRESS PARAGRAPHS FOR EXTRACTABILITY:**
   - Each paragraph = [Claim] + [Evidence] + [Implication]
   - 3-4 sentences per paragraph (Mike King limit applies here too)
   - Make each paragraph quotable on its own

6. **CONTENT STRUCTURE (Kevin Indig's No-Regret Moves):**
   - Introduction: Answer-first paragraph (150-200 words)
   - 6-8 H2 sections with question-based headings
   - Each H2: 2-3 H3 subsections
   - Include 1 comparison table (format as text list)
   - Include 1 step-by-step numbered process
   - FAQ section: 5-8 natural language questions
   - Conclusion: Key takeaways summary (3-5 sentences)

**SCHEMA MARKUP REQUIREMENTS:**
- FAQPage: Natural Q&As (not keyword-stuffed)
- HowTo: Step-by-step processes with clear actions
- Article: Clear structure, author indicators, dates
- LocalBusiness: For ${geographicFocus}-specific content

═══════════════════════════════════════════════════════════════════
QUALITY CHECKLIST (Self-Audit Before Returning Article)
═══════════════════════════════════════════════════════════════════

**LAYER 1 (Lily Ray - Answer-First):**
✓ Opening paragraph is 150-200 words
✓ Provides complete, direct answer to title question
✓ Front-loads facts and evidence
✓ Includes 2-3 mentions of target keyword naturally
✓ Cites at least 1 statistic with source in opening
✓ Mentions ${geographicFocus} in first paragraph

**LAYER 2 (Mike King - Passage-Level):**
✓ Opening paragraph is 8-12 sentences (150-200 words)
✓ ALL OTHER paragraphs are 3-5 sentences
✓ Each paragraph stands alone (self-contained)
✓ No filler or transitional waffle
✓ Active voice used throughout
✓ Key info front-loaded in every paragraph

**LAYER 3 (Kevin Indig - Citation Optimization):**
✓ Question-based H2 headings used — headings are TOPIC-FOCUSED only
✓ 🚨 CRITICAL: Every H2/H3 has 40-60 word direct answer as first paragraph
✓ 🚨 ZERO company names / business names / provider names in any H2 or H3 heading
✓ Author entity referenced in introduction or first H2 section
✓ First 2-3 paragraphs include evidence with sources
✓ At least 2 authority entities cited (in paragraph body text only, never in headings)
✓ At least 2 statistics with sources and years
✓ FAQ section has 5-8 natural Q&As
✓ At least 1 numbered step-by-step process

**LOCAL SEO (Mandatory):**
✓ ${geographicFocus} mentioned in first 3 paragraphs
✓ At least 1 ZIP code OR neighborhood mentioned in first 3 paragraphs (use batch cache if available)
✓ At least 1 local regulation cited (ONLY IF provided in batch cache above)
✓ At least 2 local authority entities cited (ONLY IF provided in batch cache above)
✓ If batch cache is empty, use ${geographicFocus} general context and knowledge

**TECHNICAL REQUIREMENTS:**
✓ Word count within ${wordCountMin}-${wordCountMax} range
✓ ${businessName} appears as example/reference only (NOT main subject)
✓ Current year (${currentYear}) referenced
✓ All claims supported by evidence

SEO Requirements:
1. Generate an SEO-optimized title tag (50-60 characters)
2. Write a compelling meta description — HARD LIMIT: 155 characters maximum (count carefully). MUST be a grammatically COMPLETE sentence ending with proper punctuation (period, exclamation, or question mark). NEVER end with a comma, conjunction (and/or/for/to), colon, or semi-colon. NEVER use "...", "…", or any truncation. If a thought cannot fit in 155 chars, simplify it — do not overflow the limit.
3. Create a URL-friendly slug (lowercase, hyphens, no special characters)
4. Identify exactly 6 article-specific long-phrase keywords (3-6 words each) that:
   - Are unique to THIS specific article title and geographic focus
   - Appear naturally in the article content
   - Target search queries relevant to "${title}"${geographicContext ? ` in ${geographicFocus}` : ''}
   - Will be used for internal linking to ${targetUrl}
5. Generate 10-15 relevant hashtags for social media

FAQ Requirements:
Generate 5-8 frequently asked questions with detailed answers:
1. Questions should be in natural language (how people actually ask)
2. Answers should be 2-4 sentences, comprehensive but concise
3. Cover common buyer concerns, technical questions, and decision criteria
4. Support FAQ schema markup
5. CRITICAL: Every FAQ answer MUST be a complete sentence ending with a period — NEVER end with "...", ".....", "…", or any trailing dots
6. CRITICAL: Do NOT truncate or summarize answers — write the full answer in 2-4 complete sentences

Image Requirements:
Generate exactly 3 HYPER-REALISTIC, VIBRANT image generation prompts that illustrate the TOPIC/SUBJECT of the article.

**CRITICAL: Images should illustrate the CONTENT TOPIC while subtly referencing the business**

**TOPIC-FOCUSED IMAGE REQUIREMENTS:**
- Images should show the SUBJECT MATTER being discussed (e.g., if about home care, show caregiving scenarios)
- Focus on authentic scenes that help readers understand the topic
- ALWAYS reference the business name "${businessName}" naturally in the scene description
- Images MUST be VIBRANT and colorful - matching the tone and energy of the article
- AVOID professional stock photo aesthetics - go for authentic, documentary-style realism
- HYPERREALISTIC location settings - capture the actual environment${geographicContext ? ` in ${geographicFocus}` : ''}

**BUSINESS NAME INTEGRATION (REQUIRED):**
- EVERY image prompt MUST include the business name "${businessName}" naturally in the description
- Example: "A ${businessName} professional assisting an elderly patient..."
- Example: "The ${businessName} team member carefully preparing..."
- This is for AI prompt tracking, NOT visible text in the image
- Do NOT include text overlays, logos, or branded uniforms in the visual
- The business name appears in the PROMPT DESCRIPTION, not as visible image elements

Each prompt MUST include ALL of these elements:

1. **Subject & Scene** (WHAT): Real people in authentic situations relevant to the article topic
   - Be extremely specific: ages, expressions, professional attire, authentic activities
   - ALWAYS include "${businessName}" in the description (e.g., "A ${businessName} caregiver...")
   - Example: "A caring 45-year-old ${businessName} professional in clean scrubs helping an elderly woman with mobility exercises in a bright living room"
   
2. **Location Context** (WHERE): HYPERREALISTIC setting in the specific geographic location${geographicContext ? ` (${geographicFocus})` : ''}
   - Include EXACT architectural styles, recognizable local landmarks, regional characteristics
   - Capture authentic local environment - weather patterns, vegetation, building materials
   - Example: "On-site at a residential property in ${geographicFocus || 'the local area'}, showing authentic local architecture and landscape"
   
3. **Vibrant Color & Atmosphere** (FEEL): VIBRANT, energetic visuals matching article tone
   - Use saturated, vivid colors - avoid muted or washed-out tones
   - Create warm, inviting atmosphere appropriate to the topic
   - Example: "Vibrant and energetic atmosphere, warm natural colors, lively and engaging"
   
4. **Lighting** (HOW IT LOOKS): Natural, authentic lighting that enhances vibrancy
   - Specify: bright natural daylight, golden hour warmth, well-lit environments
   - Enhance color saturation and vibrancy through lighting
   - Example: "Bright natural daylight, clear skies, enhanced color saturation, vibrant warm tones"
   
5. **Composition** (FRAMING): Documentary-style authentic framing
   - Avoid posed, stock-photo compositions
   - Capture real activities in action, genuine moments
   - Example: "Candid shot, people actively engaged in activity, documentary style, dynamic angles"
   
6. **Style & Quality** (VISUAL TONE): Authentic, non-stock photography
   - AVOID: Staged stock photos, artificial perfection, generic business imagery
   - AIM FOR: Documentary realism, vibrant photojournalism, authentic environments
   - Example: "Documentary-style photojournalism, hyperrealistic, vibrant color grading, authentic scene"
   
7. **Context Details** (AUTHENTICITY): Realistic setting and props relevant to the topic
   - Include authentic tools, equipment, and environmental details relevant to the subject
   - Reference "${businessName}" naturally in the prompt description
   - Example: "A ${businessName} professional with authentic medical equipment, comfortable home setting, natural props, realistic details"

CONSISTENCY REQUIREMENTS:
- All 3 prompts MUST include "${businessName}" in the scene description
- VIBRANT color palette throughout - saturated, energetic, eye-catching
- Business name in prompt text (not as visible text/logos in the actual image)
- Hyperrealistic ${geographicFocus || 'local'} location settings in every image
- Progress from wider establishing shots to detailed action close-ups
- Each prompt should illustrate a different aspect of the TOPIC being discussed

ABSOLUTELY AVOID: 
- Visible text overlays, logos, or branded uniforms in the IMAGE itself
- Generic stock photos with models
- Staged, overly-polished scenes
- Muted, professional corporate aesthetics
- Unrealistic perfection or artificial setups

MANDATE:
- ALWAYS include "${businessName}" in every image prompt description
- Documentary-style authenticity showing the TOPIC
- Vibrant, saturated colors creating engaging visuals
- Hyperrealistic location-specific settings
- Genuine moments, not posed promotional scenes

**GLOBAL SEO LAWS (MANDATORY — ENFORCED AT PUBLICATION):**
The following rules are enforced by our automated Guardian Agent after you generate content.
Violations will cause the article to be automatically rejected and regenerated.

1. ANCHOR TEXT / HYPERLINKS: All anchor text MUST be 4-7 words. NEVER hyperlink a bare city or state name alone (e.g., "Boston", "Boston MA", "Weston MA" are FORBIDDEN as anchor text). Always pair location with a service/topic: "professional in-home care near Boston" ✅ not "Boston" ❌.
2. GEO CONTENT: NEVER list more than 2 city names in any single paragraph. Instead of listing cities, create "Semantic Clusters" — 4-7 word phrases that describe a SERVICE in that location.
3. FAQ LINKS: The FAQ section MUST contain at least 2 internal hyperlinks. Every <dd> answer block is eligible for a long-phrase semantic link.
4. CITY PADDING FORBIDDEN: Do NOT pad content by repeating city names to hit keyword density. Every city mention must accompany a service, benefit, or outcome.

**SEMANTIC HOOK INSTRUCTION (CRITICAL — READ BEFORE WRITING):**
As you write EVERY paragraph and EVERY FAQ answer, you must deliberately embed "Semantic Hook" phrases — natural 4-7 word phrases that our hyperlinker can later anchor to. These are NOT forced keyword inserts; they are natural sentences written so the long phrase itself carries meaning.

HOW TO WRITE SEMANTIC HOOKS:
- WRONG: "We offer care in Boston." (bare city, no anchor hook)
- RIGHT: "Our specialized senior home care services in Boston provide families with the consistent, compassionate support they need." (the phrase "specialized senior home care services in Boston" is a 7-word hook ✅)
- WRONG: "Home care is important for seniors." (too vague, no service+location cluster)
- RIGHT: "Families navigating post-hospital recovery care for elderly parents gain confidence when a consistent routine is established." (the phrase "post-hospital recovery care for elderly parents" is a 6-word hook ✅)

Every FAQ answer MUST contain at least one such 4-7 word Semantic Hook phrase. Hooks make internal linking natural and authoritative.
FAILURE TO INCLUDE SEMANTIC HOOKS IN THE FAQ SECTION WILL RESULT IN AUTOMATIC REJECTION.

**CRITICAL FORMATTING REQUIREMENT:**
Return the article text in MARKDOWN format with proper structure:
- Use ## for H2 headers (main sections)
- Use ### for H3 headers (subsections)
- Use blank lines to separate paragraphs
- Use - or * for bullet lists
- Use 1. 2. 3. for numbered lists
- Use **bold** for emphasis
- Use proper spacing between sections

This markdown structure is ESSENTIAL for proper HTML conversion in the next stage.

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "articleText": "full article text here...",
  "seoTitle": "SEO title 50-60 chars",
  "metaDescription": "complete sentence ≤155 chars ending with . or ! or ?",
  "slug": "url-friendly-slug",
  "keywords": ["article-specific keyword 1", "article-specific keyword 2", "article-specific keyword 3", "article-specific keyword 4", "article-specific keyword 5", "article-specific keyword 6"],
  "hashtags": ["#tag1", "#tag2", ... 10-15 hashtags],
  "faq": [
    {"question": "Question 1?", "answer": "Detailed answer..."},
    {"question": "Question 2?", "answer": "Detailed answer..."},
    ... 5-8 FAQ items
  ],
  "imagePrompts": [
    "Detailed DALL-E prompt for hero image...",
    "Detailed DALL-E prompt for supporting image...",
    "Detailed DALL-E prompt for infographic..."
  ],
  "wordCount": 1500
}`;

  // Use configurable Gemini model for article generation
  const { GEMINI_ARTICLE_MODEL } = await import("./ai-config");
  const model = GEMINI_ARTICLE_MODEL;
  
  const result = await throttledGeminiRequest(() => genAI.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    config: {
      // Set explicit ceiling so Gemini never truncates a long article.
      // gemini-2.5-flash supports up to 65536 output tokens.
      maxOutputTokens: 65536,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          articleText: {
            type: "string",
            description: "Full article content in plain text format"
          },
          seoTitle: {
            type: "string",
            description: "SEO-optimized title tag (50-60 characters)"
          },
          metaDescription: {
            type: "string",
            description: "Compelling meta description (150-160 characters)"
          },
          slug: {
            type: "string",
            description: "URL-friendly slug"
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "6 article-specific long-phrase keywords tailored to this title and geographic focus"
          },
          hashtags: {
            type: "array",
            items: { type: "string" },
            description: "10-15 relevant hashtags"
          },
          faq: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                answer: { type: "string" }
              },
              required: ["question", "answer"]
            },
            description: "5-8 FAQ items with questions and answers"
          },
          wordCount: {
            type: "number",
            description: "Actual word count of the article"
          },
          imagePrompts: {
            type: "array",
            items: { type: "string" },
            description: "3 detailed DALL-E image prompts for article visuals (hero image, supporting image, infographic)"
          }
        },
        required: [
          "articleText",
          "seoTitle",
          "metaDescription",
          "slug",
          "keywords",
          "hashtags",
          "faq",
          "wordCount",
          "imagePrompts"
        ]
      }
    }
  }));

  let responseText = result.text || "";
  if (!responseText) {
    throw new Error("No response text from Gemini");
  }
  
  // Strip markdown code fences if present
  responseText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  
  const parsed = JSON.parse(responseText) as ArticleGenerationResult;
  
  if (!parsed.articleText || parsed.articleText.length < 100) {
    throw new Error("Article text is too short or missing");
  }

  if (parsed.keywords.length !== 6) {
    throw new Error(`Expected 6 article-specific keywords, received ${parsed.keywords.length}`);
  }

  // Allow 8-20 hashtags; prompt asks for 10-15 but slight deviations are acceptable.
  if (parsed.hashtags.length < 8) {
    throw new Error(`Too few hashtags (${parsed.hashtags.length}); minimum 8 required.`);
  }

  // Allow 3-10 FAQ items; the prompt asks for 5-8 but Gemini occasionally returns
  // slightly fewer or more. Strict 5-8 enforcement caused good articles to fail and
  // retry indefinitely. FAQ count is enforced in the prompt, not here.
  if (!parsed.faq || parsed.faq.length < 3) {
    throw new Error(`Too few FAQ items (${parsed.faq?.length || 0}); minimum 3 required. Gemini may have truncated.`);
  }

  // ENHANCED: Run article critique for SEO optimization and fact-checking
  // Set DISABLE_ARTICLE_CRITIQUE=true to skip for faster generation (~30s savings per article)
  const disableCritique = process.env.DISABLE_ARTICLE_CRITIQUE === "true";
  
  if (disableCritique) {
    console.log('⚡ Article critique skipped (DISABLE_ARTICLE_CRITIQUE=true) - saving ~30s');
  } else {
    try {
      const { articleCritique } = await import('./article-critique');
      const topic = (title.split(/[-:|]/)[0] ?? title).trim();
      
      console.log('🔍 Running article critique and fact-checking...');
      const critiqueResult = await articleCritique.critiqueArticle(
        parsed.articleText,
        title,
        topic,
        geographicFocus || 'United States',
        businessName || 'the company',
        wordCountMax
      );
      
      if (critiqueResult.refinedContent && critiqueResult.qualityScore > 50) {
        parsed.articleText = critiqueResult.refinedContent;
        parsed.wordCount = critiqueResult.refinedWordCount;
      }
      
      parsed.critique = {
        qualityScore: critiqueResult.qualityScore,
        eeatScore: critiqueResult.seoAnalysis.eeatScore,
        factChecks: critiqueResult.factChecks.map(f => ({
          claim: f.claim.substring(0, 100),
          verified: f.verified,
          confidence: f.confidence
        })),
        clichesRemoved: critiqueResult.clichesRemoved,
        improvements: critiqueResult.improvements,
        critiqueSummary: critiqueResult.critiqueSummary
      };
      
      console.log(`✅ Article critique complete: Quality score ${critiqueResult.qualityScore}/100`);
      
    } catch (critiqueError) {
      console.warn('⚠️ Article critique skipped:', (critiqueError as Error).message);
    }
  }

  if (enableFactValidation && teamId) {
    try {
      console.log(`🔍 [Anti-Hallucination] Starting fact validation for article...`);
      
      const factValidationResult = await validateContentWithFacts(
        parsed.articleText,
        "article",
        {
          teamId,
          enableFactValidation: true,
          minConfidence: 80,
          topic: title,
          contentId: articleId,
        }
      );

      parsed.factValidation = {
        enabled: true,
        factCount: factValidationResult.factPack.totalCount,
        confidenceRange: factValidationResult.factPack.confidenceRange,
        safetyScore: factValidationResult.validationResult?.safetyScore,
        validClaims: factValidationResult.validationResult?.validatedClaims.length,
        rejectedClaims: factValidationResult.validationResult?.rejectedClaims.length,
        gapReport: factValidationResult.gapReport,
      };

      if (factValidationResult.isValid && factValidationResult.validatedContent) {
        parsed.articleText = factValidationResult.validatedContent;
        console.log(`✅ [Anti-Hallucination] Article validated. Safety: ${factValidationResult.validationResult?.safetyScore}%`);
      } else if (factValidationResult.gapReport) {
        console.warn(`⚠️ [Anti-Hallucination] Insufficient facts: ${factValidationResult.gapReport.missing.join(', ')}`);
      }
    } catch (factValidationError) {
      console.warn('⚠️ Fact validation skipped:', (factValidationError as Error).message);
      parsed.factValidation = {
        enabled: false,
        factCount: 0,
        confidenceRange: { min: 0, max: 0 },
      };
    }
  }

  return parsed;
}

// ============================================================================
// ADVANCED ARTICLE GENERATION WITH GEO-SCORING & SERP TARGETING
// ============================================================================

export interface AdvancedArticleResult {
  rawContent: string;
  seoTitle: string;
  metaDescription: string;
  slug: string;
  keywords: string[];
  hashtags: string[];
  faq: Array<{ question: string; answer: string }>;
  imagePrompts: string[];
  wordCount: number;
  geoAccuracyScore?: number;
  tokensUsed?: number;
  humanizationMetrics?: Record<string, unknown>;
}

export async function generateArticleWithGemini(
  title: string,
  targetUrl: string,
  wordCountMin: number = 800,
  wordCountMax: number = 2000,
  tone?: string,
  geographicFocus?: string,
  audience?: string,
  competitorUrls?: string[],
  serpFeatureTarget?: string,
  businessName?: string,
  customInstructions?: string,
  companyLogoUrl?: string,
  batchId?: number,
  teamId?: number,
  personaId?: number
): Promise<AdvancedArticleResult> {
  const result = await generateArticleContent(
    title,
    targetUrl,
    wordCountMin,
    wordCountMax,
    tone,
    geographicFocus,
    audience,
    businessName,
    customInstructions,
    companyLogoUrl,
    batchId,
    teamId,
    personaId
  );

  let geoAccuracyScore: number | undefined;
  if (geographicFocus) {
    const locationMentions = (result.articleText.match(new RegExp(geographicFocus, 'gi')) || []).length;
    geoAccuracyScore = Math.min(100, locationMentions * 10 + 50);
  }

  // DETERMINISTIC HUMANIZATION: Apply burstiness and scrub AI-isms
  const humanized = humanizeArticle(result.articleText, 0.45);
  console.log(`🔧 [DH] Article humanized: burstiness=${humanized.metrics.burstinessApplied}, scrubs=${humanized.metrics.scrubsApplied}, integrity=${humanized.metrics.integrityPassed}`);

  return {
    rawContent: humanized.content,
    seoTitle: result.seoTitle,
    metaDescription: result.metaDescription,
    slug: result.slug,
    keywords: result.keywords,
    hashtags: result.hashtags,
    faq: result.faq,
    imagePrompts: result.imagePrompts || [],
    wordCount: result.wordCount,
    geoAccuracyScore,
    tokensUsed: result.wordCount,
    humanizationMetrics: humanized.metrics,
  };
}
