import { psychographicService, PersonaContentGuidelines } from "./psychographic-service";
import { getPromptEnhancement, PromptEnhancement, recordContentGenerated } from "./learning-integration";
import { ContentType } from "../shared/schema";

export interface ContentOptimizationContext {
  learningEnhancement: PromptEnhancement;
  personaGuidelines: PersonaContentGuidelines | null;
  combinedSystemPrompt: string;
  combinedUserPrompt: string;
  patternsUsed: number[];
  personaId: number | null;
}

export async function getContentOptimizationContext(
  teamId: number,
  contentType: string,
  options?: {
    personaId?: number;
    industry?: string;
    audience?: string;
  }
): Promise<ContentOptimizationContext> {
  const [learningEnhancement, personaGuidelines] = await Promise.all([
    getPromptEnhancement(teamId, contentType, {
      industry: options?.industry,
      audience: options?.audience,
    }),
    psychographicService.getContentGuidelines(teamId, options?.personaId),
  ]);

  let combinedSystemPrompt = "";
  let combinedUserPrompt = "";

  if (learningEnhancement.systemPromptAdditions.length > 0) {
    combinedSystemPrompt += learningEnhancement.systemPromptAdditions.join("");
  }

  if (personaGuidelines) {
    combinedSystemPrompt += personaGuidelines.systemPromptAdditions.join("\n");
  }

  if (learningEnhancement.userPromptAdditions.length > 0) {
    combinedUserPrompt += learningEnhancement.userPromptAdditions.join("\n");
  }

  if (personaGuidelines && personaGuidelines.userPromptAdditions.length > 0) {
    combinedUserPrompt += "\n" + personaGuidelines.userPromptAdditions.join("\n");
  }

  return {
    learningEnhancement,
    personaGuidelines,
    combinedSystemPrompt,
    combinedUserPrompt,
    patternsUsed: learningEnhancement.patternsUsed,
    personaId: personaGuidelines?.personaId || null,
  };
}

export function enhancePromptWithContext(
  baseSystemPrompt: string,
  baseUserPrompt: string,
  context: ContentOptimizationContext
): { systemPrompt: string; userPrompt: string } {
  let systemPrompt = baseSystemPrompt;
  let userPrompt = baseUserPrompt;

  if (context.combinedSystemPrompt) {
    systemPrompt = baseSystemPrompt + context.combinedSystemPrompt;
  }

  if (context.combinedUserPrompt) {
    userPrompt = baseUserPrompt + context.combinedUserPrompt;
  }

  return { systemPrompt, userPrompt };
}

export async function recordContentWithPersona(
  teamId: number,
  contentType: string,
  contentId: number,
  patternsUsed: number[],
  qualityScore: number,
  personaId?: number | null
): Promise<number> {
  const metricId = await recordContentGenerated(
    teamId,
    contentType,
    contentId,
    patternsUsed,
    qualityScore
  );

  if (personaId && metricId > 0) {
    await psychographicService.recordBehavioralSignal(personaId, {
      signalType: "content_generated",
      contentType,
      contentId,
      signalValue: qualityScore,
      signalMetadata: { patternsUsed },
      patternsUsed,
    });
  }

  return metricId;
}

export function getOceanBasedTone(ocean: { 
  openness: number; 
  extraversion: number; 
  agreeableness: number;
  neuroticism: number;
}): string {
  if (ocean.neuroticism >= 70) return "reassuring";
  if (ocean.extraversion >= 70 && ocean.agreeableness >= 60) return "enthusiastic";
  if (ocean.extraversion >= 70) return "energetic";
  if (ocean.openness >= 70) return "creative";
  if (ocean.agreeableness >= 70) return "warm";
  return "professional";
}

export function getOceanBasedContentLength(conscientiousness: number): "short" | "medium" | "long" | "detailed" {
  if (conscientiousness >= 80) return "detailed";
  if (conscientiousness >= 60) return "long";
  if (conscientiousness <= 30) return "short";
  return "medium";
}

export function getOceanBasedCTAStyle(riskTolerance: number, neuroticism: number): string {
  if (riskTolerance >= 70) return "direct";
  if (neuroticism >= 70) return "gentle";
  if (riskTolerance <= 30) return "value-first";
  return "balanced";
}

export { ContentType };
