import { db } from "./db";
import { eq, and, desc, gte, sql, asc } from "drizzle-orm";
import {
  learningAgents,
  learningPatterns,
  patternDimensionStats,
  contentPerformanceMetrics,
  agentOptimizationLogs,
  aiLearningLedger,
  ContentType,
} from "../shared/schema";
import {
  GEMINI_ARTICLE_MODEL,
  GEMINI_FLASH_MODEL,
  GPT_ENHANCEMENT_MODEL,
  TTS_MODEL,
  VEO_VIDEO_MODEL,
} from "./ai-config";
import { factStore } from "./fact-store";
import { getFactCoverageReport } from "./fact-validated-generators";
import { 
  humanizeContent, 
  analyzeContentQuality, 
  HumanizationConfig,
  HumanizationResult 
} from "./deterministic-humanizer";

const EMA_ALPHA = 0.1;
const MIN_CONFIDENCE_SAMPLES = 5;
const EPSILON = 0.15; // exploration fraction for epsilon-greedy

// Wilson lower-bound (95% CI) — same formula as content-review-service
function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials === 0) return 0;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials);
  return Math.max(0, Math.round(((center - margin) / denom) * 100));
}

export interface LearnedPattern {
  id: number;
  patternType: string;
  patternName: string;
  patternValue: string;
  successRate: number;
  confidence: number;
}

export interface OptimizationContext {
  agentId: number;
  contentType: string;
  patterns: LearnedPattern[];
  promptEnhancements: string[];
  negativeConstraints?: string[];
  humanizationGuidelines?: string[];
  modelConfig: {
    model: string;
    temperature: number;
  };
}

export class LearningService {
  private static instance: LearningService;

  static getInstance(): LearningService {
    if (!LearningService.instance) {
      LearningService.instance = new LearningService();
    }
    return LearningService.instance;
  }

