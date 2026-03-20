/**
 * ============================================================================
 * ARTICLE CRITIQUE & FACT-CHECKING MODULE
 * ============================================================================
 * 
 * Implements search-augmented fact checking and self-correction for articles.
 * Follows SEO best practices and generative AI optimizations:
 * 
 * - E-E-A-T signal verification (Experience, Expertise, Authoritativeness, Trustworthiness)
 * - Answer-first framing optimization for AI citations
 * - AI cliché detection and removal
 * - PROMOTIONAL LANGUAGE detection and section-scoped validation
 * - Factual claim verification via web search
 * - Word count and tone validation
 * - Keyword density optimization
 * 
 * NEW: Reflexive validation system - promotional content allowed ONLY in conclusion/CTA sections
 */

import { GoogleGenAI } from "@google/genai";

const AI_CLICHES = [
  // Opening/transition clichés
  "in today's fast-paced world",
  "in the ever-evolving landscape",
  "in today's digital age",
  "in today's world",
  "in this day and age",
  "in today's competitive",
  "in the modern world",
  "in an era of",
  "in a world where",
  "as we navigate",
  "as technology continues",
  "as we move forward",
  
  // Filler phrases
  "it's important to note that",
  "it's worth noting that",
  "it's essential to understand",
  "it's crucial to",
  "it's no secret that",
  "it goes without saying",
  "needless to say",
  "at the end of the day",
  "when it comes to",
  "when all is said and done",
  "the fact of the matter is",
  "the bottom line is",
  "here's the thing",
  "the reality is",
  "the truth is",
  "believe it or not",
  "let me tell you",
  "let's be honest",
  "let's face it",
  "make no mistake",
  "rest assured",
  
  // Conclusion clichés
  "in conclusion",
  "to sum up",
  "to summarize",
  "in summary",
  "all in all",
  "last but not least",
  "without further ado",
  "moving forward",
  
  // Hype words
  "dive deep into",
  "take a deep dive",
  "delve into",
  "unlock the secrets",
  "unlock the power",
  "unleash the potential",
  "the ultimate guide",
  "everything you need to know",
  "comprehensive guide",
  "game-changer",
  "game-changing",
  "revolutionary",
  "revolutionize",
  "cutting-edge",
  "state-of-the-art",
  "world-class",
  "best-in-class",
  "next-level",
  "top-notch",
  "seamless",
  "seamlessly",
  "robust",
  "holistic",
  "synergy",
  "leverage",
  "empower",
  "elevate",
  "optimize",
  "streamline",
  "maximize",
  "transform",
  "transformative",
  
  // Corporate jargon
  "paradigm shift",
  "think outside the box",
  "move the needle",
  "low-hanging fruit",
  "circle back",
  "touch base",
  "let's unpack",
  "deep-dive",
  "bandwidth",
  "synergize",
  "ecosystem",
  "value-add",
  "pain points",
  "actionable insights",
  "best practices",
  "core competencies",
  "key takeaways",
  
  // AI-specific patterns
  "as an AI",
  "I cannot",
  "I don't have access",
  "based on my training",
  "as of my knowledge cutoff",
  "certainly!",
  "absolutely!",
  "great question",
  "that's a great",
  "happy to help",
  "I'd be happy to",
  "sure thing",
  "of course!",
  "firstly",
  "secondly",
  "thirdly",
  "lastly",
  "furthermore",
  "moreover",
  "additionally",
  "consequently",
  "thus",
  "hence",
  "therefore",
  "nevertheless",
  "nonetheless",
  "notwithstanding",
  
  // Overused descriptors
  "plethora",
  "myriad",
  "multifaceted",
  "nuanced",
  "intricate",
  "pivotal",
  "paramount",
  "invaluable",
  "indispensable",
  "quintessential",
  "unparalleled",
  "unprecedented",
  "undeniable",
  "undoubtedly",
  "incredibly",
  "extremely",
  "highly",
  "very unique",
  "quite frankly",
  "literally",
  
  // Engagement bait
  "you won't believe",
  "the shocking truth",
  "what nobody tells you",
  "the secret to",
  "discover how",
  "learn how to",
  "find out how",
  "here's why",
  "here's how",
  "this is why",
  "this is how",
];

