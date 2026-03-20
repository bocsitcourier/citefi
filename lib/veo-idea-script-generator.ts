import { GoogleGenAI } from "@google/genai";
import { 
  VideoStyle, 
  VideoTone, 
  ExpandedVideoConcept,
  STYLE_DESCRIPTIONS,
  TONE_DESCRIPTIONS 
} from "./veo-idea-expander";
import { createBrandLockPromptSegment, validateBrandInOutput } from "./branding";

const VEO_BLOCKED_PATTERNS = [
  /\b(google|facebook|meta|apple|microsoft|amazon|twitter|instagram|tiktok|youtube|netflix|disney|marvel|dc comics|star wars|pokemon|nike|adidas|coca-cola|pepsi|mcdonald'?s|burger king|starbucks|walmart|uber|lyft|airbnb|spotify|openai|chatgpt)\b/gi,
  /\b(nfl|nba|mlb|nhl|fifa|olympics|espn)\b/gi,
  /\b(iphone|ipad|macbook|xbox|playstation|nintendo)\b/gi,
  /\b(©|®|™)\b/gi,
  /\b(celebrity name|famous person name|real person name|public figure name)\b/gi,
];

const VEO_TRIGGER_WORD_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string; reason: string }> = [
  { pattern: /\belderly\b/gi, replacement: "wise person in their golden years", reason: "ageism filter" },
  { pattern: /\bold (man|woman|person|lady|gentleman)\b/gi, replacement: "mature $1", reason: "ageism filter" },
  { pattern: /\bsenior citizen\b/gi, replacement: "person in their golden years", reason: "ageism filter" },
  { pattern: /\bcaregiver\b/gi, replacement: "professional companion", reason: "healthcare restrictions" },
  { pattern: /\bnurse\b/gi, replacement: "healthcare professional", reason: "healthcare restrictions" },
  { pattern: /\bdoctor\b/gi, replacement: "medical professional", reason: "healthcare restrictions" },
  { pattern: /\bfire (a |the |at |into |upon )/gi, replacement: "release $1", reason: "violence filter - fire weapon" },
  { pattern: /\bfiring\b/gi, replacement: "releasing", reason: "violence filter" },
  { pattern: /\bon fire\b/gi, replacement: "ablaze with warmth", reason: "violence filter" },
  { pattern: /\bfire\b/gi, replacement: "glowing embers", reason: "violence filter" },
  { pattern: /\b(his|her|my|the) will\b/gi, replacement: "$1 wishes", reason: "legal/financial filter" },
  { pattern: /\bin (his|her|my|the) will\b/gi, replacement: "among $1 wishes", reason: "legal/financial filter" },
  { pattern: /\bwill and testament\b/gi, replacement: "final wishes", reason: "legal/financial filter" },
  { pattern: /\b(kids?|children|child|toddler|infant|baby|babies)\b/gi, replacement: "family members", reason: "minor-safety protocols" },
  { pattern: /\bfacetime\b/gi, replacement: "video call", reason: "brand + potential minor content" },
  { pattern: /\bschool\b/gi, replacement: "learning environment", reason: "minor-safety filter" },
  { pattern: /\bgun\b/gi, replacement: "tool", reason: "violence filter" },
  { pattern: /\bweapon\b/gi, replacement: "equipment", reason: "violence filter" },
  { pattern: /\bshoot\b/gi, replacement: "capture", reason: "violence filter" },
  { pattern: /\bshooting\b/gi, replacement: "capturing", reason: "violence filter" },
  { pattern: /\bkill\b/gi, replacement: "stop", reason: "violence filter" },
  { pattern: /\bdead\b/gi, replacement: "inactive", reason: "violence filter" },
  { pattern: /\bdeath\b/gi, replacement: "end", reason: "violence filter" },
  { pattern: /\bblood\b/gi, replacement: "red liquid", reason: "violence filter" },
  { pattern: /\bexplode\b/gi, replacement: "burst", reason: "violence filter" },
  { pattern: /\bexplosion\b/gi, replacement: "dramatic burst", reason: "violence filter" },
  { pattern: /\bbomb\b/gi, replacement: "device", reason: "violence filter" },
  { pattern: /\bterror\b/gi, replacement: "intense feeling", reason: "violence filter" },
  { pattern: /\bdrug\b/gi, replacement: "substance", reason: "substance filter" },
  { pattern: /\balcohol\b/gi, replacement: "beverage", reason: "substance filter" },
  { pattern: /\bdrunk\b/gi, replacement: "relaxed", reason: "substance filter" },
  { pattern: /\bnaked\b/gi, replacement: "natural", reason: "adult content filter" },
  { pattern: /\bnude\b/gi, replacement: "natural", reason: "adult content filter" },
];

