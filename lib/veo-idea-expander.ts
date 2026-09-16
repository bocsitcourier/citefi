import { GEMINI_FLASH_MODEL } from "./ai-config";
import { GoogleGenAI } from "@google/genai";
import { isProviderAccountingError } from "./cost-telemetry";
import { redactProviderError, redactProviderOutput } from "./provider-diagnostics";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required for video idea expansion");
  }
  return new GoogleGenAI({ apiKey });
}

export interface VideoIdeaInput {
  teamId: number;
  ideaTitle: string;
  shortIdea: string;
  companyName: string;
  targetAudience?: string;
  style: VideoStyle;
  tone: VideoTone;
  callToAction: string;
  website?: string;
  location?: string;
}

export type VideoStyle = 
  | "cinematic" 
  | "comedy" 
  | "emotional" 
  | "tech" 
  | "minimal" 
  | "retro" 
  | "luxury" 
  | "action";

export type VideoTone = 
  | "professional" 
  | "playful" 
  | "inspirational" 
  | "urgent" 
  | "mysterious" 
  | "friendly";

export interface ExpandedVideoConcept {
  hook: {
    description: string;
    visualConcept: string;
    emotionalTrigger: string;
  };
  problem: {
    description: string;
    painPoints: string[];
    relatableScenario: string;
  };
  solution: {
    description: string;
    keyFeatures: string[];
    differentiator: string;
  };
  benefits: {
    description: string;
    outcomes: string[];
    transformation: string;
  };
  proof: {
    description: string;
    socialProof: string;
    credibilityElement: string;
  };
  cta: {
    description: string;
    actionPhrase: string;
    urgencyElement: string;
  };
  overallNarrative: string;
  targetEmotion: string;
}

const STYLE_DESCRIPTIONS: Record<VideoStyle, string> = {
  cinematic: "Epic, dramatic, film-quality visuals with sweeping camera movements and emotional depth",
  comedy: "Light-hearted, humorous, unexpected twists with relatable comedic timing",
  emotional: "Heartfelt, personal stories that create deep emotional connection and empathy",
  tech: "Futuristic, clean, innovative with sleek animations and cutting-edge aesthetics",
  minimal: "Simple, elegant, focused with negative space and subtle movements",
  retro: "Nostalgic, vintage-inspired with warm colors and classic visual elements",
  luxury: "Premium, sophisticated, elegant with rich textures and refined aesthetics",
  action: "High-energy, dynamic, fast-paced with intense visuals and momentum"
};

const TONE_DESCRIPTIONS: Record<VideoTone, string> = {
  professional: "Authoritative, trustworthy, polished corporate communication",
  playful: "Fun, energetic, approachable with a sense of joy",
  inspirational: "Uplifting, motivating, empowering with aspirational messaging",
  urgent: "Time-sensitive, compelling, creating immediate desire for action",
  mysterious: "Intriguing, curious, building anticipation and discovery",
  friendly: "Warm, welcoming, conversational like talking to a trusted friend"
};

export class ExpandedVideoConceptContractError extends Error {
  readonly code = "MODEL_OUTPUT_INVALID" as const;

  constructor(message: string, cause?: unknown) {
    super(`[idea_expansion] ${message}`, cause === undefined ? undefined : { cause });
    this.name = "ExpandedVideoConceptContractError";
  }
}

interface ExpandedVideoConceptResponseLike {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
  text?: string;
}

function extractExpandedConceptText(
  response: ExpandedVideoConceptResponseLike,
): string {
  const answerText = (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return (answerText || response.text || "").trim();
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function boundedStringArray(
  value: unknown,
  itemMaxLength: number,
  maxItems: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxItems &&
    value.every((item) => boundedString(item, itemMaxLength))
  );
}

function isExpandedSection(
  value: unknown,
  fields: Record<string, number | { itemMaxLength: number; maxItems: number }>,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const section = value as Record<string, unknown>;
  return Object.entries(fields).every(([field, limit]) => {
    const fieldValue = section[field];
    if (typeof limit === "number") return boundedString(fieldValue, limit);
    return boundedStringArray(fieldValue, limit.itemMaxLength, limit.maxItems);
  });
}

export function parseExpandedVideoConceptResponse(
  response: ExpandedVideoConceptResponseLike,
): ExpandedVideoConcept {
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && String(finishReason).toUpperCase() !== "STOP") {
    throw new ExpandedVideoConceptContractError(
      `provider response ended with finishReason=${String(finishReason)}; refusing incomplete output`,
    );
  }

  const rawText = extractExpandedConceptText(response);
  const digest = redactProviderOutput(rawText, "video_idea_expansion_json");
  if (!rawText) {
    throw new ExpandedVideoConceptContractError(`empty provider output (${digest})`);
  }
  if (rawText.length > 50_000) {
    throw new ExpandedVideoConceptContractError(
      `provider output exceeds 50000 characters (${digest})`,
    );
  }

  const cleanedText = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let value: unknown;
  try {
    value = JSON.parse(cleanedText);
  } catch (error) {
    throw new ExpandedVideoConceptContractError(
      `malformed or truncated concept JSON (${digest})`,
      error,
    );
  }

  const concept = value as Partial<ExpandedVideoConcept>;
  const valid =
    concept &&
    typeof concept === "object" &&
    isExpandedSection(concept.hook, {
      description: 2_000,
      visualConcept: 2_000,
      emotionalTrigger: 500,
    }) &&
    isExpandedSection(concept.problem, {
      description: 2_000,
      painPoints: { itemMaxLength: 500, maxItems: 10 },
      relatableScenario: 2_000,
    }) &&
    isExpandedSection(concept.solution, {
      description: 2_000,
      keyFeatures: { itemMaxLength: 500, maxItems: 10 },
      differentiator: 1_000,
    }) &&
    isExpandedSection(concept.benefits, {
      description: 2_000,
      outcomes: { itemMaxLength: 500, maxItems: 10 },
      transformation: 2_000,
    }) &&
    isExpandedSection(concept.proof, {
      description: 2_000,
      socialProof: 1_000,
      credibilityElement: 1_000,
    }) &&
    isExpandedSection(concept.cta, {
      description: 2_000,
      actionPhrase: 500,
      urgencyElement: 1_000,
    }) &&
    boundedString(concept.overallNarrative, 2_000) &&
    boundedString(concept.targetEmotion, 500);

  if (!valid) {
    throw new ExpandedVideoConceptContractError(
      `concept failed the complete bounded field contract (${digest})`,
    );
  }
  return concept as ExpandedVideoConcept;
}

