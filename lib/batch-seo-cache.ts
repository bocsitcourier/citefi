import { db } from "./db";
import { batchSeoCache, jobBatches } from "../shared/schema";
import { eq } from "drizzle-orm";
import { throttledGeminiRequest } from "./gemini";
import { GoogleGenAI } from "@google/genai";
import { performRedditResearch, type RedditResearchResult } from "./reddit-research-service";
import { consolidateRedditIntents, type RedditOutline } from "./reddit-intent-consolidation";
import { RedditResearch } from "./reddit-research";
import { ExpertDiscovery } from "./expert-discovery";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ============================================================================
// BATCH-LEVEL SEO CACHE SYSTEM
// Generates reusable SEO context once per batch (30-50% API call reduction)
// ============================================================================

// Cache version for invalidation when prompt structure evolves
// Increment this when changing generateBatchSeoContext prompt or output structure
// v3.0: Reddit integration for intent-based content gap analysis
// v3.1: Reddit JSON API + Expert Discovery for E-E-A-T enhancement
const CURRENT_CACHE_VERSION = "3.1";

export interface LocalAuthorityEntity {
  name: string;
  type: "organization" | "expert" | "landmark" | "regulation" | "statistic";
  description: string;
  citationUrl?: string;
  credibilityScore: number; // 0-100
  freshnessYear?: number; // Year of data/publication
}

export interface LocalRegulation {
  title: string;
  category: "licensing" | "zoning" | "health" | "safety" | "employment" | "taxation" | "other";
  description: string;
  effectiveDate?: string;
  sourceUrl?: string;
}

export interface BatchSeoContext {
  locationAnalysis: {
    demographics: string;
    landmarks: string[];
    localCulture: string;
    economicContext: string;
    // ENHANCED: Deep local intelligence
    zipCodes?: string[]; // Relevant ZIP codes
    neighborhoods?: string[]; // Specific neighborhoods/districts
    population?: string; // Latest population data with year
    medianIncome?: string; // Economic data with year
  };
  locationKeywords: string[];
  // ENHANCED: Local regulations and laws
  localRegulations?: LocalRegulation[];
  // ENHANCED: Authority entities with credibility tracking
  authorityEntities?: LocalAuthorityEntity[];
  // ENHANCED: Statistics with freshness dates
  keyStatistics?: Array<{
    claim: string;
    value: string;
    source: string;
    year: number;
  }>;
  // ENHANCED v3.0: Reddit research for intent-based content gap analysis
  redditResearch?: RedditResearchResult;
  // ENHANCED v3.1: Expert Discovery for E-E-A-T signals
  expertDiscovery?: {
    experts: Array<{
      name: string;
      title: string;
      source: string;
      credibilityScore: number;
      topic: string;
    }>;
    totalFound: number;
    avgCredibility: number;
    expertiseLevel: 'low' | 'medium' | 'high';
  };
  competitorInsights?: {
    commonThemes: string[];
    contentGaps: string[];
    uniqueAngles: string[];
  };
  competitorKeywords?: string[];
  semanticClusters: {
    primary: string[];
    secondary: string[];
    related: string[];
  };
  topicalAuthority: {
    expertiseAreas: string[];
    trustSignals: string[];
  };
}

/**
 * Get or generate batch-level SEO cache
 * This function is called once per batch and cached for all articles
 * 
 * @param batchId - The batch ID to get/generate cache for
 * @returns Cached SEO context that can be reused across all articles
 */