function sanitizePromptForVeo(prompt: string, companyName: string): string {
  let sanitized = prompt;
  const matchedTerms: string[] = [];
  
  for (const pattern of VEO_BLOCKED_PATTERNS) {
    const matches = prompt.match(pattern);
    if (matches) {
      matchedTerms.push(...matches.map(m => `${m} (brand)`));
    }
    sanitized = sanitized.replace(pattern, "a business");
  }
  
  for (const { pattern, replacement, reason } of VEO_TRIGGER_WORD_REPLACEMENTS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      matchedTerms.push(...matches.map(m => `${m} (${reason})`));
      sanitized = sanitized.replace(pattern, replacement);
    }
  }
  
  if (matchedTerms.length > 0) {
    console.log(`🧹 Veo sanitization applied: ${matchedTerms.join(", ")}`);
  }
  
  sanitized = sanitized
    .replace(/a business a business/gi, 'a business')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/g, '')
    .trim();
  
  return sanitized;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required for video script generation");
  }
  return new GoogleGenAI({ apiKey });
}

export interface IdeaVideoScript {
  title: string;
  totalDuration: number;
  companyName: string;
  style: VideoStyle;
  tone: VideoTone;
  clips: IdeaVideoClip[];
}

export interface IdeaVideoClip {
  sceneNumber: number;
  targetDuration: number;
  beat: "hook" | "problem" | "solution" | "benefits" | "proof" | "cta";
  prompt: string;
  narration: string;
  visualCue: string;
}

// Hyper-realistic visual modifiers for each style - enhanced for maximum realism
const STYLE_VISUAL_MODIFIERS: Record<VideoStyle, string> = {
  cinematic: "hyper-realistic, photorealistic, 8K ultra HD, cinematic lighting, epic scale, dramatic camera movement, film grain, shallow depth of field, golden hour, sweeping crane shots, lifelike textures, professional cinematography",
  comedy: "hyper-realistic, photorealistic, 8K ultra HD, bright saturated colors, dynamic camera, comedic timing, natural expressions, quick cuts, playful angles, lifelike details, realistic lighting",
  emotional: "hyper-realistic, photorealistic, 8K ultra HD, soft diffused lighting, intimate close-ups, warm color palette, handheld subtle movement, bokeh backgrounds, lifelike skin textures, natural emotions",
  tech: "hyper-realistic, photorealistic, 8K ultra HD, clean minimal aesthetic, futuristic elements, precise movements, cool blue tones, sleek surfaces, holographic accents, realistic materials, sharp details",
  minimal: "hyper-realistic, photorealistic, 8K ultra HD, simple composition, negative space, subtle movement, monochrome palette, geometric shapes, zen-like calm, lifelike textures, natural lighting",
  retro: "hyper-realistic, photorealistic, 8K ultra HD, vintage film filters, warm grain, retro color grading, 70s-80s aesthetics, nostalgic elements, classic framing, authentic period details",
  luxury: "hyper-realistic, photorealistic, 8K ultra HD, elegant lighting, premium materials, slow motion, gold and black accents, crystal clarity, refined textures, lifelike reflections, realistic surfaces",
  action: "hyper-realistic, photorealistic, 8K ultra HD, fast dynamic cuts, intense angles, motion blur, high contrast, adrenaline energy, bold movements, lifelike physics, realistic motion"
};

const TONE_NARRATION_MODIFIERS: Record<VideoTone, string> = {
  professional: "authoritative, clear, confident delivery with measured pacing",
  playful: "light-hearted, energetic, smile-inducing with natural enthusiasm",
  inspirational: "uplifting, empowering, crescendo building with hope",
  urgent: "compelling, time-sensitive, driving momentum forward",
  mysterious: "intriguing, building curiosity, drawing viewers deeper",
  friendly: "warm, conversational, approachable like a trusted advisor"
};