/**
 * PROMOTIONAL LANGUAGE - Forbidden in body sections, allowed ONLY in conclusion/CTA
 * These phrases indicate marketing/sales language that should be removed from educational content
 */
const PROMOTIONAL_CLICHES = [
  // First-person promotional
  "our team",
  "our experts",
  "our specialists",
  "our professionals",
  "our services",
  "our solutions",
  "our approach",
  "our commitment",
  "our dedication",
  "we offer",
  "we provide",
  "we deliver",
  "we help",
  "we specialize",
  "we are committed",
  "we are dedicated",
  "we are proud",
  "we understand",
  "we believe",
  "we have helped",
  "we have served",
  "we have been",
  
  // Marketing superlatives
  "leading provider",
  "industry leader",
  "market leader",
  "trusted partner",
  "trusted provider",
  "premier provider",
  "top-rated",
  "award-winning",
  "best-in-class",
  "world-class",
  "exceptional service",
  "superior service",
  "unmatched quality",
  "unrivaled",
  "unparalleled service",
  
  // Direct sales language
  "choose us",
  "call us today",
  "contact us today",
  "visit us today",
  "schedule today",
  "book today",
  "get started today",
  "don't wait",
  "act now",
  "limited time",
  "special offer",
  "free consultation",
  "free quote",
  "no obligation",
  
  // Self-endorsement
  "we are the best",
  "we are your best",
  "look no further",
  "your search ends here",
  "the only choice",
  "the smart choice",
  "the right choice",
  "why choose us",
  "reasons to choose",
];

/**
 * Section metadata for promotional content control
 */
export interface ArticleSection {
  id: string;
  heading: string;
  content: string;
  startIndex: number;
  endIndex: number;
  sectionType: 'introduction' | 'body' | 'faq' | 'conclusion';
  allowPromotionalContent: boolean;
}

/**
 * Promotional language violation
 */
export interface PromotionalViolation {
  phrase: string;
  sectionId: string;
  sectionType: string;
  context: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * Result of promotional content validation
 */
export interface PromotionalValidationResult {
  isClean: boolean;
  violations: PromotionalViolation[];
  companyMentionsOutsideCTA: number;
  firstPersonPromoCount: number;
  marketingSuperlativeCount: number;
}

/**
 * Parse article content into sections with promotional content flags
 */
export function parseArticleSections(content: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  
  // Split by H2 headings (## in markdown)
  const h2Pattern = /^##\s+(.+)$/gm;
  const matches = [...content.matchAll(h2Pattern)];
  
  if (matches.length === 0) {
    // No headings found, treat as single body section
    return [{
      id: 'body-0',
      heading: 'Content',
      content: content,
      startIndex: 0,
      endIndex: content.length,
      sectionType: 'body',
      allowPromotionalContent: false
    }];
  }
  
  // Add introduction (content before first H2)
  if (matches[0]!.index! > 0) {
    sections.push({
      id: 'intro',
      heading: 'Introduction',
      content: content.substring(0, matches[0]!.index!).trim(),
      startIndex: 0,
      endIndex: matches[0]!.index!,
      sectionType: 'introduction',
      allowPromotionalContent: false
    });
  }
  
  // Process each H2 section
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const heading = match[1]!;
    const startIndex = match.index!;
    const endIndex = i < matches.length - 1 ? matches[i + 1]!.index! : content.length;
    const sectionContent = content.substring(startIndex, endIndex).trim();
    
    // Determine section type based on heading
    const headingLower = heading.toLowerCase();
    let sectionType: ArticleSection['sectionType'] = 'body';
    let allowPromotionalContent = false;
    
    if (headingLower.includes('faq') || headingLower.includes('frequently asked')) {
      sectionType = 'faq';
      allowPromotionalContent = false;
    } else if (
      headingLower.includes('conclusion') ||
      headingLower.includes('next step') ||
      headingLower.includes('get started') ||
      headingLower.includes('contact') ||
      headingLower.includes('ready to') ||
      headingLower.includes('take action') ||
      headingLower.includes('final thought')
    ) {
      sectionType = 'conclusion';
      allowPromotionalContent = true; // CTA allowed here
    }
    
    sections.push({
      id: `section-${i}`,
      heading,
      content: sectionContent,
      startIndex,
      endIndex,
      sectionType,
      allowPromotionalContent
    });
  }
  
