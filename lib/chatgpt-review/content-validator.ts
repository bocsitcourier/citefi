import { openaiClient, callOpenAI } from "../openai-client";

/**
 * TASK 5: ADVANCED CONTENT VALIDATOR
 * 
 * Validates articles against Task 4 (Lily Ray + Mike King + Kevin Indig) requirements:
 * - Layer 1 (Lily Ray): Answer-first structure, E-E-A-T signals, local optimization
 * - Layer 2 (Mike King): Passage-level optimization (3-5 sentence paragraphs)
 * - Layer 3 (Kevin Indig): Citation optimization, schema-ready structure
 */

export interface ContentValidationResult {
  overallScore: number; // 0-100 composite score
  
  // Layer 1: Answer-First & E-E-A-T (Lily Ray)
  answerFirst: {
    score: number; // 0-100
    openingWordCount: number;
    openingSentenceCount: number;
    hasDirectAnswer: boolean;
    frontLoadsEvidence: boolean;
    includesStatistics: boolean;
    isQuotable: boolean;
    issues: string[];
  };
  
  eatSignals: {
    score: number; // 0-100
    experience: {
      score: number; // 0-25
      hasFirstHandEvidence: boolean;
      hasCaseStudies: boolean;
      hasRealWorldExamples: boolean;
      count: number;
    };
    expertise: {
      score: number; // 0-25
      hasTechnicalDepth: boolean;
      usesIndustryTerms: boolean;
      explainsComplexConcepts: boolean;
      count: number;
    };
    authoritativeness: {
      score: number; // 0-25
      citationCount: number;
      authorityEntityCount: number;
      statisticCount: number;
      hasSourcesWithYears: boolean;
      count: number;
    };
    trustworthiness: {
      score: number; // 0-25
      isFactual: boolean;
      isTransparent: boolean;
      isBalanced: boolean;
      usesFreshData: boolean; // 2024-2025
      count: number;
    };
    issues: string[];
  };
  
  localOptimization: {
    score: number; // 0-100
    cityMentions: number;
    zipCodeMentions: number;
    neighborhoodMentions: number;
    localRegulationCitations: number;
    authorityEntityCitations: number;
    firstThreeParagraphsHaveLocalSignals: boolean;
    issues: string[];
  };
  
  // Layer 2: Passage-Level Optimization (Mike King)
  passageQuality: {
    score: number; // 0-100
    totalParagraphs: number;
    openingParagraph: {
      sentenceCount: number;
      meetsRequirement: boolean; // 8-12 sentences
      issue?: string;
    };
    otherParagraphs: {
      compliantCount: number; // paragraphs with 3-5 sentences
      violationCount: number;
      violations: Array<{
        paragraphIndex: number;
        sentenceCount: number;
        excerpt: string; // first 100 chars
      }>;
    };
    selfContainedCount: number; // paragraphs that can stand alone
    fillerPhraseCount: number; // detected filler/fluff
    activeVoicePercentage: number;
    issues: string[];
  };
  
  // Layer 3: Citation Optimization (Kevin Indig)
  schemaReadiness: {
    score: number; // 0-100
    questionBasedH2Count: number;
    totalH2Count: number;
    h2ToH3Ratio: number;
    hasFAQSection: boolean;
    faqQuestionCount: number;
    hasNumberedProcess: boolean;
    hasComparisonTable: boolean;
    evidenceFrontLoading: {
      paragraph1HasStatistic: boolean;
      paragraph2HasAuthority: boolean;
      paragraph3HasRegulation: boolean;
    };
    issues: string[];
  };
  
  // Evidence Density Tracking
  evidenceDensity: {
    score: number; // 0-100
    totalCitations: number;
    totalStatistics: number;
    totalSources: number;
    citationsPerParagraph: number; // average
    hasYearReferences: boolean; // includes 2024-2025
    evidenceQuality: "low" | "medium" | "high";
    issues: string[];
  };
  
  // Consolidated Recommendations
  recommendations: Array<{
    category: "critical" | "important" | "minor";
    layer: "Layer 1 (Lily Ray)" | "Layer 2 (Mike King)" | "Layer 3 (Kevin Indig)";
    issue: string;
    fix: string;
  }>;
  