  async initializeDefaultAgents(teamId: number): Promise<void> {
    const agentConfigs = [
      {
        contentType: ContentType.ARTICLE,
        name: "Article Optimization Agent",
        description: "Learns optimal title styles, opening hooks, E-E-A-T signals, and content structures that drive engagement",
        primaryModel: GEMINI_ARTICLE_MODEL,
        fallbackModel: GPT_ENHANCEMENT_MODEL,
      },
      {
        contentType: ContentType.VIDEO,
        name: "Video Script Agent",
        description: "Learns hooks, pacing, visual styles, and CTAs that maximize video engagement",
        primaryModel: GEMINI_FLASH_MODEL,
        fallbackModel: GPT_ENHANCEMENT_MODEL,
      },
      {
        contentType: ContentType.SOCIAL,
        name: "Social Media Agent",
        description: "Learns tone, hashtag strategies, and post structures that drive shares and engagement",
        primaryModel: GEMINI_FLASH_MODEL,
        fallbackModel: GPT_ENHANCEMENT_MODEL,
      },
      {
        contentType: ContentType.PODCAST,
        name: "Podcast Script Agent",
        description: "Learns conversational patterns, pacing, and hooks for engaging audio content",
        primaryModel: GEMINI_FLASH_MODEL,
        fallbackModel: GPT_ENHANCEMENT_MODEL,
      },
      {
        contentType: ContentType.IMAGE,
        name: "Image Generation Agent",
        description: "Learns visual styles, compositions, and prompts that create compelling images",
        primaryModel: GEMINI_FLASH_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
      },
    ];

    for (const config of agentConfigs) {
      const existing = await db
        .select()
        .from(learningAgents)
        .where(
          and(
            eq(learningAgents.teamId, teamId),
            eq(learningAgents.contentType, config.contentType)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(learningAgents).values({
          teamId,
          ...config,
        });
        console.log(`✅ Initialized ${config.name} for team ${teamId}`);
      }
    }
  }

  async getAgentForContentType(
    teamId: number,
    contentType: string
  ): Promise<typeof learningAgents.$inferSelect | null> {
    const agents = await db
      .select()
      .from(learningAgents)
      .where(
        and(
          eq(learningAgents.teamId, teamId),
          eq(learningAgents.contentType, contentType),
          eq(learningAgents.isActive, 1)
        )
      )
      .limit(1);

    return agents[0] || null;
  }

  async getOptimizationContext(
    teamId: number,
    contentType: string,
    options?: {
      industry?: string;
      audience?: string;
      patternTypes?: string[];
    }
  ): Promise<OptimizationContext | null> {
    const agent = await this.getAgentForContentType(teamId, contentType);
    if (!agent) {
      console.log(`⚠️ No learning agent found for ${contentType}, initializing...`);
      await this.initializeDefaultAgents(teamId);
      const newAgent = await this.getAgentForContentType(teamId, contentType);
      if (!newAgent) return null;
      return this.buildOptimizationContext(newAgent, options);
    }

    return this.buildOptimizationContext(agent, options);
  }

  private async buildOptimizationContext(
    agent: typeof learningAgents.$inferSelect,
    options?: {
      industry?: string;
      audience?: string;
      patternTypes?: string[];
    }
  ): Promise<OptimizationContext> {
    // Fetch ALL patterns for this agent — no confidence gate here.
    // Seeded patterns start at confidence=0 but are still valid for exploration.
    // Defense-in-depth: scope by both agentId AND teamId so a spoofed agentId
    // cannot leak patterns across team boundaries.
    const allPatterns = await db
      .select()
      .from(learningPatterns)
      .where(
        and(
          eq(learningPatterns.agentId, agent.id),
          eq(learningPatterns.teamId, agent.teamId)
        )
      )
      .limit(100);

    if (allPatterns.length === 0) {
      return {
        agentId: agent.id,
        contentType: agent.contentType,
        patterns: [],
        promptEnhancements: [],
        negativeConstraints: [],
        modelConfig: { model: agent.primaryModel, temperature: agent.temperature / 100 },
      };
    }

    // Fetch engagement Wilson scores for all patterns
    const patternIds = allPatterns.map(p => p.id);
    const dimStats = await db
      .select()
      .from(patternDimensionStats)
      .where(
        and(
          eq(patternDimensionStats.dimension, "engagement"),
          sql`${patternDimensionStats.patternId} = ANY(ARRAY[${sql.join(patternIds.map(id => sql`${id}`), sql`, `)}]::int[])`
        )
      );
    const wilsonById = new Map(dimStats.map(s => [s.patternId, s.wilsonScore]));

    // Separate patterns with Wilson data (proven) from untested ones (exploratory)
    const proven = allPatterns.filter(p => wilsonById.has(p.id));
    const untested = allPatterns.filter(p => !wilsonById.has(p.id));

    // Sort proven by Wilson score descending
    proven.sort((a, b) => (wilsonById.get(b.id) ?? 0) - (wilsonById.get(a.id) ?? 0));

    // Epsilon-greedy: 15% of slots go to random untested patterns for exploration
    const totalSlots = 8;
    const exploreSlots = Math.max(1, Math.round(totalSlots * EPSILON));
    const exploitSlots = totalSlots - exploreSlots;

    const exploited = proven.slice(0, exploitSlots);
    const explored = untested.sort(() => Math.random() - 0.5).slice(0, exploreSlots);
    const selected = [...exploited, ...explored];

    const learnedPatterns: LearnedPattern[] = selected.map(p => ({
      id: p.id,
      patternType: p.patternType,
      patternName: p.patternName,
      patternValue: p.patternValue,
      successRate: p.successRate,
      confidence: wilsonById.has(p.id) ? (wilsonById.get(p.id) ?? p.confidence) : p.confidence,
    }));

    // Collect negative constraints from error ledger
    const negativeConstraints = await this.collectNegativeConstraints(agent.teamId!, agent.contentType);

    const promptEnhancements = this.buildPromptEnhancements(learnedPatterns);

    return {
      agentId: agent.id,
      contentType: agent.contentType,
      patterns: learnedPatterns,
      promptEnhancements,
      negativeConstraints,
      modelConfig: {
        model: agent.primaryModel,
        temperature: agent.temperature / 100,
      },
    };
  }

  private async collectNegativeConstraints(teamId: number, contentType: string): Promise<string[]> {
    const NEGATIVE_MAP: Record<string, string> = {
      "COMPLETENESS:TRUNCATED": "Finish every section. Never end mid-thought.",
      "COMPLETENESS:UNANSWERED_BRIEF": "Answer every question stated in the brief.",
      "COMPLETENESS:THIN_SECTION": "Each H2 section must have at least 120 words.",
      "FACTUALITY:UNSUPPORTED_CLAIM": "Only state statistics you can ground in provided facts.",
      "FACTUALITY:FAKE_CITATION": "Do not invent citations, URLs, or named sources.",
      "STRUCTURE:MISSING_FAQ": "Always include a FAQ section with 3+ questions.",
      "STRUCTURE:NO_ANSWER_FIRST": "Open with a direct answer containing the target keyword.",
      "HUMANNESS:AI_ISMS": "Avoid AI-isms (leverage, dive into, it's worth noting).",
      "HUMANNESS:LOW_BURSTINESS": "Vary sentence length sharply — mix short and long sentences.",
      "CHANNEL:WEAK_HOOK": "Lead with a hook that engages in the first 3 seconds.",
      "CHANNEL:NO_CTA": "End with a clear, natural call to action.",
    };

    try {
      const rows = await db
        .select()
        .from(aiLearningLedger)
        .where(and(eq(aiLearningLedger.teamId, teamId), eq(aiLearningLedger.contentType, contentType)))
        .orderBy(desc(aiLearningLedger.count))
        .limit(5);

      return rows
        .map(r => NEGATIVE_MAP[r.errorType])
        .filter((v): v is string => Boolean(v));
    } catch {
      return [];
    }
  }

  private buildPromptEnhancements(patterns: LearnedPattern[]): string[] {
    const enhancements: string[] = [];
    const patternsByType = patterns.reduce((acc, p) => {
      if (!acc[p.patternType]) acc[p.patternType] = [];
      acc[p.patternType]!.push(p);
      return acc;
    }, {} as Record<string, LearnedPattern[]>);

    for (const [type, typePatterns] of Object.entries(patternsByType)) {
      if (typePatterns.length > 0) {
        const topPattern = typePatterns[0]!;
        const isProven = topPattern.confidence >= 50;
        enhancements.push(
          isProven
            ? `[LEARNED - ${type.toUpperCase()}] ${topPattern.patternValue} (${topPattern.successRate}% success)`
            : `[EXPLORING - ${type.toUpperCase()}] Try: ${topPattern.patternValue}`
        );
      }
    }
    return enhancements;
  }

  async recordContentGeneration(
    teamId: number,
    agentId: number,
    contentType: string,
    contentId: number,
    patternsUsed: number[],
    qualityScore: number
  ): Promise<number> {
    const [metricRow] = await db
      .insert(contentPerformanceMetrics)
      .values({
        teamId,
        contentType,
        articleId: contentType === ContentType.ARTICLE ? contentId : null,
        socialPostId: contentType === ContentType.SOCIAL ? contentId : null,
        videoIdeaId: contentType === ContentType.VIDEO ? contentId : null,
        patternsUsedJson: patternsUsed,
        qualityScore,
      })
      .returning({ id: contentPerformanceMetrics.id });
    const metric = metricRow!;

    await db
      .update(learningAgents)
      .set({
        totalGenerations: sql`${learningAgents.totalGenerations} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(learningAgents.id, agentId));

    return metric.id;
  }

  async recordEngagement(
    teamId: number,
    metricId: number,
    engagement: {
      views?: number;
      clicks?: number;
      shares?: number;
      likes?: number;
      comments?: number;
      timeOnPage?: number;
      bounceRate?: number;
    }
  ): Promise<void> {
    await db
      .update(contentPerformanceMetrics)
      .set({
        ...engagement,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentPerformanceMetrics.id, metricId),
          eq(contentPerformanceMetrics.teamId, teamId)
        )
      );
  }

  async markContentSuccess(
    teamId: number,
    metricId: number,
    isSuccess: boolean,
    reason?: string
  ): Promise<void> {
    const updated = await db
      .update(contentPerformanceMetrics)
      .set({
        isSuccess: isSuccess ? 1 : 0,
        successReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentPerformanceMetrics.id, metricId),
          eq(contentPerformanceMetrics.teamId, teamId)
        )
      )
      .returning({ id: contentPerformanceMetrics.id });

    if (updated.length > 0) {
      await this.processLearningFeedback(metricId);
    }
  }

  async processLearningFeedback(metricId: number): Promise<void> {
    const [metric] = await db
      .select()
      .from(contentPerformanceMetrics)
      .where(eq(contentPerformanceMetrics.id, metricId))
      .limit(1);

    if (!metric || metric.feedbackProcessed === 1) return;
    if (metric.isSuccess === null) return;

    const patternsUsed = (metric.patternsUsedJson as number[]) || [];
    const isSuccess = metric.isSuccess === 1;

    for (const patternId of patternsUsed) {
      await this.updatePatternWithEMA(patternId, isSuccess, metric.qualityScore);
    }

    await db
      .update(contentPerformanceMetrics)
      .set({
        feedbackProcessed: 1,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentPerformanceMetrics.id, metricId));

    console.log(`📊 Processed learning feedback for metric ${metricId}, patterns: ${patternsUsed.length}`);
  }

  private async updatePatternWithEMA(
    patternId: number,
    isSuccess: boolean,
    qualityScore: number
  ): Promise<void> {
    const [pattern] = await db
      .select()
      .from(learningPatterns)
      .where(eq(learningPatterns.id, patternId))
      .limit(1);

    if (!pattern) return;

    const newSuccessRate = Math.round(
      pattern.successRate * (1 - EMA_ALPHA) + (isSuccess ? 100 : 0) * EMA_ALPHA
    );
    const newQualityScore = Math.round(
      pattern.qualityScore * (1 - EMA_ALPHA) + qualityScore * EMA_ALPHA
    );

    const newTimesUsed = pattern.timesUsed + 1;
    const newTimesSuccessful = pattern.timesSuccessful + (isSuccess ? 1 : 0);

    const newConfidence = Math.min(
      100,
      Math.round((newTimesUsed / MIN_CONFIDENCE_SAMPLES) * 100)
    );

    await db
      .update(learningPatterns)
      .set({
        successRate: newSuccessRate,
        qualityScore: newQualityScore,
        timesUsed: newTimesUsed,
        timesSuccessful: newTimesSuccessful,
        confidence: newConfidence,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(learningPatterns.id, patternId));

    console.log(
      `📈 Updated pattern ${patternId}: success=${newSuccessRate}%, quality=${newQualityScore}, confidence=${newConfidence}%`
    );
  }

  async addPattern(
    agentId: number,
    teamId: number,
    pattern: {
      patternType: string;
      patternName: string;
      patternValue: string;
      industry?: string;
      audience?: string;
    }
  ): Promise<number> {
    const [agent] = await db
      .select()
      .from(learningAgents)
      .where(eq(learningAgents.id, agentId))
      .limit(1);

    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.teamId !== teamId) throw new Error(`Agent ${agentId} does not belong to team ${teamId}`);

    const [newPatternRow] = await db
      .insert(learningPatterns)
      .values({
        agentId,
        teamId,
        contentType: agent.contentType,
        ...pattern,
        successRate: 50,
        engagementScore: 50,
        qualityScore: 50,
        confidence: 0,
      })
      .returning({ id: learningPatterns.id });
    const newPattern = newPatternRow!;

    console.log(`✅ Added new pattern: ${pattern.patternName} (${pattern.patternType})`);

    return newPattern.id;
  }

  async getTopPatterns(
    teamId: number,
    contentType: string,
    limit: number = 10
  ): Promise<LearnedPattern[]> {
    const patterns = await db
      .select()
      .from(learningPatterns)
      .where(
        and(
          eq(learningPatterns.teamId, teamId),
          eq(learningPatterns.contentType, contentType)
        )
      )
      .orderBy(desc(learningPatterns.successRate))
      .limit(limit);

    return patterns.map((p) => ({
      id: p.id,
      patternType: p.patternType,
      patternName: p.patternName,
      patternValue: p.patternValue,
      successRate: p.successRate,
      confidence: p.confidence,
    }));
  }

  async getAgentStats(teamId: number): Promise<{
    agents: Array<{
      id: number;
      name: string;
      contentType: string;
      totalGenerations: number;
      successfulGenerations: number;
      averageQualityScore: number;
      patternCount: number;
      topPatterns: LearnedPattern[];
    }>;
  }> {
    const agents = await db
      .select()
      .from(learningAgents)
      .where(eq(learningAgents.teamId, teamId));

    const stats = await Promise.all(
      agents.map(async (agent) => {
        const patterns = await this.getTopPatterns(teamId, agent.contentType, 5);
        const patternCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(learningPatterns)
          .where(eq(learningPatterns.agentId, agent.id));

        return {
          id: agent.id,
          name: agent.name,
          contentType: agent.contentType,
          totalGenerations: agent.totalGenerations,
          successfulGenerations: agent.successfulGenerations,
          averageQualityScore: agent.averageQualityScore,
          patternCount: Number(patternCount[0]?.count || 0),
          topPatterns: patterns,
        };
      })
    );

    return { agents: stats };
  }

  async optimizeAgent(teamId: number, agentId: number): Promise<void> {
    const [agent] = await db
      .select()
      .from(learningAgents)
      .where(
        and(
          eq(learningAgents.id, agentId),
          eq(learningAgents.teamId, teamId)
        )
      )
      .limit(1);

    if (!agent) return;

    const beforeMetrics = {
      averageQualityScore: agent.averageQualityScore,
      totalGenerations: agent.totalGenerations,
      successfulGenerations: agent.successfulGenerations,
    };

    const unprocessedMetrics = await db
      .select()
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, agent.contentType),
          eq(contentPerformanceMetrics.feedbackProcessed, 0)
        )
      );

    let patternsUpdated = 0;
    for (const metric of unprocessedMetrics) {
      if (metric.isSuccess !== null) {
        await this.processLearningFeedback(metric.id);
        patternsUpdated++;
      }
    }

    const successfulGenerations = await db
      .select({ count: sql<number>`count(*)` })
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, agent.contentType),
          eq(contentPerformanceMetrics.isSuccess, 1)
        )
      );

    const avgQuality = await db
      .select({ avg: sql<number>`avg(quality_score)` })
      .from(contentPerformanceMetrics)
      .where(
        and(
          eq(contentPerformanceMetrics.teamId, teamId),
          eq(contentPerformanceMetrics.contentType, agent.contentType)
        )
      );

    await db
      .update(learningAgents)
      .set({
        successfulGenerations: Number(successfulGenerations[0]?.count || 0),
        averageQualityScore: Math.round(avgQuality[0]?.avg || 0),
        lastOptimizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(learningAgents.id, agentId));

    const afterMetrics = {
      averageQualityScore: Math.round(avgQuality[0]?.avg || 0),
      totalGenerations: agent.totalGenerations,
      successfulGenerations: Number(successfulGenerations[0]?.count || 0),
    };

    await db.insert(agentOptimizationLogs).values({
      agentId,
      optimizationType: "pattern_update",
      description: `Processed ${unprocessedMetrics.length} metrics, updated ${patternsUpdated} patterns`,
      beforeMetricsJson: beforeMetrics,
      afterMetricsJson: afterMetrics,
      changesAppliedJson: { metricsProcessed: unprocessedMetrics.length },
      patternsUpdated,
    });

    console.log(`🔄 Optimized agent ${agent.name}: ${patternsUpdated} patterns updated`);
  }

  async seedDefaultPatterns(agentId: number, teamId: number, contentType: string): Promise<void> {
    const defaultPatterns: Record<string, Array<{ type: string; name: string; value: string }>> = {
      article: [
        { type: "opening_style", name: "Direct Answer First", value: "Start with a clear, direct answer to the main question in the first paragraph. Provide the key insight immediately." },
        { type: "opening_style", name: "Problem-Solution Hook", value: "Open with a relatable problem statement, then preview the solution. Create immediate relevance." },
        { type: "tone", name: "Expert Educational", value: "Write in an authoritative but approachable tone. Use 'you' language. Avoid jargon without explanation." },
        { type: "structure", name: "Scannable Format", value: "Use H2 headings every 200-300 words. Include bullet points for key takeaways. Add a summary box." },
        { type: "cta", name: "Soft Value CTA", value: "End with a helpful next step, not a hard sell. Offer additional value before mentioning services." },
        { type: "eeat_signal", name: "Local Expertise", value: "Reference specific local entities, regulations, or case studies. Show first-hand experience." },
      ],
      video: [
        { type: "hook", name: "Pattern Interrupt", value: "Start with an unexpected statement or visual that breaks viewer expectations in the first 2 seconds." },
        { type: "hook", name: "Question Hook", value: "Open with a compelling question that addresses the viewer's pain point directly." },
        { type: "pacing", name: "Fast-Slow-Fast", value: "Quick cuts for energy, slow for key points, quick for transitions. Match audio pacing." },
        { type: "visual_style", name: "Cinematic B-Roll", value: "Use professional b-roll with shallow depth of field. Color grade for warmth and trust." },
        { type: "cta", name: "Value Before Ask", value: "Deliver full value before any CTA. Make the CTA feel like a natural next step, not an interruption." },
      ],
      social: [
        { type: "hook", name: "Curiosity Gap", value: "Create information asymmetry - hint at valuable insight without revealing everything upfront." },
        { type: "format", name: "List with Twist", value: "Use numbered lists but include one unexpected or contrarian point to stand out." },
        { type: "hashtag", name: "Niche + Broad Mix", value: "Use 2-3 niche hashtags (high relevance) + 1-2 broad hashtags (discovery potential)." },
        { type: "tone", name: "Conversational Authority", value: "Sound like a knowledgeable friend, not a corporate brand. Use contractions and direct address." },
        { type: "cta", name: "Engagement Prompt", value: "End with a question or poll to drive comments. Boost algorithm visibility through engagement." },
      ],
      podcast: [
        { type: "opening", name: "Story Cold Open", value: "Start mid-story or with a compelling quote. Skip intros - hook listeners immediately." },
        { type: "pacing", name: "Energy Variation", value: "Vary energy levels throughout. Low for reflection, high for key insights. Avoid monotone." },
        { type: "structure", name: "Conversational Chapters", value: "Organize around 3-4 main topics. Signal transitions naturally through conversation." },
        { type: "engagement", name: "Direct Address", value: "Speak to the listener as 'you'. Include them in the conversation. Anticipate their questions." },
      ],
      image: [
        { type: "composition", name: "Rule of Thirds with Focus", value: "Place subject at intersection points. Use depth of field to direct attention." },
        { type: "color", name: "Brand-Consistent Palette", value: "Use 2-3 core colors consistently. Warm tones for trust, cool for professionalism." },
        { type: "style", name: "Authentic Over Stock", value: "Prefer realistic, authentic imagery over polished stock photos. Real > perfect." },
        { type: "text", name: "Minimal Readable Text", value: "If adding text, use high contrast and minimal words. Text should be readable at all sizes." },
      ],
    };

    const patterns = defaultPatterns[contentType] || [];

    for (const pattern of patterns) {
      await this.addPattern(agentId, teamId, {
        patternType: pattern.type,
        patternName: pattern.name,
        patternValue: pattern.value,
      });
    }

    console.log(`🌱 Seeded ${patterns.length} default patterns for ${contentType} agent`);
  }

  async getFactAwareOptimizationContext(
    teamId: number,
    contentType: string,
    options: { topic?: string; entityTypes?: string[] } = {}
  ): Promise<OptimizationContext & { factCoverage: { totalFacts: number; recommendations: string[] } }> {
    const baseContext = await this.getOptimizationContext(teamId, contentType);
    if (!baseContext) throw new Error(`No optimization context for team ${teamId}, type ${contentType}`);
    
    const factCoverage = await getFactCoverageReport(teamId, options.topic, options.entityTypes);
    
    const factAwareEnhancements = [...baseContext.promptEnhancements];
    
    if (factCoverage.totalFacts > 0) {
      factAwareEnhancements.push(
        `FACT VALIDATION ACTIVE: ${factCoverage.totalFacts} verified facts available (avg confidence: ${factCoverage.averageConfidence}%)`
      );
      
      if (factCoverage.expiringFacts > 0) {
        factAwareEnhancements.push(
          `⚠️ ${factCoverage.expiringFacts} facts expiring soon - verify before using`
        );
      }
    } else {
      factAwareEnhancements.push(
        `⚠️ NO VERIFIED FACTS AVAILABLE - Content generation may include unverified claims`
      );
    }
    
    console.log(`🧠 [Learning+Facts] Context for ${contentType}: ${baseContext.patterns.length} patterns, ${factCoverage.totalFacts} facts`);
    
    return {
      ...baseContext,
      promptEnhancements: factAwareEnhancements,
      factCoverage: {
        totalFacts: factCoverage.totalFacts,
        recommendations: factCoverage.recommendations,
      },
    } as OptimizationContext & { factCoverage: { totalFacts: number; recommendations: string[] } };
  }

  async validatePatternAgainstFacts(
    patternId: number,
    teamId: number
  ): Promise<{ valid: boolean; concerns: string[] }> {
    const [pattern] = await db
      .select()
      .from(learningPatterns)
      .where(eq(learningPatterns.id, patternId))
      .limit(1);

    if (!pattern) {
      return { valid: false, concerns: ["Pattern not found"] };
    }

    const concerns: string[] = [];

    const claimIndicators = [
      /\d+%/,
      /according to/i,
      /studies show/i,
      /research indicates/i,
      /statistics/i,
      /data shows/i,
    ];

    const containsClaim = claimIndicators.some((regex) =>
      regex.test(pattern.patternValue)
    );

    if (containsClaim) {
      const factPack = await factStore.searchFacts({
        teamId,
        query: pattern.patternValue.substring(0, 100),
        limit: 5,
      });

      if (factPack.length === 0) {
        concerns.push(
          `Pattern "${pattern.patternName}" contains claims but no supporting facts found`
        );
      }
    }

    return {
      valid: concerns.length === 0,
      concerns,
    };
  }

  /**
   * DETERMINISTIC HUMANIZATION: Analyze and improve pattern text quality
   * Ensures learned patterns don't perpetuate AI-isms
   */
  async analyzePatternQuality(
    teamId: number,
    patternId: number
  ): Promise<{
    quality: ReturnType<typeof analyzeContentQuality>;
    needsHumanization: boolean;
    recommendations: string[];
  }> {
    const [pattern] = await db
      .select()
      .from(learningPatterns)
      .where(eq(learningPatterns.id, patternId));

    if (!pattern) {
      throw new Error(`Pattern ${patternId} not found`);
    }

    const quality = analyzeContentQuality(pattern.patternValue);
    const recommendations: string[] = [];

    if (quality.aiIsmCount > 0) {
      recommendations.push(`Contains ${quality.aiIsmCount} AI-isms that should be scrubbed`);
    }

    if (quality.burstiness < 0.3) {
      recommendations.push(`Low sentence variety (${quality.burstiness}) - add more sentence length variation`);
    }

    if (quality.averageSentenceLength > 25) {
      recommendations.push(`Long average sentence length (${quality.averageSentenceLength}) - break into shorter sentences`);
    }

    return {
      quality,
      needsHumanization: recommendations.length > 0,
      recommendations,
    };
  }

  /**
   * DETERMINISTIC HUMANIZATION: Apply humanization to pattern text
   * Used when patterns are applied to new content
   */
  humanizePatternForApplication(
    patternValue: string,
    contentType: string
  ): HumanizationResult {
    const configByType: Record<string, HumanizationConfig> = {
      [ContentType.ARTICLE]: { burstinessTarget: 0.45, scrubLevel: "standard", channelFormat: "article" },
      [ContentType.SOCIAL]: { burstinessTarget: 0.35, scrubLevel: "aggressive", channelFormat: "social" },
      [ContentType.VIDEO]: { burstinessTarget: 0.40, scrubLevel: "standard", channelFormat: "video" },
      [ContentType.PODCAST]: { burstinessTarget: 0.50, scrubLevel: "minimal", channelFormat: "podcast" },
    };

    const config = configByType[contentType] || configByType[ContentType.ARTICLE]!
    return humanizeContent(patternValue, config);
  }

  /**
   * DETERMINISTIC HUMANIZATION: Get humanization-aware optimization context
   * Enhances prompt suggestions with anti-AI-ism guidelines
   */
  async getHumanizedOptimizationContext(
    teamId: number,
    contentType: string,
    options?: {
      industry?: string;
      audience?: string;
      patternTypes?: string[];
    }
  ): Promise<OptimizationContext & { humanizationGuidelines: string[] }> {
    const baseContext = await this.getOptimizationContext(teamId, contentType, options);
    if (!baseContext) throw new Error(`No optimization context for team ${teamId}, type ${contentType}`);
    
    const humanizationGuidelines = [
      "Vary sentence lengths naturally - mix short punchy sentences with longer ones",
      "Avoid corporate jargon: 'leverage', 'synergy', 'paradigm shift', 'game-changer'",
      "Start sentences differently - avoid repetitive patterns",
      "Use active voice and concrete examples",
      "Remove filler phrases: 'It's worth noting', 'In today's world', 'Let's dive into'",
    ];

    // Analyze existing patterns for quality
    for (const pattern of baseContext.patterns) {
      const quality = analyzeContentQuality(pattern.patternValue);
      if (quality.aiIsmCount > 2) {
        console.warn(`⚠️ [DH-Learning] Pattern "${pattern.patternName}" contains ${quality.aiIsmCount} AI-isms`);
      }
    }

    return {
      ...baseContext,
      humanizationGuidelines,
    } as OptimizationContext & { humanizationGuidelines: string[] };
  }

  // ============================================================================
  // GUARDIAN AGENT FAILURE LEDGER
  // ============================================================================

  async recordGuardianFailures(
    teamId: number,
    contentType: string,
    failures: string[]
  ): Promise<void> {
    try {
      const { aiLearningLedger } = await import("../shared/schema");
      const now = new Date();

      for (const failure of failures) {
        const errorType = failure.split(":")[0]!.trim().toUpperCase();
        const existing = await db
          .select()
          .from(aiLearningLedger)
          .where(
            and(
              eq(aiLearningLedger.teamId, teamId),
              eq(aiLearningLedger.contentType, contentType),
              eq(aiLearningLedger.errorType, errorType)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(aiLearningLedger)
            .set({ count: existing[0]!.count + 1, lastOccurrence: now })
            .where(eq(aiLearningLedger.id, existing[0]!.id));
        } else {
          await db.insert(aiLearningLedger).values({
            teamId,
            contentType,
            errorType,
            count: 1,
            lastOccurrence: now,
          });
        }
      }
    } catch (error) {
      console.warn("⚠️ Failed to record Guardian failures to ledger:", error);
    }
  }

  async getTopRecurringFailures(
    teamId: number,
    contentType: string,
    limit = 3
  ): Promise<Array<{ errorType: string; count: number; lastOccurrence: Date }>> {
    try {
      const { aiLearningLedger } = await import("../shared/schema");
      const rows = await db
        .select()
        .from(aiLearningLedger)
        .where(
          and(
            eq(aiLearningLedger.teamId, teamId),
            eq(aiLearningLedger.contentType, contentType)
          )
        )
        .orderBy(desc(aiLearningLedger.count))
        .limit(limit);

      return rows.map(r => ({
        errorType: r.errorType,
        count: r.count,
        lastOccurrence: r.lastOccurrence,
      }));
    } catch (error) {
      console.warn("⚠️ Failed to fetch recurring failures from ledger:", error);
      return [];
    }
  }
}

export const learningService = LearningService.getInstance();
