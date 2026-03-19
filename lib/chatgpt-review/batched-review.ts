import { openaiClient, callOpenAI } from "../openai-client";
import { validateContent, type ContentValidationResult } from "./content-validator";

export interface BatchedReviewResult {
  hyperlinks: {
    keywords: Array<{
      phrase: string;
      url: string;
      type: "internal" | "external";
      anchorText: string;
      paragraphIndex?: number; // 0-based position in article (for distribution verification)
    }>;
    totalLinks: number;
    internalCount: number;
    externalCount: number;
  };
  seo: {
    seoScore: number;
    scoreBreakdown?: {
      title: number;           // /15
      metaDescription: number; // /10
      structure: number;       // /15
      keywordUsage: number;    // /15
      readability: number;     // /10
      eatSignals: number;      // /15
      semanticDepth: number;   // /10
      localSeo: number;        // /10
    };
    keywordDensity: {
      primary: number;
      secondary: number;
      overOptimized: boolean;
    };
    readability: {
      fleschScore: number;
      gradeLevel: string;
      avgSentenceLength: number;
    };
    localSignals: {
      napMentions: number;
      locationKeywords: number;
      geoRelevance: number;
    };
    recommendations: string[];
  };
  hashtags: {
    hashtags: string[];
    categories: {
      seo: string[];
      geo: string[];
      brand: string[];
      trending: string[];
    };
    totalCount: number;
  };
  socialSnippets: {
    openGraph: {
      title: string;
      description: string;
      type: string;
    };
    twitter: {
      title: string;
      description: string;
      card: string;
    };
    linkedin: {
      title: string;
      description: string;
    };
  };
  // TASK 5: Advanced content validation (Lily Ray + Mike King + Kevin Indig)
  contentValidation?: ContentValidationResult;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function batchedChatGPTReview(params: {
  content: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  keywords: string[];
  targetUrl: string;
  geographicFocus?: string;
  businessName?: string;
  audience?: string;
  competitorUrls?: string[];
  faq?: Array<{ question: string; answer: string }>;
  wordCount?: number;
  enableValidation?: boolean; // TASK 5: Enable advanced validation
}): Promise<BatchedReviewResult> {
  const {
    content,
    title,
    seoTitle,
    metaDescription,
    keywords,
    targetUrl,
    geographicFocus,
    businessName,
    audience,
    competitorUrls,
    faq,
    wordCount,
    enableValidation = true, // Default: enabled
  } = params;

  const systemPrompt = `You are an elite SEO and content marketing expert. You will analyze content and provide comprehensive SEO optimization data in a single response.

Your analysis includes:
1. Strategic hyperlink placement (25-30 long-phrase keywords)
2. SEO quality analysis (score, keyword density, readability, local signals)
3. Hashtag generation (10-20 hashtags with categorization)
4. Social media snippets (OpenGraph, Twitter, LinkedIn optimized with emojis)`;

  const userPrompt = `Analyze this article and provide comprehensive SEO optimization data:

**ARTICLE DETAILS:**
Title: ${title}
SEO Title: ${seoTitle}
Meta Description: ${metaDescription}
Target Keywords: ${keywords.join(", ")}
Target URL: ${targetUrl}
${geographicFocus ? `Geographic Focus: ${geographicFocus}` : ""}
${businessName ? `Business Name: ${businessName}` : ""}
${audience ? `Audience: ${audience}` : ""}
${competitorUrls?.length ? `Competitor URLs: ${competitorUrls.join(", ")}` : ""}

**CONTENT:**
${content}

**PROVIDE THE FOLLOWING IN JSON FORMAT:**

1. **HYPERLINKS** (25-30 total long-phrase keywords, 3-7 words each, ALL pointing to ${targetUrl}):
   - **CRITICAL**: You MUST scan the ENTIRE article from first paragraph to last paragraph before selecting ANY keywords
   - Read through ALL sections (beginning, middle, end) and note valuable phrases throughout
   - **PRIMARY CITY RULE — MANDATORY**: The article title is "${title}". Identify the PRIMARY city/location from the title (e.g., if the title says "Near Wellesley MA", the primary city is "Wellesley MA"). ALL long-phrase keywords MUST include or be clearly about that PRIMARY city. Do NOT select phrases that mention neighboring cities, surrounding towns, or the broader metro area (e.g., "Greater Boston MA", "Newton MA", "Sudbury MA") — those are only contextual mentions in the article body and must NOT appear as keyword phrases.
   - **PRIORITY SELECTION** - Prioritize phrases that directly relate to ${businessName || 'the business'}'s services and the PRIMARY city from the title:
     * Service + primary city: "[service type] [primary city]"
     * Location-specific phrases: "near [primary city]", "in [primary city]", "[primary city] [service]"
     * Problem/solution phrases tied to the primary city
   - **Distribution Strategy**: Aim to select keywords from different parts of the article:
     * Top quarter: 6-8 phrases (if natural anchors exist)
     * Second quarter: 6-8 phrases (if natural anchors exist)
     * Third quarter: 6-8 phrases (if natural anchors exist)
     * Bottom quarter: 6-8 phrases (if natural anchors exist)
   - If a section lacks natural long phrases, select fewer from that section and more from phrase-rich sections
   - Total must stay within 25-30 links across entire article
   - DO NOT focus only on the introduction - deliberately scan middle and conclusion paragraphs
   - Each keyword must include "paragraphIndex" field (0-based position in article where phrase appears)
   - **AVOID** generic phrases that don't relate to the business services (e.g., "in recent years", "according to studies")
   - **AVOID** phrases that only mention neighboring/surrounding cities — the keywords must reflect the PRIMARY city in the article title
   - Select phrases that a user would search for when looking for ${businessName || 'this type of service'} in the primary city
   - ALL links must be internal (type: "internal", url: "${targetUrl}")

2. **SEO ANALYSIS** (Use this scoring guidance to calculate 0-100 score):
   
   🚨 **CRITICAL GEO/AEO METADATA VERIFICATION** 🚨
   **BEFORE scoring, verify these character limits (penalties if exceeded):**
   - **SEO Title:** MUST be under 60 characters (current: "${seoTitle}" = ${seoTitle.length} chars)
     * If >60 chars: Include specific recommendation to shorten to ${Math.max(50, Math.min(seoTitle.length - 10, 60))} characters
     * Penalty: -5 points from title score for every 5 chars over 60
   - **Meta Description:** MUST be under 160 characters (current: "${metaDescription}" = ${metaDescription.length} chars)
     * If >160 chars: Include specific recommendation to shorten to ${Math.max(150, Math.min(metaDescription.length - 10, 160))} characters
     * Penalty: -5 points from metaDescription score for every 10 chars over 160
   
   **SCORING GUIDANCE** (Aim for balanced evaluation across these areas):
   - **Title Optimization (~15%):** Keyword placement in title, compelling/clickworthy language, STRICT 60 char limit compliance
   - **Meta Description (~10%):** Keyword presence, includes CTA or value prop, STRICT 160 char limit compliance
   - **Content Structure (~15%):** Clear H1→H2→H3 hierarchy, logical flow, BLUF principle applied
   - **Keyword Usage (~15%):** Primary keyword appears in critical locations (H1, intro, conclusion), natural variations used, not over-optimized
   - **Readability (~10%):** Appropriate Flesch score, accessible reading level, sentence length variety
   - **Authority Signals (~15%):** Demonstrates expertise through specific details, industry insights, professional language
   - **Topic Coverage (~10%):** Related topics explored, comprehensive coverage, answers user intent fully
   - **Local Relevance (~10%):** ${geographicFocus ? `Location (${geographicFocus}) mentioned naturally, local context integrated` : 'Geographic context integrated if applicable'}
   
   **RETURN THESE METRICS:**
   - Overall SEO score (0-100) - use judgment based on guidance above, be realistic but constructive
   - Score breakdown (optional - only if you can confidently assess each category)
   - Keyword density (primary/secondary as decimal, overOptimized boolean)
   - Readability (Flesch score estimate, grade level, avg sentence length estimate)
   - Local signals (location mention count, location keywords present, geo-relevance 0-100)
   - 3-5 specific, actionable recommendations to improve the score (focus on biggest gaps)

3. **HASHTAGS** (10-20 total, categorized):
   - SEO hashtags (40%): Core topic keywords
   - Geographic hashtags (30%): Location-specific ${geographicFocus ? `(must include #${geographicFocus.split(',')[0].replace(/\s+/g, '')})` : ""}
   - Brand/Industry hashtags (20%)
   - Trending hashtags (10%)
   - Use PascalCase for multi-word tags

4. **SOCIAL SNIPPETS**:
   - OpenGraph: 60-70 char title, 155-200 char description
   - Twitter: 70-80 char title, 250-280 char description with 2-3 hashtags
   - LinkedIn: 150-200 char title, 300-400 char description with 3-5 hashtags
   - Create FOMO and urgency in copy
   - USE 2-4 emojis strategically (beginning, middle, or end) to increase engagement
   - Include location-specific emojis when geographic focus provided (📍🌆🏙️🗺️)

**RETURN ONLY THIS JSON STRUCTURE:**
{
  "hyperlinks": {
    "keywords": [
      {
        "phrase": "long-phrase keyword from content",
        "url": "${targetUrl}",
        "type": "internal",
        "anchorText": "exact phrase to hyperlink",
        "paragraphIndex": <0-based position where phrase appears>
      }
    ],
    "totalLinks": <number>,
    "internalCount": <number>,
    "externalCount": <number>
  },
  "seo": {
    "seoScore": <0-100>,
    "scoreBreakdown": {
      "title": <0-15>,
      "metaDescription": <0-10>,
      "structure": <0-15>,
      "keywordUsage": <0-15>,
      "readability": <0-10>,
      "eatSignals": <0-15>,
      "semanticDepth": <0-10>,
      "localSeo": <0-10>
    },
    "keywordDensity": {
      "primary": <percentage as decimal>,
      "secondary": <percentage as decimal>,
      "overOptimized": <boolean>
    },
    "readability": {
      "fleschScore": <0-100>,
      "gradeLevel": "<grade level>",
      "avgSentenceLength": <number>
    },
    "localSignals": {
      "napMentions": <count>,
      "locationKeywords": <count>,
      "geoRelevance": <0-100>
    },
    "recommendations": ["<specific action to improve score>", "..."]
  },
  "hashtags": {
    "hashtags": ["#Tag1", "#Tag2", ...],
    "categories": {
      "seo": ["#SEOTag1", ...],
      "geo": ["#${geographicFocus?.split(',')[0].replace(/\s+/g, '') || 'Location'}", ...],
      "brand": ["#IndustryTag1", ...],
      "trending": ["#TrendingTag1", ...]
    },
    "totalCount": <number>
  },
  "socialSnippets": {
    "openGraph": {
      "title": "<60-70 chars>",
      "description": "<155-200 chars>",
      "type": "article"
    },
    "twitter": {
      "title": "<70-80 chars>",
      "description": "<250-280 chars with 2-3 hashtags>",
      "card": "summary_large_image"
    },
    "linkedin": {
      "title": "<150-200 chars>",
      "description": "<300-400 chars with 3-5 hashtags>"
    }
  }
}`;

  // ChatGPT review timeout: 90s default (articles complete in 50-60s, buffer for safety)
  const chatgptReviewTimeout = parseInt(process.env.CHATGPT_REVIEW_TIMEOUT_MS || "90000");
  
  const completion = await callOpenAI(
    (client) => client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    }),
    `Batched Review: ${title.substring(0, 50)}`,
    chatgptReviewTimeout // Pass timeout to callOpenAI wrapper (controls request timeout)
  );

  const responseText = completion.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(responseText);

  // TASK 5: Run advanced content validation in BACKGROUND (non-blocking)
  // Validation is purely informational (logging) - it doesn't gate the pipeline
  let contentValidation: ContentValidationResult | undefined;
  if (enableValidation) {
    const validationPromise = (async () => {
      try {
        console.log(`\n🔍 Running advanced content validation (Task 5)...`);
        const result = await validateContent({
          content,
          title,
          seoTitle,
          metaDescription,
          faq,
          geographicFocus,
          wordCount: wordCount || content.split(/\s+/).length,
        });
        console.log(`✅ Content validation complete - Overall Score: ${result.overallScore}/100`);
        return result;
      } catch (error) {
        console.error(`❌ Content validation failed:`, error);
        return undefined;
      }
    })();
    // Fire-and-forget: Don't await - let it run in background while pipeline continues
    validationPromise.then(result => {
      if (result) contentValidation = result;
    }).catch(() => {});
  }

  // Ensure all required fields exist with defaults
  const result: BatchedReviewResult = {
    hyperlinks: {
      keywords: parsed.hyperlinks?.keywords || [],
      totalLinks: parsed.hyperlinks?.totalLinks || 0,
      internalCount: parsed.hyperlinks?.internalCount || 0,
      externalCount: parsed.hyperlinks?.externalCount || 0,
    },
    seo: {
      seoScore: parsed.seo?.seoScore || 70,
      scoreBreakdown: parsed.seo?.scoreBreakdown || undefined,
      keywordDensity: parsed.seo?.keywordDensity || { primary: 0.01, secondary: 0.005, overOptimized: false },
      readability: parsed.seo?.readability || { fleschScore: 60, gradeLevel: "10th grade", avgSentenceLength: 20 },
      localSignals: parsed.seo?.localSignals || { napMentions: 0, locationKeywords: 0, geoRelevance: 50 },
      recommendations: parsed.seo?.recommendations || [],
    },
    hashtags: {
      hashtags: parsed.hashtags?.hashtags || [],
      categories: parsed.hashtags?.categories || { seo: [], geo: [], brand: [], trending: [] },
      totalCount: parsed.hashtags?.totalCount || 0,
    },
    socialSnippets: {
      openGraph: parsed.socialSnippets?.openGraph || { title: seoTitle, description: metaDescription, type: "article" },
      twitter: parsed.socialSnippets?.twitter || { title: seoTitle, description: metaDescription, card: "summary_large_image" },
      linkedin: parsed.socialSnippets?.linkedin || { title: seoTitle, description: metaDescription },
    },
    contentValidation, // TASK 5: Include validation results
    tokenUsage: {
      promptTokens: completion.usage?.prompt_tokens || 0,
      completionTokens: completion.usage?.completion_tokens || 0,
      totalTokens: completion.usage?.total_tokens || 0,
    },
  };
  
  // Add validation token usage to total if validation ran
  if (contentValidation) {
    result.tokenUsage.promptTokens += contentValidation.tokenUsage.promptTokens;
    result.tokenUsage.completionTokens += contentValidation.tokenUsage.completionTokens;
    result.tokenUsage.totalTokens += contentValidation.tokenUsage.totalTokens;
  }

  console.log(`✅ Batched review complete - SEO Score: ${result.seo.seoScore}/100, ${result.hyperlinks.totalLinks} links, ${result.hashtags.totalCount} hashtags`);
  
  // Log SEO score breakdown if available
  if (result.seo.scoreBreakdown) {
    const bd = result.seo.scoreBreakdown;
    console.log(`  📊 SEO Breakdown: Title ${bd.title}/15, Meta ${bd.metaDescription}/10, Structure ${bd.structure}/15, Keywords ${bd.keywordUsage}/15`);
    console.log(`                   Readability ${bd.readability}/10, E-A-T ${bd.eatSignals}/15, Semantic ${bd.semanticDepth}/10, Local ${bd.localSeo}/10`);
    
    // Identify weakest areas
    const categories = [
      { name: 'Title', score: bd.title, max: 15 },
      { name: 'Meta', score: bd.metaDescription, max: 10 },
      { name: 'Structure', score: bd.structure, max: 15 },
      { name: 'Keywords', score: bd.keywordUsage, max: 15 },
      { name: 'Readability', score: bd.readability, max: 10 },
      { name: 'E-A-T', score: bd.eatSignals, max: 15 },
      { name: 'Semantic', score: bd.semanticDepth, max: 10 },
      { name: 'Local SEO', score: bd.localSeo, max: 10 },
    ];
    
    const weakest = categories
      .map(c => ({ ...c, percentage: (c.score / c.max) * 100 }))
      .filter(c => c.percentage < 80)
      .sort((a, b) => a.percentage - b.percentage);
    
    if (weakest.length > 0) {
      console.log(`  ⚠️  Improvement opportunities: ${weakest.slice(0, 3).map(w => `${w.name} (${Math.round(w.percentage)}%)`).join(', ')}`);
    }
  }

  // Verify keyword distribution across article if paragraphIndex is provided
  if (result.hyperlinks.keywords.length > 0) {
    const withIndex = result.hyperlinks.keywords.filter(k => typeof k.paragraphIndex === 'number');
    if (withIndex.length > 0) {
      const indices = withIndex.map(k => k.paragraphIndex!).sort((a, b) => a - b);
      const maxIndex = Math.max(...indices);
      const q1 = Math.floor(maxIndex * 0.25);
      const q2 = Math.floor(maxIndex * 0.50);
      const q3 = Math.floor(maxIndex * 0.75);
      
      const topQuarter = indices.filter(i => i <= q1).length;
      const secondQuarter = indices.filter(i => i > q1 && i <= q2).length;
      const thirdQuarter = indices.filter(i => i > q2 && i <= q3).length;
      const bottomQuarter = indices.filter(i => i > q3).length;
      
      console.log(`  📊 Keyword distribution: Top 25%: ${topQuarter}, Middle-Top 25%: ${secondQuarter}, Middle-Bottom 25%: ${thirdQuarter}, Bottom 25%: ${bottomQuarter}`);
      
      // Warn if heavily skewed to beginning
      if (topQuarter > (withIndex.length * 0.5)) {
        console.warn(`  ⚠️  WARNING: ${Math.round((topQuarter / withIndex.length) * 100)}% of keywords are in top 25% of article - distribution may be skewed`);
      }
    }
  }

  return result;
}