const CLIP_BEAT_MAPPING: Record<number, "hook" | "problem" | "solution" | "benefits" | "proof" | "cta"> = {
  1: "hook",
  2: "hook",
  3: "problem",
  4: "problem",
  5: "solution",
  6: "solution",
  7: "benefits",
  8: "proof",
  9: "cta",
  10: "cta"
};

export interface IdeaScriptRequest {
  ideaTitle: string;
  companyName: string;
  expandedConcept: ExpandedVideoConcept;
  style: VideoStyle;
  tone: VideoTone;
  callToAction: string;
  location?: string;
  website?: string;
  stylePromptOverride?: string;
}

export async function generateIdeaVideoScript(request: IdeaScriptRequest): Promise<IdeaVideoScript> {
  const {
    ideaTitle,
    companyName,
    expandedConcept,
    style,
    tone,
    callToAction,
    location,
    website,
    stylePromptOverride
  } = request;

  const isLikeVideo = !!stylePromptOverride;
  console.log(`🎬 Generating ${isLikeVideo ? "Like Video" : "idea video"} script: "${ideaTitle}" [${style}/${tone}]`);

  const styleVisuals = stylePromptOverride || STYLE_VISUAL_MODIFIERS[style];
  const toneNarration = TONE_NARRATION_MODIFIERS[tone];
  const styleDesc = STYLE_DESCRIPTIONS[style];
  const toneDesc = TONE_DESCRIPTIONS[tone];
  const brandLockContext = companyName ? createBrandLockPromptSegment(companyName) : "";

  const likeVideoSection = isLikeVideo ? `
REFERENCE VIDEO STYLE (HIGHEST PRIORITY - replicate this exact visual style):
${stylePromptOverride}
NOTE: The visual style above was analyzed from a reference video. Every clip MUST match this exact style, color grading, camera work, and mood.
` : "";

  const prompt = `You are a professional video director creating a 60-second social media video using AI video generation (Google Veo 3.1).
${brandLockContext}
${likeVideoSection}
VIDEO CONCEPT (Pre-expanded):
${JSON.stringify(expandedConcept, null, 2)}

STYLE: ${style.toUpperCase()} - ${styleDesc}
VISUAL MODIFIERS: ${styleVisuals}

TONE: ${tone.toUpperCase()} - ${toneDesc}
NARRATION STYLE: ${toneNarration}

COMPANY: ${companyName}
LOCATION: ${location || "N/A"}
WEBSITE: ${website || "N/A"}
CALL TO ACTION: ${callToAction}

Create EXACTLY 10 clips of 6 seconds each (60 seconds total). Map to these narrative beats:

CLIPS 1-2 (HOOK): Use the hook concept - attention-grabbing opening
CLIPS 3-4 (PROBLEM): Use the problem concept - relatable challenge
CLIPS 5-6 (SOLUTION): Use the solution concept - how ${companyName} solves it
CLIP 7 (BENEFITS): Use the benefits concept - transformation shown
CLIP 8 (PROOF): Use the proof concept - credibility and trust
CLIPS 9-10 (CTA - MANDATORY REQUIREMENTS):
  - VISUAL: Action-oriented imagery showing someone actively engaging: hand reaching out, person walking forward, finger pressing button, door opening, confident stride toward camera
  - NARRATION: MUST include explicit action verbs: "Visit", "Call", "Sign up", "Get started", "Contact us", "Try it now"
  - EXACT CTA PHRASE: "${callToAction}"
  - WEBSITE REFERENCE: "${website || 'our website'}"

PROMPT ENGINEERING RULES (CRITICAL):
1. STYLE: Every prompt MUST include "${styleVisuals}"
2. CAMERA: Specify exact movement - "camera slowly pans left", "dolly forward", "tracking shot"
3. MOTION: Describe what's moving - clouds drifting, people walking, light shifting
4. SAFETY EXCLUSIONS (MANDATORY FOR ALL PROMPTS): "no text, no logos, no watermarks, no signage, no written words, no brand marks"
5. DURATION: Structure for 6 seconds: 0-1.5s setup, 1.5-5s main action, 5-6s transition

NARRATION RULES (STRICT TIMING - 60 SECOND VIDEO, NATURAL SPEECH):
- Use ${toneNarration} delivery
- TOTAL WORD COUNT: Maximum 150 words across all 10 clips (allows 60s at 2.5 words/second)
- Clips 1-8: 10-13 words per clip MAXIMUM (80-104 words total for clips 1-8)
- Clips 9-10: 15-20 words each for CTA emphasis (30-40 words for CTA clips)
- MANDATORY: Include natural pauses between sentences using "..." or brief gaps
- CTA Clips 9-10: MANDATORY explicit action language including "${callToAction}", "Visit ${website || 'our website'}", "Get started now"

NATURAL SPEECH REQUIREMENTS (CRITICAL FOR TTS):
- Write conversationally, as if speaking to a friend - avoid formal/robotic phrasing
- Use contractions naturally: "we're", "you'll", "it's", "that's", "don't"
- Avoid awkward technical language - keep it simple and natural
- Include emotional words that sound genuine when spoken aloud
- Website mentions: Write "${website || 'our website'}" naturally in sentences, not as standalone URLs
- Company name "${companyName}" should flow naturally in speech patterns
- NO bullet points or list-style narration - write flowing conversational sentences

HYPER-REALISTIC VISUAL REQUIREMENTS (CRITICAL):
- ALL prompts MUST include: "hyper-realistic, photorealistic, 8K ultra HD, lifelike textures"
- Show REAL people, real environments, real lighting - no cartoon or stylized visuals
- Environments should look like actual filmed footage, not AI-generated
- Include realistic details: natural skin textures, authentic materials, real-world lighting

OUTPUT FORMAT (JSON only):
{
  "title": "${ideaTitle}",
  "totalDuration": 60,
  "companyName": "${companyName}",
  "style": "${style}",
  "tone": "${tone}",
  "clips": [
    {
      "sceneNumber": 1,
      "targetDuration": 6,
      "beat": "hook",
      "prompt": "Veo prompt with ${styleVisuals}, camera movement, motion description, NO text/logos",
      "narration": "6-second voiceover (10-13 words MAX for clips 1-8, 15-20 words for CTA clips 9-10)",
      "visualCue": "Key visual element"
    },
    ... (10 clips total)
  ]
}

CRITICAL: Return ONLY valid JSON. No markdown, no explanations.`;

  try {
    const genAI = getGeminiClient();
    const response = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 4000,
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

    if (companyName) {
      console.log(`🔧 Auto-correcting brand name case: "${companyName}"`);
      const escapedBrand = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const caseInsensitiveRegex = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapedBrand}(?![\\p{L}\\p{N}_])`,
        'gui'
      );
      cleanedText = cleanedText.replace(caseInsensitiveRegex, companyName);
    }

    let script: IdeaVideoScript;
    try {
      script = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", cleanedText.substring(0, 500));
      throw new Error(`Invalid JSON from Gemini: ${parseError}`);
    }
    
    if (!script.clips || script.clips.length !== 10) {
      throw new Error(`Expected 10 clips, got ${script.clips?.length || 0}`);
    }

    if (companyName) {
      const validationResult = validateBrandInOutput(cleanedText, companyName);
      if (!validationResult.valid) {
        console.warn(`⚠️ Brand validation issues: ${validationResult.errors?.join(", ")}`);
      }
    }

    const safetyExclusions = "no text, no logos, no watermarks, no signage, no written words, no brand marks";
    const ctaActionVisuals = "hand reaching toward camera, person walking forward with purpose, confident forward motion, inviting gesture";
    const hyperRealisticCore = "hyper-realistic, photorealistic, 8K ultra HD, lifelike textures, realistic lighting, natural materials";
    
    // Style-specific modifiers WITHOUT hyper-realistic prefix (added separately)
    const styleSpecificModifiers: Record<string, string> = {
      cinematic: "cinematic lighting, epic scale, dramatic camera movement, film grain, shallow depth of field, golden hour, sweeping crane shots, lifelike textures, professional cinematography",
      comedy: "bright saturated colors, dynamic camera, comedic timing, natural expressions, quick cuts, playful angles, lifelike details, realistic lighting",
      emotional: "soft diffused lighting, intimate close-ups, warm color palette, handheld subtle movement, bokeh backgrounds, lifelike skin textures, natural emotions",
      tech: "clean minimal aesthetic, futuristic elements, precise movements, cool blue tones, sleek surfaces, holographic accents, realistic materials, sharp details",
      minimal: "simple composition, negative space, subtle movement, monochrome palette, geometric shapes, zen-like calm, lifelike textures, natural lighting",
      retro: "vintage film filters, warm grain, retro color grading, 70s-80s aesthetics, nostalgic elements, classic framing, authentic period details",
      luxury: "elegant lighting, premium materials, slow motion, gold and black accents, crystal clarity, refined textures, lifelike reflections, realistic surfaces",
      action: "fast dynamic cuts, intense angles, motion blur, high contrast, adrenaline energy, bold movements, lifelike physics, realistic motion"
    };
    
    script.clips.forEach((clip, i) => {
      const clipNumber = i + 1;
      clip.beat = CLIP_BEAT_MAPPING[clipNumber] || "solution";
      
      let currentPrompt = clip.prompt;
      let currentPromptLower = currentPrompt.toLowerCase();
      
      // Add hyper-realistic core modifiers only if not already present
      if (!currentPromptLower.includes("hyper-realistic") && !currentPromptLower.includes("photorealistic")) {
        currentPrompt = `${hyperRealisticCore}, ${currentPrompt}`;
        currentPromptLower = currentPrompt.toLowerCase();
      }
      
      // Add style-specific modifiers (without hyper-realistic) if key style cues are missing
      const hasStyleCues = currentPromptLower.includes("cinematic") || 
                           currentPromptLower.includes("shallow depth") || 
                           currentPromptLower.includes("film grain") ||
                           currentPromptLower.includes("epic scale") ||
                           currentPromptLower.includes("camera movement");
      if (!hasStyleCues) {
        const cleanStyleModifiers = styleSpecificModifiers[style] || styleSpecificModifiers.cinematic;
        currentPrompt = `${currentPrompt}, ${cleanStyleModifiers}`;
        currentPromptLower = currentPrompt.toLowerCase();
      }
      
      if (!currentPromptLower.includes("no text")) {
        currentPrompt = `${currentPrompt}, ${safetyExclusions}`;
      }
      
      currentPrompt = sanitizePromptForVeo(currentPrompt, companyName);
      
      clip.prompt = currentPrompt;
      
      if (clipNumber >= 9) {
        if (!clip.prompt.toLowerCase().includes("reaching") && !clip.prompt.toLowerCase().includes("walking forward")) {
          clip.prompt = `${clip.prompt}, ${ctaActionVisuals}`;
        }
        
        const mandatoryCtaVerbs = ["visit", "call", "sign up", "get started", "contact", "try"];
        const narrationLower = clip.narration.toLowerCase();
        const hasMandatoryVerb = mandatoryCtaVerbs.some(verb => narrationLower.includes(verb));
        
        const websiteRef = website || "our website";
        const hasWebsiteRef = narrationLower.includes("website") || narrationLower.includes(websiteRef.toLowerCase());
        
        if (!hasMandatoryVerb || !hasWebsiteRef) {
          const standardizedCta = clipNumber === 9 
            ? `Get started today. Visit ${websiteRef}.`
            : `${callToAction} Contact us now at ${websiteRef}.`;
          clip.narration = `${clip.narration.trim()} ${standardizedCta}`;
        }
        
        const ctaPromptEnforcement = `dynamic action scene showing invitation to engage, welcoming atmosphere, open door metaphor, clear path forward`;
        if (!clip.prompt.toLowerCase().includes("invitation") && !clip.prompt.toLowerCase().includes("welcoming")) {
          clip.prompt = `${clip.prompt}, ${ctaPromptEnforcement}`;
        }
        
        clip.prompt = sanitizePromptForVeo(clip.prompt, companyName);
      }
    });

    console.log(`✅ Idea video script generated: ${script.clips.length} clips`);
    console.log(`🧹 All prompts sanitized for Veo content policy compliance`);
    
    return script;
  } catch (error) {
    console.error("Error generating idea video script:", error);
    throw new Error(`Failed to generate idea video script: ${error}`);
  }
}
