import { GEMINI_FLASH_MODEL } from "./ai-config";
/**
 * ============================================================================
 * SMART TOPIC RESEARCH MODULE
 * ============================================================================
 * 
 * Automatically researches any topic before title generation to find:
 * - Local entities (hospitals, providers, businesses in the area)
 * - High-converting article titles from competitors
 * - Related topics and angles
 * - User intent signals
 * 
 * Uses Brave Search API to gather real-time intelligence.
 */

export interface LocalEntity {
  name: string;
  type: 'hospital' | 'provider' | 'business' | 'organization' | 'government';
  location: string;
  relevanceScore: number;
  snippet?: string;
  url?: string;
}

export interface CompetitorTitle {
  title: string;
  url: string;
  source: string;
  estimatedEngagement: 'high' | 'medium' | 'low';
  titlePatterns: string[];
}

export interface TopicInsight {
  angle: string;
  searchVolume: 'high' | 'medium' | 'low';
  competitionLevel: 'high' | 'medium' | 'low';
  userIntent: 'informational' | 'transactional' | 'navigational' | 'commercial';
}

export interface SmartResearchResult {
  topic: string;
  location: string;
  localEntities: LocalEntity[];
  competitorTitles: CompetitorTitle[];
  topicInsights: TopicInsight[];
  suggestedAngles: string[];
  keywords: string[];
  searchesPerformed: number;
  researchTimestamp: Date;
}

export interface TitleWithScore {
  title: string;
  originalTitle: string;
  uniquenessScore: number;
  wasRefined: boolean;
  refinementReason?: string;
}

export interface CritiqueResult {
  refinedTitles: TitleWithScore[];
  removedCount: number;
  refinedCount: number;
  critiqueSummary: string;
}

export class SmartTopicResearch {
  private apiKey: string | undefined;
  private searchCount = 0;

  constructor() {
    this.apiKey = process.env.BRAVE_API_KEY;
  }

  async researchTopic(
    topic: string,
    location: string,
    options: { maxSearches?: number; includeCompetitors?: boolean } = {}
  ): Promise<SmartResearchResult> {
    const maxSearches = options.maxSearches || 10;
    const includeCompetitors = options.includeCompetitors !== false;
    
    console.log(`🔬 Starting smart research for: "${topic}" in ${location}`);
    
    const result: SmartResearchResult = {
      topic,
      location,
      localEntities: [],
      competitorTitles: [],
      topicInsights: [],
      suggestedAngles: [],
      keywords: [],
      searchesPerformed: 0,
      researchTimestamp: new Date()
    };

    if (!this.apiKey) {
      console.log('⚠️ No BRAVE_API_KEY - using fallback research');
      return this.getFallbackResearch(topic, location);
    }

    try {
      // Phase 1: Find local entities (hospitals, providers, etc.)
      const localEntities = await this.findLocalEntities(topic, location, maxSearches);
      result.localEntities = localEntities;

      // Phase 2: Find competitor titles that rank well
      if (includeCompetitors) {
        const competitorTitles = await this.findCompetitorTitles(topic, location);
        result.competitorTitles = competitorTitles;
      }

      // Phase 3: Discover topic insights and angles
      const insights = await this.discoverTopicInsights(topic, location);
      result.topicInsights = insights.insights;
      result.suggestedAngles = insights.angles;
      result.keywords = insights.keywords;

      result.searchesPerformed = this.searchCount;
      
      console.log(`✅ Research complete: ${result.localEntities.length} local entities, ${result.competitorTitles.length} competitor titles, ${result.suggestedAngles.length} angles`);
      
    } catch (error) {
      console.error('Research error:', (error as Error).message);
      return this.getFallbackResearch(topic, location);
    }

    return result;
  }