export async function getBatchSeoCache(batchId: number): Promise<BatchSeoContext | null> {
  console.log(`📦 [Batch ${batchId}] Checking for cached SEO context...`);

  // Check if cache exists
  const existingCache = await db
    .select()
    .from(batchSeoCache)
    .where(eq(batchSeoCache.batchId, batchId))
    .limit(1);

  if (existingCache.length > 0) {
    const cache = existingCache[0];
    
    // Check cache version - invalidate if outdated
    if (cache.cacheVersion !== CURRENT_CACHE_VERSION) {
      console.log(`⚠️  [Batch ${batchId}] Cache version mismatch (stored: ${cache.cacheVersion}, current: ${CURRENT_CACHE_VERSION}) - regenerating...`);
      // Delete stale cache and regenerate below
      await db.delete(batchSeoCache).where(eq(batchSeoCache.batchId, batchId));
    } else {
      console.log(`✅ [Batch ${batchId}] Found existing SEO cache (v${cache.cacheVersion}) - reusing!`);
      
      return {
        locationAnalysis: cache.locationAnalysisJson as any,
        locationKeywords: cache.locationKeywordsJson as any,
        localRegulations: cache.localRegulations as any,
        authorityEntities: cache.authorityEntities as any,
        keyStatistics: cache.keyStatistics as any,
        redditResearch: cache.redditResearch as any,
        expertDiscovery: cache.expertDiscovery as any,
        competitorInsights: cache.competitorInsightsJson as any,
        competitorKeywords: cache.competitorKeywordsJson as any,
        semanticClusters: cache.semanticClustersJson as any,
        topicalAuthority: cache.topicalAuthorityJson as any,
      };
    }
  }

  console.log(`🔧 [Batch ${batchId}] No cache found - generating SEO context (one-time cost)...`);
  
  // Get batch details
  const batch = await db
    .select()
    .from(jobBatches)
    .where(eq(jobBatches.id, batchId))
    .limit(1);

  if (batch.length === 0) {
    console.error(`❌ [Batch ${batchId}] Batch not found`);
    return null;
  }

  const batchData = batch[0];
  const params = batchData.generationParams as any;
  const geographicFocus = params?.geographicFocus || "";
  
  // CRITICAL: Skip cache generation if no geographic focus (prevents low-quality prompts)
  // Batch SEO cache is designed for location-specific optimization
  if (!geographicFocus || geographicFocus.trim().length === 0) {
    console.log(`⏩ [Batch ${batchId}] Skipping batch SEO cache - no geographic focus provided (generationParams may be null for legacy batches)`);
    return null;
  }
  
  // Check if Reddit research was already performed during title generation (to avoid duplicate scraping)
  const cachedRedditResearch = params?.redditResearchCache;
  
  // Generate batch-level SEO context using Gemini + Reddit research
  const context = await generateBatchSeoContext({
    coreTopic: batchData.coreTopic,
    geographicFocus,
    targetUrl: batchData.targetUrl,
    businessName: batchData.businessName || "",
    competitorUrls: (batchData.competitorUrlsJson as string[]) || [],
    cachedRedditResearch, // Reuse if available
  }, batchId);

  if (!context) {
    console.error(`❌ [Batch ${batchId}] Failed to generate SEO context`);
    return null;
  }

  // Store cache in database with conflict handling for concurrent workers
  // If another worker already inserted cache (race condition), use their version
  await db.insert(batchSeoCache).values({
    batchId,
    locationAnalysisJson: context.locationAnalysis,
    locationKeywordsJson: context.locationKeywords,
    localRegulations: context.localRegulations || null,
    authorityEntities: context.authorityEntities || null,
    keyStatistics: context.keyStatistics || null,
    redditResearch: context.redditResearch || null,
    expertDiscovery: context.expertDiscovery || null,
    competitorInsightsJson: context.competitorInsights,
    competitorKeywordsJson: context.competitorKeywords,
    semanticClustersJson: context.semanticClusters,
    topicalAuthorityJson: context.topicalAuthority,
    cacheVersion: CURRENT_CACHE_VERSION,
  }).onConflictDoNothing();

  // Re-fetch to ensure we have the actual stored cache (in case another worker won the race)
  const storedCache = await db
    .select()
    .from(batchSeoCache)
    .where(eq(batchSeoCache.batchId, batchId))
    .limit(1);

  if (storedCache.length > 0) {
    console.log(`✅ [Batch ${batchId}] SEO cache stored successfully - will be reused for all articles`);
    
    // Return the stored cache to ensure consistency (another worker may have inserted first)
    return {
      locationAnalysis: storedCache[0].locationAnalysisJson as any,
      locationKeywords: storedCache[0].locationKeywordsJson as any,
      localRegulations: storedCache[0].localRegulations as any,
      authorityEntities: storedCache[0].authorityEntities as any,
      keyStatistics: storedCache[0].keyStatistics as any,
      redditResearch: storedCache[0].redditResearch as any,
      expertDiscovery: storedCache[0].expertDiscovery as any,
      competitorInsights: storedCache[0].competitorInsightsJson as any,
      competitorKeywords: storedCache[0].competitorKeywordsJson as any,
      semanticClusters: storedCache[0].semanticClustersJson as any,
      topicalAuthority: storedCache[0].topicalAuthorityJson as any,
    };
  }

  console.log(`✅ [Batch ${batchId}] SEO cache generated and stored - will be reused for all articles`);

  return context;
}

