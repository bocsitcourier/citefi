import { GoogleGenAI } from "@google/genai";

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required for video idea expansion");
  }
  return new GoogleGenAI({ apiKey });
}

export interface VideoIdeaInput {
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

export async function expandVideoIdea(input: VideoIdeaInput): Promise<ExpandedVideoConcept> {
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
    const response = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.8,
        maxOutputTokens: 2000,
      },
    });

    const text = (response.text || "").trim();
    
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }
    
    let cleanedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let concept: ExpandedVideoConcept;
    try {
      concept = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", cleanedText.substring(0, 500));
      throw new Error(`Invalid JSON from Gemini: ${parseError}`);
    }
    
    if (!concept.hook || !concept.problem || !concept.solution || !concept.cta) {
      throw new Error("Incomplete video concept structure from Gemini");
    }
    
    console.log(`✅ Video concept expanded successfully`);
    console.log(`   Story arc: ${concept.overallNarrative}`);
    console.log(`   Target emotion: ${concept.targetEmotion}`);
    
    return concept;
  } catch (error) {
    console.error("Error expanding video idea:", error);
    throw new Error(`Failed to expand video idea: ${error}`);
  }
}

export { STYLE_DESCRIPTIONS, TONE_DESCRIPTIONS };
