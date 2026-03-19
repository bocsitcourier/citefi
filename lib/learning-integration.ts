import { learningService, OptimizationContext } from "./learning-service";
import { ContentType } from "../shared/schema";

export interface PromptEnhancement {
  systemPromptAdditions: string[];
  userPromptAdditions: string[];
  suggestedParameters: {
    temperature?: number;
    model?: string;
  };
  patternsUsed: number[];
  humanizationGuidelines?: string[];
}

export async function getPromptEnhancement(
  teamId: number,
  contentType: string,
  options?: {
    industry?: string;
    audience?: string;
  }
): Promise<PromptEnhancement> {
  try {
    // Use humanized optimization context for better content quality
    const context = await learningService.getHumanizedOptimizationContext(
      teamId,
      contentType as ContentType,
      options
    );

    if (!context || context.patterns.length === 0) {
      return {
        systemPromptAdditions: [],
        userPromptAdditions: [],
        suggestedParameters: {},
        patternsUsed: [],
        humanizationGuidelines: context?.humanizationGuidelines || [],
      };
    }

    const systemAdditions: string[] = [];
    const userAdditions: string[] = [];
    const patternsUsed: number[] = [];

    const highConfidencePatterns = context.patterns.filter(p => p.confidence >= 60);
    
    if (highConfidencePatterns.length > 0) {
      systemAdditions.push("\n\n--- LEARNED OPTIMIZATION PATTERNS (Apply these for best results) ---");
      
      for (const pattern of highConfidencePatterns.slice(0, 5)) {
        systemAdditions.push(`\n[${pattern.patternType.toUpperCase()}] ${pattern.patternValue}`);
        patternsUsed.push(pattern.id);
      }
      
      systemAdditions.push("\n--- END LEARNED PATTERNS ---\n");
    }

    const suggestedPatterns = context.patterns.filter(p => p.confidence >= 40 && p.confidence < 60);
    if (suggestedPatterns.length > 0) {
      userAdditions.push("\nConsider these suggested approaches:");
      for (const pattern of suggestedPatterns.slice(0, 3)) {
        userAdditions.push(`- ${pattern.patternName}: ${pattern.patternValue}`);
        patternsUsed.push(pattern.id);
      }
    }

    // Add humanization guidelines to system prompt
    if (context.humanizationGuidelines && context.humanizationGuidelines.length > 0) {
      systemAdditions.push("\n\n--- CONTENT QUALITY GUIDELINES (Avoid AI-isms) ---");
      for (const guideline of context.humanizationGuidelines) {
        systemAdditions.push(`\n• ${guideline}`);
      }
      systemAdditions.push("\n--- END QUALITY GUIDELINES ---\n");
    }

    return {
      systemPromptAdditions: systemAdditions,
      userPromptAdditions: userAdditions,
      suggestedParameters: {
        temperature: context.modelConfig.temperature,
        model: context.modelConfig.model,
      },
      patternsUsed,
      humanizationGuidelines: context.humanizationGuidelines,
    };
  } catch (error) {
    console.warn("Failed to get prompt enhancement:", error);
    return {
      systemPromptAdditions: [],
      userPromptAdditions: [],
      suggestedParameters: {},
      patternsUsed: [],
      humanizationGuidelines: [],
    };
  }
}

export function enhanceSystemPrompt(
  originalPrompt: string,
  enhancement: PromptEnhancement
): string {
  if (enhancement.systemPromptAdditions.length === 0) {
    return originalPrompt;
  }
  
  return originalPrompt + enhancement.systemPromptAdditions.join("");
}

export function enhanceUserPrompt(
  originalPrompt: string,
  enhancement: PromptEnhancement
): string {
  if (enhancement.userPromptAdditions.length === 0) {
    return originalPrompt;
  }
  
  return originalPrompt + "\n" + enhancement.userPromptAdditions.join("\n");
}