  // Token usage
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export async function validateContent(params: {
  content: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  faq?: Array<{ question: string; answer: string }>;
  geographicFocus?: string;
  wordCount: number;
}): Promise<ContentValidationResult> {
  const {
    content,
    title,
    seoTitle,
    metaDescription,
    faq,
    geographicFocus,
    wordCount,
  } = params;

  const systemPrompt = `You are an expert content quality auditor specializing in advanced SEO methodologies. You validate content against a composite 3-layer framework:

**LAYER 1 (Lily Ray - Answer-First & E-E-A-T):**
- Opening paragraph must be 150-200 words (8-12 sentences) with direct answer
- E-E-A-T signals: Experience (first-hand evidence), Expertise (technical depth), Authoritativeness (citations), Trustworthiness (accuracy)
- Local optimization: City/ZIP/neighborhood mentions in first 3 paragraphs

**LAYER 2 (Mike King - Passage-Level Optimization):**
- Opening paragraph: 8-12 sentences (EXEMPT from 3-5 rule)
- All OTHER paragraphs: 3-5 sentences STRICT
- Self-contained paragraphs (each quotable standalone)
- No filler, active voice, front-loaded info

**LAYER 3 (Kevin Indig - Citation Optimization):**
- Question-based H2 headings ("What is...", "How does...", "Why...")
- Evidence front-loading in first 2-3 paragraphs
- FAQ section with natural Q&As
- Schema-ready structure

Analyze content comprehensively and identify ALL violations with specific examples.`;

  const userPrompt = `Validate this article against the 3-layer framework:

**ARTICLE METADATA:**
Title: ${title}
SEO Title: ${seoTitle}
Meta Description: ${metaDescription}
Geographic Focus: ${geographicFocus || "Not specified"}
Word Count: ${wordCount}
FAQ Provided: ${faq ? `Yes (${faq.length} questions)` : "No"}

**CONTENT TO VALIDATE:**
${content}

${faq ? `\n**FAQ SECTION:**\n${faq.map((q, i) => `${i + 1}. Q: ${q.question}\n   A: ${q.answer}`).join('\n\n')}` : ''}

**VALIDATION REQUIREMENTS:**

**LAYER 1 - ANSWER-FIRST & E-E-A-T:**
1. Opening paragraph analysis:
   - Count sentences (should be 8-12)
   - Estimate word count (should be 150-200)
   - Does it provide COMPLETE direct answer to title question?
   - Does it front-load key facts and evidence?
   - Does it include at least 1 statistic with source?
   - Is it quotable and citable by AI?

2. E-E-A-T signals throughout:
   - **Experience (0-25):** First-hand evidence, case studies, real-world examples with ${geographicFocus || "location"} context
   - **Expertise (0-25):** Technical depth, industry terminology, complex concepts explained
   - **Authoritativeness (0-25):** Count citations, authority entities, statistics with sources and years
   - **Trustworthiness (0-25):** Factual accuracy, transparency, balanced perspective, uses 2024-2025 data

3. Local optimization:
   - Count mentions: ${geographicFocus || "city/location"}, ZIP codes, neighborhoods
   - Check if first 3 paragraphs have local signals
   - Count local regulation citations
   - Count authority entity citations (government, industry, local orgs)

**LAYER 2 - PASSAGE-LEVEL OPTIMIZATION:**
1. Parse ALL paragraphs (split by double newlines or paragraph breaks)
2. Opening paragraph (first substantial paragraph):
   - Count sentences
   - PASS if 8-12 sentences, FAIL otherwise
3. All OTHER paragraphs:
   - Count sentences in each
   - PASS if 3-5 sentences, FAIL otherwise
   - List ALL violations with paragraph index, sentence count, and excerpt (first 100 chars)
4. Self-contained check: Can each paragraph stand alone?
5. Detect filler phrases: "When it comes to", "It's important to note", "One of the most", etc.
6. Estimate active voice percentage

**LAYER 3 - CITATION OPTIMIZATION:**
1. Extract all H2 headings:
   - Count total H2s
   - Count question-based H2s (starting with "What", "How", "Why", "When", "Where", "Who")
2. Count H3 headings under each H2 (should be 2-3 max per H2)
3. FAQ validation:
   - Is there a FAQ section?
   - Count FAQ questions
   - Are questions natural language (not keyword-stuffed)?
4. Check for numbered step-by-step process
5. Check for comparison table or list
6. Evidence front-loading in first 3 paragraphs:
   - Paragraph 1: Has statistic with source?
   - Paragraph 2: Has authority entity citation?
   - Paragraph 3: Has local regulation or neighborhood data?

**EVIDENCE DENSITY:**
- Total citations count (any reference to source)
- Total statistics with numbers
- Total sources mentioned
- Year references (2024, 2025)
- Calculate average citations per paragraph

**RETURN THIS EXACT JSON STRUCTURE:**
{
  "overallScore": <0-100>,
  "answerFirst": {
    "score": <0-100>,
    "openingWordCount": <number>,
    "openingSentenceCount": <number>,
    "hasDirectAnswer": <boolean>,
    "frontLoadsEvidence": <boolean>,
    "includesStatistics": <boolean>,
    "isQuotable": <boolean>,
    "issues": ["<specific issue>", ...]
  },
  "eatSignals": {
    "score": <0-100>,
    "experience": {
      "score": <0-25>,
      "hasFirstHandEvidence": <boolean>,
      "hasCaseStudies": <boolean>,
      "hasRealWorldExamples": <boolean>,
      "count": <number of experience signals found>
    },
    "expertise": {
      "score": <0-25>,
      "hasTechnicalDepth": <boolean>,
      "usesIndustryTerms": <boolean>,
      "explainsComplexConcepts": <boolean>,
      "count": <number of expertise signals found>
    },
    "authoritativeness": {
      "score": <0-25>,
      "citationCount": <number>,
      "authorityEntityCount": <number>,
      "statisticCount": <number>,
      "hasSourcesWithYears": <boolean>,
      "count": <total authority signals>
    },
    "trustworthiness": {
      "score": <0-25>,
      "isFactual": <boolean>,
      "isTransparent": <boolean>,
      "isBalanced": <boolean>,
      "usesFreshData": <boolean>,
      "count": <number of trust signals found>
    },
    "issues": ["<specific E-E-A-T gap>", ...]
  },
  "localOptimization": {
    "score": <0-100>,
    "cityMentions": <number>,
    "zipCodeMentions": <number>,
    "neighborhoodMentions": <number>,
    "localRegulationCitations": <number>,
    "authorityEntityCitations": <number>,
    "firstThreeParagraphsHaveLocalSignals": <boolean>,
    "issues": ["<specific local SEO issue>", ...]
  },
  "passageQuality": {
    "score": <0-100>,
    "totalParagraphs": <number>,
    "openingParagraph": {
      "sentenceCount": <number>,
      "meetsRequirement": <boolean>,
      "issue": "<reason if failed>"
    },
    "otherParagraphs": {
      "compliantCount": <number>,
      "violationCount": <number>,
      "violations": [
        {
          "paragraphIndex": <number>,
          "sentenceCount": <number>,
          "excerpt": "<first 100 chars of paragraph>"
        }
      ]
    },
    "selfContainedCount": <number>,
    "fillerPhraseCount": <number>,
    "activeVoicePercentage": <0-100>,
    "issues": ["<specific passage issue>", ...]
  },
  "schemaReadiness": {
    "score": <0-100>,
    "questionBasedH2Count": <number>,
    "totalH2Count": <number>,
    "h2ToH3Ratio": <number>,
    "hasFAQSection": <boolean>,
    "faqQuestionCount": <number>,
    "hasNumberedProcess": <boolean>,
    "hasComparisonTable": <boolean>,
    "evidenceFrontLoading": {
      "paragraph1HasStatistic": <boolean>,
      "paragraph2HasAuthority": <boolean>,
      "paragraph3HasRegulation": <boolean>
    },
    "issues": ["<specific schema issue>", ...]
  },
  "evidenceDensity": {
    "score": <0-100>,
    "totalCitations": <number>,
    "totalStatistics": <number>,
    "totalSources": <number>,
    "citationsPerParagraph": <number>,
    "hasYearReferences": <boolean>,
    "evidenceQuality": "low" | "medium" | "high",
    "issues": ["<specific evidence issue>", ...]
  },
  "recommendations": [
    {
      "category": "critical" | "important" | "minor",
      "layer": "Layer 1 (Lily Ray)" | "Layer 2 (Mike King)" | "Layer 3 (Kevin Indig)",
      "issue": "<specific problem>",
      "fix": "<actionable solution>"
    }
  ]
}

Be thorough and specific. List ALL paragraph violations. Identify exact missing elements.`;

  const completion = await callOpenAI(
    (client) => client.chat.completions.create({
      model: "gpt-4.5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2, // Low temp for consistent analysis
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
    `Content Validator: ${title.substring(0, 50)}`
  );

  const responseText = completion.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(responseText);

  // Build result with defaults
  const result: ContentValidationResult = {
    overallScore: parsed.overallScore || 0,
    answerFirst: parsed.answerFirst || {
      score: 0,
      openingWordCount: 0,
      openingSentenceCount: 0,
      hasDirectAnswer: false,
      frontLoadsEvidence: false,
      includesStatistics: false,
      isQuotable: false,
      issues: [],
    },
    eatSignals: parsed.eatSignals || {
      score: 0,
      experience: { score: 0, hasFirstHandEvidence: false, hasCaseStudies: false, hasRealWorldExamples: false, count: 0 },
      expertise: { score: 0, hasTechnicalDepth: false, usesIndustryTerms: false, explainsComplexConcepts: false, count: 0 },
      authoritativeness: { score: 0, citationCount: 0, authorityEntityCount: 0, statisticCount: 0, hasSourcesWithYears: false, count: 0 },
      trustworthiness: { score: 0, isFactual: false, isTransparent: false, isBalanced: false, usesFreshData: false, count: 0 },
      issues: [],
    },
    localOptimization: parsed.localOptimization || {
      score: 0,
      cityMentions: 0,
      zipCodeMentions: 0,
      neighborhoodMentions: 0,
      localRegulationCitations: 0,
      authorityEntityCitations: 0,
      firstThreeParagraphsHaveLocalSignals: false,
      issues: [],
    },
    passageQuality: parsed.passageQuality || {
      score: 0,
      totalParagraphs: 0,
      openingParagraph: { sentenceCount: 0, meetsRequirement: false },
      otherParagraphs: { compliantCount: 0, violationCount: 0, violations: [] },
      selfContainedCount: 0,
      fillerPhraseCount: 0,
      activeVoicePercentage: 0,
      issues: [],
    },
    schemaReadiness: parsed.schemaReadiness || {
      score: 0,
      questionBasedH2Count: 0,
      totalH2Count: 0,
      h2ToH3Ratio: 0,
      hasFAQSection: false,
      faqQuestionCount: 0,
      hasNumberedProcess: false,
      hasComparisonTable: false,
      evidenceFrontLoading: { paragraph1HasStatistic: false, paragraph2HasAuthority: false, paragraph3HasRegulation: false },
      issues: [],
    },
    evidenceDensity: parsed.evidenceDensity || {
      score: 0,
      totalCitations: 0,
      totalStatistics: 0,
      totalSources: 0,
      citationsPerParagraph: 0,
      hasYearReferences: false,
      evidenceQuality: "low",
      issues: [],
    },
    recommendations: parsed.recommendations || [],
    tokenUsage: {
      promptTokens: completion.usage?.prompt_tokens || 0,
      completionTokens: completion.usage?.completion_tokens || 0,
      totalTokens: completion.usage?.total_tokens || 0,
    },
  };

  // Log comprehensive validation results
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 CONTENT VALIDATION REPORT - Overall Score: ${result.overallScore}/100`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  // Layer 1: Answer-First & E-E-A-T
  console.log(`\n📝 LAYER 1: ANSWER-FIRST & E-E-A-T (Lily Ray)`);
  console.log(`   Answer-First Score: ${result.answerFirst.score}/100`);
  console.log(`   Opening: ${result.passageQuality.openingParagraph.sentenceCount} sentences, ${result.answerFirst.openingWordCount} words ${result.passageQuality.openingParagraph.meetsRequirement ? '✅' : '❌'}`);
  console.log(`   E-E-A-T Score: ${result.eatSignals.score}/100`);
  console.log(`   ├─ Experience: ${result.eatSignals.experience.score}/25 (${result.eatSignals.experience.count} signals)`);
  console.log(`   ├─ Expertise: ${result.eatSignals.expertise.score}/25 (${result.eatSignals.expertise.count} signals)`);
  console.log(`   ├─ Authoritativeness: ${result.eatSignals.authoritativeness.score}/25 (${result.eatSignals.authoritativeness.citationCount} citations, ${result.eatSignals.authoritativeness.statisticCount} statistics)`);
  console.log(`   └─ Trustworthiness: ${result.eatSignals.trustworthiness.score}/25 (Fresh data: ${result.eatSignals.trustworthiness.usesFreshData ? '✅' : '❌'})`);
  console.log(`   Local Optimization: ${result.localOptimization.score}/100`);
  console.log(`   ├─ ${geographicFocus || 'City'}: ${result.localOptimization.cityMentions} mentions`);
  console.log(`   ├─ ZIP codes: ${result.localOptimization.zipCodeMentions} mentions`);
  console.log(`   ├─ Neighborhoods: ${result.localOptimization.neighborhoodMentions} mentions`);
  console.log(`   └─ First 3 paragraphs have local signals: ${result.localOptimization.firstThreeParagraphsHaveLocalSignals ? '✅' : '❌'}`);
  
  // Layer 2: Passage Quality
  console.log(`\n✂️  LAYER 2: PASSAGE-LEVEL OPTIMIZATION (Mike King)`);
  console.log(`   Passage Quality Score: ${result.passageQuality.score}/100`);
  console.log(`   Total Paragraphs: ${result.passageQuality.totalParagraphs}`);
  console.log(`   Opening: ${result.passageQuality.openingParagraph.sentenceCount} sentences ${result.passageQuality.openingParagraph.meetsRequirement ? '✅ (8-12 required)' : '❌ (8-12 required)'}`);
  console.log(`   Other Paragraphs: ${result.passageQuality.otherParagraphs.compliantCount}/${result.passageQuality.totalParagraphs - 1} compliant (3-5 sentences)`);
  if (result.passageQuality.otherParagraphs.violationCount > 0) {
    console.log(`   ⚠️  ${result.passageQuality.otherParagraphs.violationCount} paragraph violations:`);
    result.passageQuality.otherParagraphs.violations.slice(0, 5).forEach(v => {
      console.log(`      - Paragraph ${v.paragraphIndex}: ${v.sentenceCount} sentences - "${v.excerpt}..."`);
    });
    if (result.passageQuality.otherParagraphs.violations.length > 5) {
      console.log(`      ... and ${result.passageQuality.otherParagraphs.violations.length - 5} more`);
    }
  }
  console.log(`   Self-contained: ${result.passageQuality.selfContainedCount}/${result.passageQuality.totalParagraphs}`);
  console.log(`   Filler phrases detected: ${result.passageQuality.fillerPhraseCount}`);
  console.log(`   Active voice: ${result.passageQuality.activeVoicePercentage}%`);
  
  // Layer 3: Schema Readiness
  console.log(`\n🏗️  LAYER 3: CITATION OPTIMIZATION (Kevin Indig)`);
  console.log(`   Schema Readiness Score: ${result.schemaReadiness.score}/100`);
  console.log(`   Question-based H2s: ${result.schemaReadiness.questionBasedH2Count}/${result.schemaReadiness.totalH2Count} (${Math.round((result.schemaReadiness.questionBasedH2Count / Math.max(result.schemaReadiness.totalH2Count, 1)) * 100)}%)`);
  console.log(`   H2:H3 ratio: ${result.schemaReadiness.h2ToH3Ratio.toFixed(2)}`);
  console.log(`   FAQ section: ${result.schemaReadiness.hasFAQSection ? `✅ (${result.schemaReadiness.faqQuestionCount} questions)` : '❌'}`);
  console.log(`   Numbered process: ${result.schemaReadiness.hasNumberedProcess ? '✅' : '❌'}`);
  console.log(`   Comparison table: ${result.schemaReadiness.hasComparisonTable ? '✅' : '❌'}`);
  console.log(`   Evidence Front-Loading:`);
  console.log(`   ├─ P1 has statistic: ${result.schemaReadiness.evidenceFrontLoading.paragraph1HasStatistic ? '✅' : '❌'}`);
  console.log(`   ├─ P2 has authority: ${result.schemaReadiness.evidenceFrontLoading.paragraph2HasAuthority ? '✅' : '❌'}`);
  console.log(`   └─ P3 has regulation: ${result.schemaReadiness.evidenceFrontLoading.paragraph3HasRegulation ? '✅' : '❌'}`);
  
  // Evidence Density
  console.log(`\n📊 EVIDENCE DENSITY`);
  console.log(`   Score: ${result.evidenceDensity.score}/100 (${result.evidenceDensity.evidenceQuality} quality)`);
  console.log(`   Citations: ${result.evidenceDensity.totalCitations} (${result.evidenceDensity.citationsPerParagraph.toFixed(2)} per paragraph)`);
  console.log(`   Statistics: ${result.evidenceDensity.totalStatistics}`);
  console.log(`   Sources: ${result.evidenceDensity.totalSources}`);
  console.log(`   Fresh data (2024-2025): ${result.evidenceDensity.hasYearReferences ? '✅' : '❌'}`);
  
  // Recommendations
  if (result.recommendations.length > 0) {
    console.log(`\n💡 RECOMMENDATIONS (${result.recommendations.length} total):`);
    const critical = result.recommendations.filter(r => r.category === "critical");
    const important = result.recommendations.filter(r => r.category === "important");
    
    if (critical.length > 0) {
      console.log(`   🔴 CRITICAL (${critical.length}):`);
      critical.forEach(r => console.log(`      - [${r.layer}] ${r.issue}\n        Fix: ${r.fix}`));
    }
    if (important.length > 0) {
      console.log(`   🟡 IMPORTANT (${important.length}):`);
      important.slice(0, 3).forEach(r => console.log(`      - [${r.layer}] ${r.issue}\n        Fix: ${r.fix}`));
      if (important.length > 3) {
        console.log(`      ... and ${important.length - 3} more`);
      }
    }
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  return result;
}
