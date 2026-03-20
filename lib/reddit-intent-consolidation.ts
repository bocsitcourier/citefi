/**
 * Phase 1: Intent Consolidation & Outline Generation
 * 
 * Transforms raw Reddit discussions into structured AEO-compliant outlines.
 * This intermediate analysis layer clusters user questions, identifies core intents,
 * and extracts authentic experience proof before article generation.
 */

import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ConsolidatedIntent {
  h2Question: string;           // AEO-compliant H2 heading (natural user query)
  coreIntent: string;           // Primary user intent (how-to, comparison, pain point, etc.)
  experienceProof: string;      // Authentic first-hand user experience from Reddit
  supportingQuestions: string[]; // Related questions from Reddit that map to this theme
  prevalence: string;           // How common this theme is (e.g., "15 mentions across 3 subreddits")
  coveragePillar: string;       // Maps to one of 7 coverage pillars
}

export interface RedditOutline {
  consolidatedIntents: ConsolidatedIntent[];
  overallTheme: string;         // Main topic synthesized from all discussions
  targetAudience: string;       // Inferred audience from discussion tone/context
  analysisTimestamp: string;
}

// ============================================================================
// PHASE 1: INTENT CONSOLIDATION
// ============================================================================

/**
 * Analyzes raw Reddit data and produces structured outline
 */
export async function consolidateRedditIntents(params: {
  coreTopic: string;
  location: string;
  redditQuestions: Array<{
    question: string;
    upvotes: number;
    subreddit: string;
    intentCategory: string;
  }>;
  redditDiscussions?: Array<{
    title: string;
    topComments: string[];
    upvotes: number;
    subreddit: string;
  }>;
}): Promise<RedditOutline> {
  const { coreTopic, location, redditQuestions, redditDiscussions = [] } = params;
  
  console.log(`[Intent Consolidation] Analyzing ${redditQuestions.length} questions for "${coreTopic}" in "${location}"...`);
  
  // SAFETY: Return empty outline if no data
  if (redditQuestions.length === 0) {
    console.warn('[Intent Consolidation] No Reddit questions to analyze - returning empty outline');
    return {
      consolidatedIntents: [],
      overallTheme: coreTopic,
      targetAudience: 'general',
      analysisTimestamp: new Date().toISOString(),
    };
  }
  
  try {
    // Prepare raw Reddit data for analysis
    const questionsText = redditQuestions
      .map((q, i) => `${i + 1}. "${q.question}" (${q.upvotes} upvotes, r/${q.subreddit}, intent: ${q.intentCategory})`)
      .join('\n');
    
    const discussionsText = redditDiscussions
      .map((d, i) => `
Discussion ${i + 1}: "${d.title}" (${d.upvotes} upvotes, r/${d.subreddit})
Top comments: ${d.topComments.slice(0, 3).join(' | ')}
      `)
      .join('\n');
    
    // Build Phase 1 prompt
    const prompt = `Act as a Content Strategist and Intent Analyst with deep knowledge of community forums. Your task is to structure raw Reddit user data into an AEO-ready outline for a local SEO article about "${coreTopic}" in "${location}".

**YOUR ROLE:**
- Transform chaotic Reddit discussions into clear, structured content outline
- Cluster genuine user questions into 5-7 high-relevance themes
- Extract authentic Experience (E) component of E-E-A-T from real user stories
- Ensure each theme addresses specific micro-intents for AI citation optimization

**RAW REDDIT DATA:**

Questions (${redditQuestions.length} total):
${questionsText}

${redditDiscussions.length > 0 ? `Discussions (${redditDiscussions.length} total):
${discussionsText}` : ''}

**YOUR TASK:**

1. **Intent Clustering:** Group the user questions into 5-7 distinct, high-relevance themes. Each theme should represent a clear user need.

2. **H2 Question Generation:** For each theme, create an AEO-compliant H2 heading formatted as a natural user query. Use question words (How, What, Why, Which, etc.) and incorporate the location "${location}" naturally.

3. **Core Intent Identification:** Classify each theme's primary intent:
   - How-to/Process (instructional)
   - Comparison/Best (evaluative)
   - Cost/Pricing (transactional research)
   - Problem-solving (troubleshooting)
   - Foundational (what/why/definition)
   - Location-specific (local regulations, providers, etc.)
   - Advanced (specialized topics)

4. **Experience Proof Extraction:** For each theme, extract the MOST COMPELLING, authentic first-hand user experience, anecdote, or specific data point from the Reddit text. This must be real, non-generic proof.

5. **Coverage Pillar Mapping:** Map each theme to one of these pillars:
   - foundational (basics, definitions, what/why)
   - process (how-to, step-by-step)
   - comparative (best, vs, alternatives)
   - cost (pricing, budgets, ROI)
   - local (regulations, providers, area-specific)
   - advanced (specialized, technical)
   - troubleshooting (problems, solutions, fixes)

**OUTPUT FORMAT (JSON):**
Return a valid JSON object with this structure:

{
  "overallTheme": "brief synthesis of main topic",
  "targetAudience": "inferred audience (e.g., 'homeowners', 'small business owners', 'consumers')",
  "consolidatedIntents": [
    {
      "h2Question": "Natural question as H2 heading",
      "coreIntent": "primary intent type",
      "experienceProof": "Authentic user experience/anecdote from Reddit",
      "supportingQuestions": ["question 1", "question 2"],
      "prevalence": "e.g., '15 mentions across r/AskNYC, r/HomeImprovement'",
      "coveragePillar": "pillar name"
    }
  ]
}

**REQUIREMENTS:**
- 5-7 consolidated intents minimum
- Each H2 must be a natural, location-optimized question
- Experience proof must be specific (not generic) and quoted from Reddit
- Sort intents by prevalence (most common themes first)
- Ensure no duplicate themes

Generate the JSON outline now:`;

    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });
    const responseText = result.text || "";
    
    // Parse JSON response
    const parsed = JSON.parse(responseText);
    
    const outline: RedditOutline = {
      consolidatedIntents: parsed.consolidatedIntents || [],
      overallTheme: parsed.overallTheme || coreTopic,
      targetAudience: parsed.targetAudience || 'general',
      analysisTimestamp: new Date().toISOString(),
    };
    
    console.log(`[Intent Consolidation] ✅ Generated outline with ${outline.consolidatedIntents.length} consolidated themes`);
    
    return outline;
    
  } catch (error) {
    console.error('[Intent Consolidation] ❌ Error during analysis:', error);
    
    // SAFETY: Return minimal outline on error
    return {
      consolidatedIntents: [],
      overallTheme: coreTopic,
      targetAudience: 'general',
      analysisTimestamp: new Date().toISOString(),
    };
  }
}