export async function recordContentGenerated(
  teamId: number,
  contentType: string,
  contentId: number,
  patternsUsed: number[],
  qualityScore: number
): Promise<number> {
  try {
    const agent = await learningService.getAgentForContentType(teamId, contentType);
    if (!agent) {
      console.warn(`No agent found for content type: ${contentType}`);
      return 0;
    }

    return await learningService.recordContentGeneration(
      teamId,
      agent.id,
      contentType,
      contentId,
      patternsUsed,
      qualityScore
    );
  } catch (error) {
    console.warn("Failed to record content generation:", error);
    return 0;
  }
}

export async function recordContentFeedback(
  teamId: number,
  metricId: number,
  isSuccess: boolean,
  reason?: string
): Promise<void> {
  try {
    await learningService.markContentSuccess(teamId, metricId, isSuccess, reason);
  } catch (error) {
    console.warn("Failed to record content feedback:", error);
  }
}

export async function initializeTeamLearning(teamId: number): Promise<void> {
  try {
    await learningService.initializeDefaultAgents(teamId);
    
    const stats = await learningService.getAgentStats(teamId);
    
    for (const agent of stats.agents) {
      if (agent.patternCount === 0) {
        await learningService.seedDefaultPatterns(agent.id, teamId, agent.contentType);
        console.log(`🌱 Seeded default patterns for ${agent.contentType} agent`);
      }
    }
  } catch (error) {
    console.warn("Failed to initialize team learning:", error);
  }
}

/**
 * Build a "hard warning" block for the AI prompt based on recurring Guardian
 * failures logged in the ai_learning_ledger. This makes the system learn from
 * its past mistakes and prioritize fixing them in future generations.
 *
 * Example output injected into the Gemini system prompt:
 *   ⚠️ CRITICAL QUALITY WARNINGS (based on recent failures):
 *   - MISSING_FAQ (failed 4 times): You frequently forget the FAQ section. This is mandatory...
 */
export async function getGuardianFailureWarnings(
  teamId: number,
  contentType: string = "article"
): Promise<string> {
  try {
    const failures = await learningService.getTopRecurringFailures(teamId, contentType, 3);
    if (failures.length === 0) return "";

    const ERROR_GUIDANCE: Record<string, string> = {
      MISSING_FAQ:
        "You frequently forget the FAQ section. Add a <h3>Frequently Asked Questions</h3> section with 3+ Q&A pairs near the end of every article. This is non-negotiable.",
      MISSING_IMAGES:
        "You frequently omit image tags. Every article must include at least 1 <img> tag with descriptive alt text after key sections.",
      MISSING_HYPERLINKS:
        "You frequently produce articles with too few hyperlinks. Every article must include at least 3 <a href> links using natural anchor text from the content.",
      LOW_WORD_COUNT:
        "Your articles are frequently too short. Every article must reach at least 600 words — expand all key sections with specific details, examples, and local context.",
      TONE_MISMATCH:
        "Your content tone frequently mismatches the required persona. Read the persona description carefully and apply it consistently throughout the article.",
      MISSING_FORMATTING:
        "Articles contain raw markdown instead of proper HTML. Use <strong>, <em>, <h2>, <h3>, <ul>, <li> tags — never **, *, #, or - list syntax.",
    };

    const lines = failures
      .filter(f => f.count >= 2)
      .map(f => {
        const guidance = ERROR_GUIDANCE[f.errorType] || `This error has occurred ${f.count} time(s). Prioritize fixing it.`;
        return `  - ${f.errorType} (failed ${f.count}× recently): ${guidance}`;
      });

    if (lines.length === 0) return "";

    return `\n\n⚠️ CRITICAL QUALITY WARNINGS — LEARN FROM PAST FAILURES:\n${lines.join("\n")}\nThese issues were detected by the quality gate in previous articles. Address them proactively before finishing.\n`;
  } catch (error) {
    console.warn("⚠️ Failed to build Guardian failure warnings:", error);
    return "";
  }
}

export { ContentType };