  private async findLocalEntities(
    topic: string,
    location: string,
    maxSearches: number
  ): Promise<LocalEntity[]> {
    const entities: LocalEntity[] = [];
    
    // Generate smart search queries based on topic keywords
    const topicLower = topic.toLowerCase();
    const searchQueries: string[] = [];
    
    // Healthcare-related searches
    if (topicLower.includes('senior') || topicLower.includes('elder') || 
        topicLower.includes('home care') || topicLower.includes('discharge') ||
        topicLower.includes('hospital') || topicLower.includes('health')) {
      searchQueries.push(
        `hospitals in ${location} with high patient discharge`,
        `best hospitals ${location} senior care`,
        `home health agencies ${location}`,
        `senior care providers ${location}`,
        `skilled nursing facilities near ${location}`
      );
    }
    
    // General business/service searches
    searchQueries.push(
      `${topic} providers ${location}`,
      `best ${topic} services ${location}`,
      `top rated ${topic} ${location}`,
      `${topic} companies near ${location}`
    );

    // Limit searches
    const queriesToRun = searchQueries.slice(0, Math.min(maxSearches / 2, 5));
    
    for (const query of queriesToRun) {
      try {
        const results = await this.braveSearch(query);
        const extracted = this.extractEntitiesFromResults(results, location);
        entities.push(...extracted);
      } catch (error) {
        console.error(`Entity search failed: ${query}`, (error as Error).message);
      }
    }

    // Deduplicate and rank
    return this.deduplicateEntities(entities);
  }

  private async findCompetitorTitles(
    topic: string,
    location: string
  ): Promise<CompetitorTitle[]> {
    const titles: CompetitorTitle[] = [];
    
    const queries = [
      `"${topic}" ${location} guide`,
      `"${topic}" ${location} tips`,
      `best "${topic}" ${location}`,
      `how to "${topic}" ${location}`,
      `"${topic}" cost ${location}`
    ];

    for (const query of queries.slice(0, 3)) {
      try {
        const results = await this.braveSearch(query);
        
        for (const result of results.slice(0, 5)) {
          const patterns = this.analyzeTitlePatterns(result.title);
          titles.push({
            title: result.title,
            url: result.url,
            source: new URL(result.url).hostname,
            estimatedEngagement: this.estimateEngagement(result),
            titlePatterns: patterns
          });
        }
      } catch (error) {
        console.error(`Competitor search failed: ${query}`);
      }
    }

    // Sort by estimated engagement
    return titles
      .sort((a, b) => {
        const engagementScore = { high: 3, medium: 2, low: 1 };
        return engagementScore[b.estimatedEngagement] - engagementScore[a.estimatedEngagement];
      })
      .slice(0, 15);
  }

  private async discoverTopicInsights(
    topic: string,
    location: string
  ): Promise<{ insights: TopicInsight[]; angles: string[]; keywords: string[] }> {
    const insights: TopicInsight[] = [];
    const angles: string[] = [];
    const keywords: string[] = [];
    
    try {
      // Search for common questions
      const questionResults = await this.braveSearch(`${topic} ${location} questions answers`);
      
      // Extract common angles from search results
      const commonAngles = this.extractAnglesFromResults(questionResults, topic);
      angles.push(...commonAngles);
      
      // Search for related keywords
      const relatedResults = await this.braveSearch(`${topic} related services ${location}`);
      const extractedKeywords = this.extractKeywordsFromResults(relatedResults, topic);
      keywords.push(...extractedKeywords);
      
      // Generate insights based on what we found
      insights.push(
        {
          angle: `Cost and pricing of ${topic} in ${location}`,
          searchVolume: 'high',
          competitionLevel: 'medium',
          userIntent: 'commercial'
        },
        {
          angle: `How to choose ${topic} providers in ${location}`,
          searchVolume: 'high',
          competitionLevel: 'medium',
          userIntent: 'informational'
        },
        {
          angle: `${topic} regulations and requirements in ${location}`,
          searchVolume: 'medium',
          competitionLevel: 'low',
          userIntent: 'informational'
        },
        {
          angle: `Reviews of ${topic} services in ${location}`,
          searchVolume: 'high',
          competitionLevel: 'high',
          userIntent: 'commercial'
        }
      );

    } catch (error) {
      console.error('Topic insights error:', (error as Error).message);
    }

    return { insights, angles: [...new Set(angles)], keywords: [...new Set(keywords)] };
  }

