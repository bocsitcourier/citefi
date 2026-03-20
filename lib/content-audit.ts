/**
 * Content Audit System - GEO/AEO Compliance & Quality Analysis
 * Analyzes existing articles for E-E-A-T signals, entity salience, direct answers, and internal linking opportunities
 */

import { openaiClient } from "./openai-client";
import type { Article } from "@/shared/schema";
import { db } from "./db";
import { articles } from "@/shared/schema";
import { eq } from "drizzle-orm";

export interface AuditCriterion {
  criterion: string;
  score: number; // 1-5 scale
  rationale: string;
  suggestedEdit?: string;
}

export interface InternalLinkOpportunity {
  anchorText: string;
  targetArticleId: number;
  targetArticleTitle: string;
  context: string;
  relevanceScore: number;
}

export interface ContentAuditResult {
  overallScore: number; // 1-5 scale
  citationPotential: "high" | "medium" | "low";
  criteria: {
    directAnswerCompliance: AuditCriterion;
    entitySalience: AuditCriterion;
    eeeatSignals: AuditCriterion;
    passageQuality: AuditCriterion;
    schemaReadiness: AuditCriterion;
    geoOptimization: AuditCriterion;
  };
  internalLinkOpportunities: InternalLinkOpportunity[];
  recommendations: string[];
  complianceIssues: string[];
}

/**
 * GPT-4 Quality Audit - Comprehensive AEO/GEO compliance check
 */