export async function expandVideoIdea(input: VideoIdeaInput): Promise<ExpandedVideoConcept> {
  if (!Number.isInteger(input.teamId) || input.teamId <= 0) {
    throw new Error("Video idea expansion requires a validated teamId");
  }
  console.log(`🎬 Expanding video idea: "${input.ideaTitle}"`);
  
  const styleDesc = STYLE_DESCRIPTIONS[input.style];
  const toneDesc = TONE_DESCRIPTIONS[input.tone];
  
  const prompt = `You are a creative director expanding a brief video idea into a comprehensive 60-second video concept.

BRIEF IDEA:
Title: ${input.ideaTitle}
Idea: ${input.shortIdea}
Company: ${input.companyName}
Target Audience: ${input.targetAudience || "General audience"}
Website: ${input.website || "N/A"}
Location: ${input.location || "N/A"}
Call to Action: ${input.callToAction}

STYLE: ${input.style.toUpperCase()}
${styleDesc}

TONE: ${input.tone.toUpperCase()}
${toneDesc}

Expand this brief idea into a compelling 60-second video narrative using the following structure:

1. HOOK (0-10s): Attention-grabbing opening that stops viewers from scrolling
   - What visual or statement will immediately captivate?
   - What emotional trigger activates instant interest?

2. PROBLEM (10-20s): Relatable challenge that the audience faces
   - What pain points resonate with ${input.targetAudience || "the target audience"}?
   - What scenario makes them think "that's exactly my problem"?

3. SOLUTION (20-35s): How ${input.companyName} solves this problem
   - What key features differentiate from alternatives?
   - What makes this solution unique and compelling?

4. BENEFITS (35-45s): Transformation and outcomes
   - What specific improvements will viewers experience?
   - What does life look like after using the solution?

5. PROOF (45-52s): Credibility and social validation
   - What evidence builds trust (testimonials, stats, awards)?
   - What makes this credible and trustworthy?

6. CTA (52-60s): Clear call to action
   - What specific action should viewers take?
   - What creates urgency without being pushy?

Return ONLY valid JSON in this exact format:
{
  "hook": {
    "description": "What happens in this section",
    "visualConcept": "Key visual elements and camera work",
    "emotionalTrigger": "The emotion we're activating"
  },
  "problem": {
    "description": "What problem we're highlighting",
    "painPoints": ["Pain point 1", "Pain point 2", "Pain point 3"],
    "relatableScenario": "The specific scenario viewers will recognize"
  },
  "solution": {
    "description": "How we present the solution",
    "keyFeatures": ["Feature 1", "Feature 2", "Feature 3"],
    "differentiator": "What makes this unique"
  },
  "benefits": {
    "description": "The transformation we show",
    "outcomes": ["Outcome 1", "Outcome 2", "Outcome 3"],
    "transformation": "Before/after state change"
  },
  "proof": {
    "description": "How we build credibility",
    "socialProof": "Testimonial or statistic concept",
    "credibilityElement": "Trust-building element"
  },
  "cta": {
    "description": "The closing action",
    "actionPhrase": "${input.callToAction}",
    "urgencyElement": "What creates motivation to act now"
  },
  "overallNarrative": "One sentence describing the complete story arc",
  "targetEmotion": "The primary emotion viewers should feel"
}`;

  try {
    const genAI = getGeminiClient();
    const _ideaStart = Date.now();
    const response = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.8,
        maxOutputTokens: 2000,
          responseMimeType: "application/json",
      },
    });

    if (response?.usageMetadata) {
      const { logCostTelemetry, extractGeminiUsage } = await import("./cost-telemetry");
      await logCostTelemetry(
        { operationType: "video_idea", provider: "gemini", model: GEMINI_FLASH_MODEL,
          teamId: input.teamId, providerRequestId: (response as any).responseId ?? null },
        extractGeminiUsage(response), Date.now() - _ideaStart, true
      );
    }

    const concept = parseExpandedVideoConceptResponse(response);
    
    console.log(`✅ Video concept expanded successfully`);
    console.log(
      `   Story arc received (${redactProviderOutput(concept.overallNarrative, "video_idea_story_arc")})`,
    );
    console.log(
      `   Target emotion received (${redactProviderOutput(concept.targetEmotion, "video_idea_target_emotion")})`,
    );
    
    return concept;
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    const diagnostic = redactProviderError(error, undefined, "video_idea_expansion");
    console.error(
      "Error expanding video idea:",
      diagnostic,
    );
    throw new Error(`Failed to expand video idea (${diagnostic})`);
  }
}

export { STYLE_DESCRIPTIONS, TONE_DESCRIPTIONS };