  private async braveSearch(query: string): Promise<any[]> {
    this.searchCount++;
    
    const params = new URLSearchParams({
      q: query,
      count: '10',
      safesearch: 'moderate'
    });

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': this.apiKey!
      }
    });

    if (!response.ok) {
      throw new Error(`Brave API error: ${response.status}`);
    }

    const data = await response.json();
    return (data as any).web?.results || [];
  }

  private extractEntitiesFromResults(results: any[], location: string): LocalEntity[] {
    const entities: LocalEntity[] = [];
    
    for (const result of results) {
      const title = result.title || '';
      const description = result.description || '';
      const combined = `${title} ${description}`.toLowerCase();
      
      // Detect entity type
      let type: LocalEntity['type'] = 'business';
      if (combined.includes('hospital') || combined.includes('medical center')) {
        type = 'hospital';
      } else if (combined.includes('agency') || combined.includes('provider') || combined.includes('care')) {
        type = 'provider';
      } else if (combined.includes('government') || combined.includes('department') || combined.includes('.gov')) {
        type = 'government';
      } else if (combined.includes('association') || combined.includes('foundation') || combined.includes('nonprofit')) {
        type = 'organization';
      }
      
      // Extract entity name (usually in title before | or -)
      let name = title.split(/[|\-–—]/)[0].trim();
      if (name.length > 60) {
        name = name.substring(0, 60) + '...';
      }
      
      if (name && name.length > 3) {
        entities.push({
          name,
          type,
          location,
          relevanceScore: this.calculateRelevanceScore(result),
          snippet: description?.substring(0, 200),
          url: result.url
        });
      }
    }
    
    return entities;
  }

  private extractAnglesFromResults(results: any[], topic: string): string[] {
    const angles: string[] = [];
    const topicWords = topic.toLowerCase().split(' ');
    
    for (const result of results) {
      const title = result.title || '';
      
      // Look for question-based titles
      if (title.match(/^(how|what|why|when|where|which|can|should|is|are|do|does)/i)) {
        angles.push(title);
      }
      
      // Look for list-based titles
      if (title.match(/^\d+\s+(tips|ways|steps|things|reasons|mistakes|benefits)/i)) {
        angles.push(title);
      }
      
      // Look for guide/comparison titles
      if (title.match(/(guide|vs\.|versus|compared|comparison|review)/i)) {
        angles.push(title);
      }
    }
    
    return angles.slice(0, 10);
  }

  private extractKeywordsFromResults(results: any[], topic: string): string[] {
    const keywords: string[] = [];
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very']);
    
    for (const result of results) {
      const text = `${result.title} ${result.description}`.toLowerCase();
      const words = text.match(/\b[a-z]{4,}\b/g) || [];
      
      for (const word of words) {
        if (!stopWords.has(word) && !keywords.includes(word)) {
          keywords.push(word);
        }
      }
    }
    
    return keywords.slice(0, 20);
  }

  private analyzeTitlePatterns(title: string): string[] {
    const patterns: string[] = [];
    
    if (title.match(/^\d+/)) patterns.push('number-prefix');
    if (title.match(/^(how|what|why|when|where|which)/i)) patterns.push('question');
    if (title.match(/guide/i)) patterns.push('guide');
    if (title.match(/\d{4}/)) patterns.push('year-included');
    if (title.match(/(best|top|ultimate)/i)) patterns.push('superlative');
    if (title.match(/(tips|ways|steps|things)/i)) patterns.push('list-format');
    if (title.match(/vs\.|versus|compared/i)) patterns.push('comparison');
    if (title.match(/review/i)) patterns.push('review');
    if (title.match(/cost|price|pricing/i)) patterns.push('pricing');
    if (title.match(/(near|in|for)/i)) patterns.push('location-targeted');
    
    return patterns;
  }

  private estimateEngagement(result: any): 'high' | 'medium' | 'low' {
    const title = result.title || '';
    const url = result.url || '';
    
    let score = 0;
    
    // Title factors
    if (title.match(/^\d+/)) score += 2; // Numbers in title
    if (title.match(/\d{4}/)) score += 1; // Year included
    if (title.match(/(best|top|ultimate|complete)/i)) score += 2;
    if (title.match(/^(how|what|why)/i)) score += 2;
    if (title.length > 40 && title.length < 65) score += 1; // Optimal length
    
    // Source factors
    if (url.includes('.gov')) score += 2;
    if (url.includes('.edu')) score += 2;
    if (url.includes('.org')) score += 1;
    
    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  }

  private calculateRelevanceScore(result: any): number {
    let score = 0.5;
    
    const url = result.url || '';
    if (url.includes('.gov')) score += 0.3;
    if (url.includes('.edu')) score += 0.2;
    if (url.includes('.org')) score += 0.1;
    
    return Math.min(1.0, score);
  }

  private deduplicateEntities(entities: LocalEntity[]): LocalEntity[] {
    const seen = new Map<string, LocalEntity>();
    
    for (const entity of entities) {
      const key = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(key)) {
        seen.set(key, entity);
      } else {
        // Keep the one with higher relevance score
        const existing = seen.get(key)!;
        if (entity.relevanceScore > existing.relevanceScore) {
          seen.set(key, entity);
        }
      }
    }
    
    return Array.from(seen.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 20);
  }

  private getFallbackResearch(topic: string, location: string): SmartResearchResult {
    console.log('📋 Using fallback research data');
    
    return {
      topic,
      location,
      localEntities: [],
      competitorTitles: [],
      topicInsights: [
        {
          angle: `Cost and pricing of ${topic} in ${location}`,
          searchVolume: 'high',
          competitionLevel: 'medium',
          userIntent: 'commercial'
        },
        {
          angle: `How to choose ${topic} providers`,
          searchVolume: 'high',
          competitionLevel: 'medium',
          userIntent: 'informational'
        }
      ],
      suggestedAngles: [
        `Complete guide to ${topic} in ${location}`,
        `How much does ${topic} cost in ${location}?`,
        `Best ${topic} providers in ${location}`,
        `${topic} tips for ${location} residents`
      ],
      keywords: [topic.toLowerCase(), location.toLowerCase()],
      searchesPerformed: 0,
      researchTimestamp: new Date()
    };
  }

  /**
   * JACCARD SIMILARITY ENGINE
   * Calculates how unique a title is compared to competitor titles
   * Score: 100 = perfectly unique, 0 = exact duplicate
   */
  calculateUniquenessScore(candidateTitle: string, competitorTitles: string[]): number {
    if (competitorTitles.length === 0) return 100;
    
    const getWords = (str: string): Set<string> => {
      return new Set(
        str.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 2)
      );
    };
    
    const candidateWords = getWords(candidateTitle);
    let highestSimilarity = 0;

    for (const competitor of competitorTitles) {
      const competitorWords = getWords(competitor);
      const intersection = new Set([...candidateWords].filter(x => competitorWords.has(x)));
      const union = new Set([...candidateWords, ...competitorWords]);
      
      if (union.size === 0) continue;
      
      const similarity = intersection.size / union.size;
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
      }
    }

    // Inverse: 100 = unique, 0 = duplicate
    return Math.round((1 - highestSimilarity) * 100);
  }

  /**
   * AGENTIC CRITIQUE LOOP
   * Reviews generated titles for hallucinations, clichés, and forced geo-references
   * Uses Gemini to self-correct the title quality
   */
  async critiqueAndRefineTitles(
    titles: string[],
    researchData: SmartResearchResult,
    industry: string
  ): Promise<CritiqueResult> {
    console.log('🧠 Agentic Review: Checking titles for hallucinations and clichés...');
    
    const competitorTitleStrings = researchData.competitorTitles.map(ct => ct.title);
    const localEntityNames = researchData.localEntities.map(e => e.name);
    
    // First, calculate uniqueness scores for all titles
    const titlesWithScores: TitleWithScore[] = titles.map(title => ({
      title,
      originalTitle: title,
      uniquenessScore: this.calculateUniquenessScore(title, competitorTitleStrings),
      wasRefined: false
    }));

    // Build the critique prompt
    const critiquePrompt = `You are a Senior SEO Content Strategist conducting a quality review.

INDUSTRY: ${industry}
LOCATION: ${researchData.location}

COMPETITOR TITLES ALREADY RANKING ON GOOGLE:
${competitorTitleStrings.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}

LOCAL ENTITIES IN THE AREA (verified):
${localEntityNames.slice(0, 10).join(', ')}

DRAFT TITLES TO REVIEW:
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

CRITIQUE TASKS:
1. HALLUCINATION CHECK: Flag any titles that promise services impossible for "${industry}" to provide
2. CLICHÉ REMOVAL: Identify titles starting with "The Ultimate Guide to...", "Unlocking the Secrets...", "Everything You Need to Know...", etc.
3. GEO-FORCING CHECK: Flag titles where the location feels awkwardly inserted or forced
4. DUPLICATE CHECK: Flag titles too similar to the competitor titles listed above
5. SPECIFICITY CHECK: Flag vague titles that could apply to any business

For each title, provide:
- KEEP: Title is high-quality and specific
- REFINE: Title needs improvement (with suggested refinement)  
- REMOVE: Title is a cliché, hallucination, or too generic

Return as JSON:
{
  "reviews": [
    {
      "index": 0,
      "original": "title text",
      "verdict": "KEEP" | "REFINE" | "REMOVE",
      "reason": "brief explanation",
      "refinedTitle": "improved title if REFINE, otherwise null"
    }
  ],
  "summary": "brief overall critique summary"
}`;

    try {
      // Use Gemini for critique (imported dynamically to avoid circular deps)
      const { GoogleGenAI } = await import('@google/genai');
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        console.log('⚠️ No GEMINI_API_KEY for critique - returning titles with scores only');
        return {
          refinedTitles: titlesWithScores,
          removedCount: 0,
          refinedCount: 0,
          critiqueSummary: 'Critique skipped - no API key'
        };
      }

      const genAI = new GoogleGenAI({ apiKey });
      const result = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: critiquePrompt }] }],
        config: { temperature: 0.1 } // Low temp for precise analysis
      });
      const responseText = result.text || '';
      
      // Parse the JSON response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('⚠️ Could not parse critique response - returning titles with scores');
        return {
          refinedTitles: titlesWithScores,
          removedCount: 0,
          refinedCount: 0,
          critiqueSummary: 'Critique parsing failed'
        };
      }

      const critiqueData = JSON.parse(jsonMatch[0]);
      let removedCount = 0;
      let refinedCount = 0;
      
      const refinedTitles: TitleWithScore[] = [];
      
      for (const review of critiqueData.reviews || []) {
        if (review.verdict === 'REMOVE') {
          removedCount++;
          continue; // Skip removed titles
        }
        
        const originalTitle = titles[review.index] || review.original;
        let finalTitle = originalTitle;
        let wasRefined = false;
        let refinementReason: string | undefined;
        
        if (review.verdict === 'REFINE' && review.refinedTitle) {
          finalTitle = review.refinedTitle;
          wasRefined = true;
          refinedCount++;
          refinementReason = review.reason;
        }
        
        refinedTitles.push({
          title: finalTitle,
          originalTitle,
          uniquenessScore: this.calculateUniquenessScore(finalTitle, competitorTitleStrings),
          wasRefined,
          refinementReason
        });
      }

      console.log(`✅ Critique complete: ${removedCount} removed, ${refinedCount} refined, ${refinedTitles.length} kept`);
      
      return {
        refinedTitles,
        removedCount,
        refinedCount,
        critiqueSummary: critiqueData.summary || 'Critique completed successfully'
      };
      
    } catch (error) {
      console.error('Critique error:', (error as Error).message);
      // Return original titles with scores on error
      return {
        refinedTitles: titlesWithScores,
        removedCount: 0,
        refinedCount: 0,
        critiqueSummary: `Critique failed: ${(error as Error).message}`
      };
    }
  }

  /**
   * Score multiple titles against competitors in batch
   */
  scoreTitlesForUniqueness(titles: string[], competitorTitles: string[]): TitleWithScore[] {
    return titles.map(title => ({
      title,
      originalTitle: title,
      uniquenessScore: this.calculateUniquenessScore(title, competitorTitles),
      wasRefined: false
    }));
  }
}

export const smartResearch = new SmartTopicResearch();