/**
 * Generate batch-level SEO context using Gemini + Reddit research
 * This is called ONCE per batch and reused across all articles
 */
async function generateBatchSeoContext(params: {
  coreTopic: string;
  geographicFocus: string;
  targetUrl: string;
  businessName: string;
  competitorUrls: string[];
  cachedRedditResearch?: any;
}, batchId: number): Promise<BatchSeoContext | null> {
  const { coreTopic, geographicFocus, targetUrl, businessName, competitorUrls, cachedRedditResearch } = params;
  
  // STEP 1A: Enhanced Reddit Research (JSON API - faster, more reliable)
  let redditResearch;
  let expertDiscovery;
  
  if (cachedRedditResearch) {
    console.log(`✅ [Batch ${batchId}] Reusing Reddit research from title generation (${cachedRedditResearch.questions?.length || 0} questions cached)`);
    redditResearch = cachedRedditResearch;
  } else {
    console.log(`🔍 [Batch ${batchId}] Performing enhanced Reddit research (JSON API) for "${coreTopic}" in "${geographicFocus}"...`);
    
    // Use new Reddit JSON API module (faster, no Playwright dependency)
    const redditClient = new RedditResearch({ useRedditAPI: true });
    const redditApiResults = await redditClient.findQuestions(coreTopic, {
      limit: 50,
      timeframe: 'year',
      includeComments: true
    });
    
    // STEP 1B: Expert Discovery for E-E-A-T signals
    console.log(`🔍 [Batch ${batchId}] Discovering experts for E-E-A-T signals...`);
    const expertClient = new ExpertDiscovery({ useWebSearch: true });
    const expertResults = await expertClient.findExperts(coreTopic, businessName || 'General', {
      limit: 10
    });
    
    expertDiscovery = expertResults;
    
    // Convert new API format to legacy format for compatibility with consolidation
    redditResearch = await performRedditResearch(coreTopic, geographicFocus, {
      maxSubreddits: 5,
      maxPostsPerSubreddit: 20,
      maxDiscussionsToAnalyze: 10
    });
    
    console.log(`✅ [Batch ${batchId}] Reddit API research complete: ${redditApiResults.totalQuestions} questions analyzed`);
    console.log(`✅ [Batch ${batchId}] Expert discovery complete: ${expertResults.totalFound} experts identified (${expertResults.expertiseLevel} expertise)`);
  }
  
  // STEP 2: PHASE 1 - Intent Consolidation & Outline Generation
  // Transform raw Reddit data into structured AEO-compliant outline
  console.log(`🧠 [Batch ${batchId}] Phase 1: Consolidating ${redditResearch.questions.length} Reddit intents into structured outline...`);
  
  let consolidatedOutline: RedditOutline | null = null;
  
  if (redditResearch.questions.length > 0) {
    consolidatedOutline = await consolidateRedditIntents({
      coreTopic,
      location: geographicFocus,
      redditQuestions: redditResearch.questions,
      redditDiscussions: redditResearch.discussions,
    });
    
    console.log(`✅ [Batch ${batchId}] Phase 1 complete: ${consolidatedOutline.consolidatedIntents.length} consolidated themes identified`);
  } else {
    console.warn(`⚠️ [Batch ${batchId}] Phase 1 skipped - no Reddit questions available`);
  }
  
  // Enhance Reddit research with consolidated outline
  const enhancedRedditResearch = {
    ...redditResearch,
    consolidatedOutline, // Add Phase 1 output
  };

  const prompt = `You are an SEO and local market research expert specializing in E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) signals. Generate reusable deep local intelligence for a content batch.

**Core Topic:** ${coreTopic}
**Geographic Focus:** ${geographicFocus}
**Target URL:** ${targetUrl}
**Business Name:** ${businessName}
**Competitor URLs:** ${competitorUrls.length > 0 ? competitorUrls.join(", ") : "None provided"}

Generate comprehensive SEO context with DEEP LOCAL INTELLIGENCE that can be reused across multiple articles in this batch:

1. **Location Analysis** (for ${geographicFocus}):
   - Demographics and target audience characteristics
   - Key landmarks, neighborhoods, and local features
   - Local culture, values, and communication style
   - Economic context (industries, job market, etc.)
   - **ENHANCED:** ZIP codes (3-5 relevant codes)
   - **ENHANCED:** Specific neighborhoods/districts (5-8 named areas)
   - **ENHANCED:** Population with year (e.g., "1.5M (2023)")
   - **ENHANCED:** Median income with year (e.g., "$75K (2023)")

2. **Location Keywords** (15-20 location-specific keyword variations):
   - City/region name variations
   - Neighborhood-specific terms
   - Local slang or commonly used phrases
   - Geo-modified service keywords

3. **Local Regulations** (3-5 relevant regulations):
   - Title, category (licensing/zoning/health/safety/employment/taxation/other)
   - Description, effective date (if known), source URL (if available)
   - FOCUS: Regulations relevant to ${coreTopic} in ${geographicFocus}

4. **Authority Entities** (5-8 local entities):
   - Name, type (organization/expert/landmark/regulation/statistic)
   - Description, citation URL (if available)
   - Credibility score (0-100), freshness year
   - FOCUS: Local organizations, experts, landmarks relevant to ${coreTopic}

5. **Key Statistics** (3-5 impactful statistics):
   - Claim, value, source, year
   - FOCUS: Recent, verifiable statistics about ${geographicFocus} and ${coreTopic}

6. **Competitor Insights** (if URLs provided):
   - Common content themes and patterns
   - Content gaps and opportunities
   - Unique angles to differentiate

7. **Semantic Clusters**:
   - Primary topic keywords (10-15 core terms)
   - Secondary related topics (10-15 supporting terms)
   - Related concepts and entities (10-15 contextual terms)

8. **Topical Authority**:
   - Expertise areas to emphasize
   - Trust signals and credibility markers

Return ONLY valid JSON in this exact structure:
{
  "locationAnalysis": {
    "demographics": "...",
    "landmarks": ["landmark1", "landmark2"],
    "localCulture": "...",
    "economicContext": "...",
    "zipCodes": ["90210", "90211"],
    "neighborhoods": ["Downtown", "West End"],
    "population": "1.5M (2023)",
    "medianIncome": "$75K (2023)"
  },
  "locationKeywords": ["keyword1", "keyword2"],
  "localRegulations": [
    {
      "title": "Regulation Title",
      "category": "licensing",
      "description": "Brief description",
      "effectiveDate": "2023-01-01",
      "sourceUrl": "https://example.com"
    }
  ],
  "authorityEntities": [
    {
      "name": "Entity Name",
      "type": "organization",
      "description": "Brief description",
      "citationUrl": "https://example.com",
      "credibilityScore": 85,
      "freshnessYear": 2023
    }
  ],
  "keyStatistics": [
    {
      "claim": "Statistic claim",
      "value": "75%",
      "source": "Source Name",
      "year": 2023
    }
  ],
  "competitorInsights": {
    "commonThemes": ["theme1", "theme2"],
    "contentGaps": ["gap1", "gap2"],
    "uniqueAngles": ["angle1", "angle2"]
  },
  "competitorKeywords": ["keyword1", "keyword2"],
  "semanticClusters": {
    "primary": ["term1", "term2"],
    "secondary": ["term1", "term2"],
    "related": ["term1", "term2"]
  },
  "topicalAuthority": {
    "expertiseAreas": ["area1", "area2"],
    "trustSignals": ["signal1", "signal2"]
  }
}`;

  try {
    const response = await throttledGeminiRequest(() =>
      genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          responseModalities: ["TEXT"],
        },
      })
    );

    const text = (response.text || "").trim();
    
    // Extract JSON from markdown code blocks if present
    let jsonText = text;
    if (text.includes("```json")) {
      const match = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonText = match[1];
      }
    } else if (text.includes("```")) {
      const match = text.match(/```\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonText = match[1];
      }
    }

    const context = JSON.parse(jsonText);
    
    // STEP 3: Merge enhanced Reddit research (with Phase 1 consolidated outline) into context
    return {
      ...context,
      redditResearch: enhancedRedditResearch
    };
  } catch (error) {
    console.error("❌ Failed to generate batch SEO context:", error);
    return null;
  }
}

/**
 * Clear cache for a batch (useful for regeneration)
 */
export async function clearBatchSeoCache(batchId: number): Promise<void> {
  await db.delete(batchSeoCache).where(eq(batchSeoCache.batchId, batchId));
  console.log(`🗑️  [Batch ${batchId}] SEO cache cleared`);
}
