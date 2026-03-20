/**
 * ============================================================================
 * REDDIT RESEARCH MODULE
 * ============================================================================
 * 
 * Scrapes Reddit for real user questions to improve content relevance and AEO.
 * Uses Reddit JSON API (no authentication required).
 */

interface RedditQuestion {
  title: string;
  body: string;
  subreddit: string;
  url: string;
  score: number;
  numComments: number;
  created: Date;
  author: string;
  intent: string;
  questionType: string;
  keywords: string[];
  priority: number;
  topComments?: Array<{ text: string; score: number; author: string }>;
}

export interface RedditResearchResult {
  questions: RedditQuestion[];
  totalQuestions: number;
  primaryIntent: string;
  questionThemes: Array<{ keyword: string; count: number }>;
  contentGaps: Array<{ question: string; priority: number; subreddit: string }>;
  targetAudience: string;
}

export class RedditResearch {
  private useRedditAPI: boolean;
  private redditClientId?: string;
  private redditSecret?: string;

  constructor(config: { useRedditAPI?: boolean; redditClientId?: string; redditSecret?: string } = {}) {
    this.useRedditAPI = config.useRedditAPI || false;
    this.redditClientId = config.redditClientId || process.env.REDDIT_CLIENT_ID;
    this.redditSecret = config.redditSecret || process.env.REDDIT_SECRET;
  }

  /**
   * Find real questions from Reddit for a given keyword/topic
   */
  async findQuestions(
    keyword: string,
    options: { subreddits?: string[]; limit?: number; timeframe?: string; includeComments?: boolean } = {}
  ): Promise<RedditResearchResult> {
    console.log(`🔍 Searching Reddit for questions about: ${keyword}`);

    const subreddits = options.subreddits || this.getRelevantSubreddits(keyword);
    const allQuestions: RedditQuestion[] = [];

    for (const subreddit of subreddits) {
      try {
        const questions = await this.searchSubreddit(subreddit, keyword, options);
        allQuestions.push(...questions);
      } catch (error) {
        console.error(`Reddit search failed for r/${subreddit}:`, (error as Error).message);
      }
    }

    // Analyze and categorize questions
    const analyzed = this.analyzeQuestions(allQuestions, keyword);
    const primaryIntent = this.getPrimaryIntent(analyzed);
    const questionThemes = this.extractQuestionThemes(analyzed);
    const contentGaps = this.identifyContentGaps(analyzed);
    const targetAudience = this.identifyTargetAudience(analyzed);

    console.log(`✅ Found ${analyzed.length} unique questions`);
    console.log(`  📊 Primary Intent: ${primaryIntent}`);
    console.log(`  👥 Target Audience: ${targetAudience}`);
    
    return {
      questions: analyzed,
      totalQuestions: analyzed.length,
      primaryIntent,
      questionThemes,
      contentGaps,
      targetAudience
    };
  }

  /**
   * Get relevant subreddits based on topic
   */
  private getRelevantSubreddits(keyword: string): string[] {
    const keywordLower = keyword.toLowerCase();
    
    // Industry-specific subreddit mapping
    const subredditMap: Record<string, string[]> = {
      // Marketing & SEO
      'seo': ['SEO', 'bigseo', 'TechSEO', 'marketing', 'digitalmarketing'],
      'marketing': ['marketing', 'digitalmarketing', 'socialmedia', 'content_marketing'],
      'content': ['content_marketing', 'copywriting', 'blogging', 'marketing'],
      
      // Tech
      'javascript': ['javascript', 'learnjavascript', 'webdev', 'programming'],
      'python': ['Python', 'learnpython', 'programming', 'coding'],
      'web': ['webdev', 'web_design', 'frontend', 'javascript'],
      
      // Business
      'business': ['Entrepreneur', 'smallbusiness', 'business', 'startups'],
      'startup': ['startups', 'Entrepreneur', 'smallbusiness'],
      'ecommerce': ['ecommerce', 'shopify', 'Entrepreneur'],
      
      // Finance
      'investment': ['investing', 'stocks', 'personalfinance'],
      'crypto': ['cryptocurrency', 'Bitcoin', 'CryptoMarkets'],
      
      // Health & Fitness
      'fitness': ['Fitness', 'loseit', 'gainit', 'bodyweightfitness'],
      'nutrition': ['nutrition', 'EatCheapAndHealthy', 'HealthyFood']
    };

    // Find matching category
    for (const [category, subs] of Object.entries(subredditMap)) {
      if (keywordLower.includes(category)) {
        return subs;
      }
    }

    // Default general subreddits
    return ['AskReddit', 'NoStupidQuestions', 'explainlikeimfive'];
  }

  /**
   * Search a specific subreddit
   */
  private async searchSubreddit(
    subreddit: string,
    keyword: string,
    options: { limit?: number; timeframe?: string; includeComments?: boolean } = {}
  ): Promise<RedditQuestion[]> {
    const limit = options.limit || 25;
    const timeframe = options.timeframe || 'year';

    try {
      // Using Reddit JSON API (no auth required)
      const searchUrl = `https://www.reddit.com/r/${subreddit}/search.json`;
      const params = new URLSearchParams({
        q: keyword,
        restrict_sr: 'on',
        sort: 'relevance',
        t: timeframe,
        limit: limit.toString()
      });

      const response = await fetch(`${searchUrl}?${params}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Research Bot)'
        }
      });

      const data = await response.json();
      const posts = (data as any).data.children;
      const questions: RedditQuestion[] = [];

      for (const post of posts) {
        const postData = post.data;
        
        // Filter for question-like posts
        if (this.isQuestion(postData.title) || this.isQuestion(postData.selftext)) {
          const question: RedditQuestion = {
            title: postData.title,
            body: postData.selftext,
            subreddit: subreddit,
            url: `https://reddit.com${postData.permalink}`,
            score: postData.score,
            numComments: postData.num_comments,
            created: new Date(postData.created_utc * 1000),
            author: postData.author,
            intent: this.categorizeIntent(postData.title),
            questionType: this.getQuestionType(postData.title),
            keywords: this.extractKeywords(postData.title + ' ' + postData.selftext),
            priority: this.calculatePriority({
              score: postData.score,
              numComments: postData.num_comments,
              title: postData.title
            })
          };
          
          questions.push(question);
        }
      }

