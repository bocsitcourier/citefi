/**
 * ============================================================================
 * EXPERT DISCOVERY MODULE
 * ============================================================================
 * 
 * Finds subject matter experts via web search to improve E-E-A-T signals.
 * Integrates with Brave Search API for real-time expert identification.
 */

interface ExpertProfile {
  name: string;
  title: string;
  source: string;
  snippet: string;
  credibilityScore: number;
  topic: string;
}

export interface ExpertDiscoveryResult {
  experts: ExpertProfile[];
  totalFound: number;
  avgCredibility: number;
  expertiseLevel: 'low' | 'medium' | 'high';
}

export class ExpertDiscovery {
  private searchApiKey?: string;
  private useWebSearch: boolean;

  constructor(config: { braveApiKey?: string; useWebSearch?: boolean } = {}) {
    this.searchApiKey = config.braveApiKey || process.env.BRAVE_API_KEY;
    this.useWebSearch = config.useWebSearch !== false;
  }

  /**
   * Find top experts in a given topic/industry
   */
  async findExperts(topic: string, industry: string, options: { limit?: number } = {}): Promise<ExpertDiscoveryResult> {
    console.log(`🔍 Searching for experts in: ${topic}`);

    const searchQueries = [
      `"${topic}" expert author -job -hiring`,
      `"${topic}" thought leader ${industry}`,
      `"${topic}" specialist consultant ${industry}`,
      `best "${topic}" professionals ${industry}`,
      `top "${topic}" researchers authors`
    ];

    const allExperts: ExpertProfile[] = [];

    for (const query of searchQueries) {
      try {
        const results = await this.webSearch(query);
        const experts = this.extractExpertsFromResults(results, topic);
        allExperts.push(...experts);
      } catch (error) {
        console.error(`Search failed for: ${query}`, (error as Error).message);
      }
    }

    // Deduplicate and rank experts
    const rankedExperts = this.rankExperts(allExperts, topic);
    const limitedExperts = rankedExperts.slice(0, options.limit || 10);
    
    const avgCredibility = limitedExperts.length > 0
      ? limitedExperts.reduce((sum, e) => sum + e.credibilityScore, 0) / limitedExperts.length
      : 0;
    
    const expertiseLevel = avgCredibility > 0.8 ? 'high' : avgCredibility > 0.6 ? 'medium' : 'low';

    console.log(`✅ Found ${limitedExperts.length} experts (avg credibility: ${(avgCredibility * 100).toFixed(0)}%)`);
    
    return {
      experts: limitedExperts,
      totalFound: limitedExperts.length,
      avgCredibility,
      expertiseLevel
    };
  }

  /**
   * Perform web search (using Brave Search API or mock)
   */
  private async webSearch(query: string): Promise<any[]> {
    // If using Brave Search API
    if (this.searchApiKey) {
      try {
        const response = await fetch('https://api.search.brave.com/res/v1/web/search', {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': this.searchApiKey
          },
        });
        
        const params = new URLSearchParams({
          q: query,
          count: '10'
        });
        
        const fullUrl = `https://api.search.brave.com/res/v1/web/search?${params}`;
        const searchResponse = await fetch(fullUrl, {
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': this.searchApiKey
          }
        });
        
        const data = await searchResponse.json();
        return (data as any).web?.results || [];
      } catch (error) {
        console.error('Brave API error:', (error as Error).message);
      }
    }

    // Fallback: Return mock data structure
    console.log('⚠️  Using mock search data (add BRAVE_API_KEY for real search)');
    return this.getMockSearchResults(query);
  }

  private extractExpertsFromResults(results: any[], topic: string): ExpertProfile[] {
    const experts: ExpertProfile[] = [];

    for (const result of results) {
      // Extract from title and description
      const text = `${result.title} ${result.description}`.toLowerCase();
      
      // Look for expert indicators
      const indicators = [
        /(\w+\s+\w+),?\s+(phd|dr\.|professor|ceo|founder|director|vp|chief|senior|lead)/i,
        /by\s+(\w+\s+\w+)/i,
        /authored?\s+by\s+(\w+\s+\w+)/i,
        /written\s+by\s+(\w+\s+\w+)/i
      ];

      for (const pattern of indicators) {
        const match = text.match(pattern);
        if (match) {
          experts.push({
            name: this.cleanName(match[1]),
            title: match[2] || 'Expert',
            source: result.url,
            snippet: result.description,
            credibilityScore: this.calculateCredibility(result),
            topic: topic
          });
        }
      }

      // Check for LinkedIn, company pages, academic profiles
      if (result.url.includes('linkedin.com')) {
        experts.push({
          name: this.extractNameFromUrl(result.url),
          title: 'Professional',
          source: result.url,
          snippet: result.description,
          credibilityScore: 0.7,
          topic: topic
        });
      }
    }

    return experts;
  }

  private rankExperts(experts: ExpertProfile[], topic: string): ExpertProfile[] {
    // Deduplicate by name
    const uniqueExperts = new Map<string, ExpertProfile>();
    
    for (const expert of experts) {
      const key = expert.name.toLowerCase();
      if (!uniqueExperts.has(key)) {
        uniqueExperts.set(key, expert);
      } else {
        // Merge data if expert appears multiple times (increases credibility)
        const existing = uniqueExperts.get(key)!;
        existing.credibilityScore = Math.min(1.0, existing.credibilityScore + 0.1);
      }
    }

    // Sort by credibility score
    return Array.from(uniqueExperts.values())
      .sort((a, b) => b.credibilityScore - a.credibilityScore);
  }

  private calculateCredibility(result: any): number {
    let score = 0.5;

    // Boost for authoritative domains
    const authDomains = [
      'edu', 'gov', 'forbes.com', 'harvard.edu', 'mit.edu',
      'stanford.edu', 'linkedin.com', 'medium.com', 'substack.com'
    ];

    for (const domain of authDomains) {
      if (result.url.includes(domain)) {
        score += 0.3;
        break;
      }
    }

    // Boost for academic titles
    if (result.description.match(/phd|professor|dr\.|doctorate|researcher/i)) {
      score += 0.2;
    }

    // Boost for C-level executives
    if (result.description.match(/ceo|cto|founder|chief|director/i)) {
      score += 0.15;
    }

    return Math.min(score, 1.0);
  }

  private cleanName(name: string): string {
    return name
      .replace(/[,\.\-\(\)]/g, '')
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
      .trim();
  }

  private extractNameFromUrl(url: string): string {
    const match = url.match(/linkedin\.com\/in\/([^\/\?]+)/);
    if (match) {
      return match[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
    return 'Unknown Expert';
  }

  private getMockSearchResults(query: string): any[] {
    // Mock data for testing without API
    return [
      {
        title: 'Expert Guide to ' + query,
        description: 'Written by John Smith, PhD, Professor of Marketing at Stanford University',
        url: 'https://stanford.edu/research'
      },
      {
        title: 'Industry Analysis by Leading Professional',
        description: 'Sarah Johnson, CEO and Founder of Digital Marketing Institute',
        url: 'https://example.com/analysis'
      }
    ];
  }
}