  return sections;
}

/**
 * Validate content for promotional language violations
 * Returns violations for promotional content found in non-CTA sections
 */
export function validatePromotionalContent(
  content: string,
  companyName: string,
  sections?: ArticleSection[]
): PromotionalValidationResult {
  const parsedSections = sections || parseArticleSections(content);
  const violations: PromotionalViolation[] = [];
  let companyMentionsOutsideCTA = 0;
  let firstPersonPromoCount = 0;
  let marketingSuperlativeCount = 0;
  
  for (const section of parsedSections) {
    // Skip CTA/conclusion sections - promotional content allowed there
    if (section.allowPromotionalContent) {
      continue;
    }
    
    const sectionContentLower = section.content.toLowerCase();
    
    // Check for company name mentions outside CTA
    if (companyName) {
      const companyRegex = new RegExp(companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const companyMatches = section.content.match(companyRegex);
      if (companyMatches) {
        companyMentionsOutsideCTA += companyMatches.length;
        violations.push({
          phrase: companyName,
          sectionId: section.id,
          sectionType: section.sectionType,
          context: `Company name "${companyName}" found in ${section.sectionType} section`,
          severity: 'high'
        });
      }
    }
    
    // Check for promotional clichés
    for (const promo of PROMOTIONAL_CLICHES) {
      if (sectionContentLower.includes(promo.toLowerCase())) {
        // Determine severity
        let severity: PromotionalViolation['severity'] = 'medium';
        if (promo.startsWith('we ') || promo.startsWith('our ')) {
          severity = 'high';
          firstPersonPromoCount++;
        } else if (promo.includes('best') || promo.includes('leading') || promo.includes('award')) {
          severity = 'high';
          marketingSuperlativeCount++;
        }
        
        // Get context (surrounding text)
        const promoIndex = sectionContentLower.indexOf(promo.toLowerCase());
        const contextStart = Math.max(0, promoIndex - 30);
        const contextEnd = Math.min(section.content.length, promoIndex + promo.length + 30);
        const context = section.content.substring(contextStart, contextEnd);
        
        violations.push({
          phrase: promo,
          sectionId: section.id,
          sectionType: section.sectionType,
          context: `..."${context}"...`,
          severity
        });
      }
    }
  }
  
  return {
    isClean: violations.length === 0,
    violations,
    companyMentionsOutsideCTA,
    firstPersonPromoCount,
    marketingSuperlativeCount
  };
}

/**
 * Detect AI clichés with section awareness
 * Returns clichés found and whether they're in CTA sections
 */
export function detectAIClichesWithContext(
  content: string,
  sections?: ArticleSection[]
): { cliche: string; inCTA: boolean; count: number }[] {
  const parsedSections = sections || parseArticleSections(content);
  const results: Map<string, { inCTA: number; outsideCTA: number }> = new Map();
  
  for (const section of parsedSections) {
    const sectionLower = section.content.toLowerCase();
    
    for (const cliche of AI_CLICHES) {
      const regex = new RegExp(cliche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = sectionLower.match(regex);
      
      if (matches) {
        const existing = results.get(cliche) || { inCTA: 0, outsideCTA: 0 };
        if (section.allowPromotionalContent) {
          existing.inCTA += matches.length;
        } else {
          existing.outsideCTA += matches.length;
        }
        results.set(cliche, existing);
      }
    }
  }
  
  return Array.from(results.entries()).map(([cliche, counts]) => ({
    cliche,
    inCTA: counts.inCTA > 0,
    count: counts.inCTA + counts.outsideCTA
  }));
}

export interface FactCheckResult {
  claim: string;
  verified: boolean;
  confidence: number;
  evidence?: string;
  source?: string;
  correction?: string;
}

export interface SEOAnalysis {
  eeatScore: {
    experience: number;
    expertise: number;
    authoritativeness: number;
    trustworthiness: number;
    overall: number;
  };
  answerFirstOptimized: boolean;
  keywordDensity: number;
  readabilityScore: number;
  internalLinkingOpportunities: string[];
  missingElements: string[];
}

export interface ArticleCritiqueResult {
  originalWordCount: number;
  refinedWordCount: number;
  refinedContent: string;
  factChecks: FactCheckResult[];
  seoAnalysis: SEOAnalysis;
  clichesRemoved: string[];
  improvements: string[];
  qualityScore: number;
  critiqueSummary: string;
}

export class ArticleCritique {
  private braveApiKey: string | undefined;
  private geminiApiKey: string | undefined;

  constructor() {
    this.braveApiKey = process.env.BRAVE_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
  }

  /**
   * Main entry point: Critique and refine an article
   */
  async critiqueArticle(
    content: string,
    title: string,
    topic: string,
    location: string,
    businessName: string,
    targetWordCount: number = 1500
  ): Promise<ArticleCritiqueResult> {
    console.log('🔍 Starting article critique and fact-checking...');
    
    const startTime = Date.now();
    const originalWordCount = this.countWords(content);
    
    // Step 1: Detect and remove AI clichés
    const { cleanedContent, clichesFound } = this.removeAIClichés(content);
    
    // Step 2: Extract factual claims and verify
    const claims = this.extractFactualClaims(cleanedContent);
    const factChecks = await this.verifyClaimsWithSearch(claims.slice(0, 5)); // Limit to 5 for API efficiency
    
    // Step 3: Run SEO analysis
    const seoAnalysis = this.analyzeSEO(cleanedContent, title, topic, location, businessName);
    
    // Step 4: AI-powered refinement (if Gemini available)
    let refinedContent = cleanedContent;
    let improvements: string[] = [];
    
    if (this.geminiApiKey) {
      try {
        const refinementResult = await this.refineWithAI(
          cleanedContent,
          title,
          topic,
          location,
          businessName,
          targetWordCount,
          factChecks,
          seoAnalysis
        );
        refinedContent = refinementResult.content;
        improvements = refinementResult.improvements;
      } catch (error) {
        console.warn('⚠️ AI refinement failed, using cleaned content:', (error as Error).message);
        improvements = ['AI refinement skipped due to error'];
      }
    }
    
    const refinedWordCount = this.countWords(refinedContent);
    const qualityScore = this.calculateQualityScore(seoAnalysis, factChecks, clichesFound.length);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Article critique complete in ${duration}ms (quality score: ${qualityScore}/100)`);
    
    return {
      originalWordCount,
      refinedWordCount,
      refinedContent,
      factChecks,
      seoAnalysis,
      clichesRemoved: clichesFound,
      improvements,
      qualityScore,
      critiqueSummary: this.generateCritiqueSummary(seoAnalysis, factChecks, clichesFound, improvements)
    };
  }

  /**
   * Remove AI clichés from content
   */
  private removeAIClichés(content: string): { cleanedContent: string; clichesFound: string[] } {
    const clichesFound: string[] = [];
    let cleanedContent = content;
    
    for (const cliche of AI_CLICHES) {
      const regex = new RegExp(cliche, 'gi');
      if (regex.test(cleanedContent)) {
        clichesFound.push(cliche);
        // Replace with empty string and clean up extra spaces
        cleanedContent = cleanedContent.replace(regex, '').replace(/\s{2,}/g, ' ');
      }
    }
    
    // Also remove sentences that start with "As a..."
    cleanedContent = cleanedContent.replace(/As a [^,.]+,\s*/gi, '');
    
    // Remove "It's worth noting that" patterns
    cleanedContent = cleanedContent.replace(/It'?s worth (noting|mentioning) that\s*/gi, '');
    
    console.log(`🧹 Removed ${clichesFound.length} AI clichés`);
    
    return { cleanedContent: cleanedContent.trim(), clichesFound };
  }

  /**
   * Extract factual claims that can be verified
   */
  private extractFactualClaims(content: string): string[] {
    const claims: string[] = [];
    
    // Find sentences with numbers/statistics
    const statPatterns = [
      /\d+%[^.]*\./g,
      /\$[\d,]+[^.]*\./g,
      /\d+ (million|billion|thousand)[^.]*\./g,
      /according to[^.]+\./gi,
      /studies show[^.]+\./gi,
      /research indicates[^.]+\./gi,
      /data suggests[^.]+\./gi,
    ];
    
    for (const pattern of statPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        claims.push(...matches.map(m => m.trim()));
      }
    }
    
    // Deduplicate
    return [...new Set(claims)];
  }

  /**
   * Verify claims using Brave Search
   */
  private async verifyClaimsWithSearch(claims: string[]): Promise<FactCheckResult[]> {
    const results: FactCheckResult[] = [];
    
    if (!this.braveApiKey || claims.length === 0) {
      return claims.map(claim => ({
        claim,
        verified: false,
        confidence: 0,
        evidence: 'Verification skipped - no API key or empty claims'
      }));
    }
    
    console.log(`🔬 Verifying ${claims.length} factual claims...`);
    
    for (const claim of claims) {
      try {
        const searchQuery = claim.substring(0, 100); // Limit query length
        const searchResults = await this.braveSearch(searchQuery);
        
        if (searchResults.length > 0) {
          // Check if any results corroborate the claim
          const topResult = searchResults[0];
          const matchesFound = searchResults.filter(r => 
            r.snippet.toLowerCase().includes(claim.toLowerCase().split(' ').slice(0, 3).join(' '))
          ).length;
          
          results.push({
            claim,
            verified: matchesFound > 0,
            confidence: Math.min(100, matchesFound * 33),
            evidence: topResult!.snippet,
            source: topResult!.url
          });
        } else {
          results.push({
            claim,
            verified: false,
            confidence: 0,
            evidence: 'No search results found'
          });
        }
      } catch (error) {
        results.push({
          claim,
          verified: false,
          confidence: 0,
          evidence: `Search failed: ${(error as Error).message}`
        });
      }
    }
    
    const verifiedCount = results.filter(r => r.verified).length;
    console.log(`✅ Fact check complete: ${verifiedCount}/${claims.length} claims verified`);
    
    return results;
  }

  /**
   * Brave Search API call with timeout protection
   */
  private async braveSearch(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
    const params = new URLSearchParams({
      q: query,
      count: '3',
      safesearch: 'moderate'
    });

    // Create abort controller with 5 second timeout to prevent blocking
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.braveApiKey!
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Brave API error: ${response.status}`);
      }

      const data = await response.json() as any;
      return (data.web?.results || []).map((r: any) => ({
        title: r.title,
        snippet: r.description,
        url: r.url
      }));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Analyze SEO quality of content
   */
  private analyzeSEO(
    content: string,
    title: string,
    topic: string,
    location: string,
    businessName: string
  ): SEOAnalysis {
    const contentLower = content.toLowerCase();
    const titleLower = title.toLowerCase();
    
    // E-E-A-T Scoring
    const eeatScore = {
      experience: this.scoreExperience(content, businessName),
      expertise: this.scoreExpertise(content, topic),
      authoritativeness: this.scoreAuthoritativeness(content),
      trustworthiness: this.scoreTrustworthiness(content),
      overall: 0
    };
    eeatScore.overall = Math.round(
      (eeatScore.experience + eeatScore.expertise + eeatScore.authoritativeness + eeatScore.trustworthiness) / 4
    );
    
    // Answer-first optimization check
    const firstParagraph = content.split('\n\n')[0] || '';
    const answerFirstOptimized = 
      firstParagraph.length > 50 &&
      !firstParagraph.toLowerCase().startsWith('in this article') &&
      !firstParagraph.toLowerCase().startsWith('in this guide') &&
      (firstParagraph.includes(topic.split(' ')[0]!) || firstParagraph.includes(location));
    
    // Keyword density
    const words = content.split(/\s+/);
    const topicWords = topic.toLowerCase().split(' ');
    const topicMentions = topicWords.reduce((count, word) => {
      return count + (contentLower.match(new RegExp(word, 'g')) || []).length;
    }, 0);
    const keywordDensity = (topicMentions / words.length) * 100;
    
    // Simple readability score (based on sentence length)
    const sentences = content.split(/[.!?]+/);
    const avgSentenceLength = words.length / sentences.length;
    const readabilityScore = Math.max(0, 100 - (avgSentenceLength - 15) * 3);
    
    // Missing elements
    const missingElements: string[] = [];
    if (!contentLower.includes(location.toLowerCase())) missingElements.push('Location mention');
    if (!contentLower.includes(businessName.toLowerCase())) missingElements.push('Business name');
    if (!content.includes('?')) missingElements.push('FAQ questions');
    if (!/\d+/.test(content)) missingElements.push('Statistics/numbers');
    if (!content.includes('http')) missingElements.push('External citations');
    
    // Internal linking opportunities
    const internalLinkingOpportunities = this.findLinkingOpportunities(content, topic);
    
    return {
      eeatScore,
      answerFirstOptimized,
      keywordDensity: Math.round(keywordDensity * 100) / 100,
      readabilityScore: Math.round(readabilityScore),
      internalLinkingOpportunities,
      missingElements
    };
  }

  /**
   * E-E-A-T Component Scorers
   */
  private scoreExperience(content: string, businessName: string): number {
    let score = 50; // Base score
    
    // First-person experience indicators
    if (/we (have|'ve) (worked|helped|served|been)/i.test(content)) score += 15;
    if (/our (team|experts|specialists|professionals)/i.test(content)) score += 10;
    if (/years of experience/i.test(content)) score += 10;
    if (content.includes(businessName)) score += 15;
    
    return Math.min(100, score);
  }

  private scoreExpertise(content: string, topic: string): number {
    let score = 50;
    
    // Technical depth indicators
    if (/according to/i.test(content)) score += 10;
    if (/research (shows|indicates|suggests)/i.test(content)) score += 10;
    if (/\d+%/.test(content)) score += 10;
    if (/studies? (show|found|indicate)/i.test(content)) score += 10;
    if (content.split('##').length >= 3) score += 10; // Multiple sections
    
    return Math.min(100, score);
  }

  private scoreAuthoritativeness(content: string): number {
    let score = 50;
    
    // Authority signals
    if (/\.gov|\.edu|\.org/i.test(content)) score += 20;
    if (/certified|licensed|accredited/i.test(content)) score += 15;
    if (/official|authorized|recognized/i.test(content)) score += 10;
    if (/\[source\]|\[citation\]|cited by/i.test(content)) score += 5;
    
    return Math.min(100, score);
  }

  private scoreTrustworthiness(content: string): number {
    let score = 50;
    
    // Trust signals
    if (/disclaimer|disclosure/i.test(content)) score += 10;
    if (/updated|last reviewed/i.test(content)) score += 10;
    if (/contact us|call us|reach out/i.test(content)) score += 10;
    if (/privacy|secure|confidential/i.test(content)) score += 10;
    if (/years?[\s\d]+experience/i.test(content)) score += 10;
    
    return Math.min(100, score);
  }

  /**
   * Find internal linking opportunities
   */
  private findLinkingOpportunities(content: string, topic: string): string[] {
    const opportunities: string[] = [];
    
    // Common linkable phrases
    const linkablePatterns = [
      /learn more about/gi,
      /for more information/gi,
      /related services/gi,
      /see also/gi,
      /contact us/gi,
      /our services/gi,
      /read more/gi,
    ];
    
    for (const pattern of linkablePatterns) {
      if (pattern.test(content)) {
        opportunities.push(pattern.source.replace(/\\b|\\s|\\/g, ' ').trim());
      }
    }
    
    return opportunities.slice(0, 5);
  }

  /**
   * AI-powered content refinement
   */
  private async refineWithAI(
    content: string,
    title: string,
    topic: string,
    location: string,
    businessName: string,
    targetWordCount: number,
    factChecks: FactCheckResult[],
    seoAnalysis: SEOAnalysis
  ): Promise<{ content: string; improvements: string[] }> {
    const genAI = new GoogleGenAI({ apiKey: this.geminiApiKey! });

    const unverifiedClaims = factChecks.filter(f => !f.verified && f.confidence < 50);
    
    const prompt = `You are a Senior SEO Content Editor. Refine this article for maximum quality.

TITLE: ${title}
TOPIC: ${topic}
LOCATION: ${location}
BUSINESS: ${businessName}
TARGET WORD COUNT: ${targetWordCount}

CURRENT SEO ISSUES:
- E-E-A-T Score: ${seoAnalysis.eeatScore.overall}/100
- Missing Elements: ${seoAnalysis.missingElements.join(', ') || 'None'}
- Answer-First Optimized: ${seoAnalysis.answerFirstOptimized ? 'Yes' : 'No - FIX THIS'}
- Keyword Density: ${seoAnalysis.keywordDensity}%

${unverifiedClaims.length > 0 ? `UNVERIFIED CLAIMS TO SOFTEN OR REMOVE:
${unverifiedClaims.map(c => `- "${c.claim.substring(0, 100)}..."`).join('\n')}` : ''}

ARTICLE TO REFINE:
${content}

INSTRUCTIONS:
1. Ensure the FIRST paragraph directly answers the main question (answer-first optimization)
2. Add ${location} mention in first 3 paragraphs if missing
3. Strengthen E-E-A-T signals by adding experience/expertise language for ${businessName}
4. Soften or add qualifiers to unverified statistical claims
5. Maintain the overall structure and information
6. Target ${targetWordCount} words

Return ONLY the refined article content in Markdown format.
Do NOT include explanations or meta-commentary.`;

    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 } // Low temp for precise editing
    });
    const refinedContent = result.text || '';

    const improvements: string[] = [];
    if (!seoAnalysis.answerFirstOptimized) improvements.push('Added answer-first optimization');
    if (seoAnalysis.missingElements.length > 0) improvements.push(`Addressed missing elements: ${seoAnalysis.missingElements.join(', ')}`);
    if (unverifiedClaims.length > 0) improvements.push(`Softened ${unverifiedClaims.length} unverified claims`);
    improvements.push('Enhanced E-E-A-T signals');

    return { content: refinedContent, improvements };
  }

  /**
   * Calculate overall quality score
   */
  private calculateQualityScore(
    seoAnalysis: SEOAnalysis,
    factChecks: FactCheckResult[],
    clichesRemoved: number
  ): number {
    let score = seoAnalysis.eeatScore.overall * 0.4; // 40% weight on E-E-A-T
    
    // Add points for verified facts
    const verifiedRatio = factChecks.length > 0 
      ? factChecks.filter(f => f.verified).length / factChecks.length 
      : 0.5;
    score += verifiedRatio * 30; // 30% weight on fact accuracy
    
    // Add points for readability
    score += (seoAnalysis.readabilityScore / 100) * 15; // 15% weight
    
    // Add points for answer-first
    if (seoAnalysis.answerFirstOptimized) score += 10;
    
    // Subtract for missing elements
    score -= seoAnalysis.missingElements.length * 2;
    
    // Bonus for removing clichés
    score += Math.min(5, clichesRemoved);
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Generate human-readable critique summary
   */
  private generateCritiqueSummary(
    seoAnalysis: SEOAnalysis,
    factChecks: FactCheckResult[],
    clichesRemoved: string[],
    improvements: string[]
  ): string {
    const parts: string[] = [];
    
    parts.push(`E-E-A-T Score: ${seoAnalysis.eeatScore.overall}/100`);
    
    if (factChecks.length > 0) {
      const verified = factChecks.filter(f => f.verified).length;
      parts.push(`Fact-checked ${factChecks.length} claims (${verified} verified)`);
    }
    
    if (clichesRemoved.length > 0) {
      parts.push(`Removed ${clichesRemoved.length} AI clichés`);
    }
    
    if (seoAnalysis.missingElements.length > 0) {
      parts.push(`Missing: ${seoAnalysis.missingElements.join(', ')}`);
    }
    
    if (improvements.length > 0) {
      parts.push(`Improvements: ${improvements.join(', ')}`);
    }
    
    return parts.join(' | ');
  }

  /**
   * Count words in content
   */
  private countWords(content: string): number {
    return content.split(/\s+/).filter(w => w.length > 0).length;
  }
}

export const articleCritique = new ArticleCritique();