export async function performQualityAudit(
  articleHtml: string,
  articleTitle: string,
  location?: string,
  businessName?: string
): Promise<ContentAuditResult> {
  console.log(`🔍 Starting GPT-4 Quality Audit for: "${articleTitle}"`);

  const auditPrompt = `You are a Google Quality Rater and AEO (Answer Engine Optimization) Strategist.

**TASK:** Perform a comprehensive quality audit of this article for Generative Engine Optimization (GEO) and AI citation potential.

**ARTICLE TITLE:** ${articleTitle}
${location ? `**LOCATION:** ${location}` : ""}
${businessName ? `**BUSINESS:** ${businessName}` : ""}

**ARTICLE CONTENT:**
${articleHtml}

**AUDIT CRITERIA (Score each 1-5, where 5 is perfect):**

1. **Direct Answer Compliance (Critical for AI Citations)**
   - Check: Does each H2/H3 section start with a complete, direct answer (40-60 words)?
   - This is PRIMARY for Featured Snippets and AI Overview citations
   - Score 5 if ALL major sections have proper direct answers
   - Score 1 if most sections lack direct answers

2. **Entity Salience (GEO Optimization)**
   ${location ? `- Check: Does "${location}" appear prominently in H2s or bolded text in top sections?` : ""}
   ${businessName ? `- Check: Does "${businessName}" appear as a clear entity signal?` : ""}
   - Check: Are authority entities (SMEs, organizations) clearly referenced?
   - Score 5 if geographic and authorship entities are highly salient
   - Score 1 if entities are buried or absent

3. **E-E-A-T Signals (Experience, Expertise, Authoritativeness, Trust)**
   - Check: Are there specific examples, case studies, or real experiences?
   - Check: Is expertise demonstrated through data, statistics, or expert citations?
   - Check: Are there trust signals (credentials, sources, transparency)?
   - Score 5 if multiple strong E-E-A-T signals present
   - Score 1 if generic content with no trust/expertise markers

4. **Passage Quality (Answer-First Structure)**
   - Check: Can individual paragraphs stand alone as complete answers?
   - Check: Are paragraphs concise, well-structured, and citation-ready?
   - Check: Do passages avoid fluff and get straight to the point?
   - Score 5 if passages are highly extractable and citation-worthy
   - Score 1 if passages are rambling or unfocused

5. **Schema Readiness**
   - Check: Is content structured for JSON-LD schema (Article, FAQPage, HowTo, LocalBusiness)?
   - Check: Are FAQs in proper Q&A format?
   - Check: Are step-by-step instructions clearly marked?
   - Score 5 if highly schema-compatible
   - Score 1 if poorly structured for schema markup

6. **GEO Optimization (Local + AI Citation Signals)**
   ${location ? `- Check: Are local signals integrated naturally (ZIP codes, neighborhoods, regulations)?` : ""}
   - Check: Does content answer questions that AI engines would cite?
   - Check: Is content optimized for voice search and conversational queries?
   - Score 5 if fully optimized for GEO
   - Score 1 if no GEO optimization present

**RESPONSE FORMAT (JSON):**
{
  "overallScore": <1-5>,
  "citationPotential": "<high|medium|low>",
  "criteria": {
    "directAnswerCompliance": {
      "score": <1-5>,
      "rationale": "<detailed explanation>",
      "suggestedEdit": "<specific improvement if score < 5>"
    },
    "entitySalience": {
      "score": <1-5>,
      "rationale": "<detailed explanation>",
      "suggestedEdit": "<specific improvement if score < 5>"
    },
    "eeeatSignals": {
      "score": <1-5>,
      "rationale": "<detailed explanation>",
      "suggestedEdit": "<specific improvement if score < 5>"
    },
    "passageQuality": {
      "score": <1-5>,
      "rationale": "<detailed explanation>",
      "suggestedEdit": "<specific improvement if score < 5>"
    },
    "schemaReadiness": {
      "score": <1-5>,
      "rationale": "<detailed explanation>",
      "suggestedEdit": "<specific improvement if score < 5>"
    },
    "geoOptimization": {
      "score": <1-5>,
      "rationale": "<detailed explanation>",
      "suggestedEdit": "<specific improvement if score < 5>"
    }
  },
  "recommendations": [
    "<actionable recommendation 1>",
    "<actionable recommendation 2>",
    "<actionable recommendation 3>"
  ],
  "complianceIssues": [
    "<critical issue 1 if any>",
    "<critical issue 2 if any>"
  ]
}

**IMPORTANT:** Return ONLY valid JSON. Be specific in rationales and suggested edits.`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert SEO auditor specializing in GEO (Generative Engine Optimization) and AEO (Answer Engine Optimization). Always respond with valid JSON only."
        },
        {
          role: "user",
          content: auditPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No audit response from GPT-4");
    }

    const auditData = JSON.parse(content);
    
    console.log(`✅ Quality Audit Complete - Overall Score: ${auditData.overallScore}/5`);
    console.log(`   Citation Potential: ${auditData.citationPotential}`);

    return {
      overallScore: auditData.overallScore,
      citationPotential: auditData.citationPotential,
      criteria: {
        directAnswerCompliance: auditData.criteria.directAnswerCompliance,
        entitySalience: auditData.criteria.entitySalience,
        eeeatSignals: auditData.criteria.eeeatSignals,
        passageQuality: auditData.criteria.passageQuality,
        schemaReadiness: auditData.criteria.schemaReadiness,
        geoOptimization: auditData.criteria.geoOptimization,
      },
      internalLinkOpportunities: [],
      recommendations: auditData.recommendations || [],
      complianceIssues: auditData.complianceIssues || [],
    };
  } catch (error) {
    console.error("❌ Quality audit failed:", error);
    throw new Error(`Quality audit failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Discover internal linking opportunities for an article
 */
export async function discoverInternalLinkOpportunities(
  articleId: number,
  articleContent: string,
  teamId: number
): Promise<InternalLinkOpportunity[]> {
  console.log(`🔗 Discovering internal link opportunities for article ${articleId}`);

  try {
    // Fetch other articles from the same team
    const potentialTargets = await db
      .select({
        id: articles.id,
        title: articles.chosenTitle,
        finalHtml: articles.finalHtmlContent,
      })
      .from(articles)
      .where(eq(articles.teamId, teamId))
      .limit(50); // Limit to most recent 50 articles

    if (potentialTargets.length === 0) {
      console.log("   No other articles found for internal linking");
      return [];
    }

    // Filter out the current article
    const targets = potentialTargets.filter(t => t.id !== articleId);

    if (targets.length === 0) {
      console.log("   No other articles available for linking");
      return [];
    }

    // Use GPT-4 to identify contextual linking opportunities
    const linkingPrompt = `You are an expert internal linking strategist.

**TASK:** Analyze this article and identify 3-5 high-quality internal linking opportunities from the list of available articles.

**CURRENT ARTICLE CONTENT:**
${articleContent.substring(0, 8000)}

**AVAILABLE ARTICLES FOR LINKING:**
${targets.slice(0, 20).map((t, i) => `${i + 1}. "${t.title}" (ID: ${t.id})${t.location ? ` - Location: ${t.location}` : ""}`).join('\n')}

**CRITERIA FOR GOOD INTERNAL LINKS:**
1. Semantic relevance - Topics are closely related
2. Natural anchor text - Fits contextually in a sentence
3. Value add - Provides additional depth or related information
4. Not forced - Should feel organic, not shoe-horned

**RESPONSE FORMAT (JSON):**
{
  "opportunities": [
    {
      "anchorText": "<natural anchor text from current article>",
      "targetArticleId": <ID number>,
      "targetArticleTitle": "<title>",
      "context": "<surrounding sentence/paragraph where link should go>",
      "relevanceScore": <0.0-1.0>
    }
  ]
}

Return ONLY valid JSON with 3-5 opportunities, ordered by relevanceScore (highest first).`;

    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an internal linking expert. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: linkingPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return [];
    }

    const linkData = JSON.parse(content);
    console.log(`   Found ${linkData.opportunities?.length || 0} internal link opportunities`);

    return linkData.opportunities || [];
  } catch (error) {
    console.error("❌ Internal link discovery failed:", error);
    return [];
  }
}

/**
 * Comprehensive article audit - combines quality audit + internal linking
 */
export async function auditArticle(
  articleId: number,
  teamId: number
): Promise<ContentAuditResult> {
  console.log(`📊 Starting comprehensive audit for article ${articleId}`);

  // Fetch the article
  const [article] = await db
    .select()
    .from(articles)
    .where(eq(articles.id, articleId));

  if (!article) {
    throw new Error(`Article ${articleId} not found`);
  }

  if (article.teamId !== teamId) {
    throw new Error("Unauthorized: Article does not belong to your team");
  }

  // Perform quality audit
  const qualityAudit = await performQualityAudit(
    article.finalHtmlContent || "",
    article.chosenTitle || "",
    undefined,
    undefined
  );

  // Discover internal link opportunities
  const linkOpportunities = await discoverInternalLinkOpportunities(
    articleId,
    article.finalHtmlContent || "",
    teamId
  );

  console.log(`✅ Comprehensive audit complete for article ${articleId}`);

  return {
    ...qualityAudit,
    internalLinkOpportunities: linkOpportunities,
  };
}
