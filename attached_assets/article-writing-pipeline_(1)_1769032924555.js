/**
 * Multi-Agent Article Writing Pipeline
 * 
 * Architecture: Planner → Writer → Critic → Publisher
 * 
 * This system takes optimized topics from SmartTopicGenerator and produces
 * high-quality, factual, structured long-form content through a multi-agent approach.
 * 
 * Agents:
 * 1. Planner Agent - Creates detailed outlines with reasoning
 * 2. Writer Agent - Drafts content section-by-section (iterative)
 * 3. Critic Agent - Fact-checks and refines for quality
 * 4. Publisher Agent - Formats and exports final content
 * 
 * @requires @google/generative-ai, axios, fs
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class ArticleWritingPipeline {
  constructor(config = {}) {
    this.config = {
      geminiApiKey: config.geminiApiKey || process.env.GEMINI_API_KEY,
      braveApiKey: config.braveApiKey || process.env.BRAVE_SEARCH_API_KEY,
      
      // Agent configurations
      plannerTemp: config.plannerTemp || 0.7,    // Creative outlining
      writerTemp: config.writerTemp || 0.8,      // Natural writing
      criticTemp: config.criticTemp || 0.3,      // Precise fact-checking
      
      // Content settings
      targetWordCount: config.targetWordCount || 2000,
      parallelSections: config.parallelSections || true,
      humanReviewPauses: config.humanReviewPauses || false,
      
      // Output settings
      outputDir: config.outputDir || './articles',
      saveMetadata: config.saveMetadata || true,
    };

    // Initialize Gemini with different models for different agents
    this.genAI = new GoogleGenerativeAI(this.config.geminiApiKey);
    
    // Planner: Creative, strategic
    this.plannerModel = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: this.config.plannerTemp,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });
    
    // Writer: Natural, engaging
    this.writerModel = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: this.config.writerTemp,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });
    
    // Critic: Precise, factual
    this.criticModel = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: this.config.criticTemp,
        topP: 0.90,
        topK: 20,
        maxOutputTokens: 8192,
      }
    });

    this.pipeline = [];
    this.metrics = {
      startTime: null,
      endTime: null,
      tokensUsed: { planner: 0, writer: 0, critic: 0 },
      timeSpent: { planner: 0, writer: 0, critic: 0 },
    };
  }

  log(agent, message, data = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      agent,
      message,
      data,
    };
    this.pipeline.push(logEntry);
    console.log(`[${agent}] ${message}`);
    if (data) console.log(JSON.stringify(data, null, 2));
  }

  /**
   * Main Pipeline: Generate a complete article from topic data
   */
  async generateArticle(topicData, researchData = null) {
    this.metrics.startTime = Date.now();
    
    this.log('PIPELINE', '🚀 Starting Multi-Agent Article Writing Pipeline', {
      topic: topicData.title,
      targetWordCount: this.config.targetWordCount,
    });

    try {
      // Phase 1: Planner Agent - Create Outline
      this.log('PLANNER', '📋 Phase 1: Generating structured outline...');
      const outline = await this.plannerAgent(topicData, researchData);
      
      if (this.config.humanReviewPauses) {
        this.log('PIPELINE', '⏸️  HUMAN REVIEW REQUIRED: Please review outline');
        this.log('PIPELINE', 'Outline saved to: outline-review.json');
        await this.saveForReview(outline, 'outline');
        // In production, this would wait for human approval
      }

      // Phase 2: Writer Agent - Draft Content
      this.log('WRITER', '✍️  Phase 2: Drafting content sections...');
      const draft = await this.writerAgent(outline, topicData, researchData);
      
      if (this.config.humanReviewPauses) {
        this.log('PIPELINE', '⏸️  HUMAN REVIEW REQUIRED: Please review draft');
        await this.saveForReview(draft, 'draft');
      }

      // Phase 3: Critic Agent - Fact-Check & Refine
      this.log('CRITIC', '🔍 Phase 3: Fact-checking and refining...');
      const refined = await this.criticAgent(draft, outline, researchData);

      // Phase 4: Publisher Agent - Format & Export
      this.log('PUBLISHER', '📤 Phase 4: Publishing final article...');
      const published = await this.publisherAgent(refined, topicData, outline);

      this.metrics.endTime = Date.now();
      this.metrics.totalTime = this.metrics.endTime - this.metrics.startTime;

      return {
        success: true,
        article: published,
        metadata: this.generateMetadata(topicData, outline, refined),
        pipeline: this.pipeline,
        metrics: this.metrics,
      };

    } catch (error) {
      this.log('PIPELINE', '❌ Error in article generation', { error: error.message });
      throw error;
    }
  }

  /**
   * AGENT 1: Planner Agent
   * Creates a detailed outline with reasoning for each section
   */
  async plannerAgent(topicData, researchData) {
    const startTime = Date.now();
    
    const prompt = this.buildPlannerPrompt(topicData, researchData);
    
    try {
      const result = await this.plannerModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse planner output');
      }
      
      const outline = JSON.parse(jsonMatch[0]);
      
      // Validate outline structure
      this.validateOutline(outline);
      
      this.metrics.timeSpent.planner = Date.now() - startTime;
      this.log('PLANNER', '✅ Outline generated successfully', {
        sections: outline.sections.length,
        estimatedWords: outline.totalWordCount,
      });
      
      return outline;
      
    } catch (error) {
      this.log('PLANNER', '❌ Error in planner agent', { error: error.message });
      throw error;
    }
  }

  buildPlannerPrompt(topicData, researchData) {
    return `You are an expert content strategist and outline architect creating EDUCATIONAL, INFORMATIONAL content.

TOPIC TO PLAN:
Title: ${topicData.title}
Primary Keyword: ${topicData.primaryKeyword}
Secondary Keywords: ${topicData.secondaryKeywords.join(', ')}
Search Intent: ${topicData.searchIntent}
Target Audience: ${topicData.userJourneyStage} stage

${researchData ? `
RESEARCH DATA:
Competitor Gaps: ${JSON.stringify(researchData.competitorGaps || [], null, 2)}
Top-Ranking Patterns: ${JSON.stringify(researchData.contentPatterns || {}, null, 2)}
Unique Angles: ${JSON.stringify(researchData.uniqueAngles || [], null, 2)}
` : ''}

TARGET SPECS:
- Target Word Count: ${this.config.targetWordCount} words
- Optimize for: Traditional SEO + AI Search (ChatGPT, Perplexity, Google SGE)
- Content Type: Educational/Informational (like WebMD, Mayo Clinic, or medical journals)
- Tone: Objective, factual, helpful - NOT promotional

⚠️ CRITICAL CONTENT PHILOSOPHY ⚠️

This article must be PURELY EDUCATIONAL:
- Write like a medical journal, textbook, or educational health website
- Use objective, third-person perspective
- Focus on educating readers about the topic
- NO promotional content about any specific business, hospital, clinic, or provider
- NO marketing language ("leading", "best", "trusted", "choose us", "our services")
- Business names (hospitals, clinics) used ONLY for:
  * Geographic/location context
  * Citing published research or data
  * Explaining specific protocols as examples
- Treat all entities neutrally - journalist style, not marketer style

YOUR TASK:
Create a comprehensive article outline that:

1. **Addresses Competitor Gaps**: Each section should exploit weaknesses found in competitor content
2. **Follows User Intent**: Structure matches the search intent and user journey stage
3. **Includes Unique Angles**: Incorporates perspectives competitors haven't covered
4. **Optimized for Both Searches**: Works for traditional search AND AI-generated answers
5. **Strategic Word Distribution**: Allocates word count based on importance
6. **Educational Focus**: Prioritizes reader education over business promotion

OUTLINE STRUCTURE REQUIREMENTS:
- Introduction: Hook + context + what reader will learn (NO promotional content)
- Body Sections: Educational content addressing topic thoroughly
- Conclusion: Summary + key takeaways + CTA (ONLY section that includes call-to-action)

CRITICAL REQUIREMENTS:
- Each section must have a "reasoning" explaining WHY it's included
- Specify which competitor gap or unique angle each section addresses
- Include target word count for each section
- Provide guidance on tone, depth, and key points to cover
- Flag sections that need factual data vs. explanatory content
- Mark the conclusion section as the ONLY section where CTA is appropriate

Return JSON in this EXACT format:

{
  "title": "${topicData.title}",
  "totalWordCount": ${this.config.targetWordCount},
  "contentType": "educational_informational",
  "structure": "introduction → educational_sections → conclusion_with_cta",
  "seoStrategy": {
    "primaryKeywordPlacement": "where to emphasize main keyword",
    "semanticKeywords": ["related terms to naturally include"],
    "internalLinkOpportunities": ["topics to link to"]
  },
  "geoStrategy": {
    "optimizationFocus": "how to optimize for AI search",
    "answerFormat": "structure for AI snippet extraction",
    "structuredDataRecommendations": ["schema types to use"]
  },
  "sections": [
    {
      "id": "intro",
      "heading": "Engaging Introduction Title",
      "targetWordCount": 150,
      "reasoning": "Hooks reader and establishes credibility. Addresses search intent immediately.",
      "competitorGap": "Competitors don't address X in intro",
      "keyPoints": ["point 1", "point 2", "point 3"],
      "tone": "educational|informative|objective",
      "requiresFactualData": false,
      "allowPromotionalContent": false,
      "seoFocus": ["primary keyword usage", "hook for featured snippet"],
      "geoFocus": ["direct answer to query", "question format"]
    },
    {
      "id": "section-1",
      "heading": "First Main Educational Section",
      "targetWordCount": 300,
      "reasoning": "Addresses biggest competitor gap identified in research",
      "competitorGap": "No one covers the cost breakdown comprehensively",
      "keyPoints": ["detailed breakdown", "real examples", "actionable tips"],
      "tone": "objective|factual",
      "requiresFactualData": true,
      "allowPromotionalContent": false,
      "subsections": [
        {
          "subheading": "Subsection A",
          "wordCount": 150,
          "focus": "specific aspect to cover"
        }
      ],
      "seoFocus": ["secondary keyword naturally integrated"],
      "geoFocus": ["structured list format for AI extraction"]
    },
    {
      "id": "conclusion",
      "heading": "Conclusion and Next Steps",
      "targetWordCount": 200,
      "reasoning": "Summarizes key points and provides actionable next steps with appropriate CTA",
      "competitorGap": "Most articles lack clear actionable conclusion",
      "keyPoints": ["recap main takeaways", "next steps", "helpful CTA"],
      "tone": "helpful|actionable",
      "requiresFactualData": false,
      "allowPromotionalContent": true,
      "ctaGuidance": {
        "type": "soft|medium|hard",
        "suggestions": ["schedule consultation", "download guide", "contact specialist"],
        "placement": "natural conclusion after summary"
      },
      "seoFocus": ["reinforce primary keyword"],
      "geoFocus": ["clear actionable conclusion"]
    }
  ],
  "callToAction": {
    "placement": "conclusion section only",
    "type": "helpful_and_relevant",
    "guidelines": "CTA must be natural, helpful, and relevant. NOT pushy or salesy. Examples: 'If you're considering this procedure, schedule a consultation with a qualified specialist' or 'Download our free guide to learn more'"
  },
  "qualityChecks": {
    "mustInclude": ["factual information", "educational value", "actionable insights"],
    "mustAvoid": ["promotional language in body sections", "AI clichés", "marketing speak", "business endorsements"],
    "contentApproach": "educational_journal_style",
    "factCheckRequired": ["all statistics", "medical claims", "procedure details"]
  }
}

Generate a strategic, comprehensive outline now.`;
  }

  validateOutline(outline) {
    if (!outline.sections || !Array.isArray(outline.sections)) {
      throw new Error('Outline must have sections array');
    }
    
    if (outline.sections.length < 3) {
      throw new Error('Outline must have at least 3 sections');
    }

    let totalWords = 0;
    for (const section of outline.sections) {
      if (!section.heading || !section.targetWordCount || !section.reasoning) {
        throw new Error('Each section must have heading, targetWordCount, and reasoning');
      }
      totalWords += section.targetWordCount;
    }

    this.log('PLANNER', 'Outline validation passed', { 
      sections: outline.sections.length,
      totalWords 
    });
  }

  /**
   * AGENT 2: Writer Agent
   * Drafts content section-by-section using the "sandwich method"
   */
  async writerAgent(outline, topicData, researchData) {
    const startTime = Date.now();
    
    this.log('WRITER', 'Starting section-by-section drafting', {
      totalSections: outline.sections.length,
      parallelMode: this.config.parallelSections,
    });

    const draft = {
      title: outline.title,
      sections: [],
      metadata: {
        wordCount: 0,
        generatedAt: new Date().toISOString(),
      },
    };

    if (this.config.parallelSections) {
      // Parallel drafting for speed
      const sectionPromises = outline.sections.map((section, index) =>
        this.draftSection(section, outline, topicData, researchData, index)
      );
      
      draft.sections = await Promise.all(sectionPromises);
      
    } else {
      // Sequential drafting with context from previous sections
      let previousContext = '';
      
      for (let i = 0; i < outline.sections.length; i++) {
        const section = outline.sections[i];
        const draftedSection = await this.draftSection(
          section,
          outline,
          topicData,
          researchData,
          i,
          previousContext
        );
        
        draft.sections.push(draftedSection);
        previousContext = draftedSection.content.substring(0, 500); // Keep context
      }
    }

    // Calculate total word count
    draft.metadata.wordCount = draft.sections.reduce(
      (sum, section) => sum + section.wordCount,
      0
    );

    this.metrics.timeSpent.writer = Date.now() - startTime;
    this.log('WRITER', '✅ Draft completed', {
      sections: draft.sections.length,
      totalWords: draft.metadata.wordCount,
    });

    return draft;
  }

  async draftSection(section, outline, topicData, researchData, index, previousContext = '') {
    this.log('WRITER', `Drafting: ${section.heading}`);

    const prompt = this.buildWriterPrompt(
      section,
      outline,
      topicData,
      researchData,
      previousContext
    );

    try {
      const result = await this.writerModel.generateContent(prompt);
      const response = await result.response;
      const content = response.text();

      // Extract JSON if present, otherwise use raw content
      let finalContent = content;
      const jsonMatch = content.match(/\{[\s\S]*"content"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        finalContent = parsed.content;
      }

      // Clean up any JSON artifacts
      finalContent = finalContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      finalContent = finalContent.replace(/^\{[\s\S]*"content":\s*"/, '').replace(/"[\s\S]*\}$/, '');

      const wordCount = finalContent.split(/\s+/).length;

      return {
        id: section.id,
        heading: section.heading,
        content: finalContent.trim(),
        wordCount,
        targetWordCount: section.targetWordCount,
        reasoning: section.reasoning,
        competitorGap: section.competitorGap,
        metadata: {
          index,
          draftedAt: new Date().toISOString(),
          tone: section.tone,
        },
      };

    } catch (error) {
      this.log('WRITER', `❌ Error drafting section: ${section.heading}`, { error: error.message });
      throw error;
    }
  }

  buildWriterPrompt(section, outline, topicData, researchData, previousContext) {
    const isCTASection = section.id === 'conclusion' || section.id.includes('cta') || 
                         (section.heading && section.heading.toLowerCase().includes('conclusion'));
    
    return `You are an expert ${topicData.industry || 'content'} writer creating EDUCATIONAL, INFORMATIONAL content.

ARTICLE CONTEXT:
Title: ${outline.title}
Overall Strategy: ${outline.structure}
Current Section: ${section.heading} (Section ${section.id})

SECTION REQUIREMENTS:
Target Word Count: ${section.targetWordCount} words
Reasoning: ${section.reasoning}
Competitor Gap to Address: ${section.competitorGap || 'N/A'}
Tone: ${section.tone}
Requires Factual Data: ${section.requiresFactualData ? 'YES - Include specific facts, stats, or examples' : 'NO - Focus on explanation and guidance'}

KEY POINTS TO COVER:
${section.keyPoints ? section.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n') : 'Use your expertise to determine key points'}

${previousContext ? `
PREVIOUS SECTION CONTEXT (for flow):
${previousContext}
` : ''}

${researchData && researchData.uniqueAngles ? `
UNIQUE ANGLES TO INCORPORATE:
${researchData.uniqueAngles.slice(0, 3).join('\n')}
` : ''}

SEO OPTIMIZATION:
${section.seoFocus ? section.seoFocus.join(', ') : 'Natural keyword integration'}

GEO OPTIMIZATION (for AI search):
${section.geoFocus ? section.geoFocus.join(', ') : 'Clear, structured format'}

${section.subsections ? `
SUBSECTIONS TO COVER:
${section.subsections.map(sub => `- ${sub.subheading} (${sub.wordCount} words): ${sub.focus}`).join('\n')}
` : ''}

⚠️ CRITICAL CONTENT GUIDELINES - MUST FOLLOW ⚠️

${isCTASection ? `
THIS IS A CONCLUSION/CTA SECTION - Include appropriate call-to-action:
- Summarize key takeaways
- Include clear next steps or action items
- CTA should be relevant and helpful (e.g., "schedule a consultation", "download a guide", "contact us")
- Keep CTA natural and non-pushy
` : `
THIS IS AN INFORMATIONAL SECTION - NO PROMOTIONAL CONTENT:
- Write PURELY educational, objective content
- NO promotional language about any company, brand, or business
- NO marketing speak ("leading provider", "industry leader", "trusted partner", "choose us")
- NO recommendations to "contact", "visit", "call", or "choose" any specific business
- If a business name is mentioned (e.g., hospital, clinic), use it ONLY for:
  * Factual context (location reference)
  * Citing published research or data
  * Explaining specific procedures/protocols as examples
- Treat ALL entities neutrally - like a journalist, not a marketer
`}

TONE REQUIREMENTS:
- Write like a medical journal, textbook, or educational website (e.g., WebMD, Mayo Clinic Health Library)
- Objective, fact-based, helpful
- Third-person perspective (avoid "we", "our", "us" unless citing published sources)
- Focus on educating the reader, not promoting any entity

CONTENT STRUCTURE:
1. Write EXACTLY ~${section.targetWordCount} words (±10%)
2. Use the tone: ${section.tone}
3. Address the competitor gap: ${section.competitorGap}
4. Include specific examples, statistics, and facts
5. Write in a natural, human voice
6. Use clear subheadings (H3) if subsections are specified
7. Make content scannable with short paragraphs (2-3 sentences max)
8. Include transition sentences to connect ideas

❌ STRICTLY FORBIDDEN:
- "delve into", "in today's world", "it's important to note", "in conclusion"
- "leading", "best", "top-rated", "trusted" (when describing specific entities)
- "contact us", "visit us", "call us", "schedule with us" (unless in CTA section)
- "our team", "our facility", "we offer", "we provide" (promotional language)
- Testimonials, success stories, or patient endorsements (unless from published studies)
- Comparisons that favor one entity over others
- Statements like "X Hospital is known for excellence" (promotional)

✅ APPROVED LANGUAGE EXAMPLES:
- "According to a 2023 study published by [institution]..."
- "The procedure typically involves..."
- "Patients generally experience..."
- "Research indicates..."
- "Common approaches include..."
- "When choosing a provider, consider factors such as..."

MARKDOWN FORMAT:
- Use ## for section heading
- Use ### for subsections
- Use **bold** for emphasis (sparingly)
- Use bullet points or numbered lists where appropriate
- Use > blockquotes for key medical facts or statistics

Write the section content now. Return ONLY the Markdown content, no JSON, no explanations.`;
  }
  }

  /**
   * AGENT 3: Critic Agent
   * Fact-checks, refines, and eliminates AI-ness
   */
  async criticAgent(draft, outline, researchData) {
    const startTime = Date.now();
    
    this.log('CRITIC', 'Starting comprehensive review', {
      sections: draft.sections.length,
      totalWords: draft.metadata.wordCount,
    });

    const critique = {
      overallAssessment: null,
      sectionReviews: [],
      factCheckResults: [],
      aiClicheDetections: [],
      improvements: [],
      refinedDraft: null,
    };

    // Step 1: Overall Assessment
    critique.overallAssessment = await this.assessOverallQuality(draft, outline);

    // Step 2: Fact-Check Each Section
    for (const section of draft.sections) {
      const factCheck = await this.factCheckSection(section, researchData);
      critique.factCheckResults.push(factCheck);
    }

    // Step 3: Detect AI Clichés
    critique.aiClicheDetections = this.detectAICliches(draft);

    // Step 4: Generate Improvements
    critique.improvements = await this.generateImprovements(
      draft,
      outline,
      critique.factCheckResults,
      critique.aiClicheDetections
    );

    // Step 5: Apply Refinements
    critique.refinedDraft = await this.applyRefinements(draft, critique.improvements);

    this.metrics.timeSpent.critic = Date.now() - startTime;
    this.log('CRITIC', '✅ Review completed', {
      issuesFound: critique.improvements.length,
      clichesDetected: critique.aiClicheDetections.length,
    });

    return critique;
  }

  async assessOverallQuality(draft, outline) {
    const fullText = draft.sections.map(s => s.content).join('\n\n');

    const prompt = `You are a senior editor reviewing an article for quality, accuracy, and readability.

ARTICLE TO REVIEW:
Title: ${draft.title}
Word Count: ${draft.metadata.wordCount}
Target: ${outline.totalWordCount}

${draft.sections.map(s => `
## ${s.heading}
${s.content}
`).join('\n')}

REVIEW CRITERIA:
1. Factual Accuracy: Are claims substantiated? Any hallucinations?
2. Structure & Flow: Does it follow logical progression?
3. Readability: Is it engaging and scannable?
4. SEO Optimization: Are keywords naturally integrated?
5. AI Detection: Does it sound human or AI-generated?
6. Completeness: Does it deliver on the title's promise?
7. Uniqueness: Does it offer new insights?

Provide assessment in JSON:

{
  "overallScore": 0-100,
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "factualConcerns": ["any claims that seem unsupported"],
  "aiLikePatterns": ["phrases that sound AI-generated"],
  "structuralIssues": ["flow or organization problems"],
  "readabilityScore": 0-100,
  "seoScore": 0-100,
  "recommendation": "publish_as_is | minor_revisions | major_revisions"
}`;

    try {
      const result = await this.criticModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return { overallScore: 70, recommendation: 'minor_revisions' };

    } catch (error) {
      this.log('CRITIC', 'Error in overall assessment', { error: error.message });
      return { overallScore: 70, recommendation: 'minor_revisions' };
    }
  }

  async factCheckSection(section, researchData) {
    // Check for specific factual claims
    const factualClaims = this.extractFactualClaims(section.content);

    if (factualClaims.length === 0) {
      return {
        section: section.heading,
        claimsFound: 0,
        allVerified: true,
        issues: [],
      };
    }

    // In production, this would verify against research data or search results
    const issues = [];
    
    for (const claim of factualClaims) {
      // Check if claim has supporting evidence in research data
      const hasEvidence = this.checkEvidenceForClaim(claim, researchData);
      
      if (!hasEvidence) {
        issues.push({
          claim,
          issue: 'No supporting evidence found in research',
          severity: 'high',
          recommendation: 'Verify or remove this claim',
        });
      }
    }

    return {
      section: section.heading,
      claimsFound: factualClaims.length,
      allVerified: issues.length === 0,
      issues,
    };
  }

  extractFactualClaims(content) {
    const claims = [];
    
    // Patterns that indicate factual claims
    const patterns = [
      /\d+%/g,                    // Percentages
      /\d+\s+(million|billion|thousand)/gi,  // Large numbers
      /according to/gi,           // Citations
      /studies show/gi,           // Research claims
      /research indicates/gi,     // Research claims
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        claims.push(...matches);
      }
    }

    return [...new Set(claims)]; // Deduplicate
  }

  checkEvidenceForClaim(claim, researchData) {
    if (!researchData) return false;
    
    // Simple check: does research data mention similar numbers or facts?
    const researchText = JSON.stringify(researchData).toLowerCase();
    const claimLower = claim.toLowerCase();
    
    return researchText.includes(claimLower);
  }

  detectAICliches(draft) {
    const cliches = [
      // AI writing clichés
      'delve into',
      'dive deep',
      'in today\'s world',
      'in today\'s digital age',
      'it\'s important to note',
      'it\'s worth noting',
      'in conclusion',
      'to summarize',
      'at the end of the day',
      'game-changer',
      'unlock',
      'revolutionize',
      'cutting-edge',
      'state-of-the-art',
      'best practices',
      'leverage',
      'holistic approach',
      'paradigm shift',
      
      // Promotional/marketing language (should only appear in CTA section)
      'leading provider',
      'industry leader',
      'trusted partner',
      'top-rated',
      'award-winning',
      'world-class',
      'premier',
      'exceptional care',
      'unparalleled',
      'second to none',
      'choose us',
      'contact us today',
      'call us now',
      'our team',
      'our services',
      'we offer',
      'we provide',
      'our facility',
      'our practice',
      'why choose',
    ];

    const detected = [];
    const fullText = draft.sections.map(s => s.content).join(' ');

    for (const cliche of cliches) {
      const regex = new RegExp(cliche, 'gi');
      const matches = fullText.match(regex);
      if (matches) {
        // Determine if this is in a CTA section
        const ctaSections = draft.sections.filter(s => 
          s.id === 'conclusion' || 
          s.id.includes('cta') || 
          (s.heading && s.heading.toLowerCase().includes('conclusion'))
        );
        
        const ctaText = ctaSections.map(s => s.content).join(' ');
        const ctaMatches = ctaText.match(regex);
        const nonCtaMatches = matches.length - (ctaMatches ? ctaMatches.length : 0);
        
        detected.push({
          cliche,
          count: matches.length,
          inCTA: ctaMatches ? ctaMatches.length : 0,
          outsideCTA: nonCtaMatches,
          severity: nonCtaMatches > 2 ? 'high' : (nonCtaMatches > 0 ? 'medium' : 'low'),
        });
      }
    }

    return detected;
  }

  async generateImprovements(draft, outline, factCheckResults, clicheDetections) {
    const improvements = [];

    // Fact-check issues
    for (const result of factCheckResults) {
      if (!result.allVerified) {
        for (const issue of result.issues) {
          improvements.push({
            type: 'factual',
            section: result.section,
            issue: issue.issue,
            severity: issue.severity,
            recommendation: issue.recommendation,
            original: issue.claim,
          });
        }
      }
    }

    // AI cliché replacements
    for (const detection of clicheDetections) {
      if (detection.severity === 'high') {
        improvements.push({
          type: 'style',
          issue: `Overuse of AI cliché: "${detection.cliche}"`,
          severity: 'medium',
          recommendation: `Replace or remove (found ${detection.count} times)`,
          original: detection.cliche,
        });
      }
    }

    return improvements;
  }

  async applyRefinements(draft, improvements) {
    // Create a refined copy
    const refined = JSON.parse(JSON.stringify(draft));

    // Apply style improvements (remove clichés and promotional content)
    const styleImprovements = improvements.filter(i => i.type === 'style');
    
    for (const section of refined.sections) {
      let content = section.content;
      
      // Check if this is a CTA section (promotional language allowed here)
      const isCTASection = section.id === 'conclusion' || 
                          section.id.includes('cta') ||
                          (section.heading && section.heading.toLowerCase().includes('conclusion'));
      
      for (const improvement of styleImprovements) {
        // For promotional language, only remove if outside CTA section
        if (improvement.original.match(/our |we |us |choose|contact|leading|trusted|premier/i)) {
          if (!isCTASection) {
            // Remove promotional content from non-CTA sections
            const regex = new RegExp(improvement.original, 'gi');
            content = content.replace(regex, '');
          }
        } else {
          // Remove all other AI clichés regardless of section
          const regex = new RegExp(improvement.original, 'gi');
          content = content.replace(regex, '');
        }
      }
      
      section.content = content.trim();
      section.refined = true;
      section.isCTASection = isCTASection;
    }

    // Flag factual issues for human review
    refined.metadata.factualIssues = improvements.filter(i => i.type === 'factual');
    refined.metadata.promotionalIssues = improvements.filter(i => 
      i.type === 'style' && 
      i.issue.includes('promotional') || i.issue.includes('marketing')
    );

    return refined;
  }

  /**
   * AGENT 4: Publisher Agent
   * Formats and exports the final article
   */
  async publisherAgent(refined, topicData, outline) {
    const startTime = Date.now();
    
    this.log('PUBLISHER', 'Formatting and exporting article');

    const published = {
      content: {
        markdown: '',
        html: '',
      },
      metadata: {},
      files: {},
    };

    // Generate Markdown
    published.content.markdown = this.generateMarkdown(refined, topicData, outline);

    // Generate HTML (basic conversion)
    published.content.html = this.markdownToHtml(published.content.markdown);

    // Generate metadata JSON
    published.metadata = this.generatePublishMetadata(refined, topicData, outline);

    // Save files
    await this.ensureOutputDir();
    
    const slug = this.generateSlug(topicData.title);
    const timestamp = Date.now();

    // Save Markdown
    const mdPath = path.join(this.config.outputDir, `${slug}-${timestamp}.md`);
    await fs.writeFile(mdPath, published.content.markdown);
    published.files.markdown = mdPath;

    // Save HTML
    const htmlPath = path.join(this.config.outputDir, `${slug}-${timestamp}.html`);
    await fs.writeFile(htmlPath, published.content.html);
    published.files.html = htmlPath;

    // Save metadata JSON
    if (this.config.saveMetadata) {
      const metaPath = path.join(this.config.outputDir, `${slug}-${timestamp}-metadata.json`);
      await fs.writeFile(metaPath, JSON.stringify(published.metadata, null, 2));
      published.files.metadata = metaPath;
    }

    // Save pipeline reasoning JSON
    const pipelinePath = path.join(this.config.outputDir, `${slug}-${timestamp}-pipeline.json`);
    await fs.writeFile(pipelinePath, JSON.stringify({
      pipeline: this.pipeline,
      metrics: this.metrics,
    }, null, 2));
    published.files.pipeline = pipelinePath;

    this.log('PUBLISHER', '✅ Article published', {
      files: Object.keys(published.files).length,
      wordCount: refined.metadata.wordCount,
    });

    return published;
  }

  generateMarkdown(refined, topicData, outline) {
    let markdown = `# ${refined.title}\n\n`;
    
    // Add metadata comment
    markdown += `<!-- \n`;
    markdown += `Generated: ${new Date().toISOString()}\n`;
    markdown += `Word Count: ${refined.metadata.wordCount}\n`;
    markdown += `Primary Keyword: ${topicData.primaryKeyword}\n`;
    markdown += `-->\n\n`;

    // Add sections
    for (const section of refined.sections) {
      markdown += `## ${section.heading}\n\n`;
      markdown += `${section.content}\n\n`;
      
      // Add reasoning as HTML comment (for editors)
      markdown += `<!-- Section Reasoning: ${section.reasoning} -->\n`;
      if (section.competitorGap) {
        markdown += `<!-- Addresses Gap: ${section.competitorGap} -->\n`;
      }
      markdown += `\n`;
    }

    return markdown;
  }

  markdownToHtml(markdown) {
    // Basic Markdown to HTML conversion
    // In production, use a proper markdown parser like 'marked'
    let html = markdown;
    
    // Headers
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Lists
    html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // Paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<p>${html}</p>`;
    
    // Clean up
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    
    return html;
  }

  generatePublishMetadata(refined, topicData, outline) {
    return {
      title: refined.title,
      slug: this.generateSlug(refined.title),
      generatedAt: new Date().toISOString(),
      
      content: {
        wordCount: refined.metadata.wordCount,
        targetWordCount: outline.totalWordCount,
        variance: Math.abs(refined.metadata.wordCount - outline.totalWordCount),
        sections: refined.sections.length,
      },
      
      seo: {
        primaryKeyword: topicData.primaryKeyword,
        secondaryKeywords: topicData.secondaryKeywords,
        searchIntent: topicData.searchIntent,
        optimizationScore: topicData.scores?.seo || null,
      },
      
      geo: {
        optimizationScore: topicData.scores?.geo || null,
        strategy: outline.geoStrategy,
      },
      
      quality: {
        factualIssues: refined.metadata.factualIssues?.length || 0,
        refinementApplied: refined.sections[0]?.refined || false,
      },
      
      outline: {
        structure: outline.structure,
        sections: outline.sections.map(s => ({
          id: s.id,
          heading: s.heading,
          reasoning: s.reasoning,
          targetWords: s.targetWordCount,
        })),
      },
    };
  }

  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 60);
  }

  async ensureOutputDir() {
    try {
      await fs.access(this.config.outputDir);
    } catch {
      await fs.mkdir(this.config.outputDir, { recursive: true });
    }
  }

  async saveForReview(data, type) {
    const reviewPath = path.join(this.config.outputDir, `${type}-review.json`);
    await fs.writeFile(reviewPath, JSON.stringify(data, null, 2));
  }

  generateMetadata(topicData, outline, refined) {
    return {
      topic: topicData,
      outline: {
        sections: outline.sections.length,
        totalTargetWords: outline.totalWordCount,
      },
      draft: {
        actualWords: refined.refinedDraft?.metadata?.wordCount || 0,
        sections: refined.refinedDraft?.sections?.length || 0,
      },
      quality: {
        overallScore: refined.overallAssessment?.overallScore || 0,
        recommendation: refined.overallAssessment?.recommendation || 'unknown',
        factualIssues: refined.factCheckResults?.filter(r => !r.allVerified).length || 0,
        aiCliches: refined.aiClicheDetections?.length || 0,
      },
      pipeline: {
        agents: ['planner', 'writer', 'critic', 'publisher'],
        totalTime: this.metrics.totalTime,
        timeBreakdown: this.metrics.timeSpent,
      },
    };
  }
}

module.exports = ArticleWritingPipeline;