      // Also get top comments if needed
      if (options.includeComments) {
        for (const question of questions.slice(0, 5)) {
          const comments = await this.getTopComments(question.url);
          question.topComments = comments;
        }
      }

      return questions;

    } catch (error) {
      console.error(`Error searching r/${subreddit}:`, (error as Error).message);
      return [];
    }
  }

  /**
   * Check if text is a question
   */
  private isQuestion(text: string): boolean {
    if (!text) return false;
    
    const questionIndicators = [
      /\?$/, // Ends with question mark
      /^(how|what|why|when|where|who|which|can|should|is|are|do|does|will|would)/i,
      /(help|advice|recommend|suggest|best way|looking for)/i
    ];

    return questionIndicators.some(pattern => pattern.test(text));
  }

  /**
   * Get top comments from a Reddit post
   */
  private async getTopComments(postUrl: string, limit = 5): Promise<Array<{ text: string; score: number; author: string }>> {
    try {
      const jsonUrl = postUrl.replace(/\/$/, '') + '.json';
      const response = await fetch(jsonUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Research Bot)' }
      });

      const data = await response.json();
      const comments = (data as any)[1].data.children
        .filter((c: any) => c.kind === 't1')
        .slice(0, limit)
        .map((c: any) => ({
          text: c.data.body,
          score: c.data.score,
          author: c.data.author
        }));

      return comments;

    } catch (error) {
      return [];
    }
  }

  /**
   * Analyze and categorize questions
   */
  private analyzeQuestions(questions: RedditQuestion[], keyword: string): RedditQuestion[] {
    // Deduplicate similar questions
    const unique = this.deduplicateQuestions(questions);

    // Sort by priority
    return unique.sort((a, b) => b.priority - a.priority);
  }

  private deduplicateQuestions(questions: RedditQuestion[]): RedditQuestion[] {
    const seen = new Set<string>();
    const unique: RedditQuestion[] = [];

    for (const q of questions) {
      const normalized = q.title.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .sort()
        .join(' ');

      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(q);
      }
    }

    return unique;
  }

  private categorizeIntent(title: string): string {
    const titleLower = title.toLowerCase();
    
    if (titleLower.match(/how to|how do|how can/)) return 'informational';
    if (titleLower.match(/best|top|recommend|suggest/)) return 'commercial';
    if (titleLower.match(/buy|purchase|price|cost/)) return 'transactional';
    if (titleLower.match(/what is|why|explain|difference/)) return 'educational';
    
    return 'general';
  }

  private getQuestionType(title: string): string {
    if (title.startsWith('How')) return 'how-to';
    if (title.startsWith('What')) return 'what';
    if (title.startsWith('Why')) return 'why';
    if (title.startsWith('When')) return 'when';
    if (title.startsWith('Where')) return 'where';
    
    return 'general';
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction (can be enhanced with NLP)
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    // Remove common words
    const stopWords = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'were', 'what', 'when', 'where', 'which', 'their', 'there']);
    return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 10);
  }

  private calculatePriority(data: { score: number; numComments: number; title: string }): number {
    let priority = 0;
    
    // Score-based priority
    priority += Math.min(data.score / 10, 10);
    
    // Comment-based priority
    priority += Math.min(data.numComments / 5, 10);
    
    // Question quality (length, specificity)
    if (data.title.length > 50) priority += 5;
    if (data.title.includes('?')) priority += 3;
    
    return priority;
  }

  private getPrimaryIntent(questions: RedditQuestion[]): string {
    const intents: Record<string, number> = {};
    questions.forEach(q => {
      intents[q.intent] = (intents[q.intent] || 0) + 1;
    });

    return Object.entries(intents)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';
  }

  private extractQuestionThemes(questions: RedditQuestion[]): Array<{ keyword: string; count: number }> {
    const allKeywords = questions.flatMap(q => q.keywords);
    const keywordFreq: Record<string, number> = {};
    
    allKeywords.forEach(kw => {
      keywordFreq[kw] = (keywordFreq[kw] || 0) + 1;
    });

    return Object.entries(keywordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword, count]) => ({ keyword, count }));
  }

  private identifyContentGaps(questions: RedditQuestion[]): Array<{ question: string; priority: number; subreddit: string }> {
    // Find frequently asked questions with high engagement
    const highPriorityQuestions = questions
      .filter(q => q.priority > 20)
      .slice(0, 5);

    return highPriorityQuestions.map(q => ({
      question: q.title,
      priority: q.priority,
      subreddit: q.subreddit
    }));
  }

  private identifyTargetAudience(questions: RedditQuestion[]): string {
    const subreddits = [...new Set(questions.map(q => q.subreddit))];
    
    // Infer audience from subreddits
    const audienceMap: Record<string, string> = {
      'smallbusiness': 'Small business owners',
      'Entrepreneur': 'Entrepreneurs and startups',
      'SEO': 'SEO professionals',
      'marketing': 'Marketing professionals',
      'learnprogramming': 'Beginner developers',
      'webdev': 'Web developers',
      'personalfinance': 'Individual investors'
    };

    const audiences = subreddits
      .map(sr => audienceMap[sr])
      .filter(Boolean);

    return audiences[0] ?? 'General audience';
  }
}
