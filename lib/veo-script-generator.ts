import { GEMINI_FLASH_MODEL } from "./ai-config";
import { GoogleGenAI } from "@google/genai";
import { createBrandLockPromptSegment, validateBrandInOutput } from "./branding";
import type { VeoClipPrompt, VeoVideoScript } from "./veo-video-generator";
import { getContentOptimizationContext, type ContentOptimizationContext } from "./persona-content-integration";
import { jsonrepair } from "jsonrepair";

function safeParseJSON<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (firstErr) {
    try {
      const repaired = jsonrepair(text);
      const parsed = JSON.parse(repaired) as T;
      console.warn(`⚠️ [${label}] JSON was malformed — repaired successfully`);
      return parsed;
    } catch {
      throw firstErr;
    }
  }
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for Veo script generation");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface GenerateVeoScriptRequest {
  topic: string;
  title: string;
  location: string;
  tone: string;
  mood: string;
  industry: string;
  companyName: string;
  articleContent?: string;
  landingPageUrl?: string;
  teamId?: number;
  personaId?: number;
}

export async function generateVeoScript(
  request: GenerateVeoScriptRequest
): Promise<VeoVideoScript> {
  const {
    topic,
    title,
    location,
    tone,
    mood,
    industry,
    companyName,
    articleContent,
    teamId,
    personaId,
  } = request;

  console.log(`🎬 Generating Veo video script for: ${title}${personaId ? ' [PERSONA TARGETED]' : ''}`);
  
  const brandLockContext = companyName ? createBrandLockPromptSegment(companyName) : "";
  
  // PSYCHOGRAPHIC TARGETING: Fetch persona + learning context
  let personaContext = "";
  if (teamId) {
    try {
      const optimizationContext = await getContentOptimizationContext(teamId, "video", {
        personaId,
        industry,
      });
      
      if (optimizationContext.combinedSystemPrompt || optimizationContext.combinedUserPrompt) {
        console.log(`🧠 [PSYCHOGRAPHIC] Applying persona targeting for video script`);
        personaContext = `\n\n**PSYCHOGRAPHIC TARGETING:**${optimizationContext.combinedSystemPrompt}${optimizationContext.combinedUserPrompt}`;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to fetch psychographic context for video:`, error);
    }
  }

  const articleSection = articleContent
    ? `ARTICLE CONTENT (use this to drive SPECIFIC visual scenes — each clip must visually depict a concept from this content):\n${articleContent.slice(0, 2000)}`
    : "";

  const prompt = `You are a professional video director creating a cinematic social media video using AI video generation (Google Veo).${personaContext}
${brandLockContext}

CRITICAL: You are writing prompts for AI VIDEO GENERATION (Veo 3.1), not a traditional script.
Each clip will be generated as an 8-second AI video with motion, camera movements, and cinematic quality.

BUSINESS CONTEXT:
Company: ${companyName}
Industry: ${industry}
Topic: ${topic}
Title: ${title}
Location: ${location}
Tone: ${tone}
Mood: ${mood}

${articleSection}

VIDEO STRUCTURE (10 Clips - 60 Seconds Total):
Create EXACTLY 10 clips of 6 seconds each (60 seconds total). Structure across 3 narrative beats.
EACH CLIP PROMPT MUST depict a SPECIFIC scene directly related to the article content and topic above — NOT a generic cinematic shot.

BEATS 1-3 (HOOK - 0-18s):
Attention-grabbing opening that VISUALLY introduces the specific topic. Establish location context with cinematic camera movements.

BEATS 4-7 (SOLUTION - 18-42s):
SPECIFICALLY show the service/solution described in the article. Each clip must depict a distinct concept from the article content. Bright professional interiors, realistic interactions, contextually accurate environments.

BEATS 8-10 (CTA - 42-60s):
Action-oriented closing. Use visuals like: a person reaching toward camera, a phone glowing, a door opening, a handshake, someone nodding confidently. Narration must include EXPLICIT CTA: "Visit", "Contact", "Call", "Learn more", "Get started", "Book now".
DO NOT show company names, phone numbers, websites, or ANY text in video clips — the logo overlay is handled separately.

ANTI-HALLUCINATION RULES (ABSOLUTE — violation will break the video):
- ZERO TEXT in any clip: no letters, no numbers, no words, no signs, no captions, no name cards, no screens showing text, no subtitles burned into the video, no chyrons, no lower-thirds
- NO LOGOS: no brand marks, no watermarks, no badges
- NO SIGNAGE: no storefronts, no billboards, no directional signs
- Every prompt MUST end with: "No text, no captions, no logos, no watermarks, no signs of any kind anywhere in the frame"

PROMPT ENGINEERING RULES:
1. CONTENT-SPECIFIC: Each prompt must describe a scene DIRECTLY related to the article topic — not a generic location shot
2. STYLE CONSISTENCY: Every prompt must include "cinematic, 4K, shallow depth of field, film grain"
3. CAMERA MOVEMENT: Specify exact movement — "camera slowly pans left", "dolly forward", "tracking shot following subject"
4. MOTION: Always describe what's moving — people interacting, hands demonstrating, natural environment
5. FULL FRAME: Describe subjects that fill the entire frame — no empty space, no borders

NARRATION RULES:
- Clips 1-7: Conversational, engaging, directly references what's shown
- Clips 8-10: MUST include explicit action words — "Call us today", "Get started", "Learn more", "Book your consultation"
- Length: ~6-second narration (15-18 words per clip)

OUTPUT FORMAT:
{
  "title": "Engaging video title",
  "totalDuration": 60,
  "companyName": "${companyName}",
  "location": "${location}",
  "clips": [
    {
      "sceneNumber": 1,
      "targetDuration": 6,
      "prompt": "Cinematic shot of [SPECIFIC SCENE FROM ARTICLE TOPIC], camera slowly [MOVEMENT], [LIGHTING], 4K film quality, shallow depth of field, film grain. No text, no captions, no logos, no watermarks, no signs of any kind anywhere in the frame",
      "narration": "6-second voiceover matching this specific visual",
      "geoReference": "Specific ${location} element"
    }
  ]
}

CRITICAL: Return ONLY valid JSON. No markdown, no explanations. Every prompt MUST end with the no-text disclaimer.`;

  try {
    const _veoStart = Date.now();
    const response = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.8,
        maxOutputTokens: 8192,
      },
    });

    if (response?.usageMetadata) {
      void import("./cost-telemetry").then(({ safeLogCostTelemetry, extractGeminiUsage }) => {
        safeLogCostTelemetry(
          { operationType: "video_script", provider: "gemini", model: GEMINI_FLASH_MODEL },
          extractGeminiUsage(response),
          Date.now() - _veoStart, true
        );
      }).catch(() => {});
    }

    const text = (response.text || "").trim();
    
    let cleanedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    if (companyName) {
      console.log(`🔧 Auto-correcting brand name case: "${companyName}"`);
      const escapedBrand = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const caseInsensitiveRegex = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapedBrand}(?![\\p{L}\\p{N}_])`,
        'gui'
      );
      
      cleanedText = cleanedText.replace(caseInsensitiveRegex, companyName);
      console.log(`✅ Brand name case corrected to: "${companyName}"`);
    }

    const script: VeoVideoScript = safeParseJSON<VeoVideoScript>(cleanedText, "VeoScript");

    if (companyName) {
      console.log(`🔒 Validating brand spelling: "${companyName}"`);
      const validationResult = validateBrandInOutput(cleanedText, companyName);
      
      if (!validationResult.valid) {
        const errorMsg = `Brand lock violation in Veo script! ${validationResult.errors.join("; ")}`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      console.log(`✅ Brand spelling validated successfully`);
    }

    if (!script.clips || script.clips.length !== 10) {
      throw new Error(`Expected 10 clips, got ${script.clips?.length || 0}`);
    }

    console.log(`✅ Generated Veo script with 10 clips for 60-second video`);
    return script;
  } catch (error) {
    console.error("❌ Failed to generate Veo script:", error);
    throw new Error(`Veo script generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
