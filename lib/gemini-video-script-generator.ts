import { GEMINI_FLASH_MODEL } from "./ai-config";
import { GoogleGenAI } from "@google/genai";
import { createBrandLockPromptSegment, validateBrandInOutput } from "./branding";
import { validateContentWithFacts } from "./fact-validated-generators";
import { humanizeVideoScript } from "./deterministic-humanizer";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required for video script generation");
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VideoScene {
  sceneNumber: number;
  timeRange: string; // e.g., "0-10s", "10-22s"
  targetDuration: number; // Target duration in seconds (10, 12, 12, 12, or 14)
  narration: string; // Voiceover text for this scene
  visualDescription: string; // What image should show
  caption: string; // Text overlay for this scene
  geoReference: string; // Location-specific reference
  seoKeywords: string[]; // Keywords for this scene
  // Multi-voice support
  speaker?: string; // Speaker identifier (e.g., "Host", "Expert", "Narrator")
  speakerEmotion?: string; // Emotion for this speaker's delivery
}

export interface VideoScript {
  title: string;
  totalDuration: number; // Should be 60 seconds
  scenes: VideoScene[];
  hashtags: string[];
  callToAction: string;
  companyName: string;
  location: string;
}

export type VideoDialogueMode = "narration" | "interview" | "conversation" | "explainer";

export interface DialogueModeAnalysis {
  mode: VideoDialogueMode;
  confidence: number;
  reason: string;
}

export function analyzeContentForDialogueMode(
  topic: string,
  articleContent?: string,
  isManualScript?: boolean
): DialogueModeAnalysis {
  if (isManualScript) {
    return {
      mode: "narration",
      confidence: 1.0,
      reason: "Manual script input - using full 60s narration mode"
    };
  }

  const content = (topic + " " + (articleContent || "")).toLowerCase();
  
  const patterns = {
    interview: {
      keywords: ["interview", "q&a", "asked", "answered", "expert says", "according to", "we spoke with", "told us", "shares insights"],
      weight: 0
    },
    explainer: {
      keywords: ["how to", "guide", "tutorial", "learn", "understand", "explained", "step by step", "what is", "why does", "basics of"],
      weight: 0
    },
    conversation: {
      keywords: ["debate", "discussion", "perspectives", "opinions", "versus", "vs", "both sides", "pros and cons", "compare"],
      weight: 0
    },
    narration: {
      keywords: ["announcement", "news", "update", "introducing", "story", "journey", "history", "overview"],
      weight: 0
    }
  };

  for (const [mode, data] of Object.entries(patterns)) {
    for (const keyword of data.keywords) {
      if (content.includes(keyword)) {
        data.weight += 1;
      }
    }
  }

  const sorted = Object.entries(patterns).sort((a, b) => b[1].weight - a[1].weight);
  const topMode = sorted[0];
  const secondMode = sorted[1];
  
  if (!topMode || topMode[1].weight === 0) {
    return {
      mode: "narration",
      confidence: 0.6,
      reason: "No strong content signals - defaulting to narration"
    };
  }

  const confidence = secondMode && secondMode[1].weight > 0
    ? Math.min(0.95, 0.5 + (topMode[1].weight - secondMode[1].weight) * 0.15)
    : 0.8;

  const reasons: Record<VideoDialogueMode, string> = {
    interview: "Content contains Q&A patterns or expert quotes",
    explainer: "Content is educational/tutorial in nature",
    conversation: "Content presents multiple perspectives or debate",
    narration: "Content is informational/announcement style"
  };

  return {
    mode: topMode[0] as VideoDialogueMode,
    confidence,
    reason: reasons[topMode[0] as VideoDialogueMode] || "Pattern matched"
  };
}

function getDialogueModeInstructions(mode: VideoDialogueMode): string {
  const modes: Record<VideoDialogueMode, string> = {
    narration: `
VOICE MODE: Single Narrator (Long-Form)
- Use "Narrator" as the speaker for ALL scenes
- Maintain consistent voice throughout
- Write as a documentary-style voiceover
- speakerEmotion should match the scene's emotional tone
- SCENE DURATION: Use 2-3 longer scenes (20-45 seconds each) instead of many short ones
- Since there's only one speaker, no need for frequent scene breaks
- Break scenes at natural visual transitions, not for speaker changes`,
    
    interview: `
VOICE MODE: Interview Format (Two Distinct Voices)
CRITICAL: Each scene has exactly ONE speaker. Alternate speakers BETWEEN scenes, not within them.
SCENE DURATION: 8-15 seconds per scene (for clean speaker transitions and lip-sync)
- Scene 1 (Host): Introduces the topic with an engaging hook
- Scene 2 (Expert): Provides key insights and expertise
- Scene 3 (Host): Asks a follow-up question or transitions
- Scene 4 (Expert): Gives practical advice and deeper insights
- Scene 5 (Host): Wraps up with CTA mentioning the company
Valid speakers: "Host" (energetic, welcoming) or "Expert" (wise, authoritative)
speakerEmotion options: warm, excited, contemplative, authoritative, inspirational`,
    
    conversation: `
VOICE MODE: Conversation Format (Two Distinct Voices)
CRITICAL: Each scene has exactly ONE speaker. Speakers alternate BETWEEN scenes.
SCENE DURATION: 8-15 seconds per scene (keeps dialogue dynamic)
- Scene 1 (Host): Opens the conversation with an engaging hook
- Scene 2 (Guest): Shares their perspective or experience
- Scene 3 (Host): Responds and adds context
- Scene 4 (Guest): Provides key takeaways
- Scene 5 (Host): Wraps up with CTA
Valid speakers: "Host" or "Guest"
speakerEmotion options: warm, conversational, excited, contemplative`,
    
    explainer: `
VOICE MODE: Teacher-Student Format (Two Distinct Voices)
CRITICAL: Each scene has exactly ONE speaker. Alternate BETWEEN scenes.
SCENE DURATION: 10-20 seconds per scene (allows for explanations)
- Scene 1 (Teacher): Introduces the topic
- Scene 2 (Student): Asks a clarifying question viewers might have
- Scene 3 (Teacher): Provides clear, helpful explanation
- Scene 4 (Student): Expresses understanding, asks follow-up
- Scene 5 (Teacher): Summarizes and mentions company as resource
Valid speakers: "Teacher" or "Student"
speakerEmotion options: warm, curious, excited, contemplative`,
  };
  
  return modes[mode] || modes.narration;
}

interface GenerateVideoScriptRequest {
  topic: string;
  title: string;
  location: string;
  tone: string;
  mood: string;
  industry: string;
  companyName: string;
  articleContent?: string;
  landingPageUrl?: string;
  enableFactValidation?: boolean;
  teamId?: number;
  videoId?: number;
  dialogueMode?: VideoDialogueMode;
  isManualScript?: boolean;
}

export async function generateVideoScript(
  request: GenerateVideoScriptRequest
): Promise<VideoScript> {
  const {
    topic,
    title,
    location,
    tone,
    mood,
    industry,
    companyName,
    articleContent,
    landingPageUrl,
    isManualScript = false,
  } = request;

  let dialogueMode = request.dialogueMode;
  
  if (!dialogueMode) {
    const analysis = analyzeContentForDialogueMode(topic, articleContent, isManualScript);
    dialogueMode = analysis.mode;
    console.log(`🎯 Auto-selected dialogue mode: ${dialogueMode} (${(analysis.confidence * 100).toFixed(0)}% confidence)`);
    console.log(`   Reason: ${analysis.reason}`);
  }

  console.log(`🎬 Generating 60-second video script for: ${title} (mode: ${dialogueMode})`);
  
  const brandLockContext = companyName ? createBrandLockPromptSegment(companyName) : "";
  
  const dialogueModeInstructions = getDialogueModeInstructions(dialogueMode);

  const prompt = `You are a professional video script writer creating a 60-second social media video script.
${brandLockContext}

ANTI-HALLUCINATION RULES (CRITICAL):
- Do NOT include website URLs anywhere in the script
- Do NOT invent or mention website addresses
- The URL will be added as a text overlay in post-production
- Focus on compelling narration without URL references

BUSINESS CONTEXT:
Company: ${companyName}
Industry: ${industry}
Topic: ${topic}
Title: ${title}
Location: ${location}
Tone: ${tone}
Mood: ${mood}
${articleContent ? `Article Content (for reference):\n${articleContent.slice(0, 2000)}` : ""}

VIDEO STRUCTURE:
Create EXACTLY 5 scenes totaling 60 seconds (intro: 10s, body1: 12s, body2: 12s, conclusion: 12s, branded CTA: 14s).
${dialogueModeInstructions}

CRITICAL NARRATION LENGTH REQUIREMENTS (MUST FOLLOW EXACTLY):
- Scene 1: Write narration of EXACTLY 30-35 words (10 seconds at 3 words/second)
- Scene 2: Write narration of EXACTLY 36-42 words (12 seconds at 3 words/second)
- Scene 3: Write narration of EXACTLY 36-42 words (12 seconds at 3 words/second)
- Scene 4: Write narration of EXACTLY 36-42 words (12 seconds at 3 words/second)
- Scene 5: Write narration of EXACTLY 42-50 words (14 seconds at 3 words/second)
- TOTAL: Must be 180-210 words across all 5 scenes to fill the full 60 seconds
- WARNING: Short narration leaves awkward silence at the end - write MORE words, not fewer

**CRITICAL: THIS IS EDUCATIONAL CONTENT, NOT AN ADVERTISEMENT**
The video should be INFORMATIONAL and HELPFUL, not promotional.
- Scenes 1-4 must be 100% educational - NO company mentions
- Only Scene 5 (final 14 seconds) may include a brief CTA mention of ${companyName}
- Write like a documentary or educational video, NOT a commercial

SCENE REQUIREMENTS:
Scene 1 (0-10s): HOOK/INTRO - Grab attention with a compelling question or interesting fact about the topic in ${location}
Scene 2 (10-22s): CONTEXT - Explain the topic/subject matter with helpful information
Scene 3 (22-34s): KEY INSIGHTS - Share valuable tips, facts, or guidance relevant to ${location} residents
Scene 4 (34-46s): PRACTICAL ADVICE - Provide actionable takeaways the viewer can use
Scene 5 (46-60s): CTA/OUTRO - Brief mention of ${companyName} as a helpful resource (keep promotional, logo-friendly)
CRITICAL: Do NOT include website URLs in narration or captions - URL will be added as text overlay in post-production

MANDATORY REQUIREMENTS:
✅ Scenes 1-4 must be purely educational - NO company mentions, NO promotional language
✅ Include ${location} (city/neighborhood) references naturally for local relevance
✅ Use ${tone} tone throughout
✅ Match ${mood} mood in language and pacing
✅ Each scene must have: narration (spoken), visual description (what to show), and caption (text overlay)
✅ Narration should be conversational and engaging (not robotic or salesy)
✅ CRITICAL: Write 180-210 total words across all scenes - short narration causes SILENCE at video end
✅ Visual descriptions should be specific and cinematic - NO company branding in scenes 1-4
✅ Captions should be short, punchy, and informative (NOT promotional)
✅ Only Scene 5 may include ${companyName} - keep it brief and helpful, not pushy
✅ Scene 5 visual description should be logo-friendly and clean for text overlay
✅ Include 8-12 relevant hashtags combining topic keywords and ${location} geo-tags

SEO/GEO OPTIMIZATION:
- Weave ${location} landmarks, neighborhoods, or local references naturally into narration
- Use location-based keywords (e.g., "${location} ${industry}", "local ${industry} in ${location}")
- Include industry-specific SEO terms throughout

OUTPUT FORMAT:
Return a valid JSON object with this exact structure:
{
  "title": "Engaging video title",
  "totalDuration": 60,
  "scenes": [
    {
      "sceneNumber": 1,
      "timeRange": "0-10s",
      "targetDuration": 10,
      "speaker": "Narrator",
      "speakerEmotion": "warm",
      "narration": "Spoken voiceover text - conversational, engaging, natural hook",
      "visualDescription": "Detailed description of what image should show - specific and cinematic",
      "caption": "SHORT TEXT OVERLAY",
      "geoReference": "Specific ${location} reference in this scene",
      "seoKeywords": ["keyword1", "keyword2", "keyword3"]
    },
    {
      "sceneNumber": 2,
      "timeRange": "10-22s",
      "targetDuration": 12,
      "speaker": "Narrator",
      "speakerEmotion": "warm",
      "narration": "Problem/opportunity explanation - keep to ~12 seconds",
      "visualDescription": "Visual for problem/opportunity scene",
      "caption": "SHORT TEXT OVERLAY",
      "geoReference": "Specific ${location} reference",
      "seoKeywords": ["keyword1", "keyword2"]
    },
    {
      "sceneNumber": 3,
      "timeRange": "22-34s",
      "targetDuration": 12,
      "speaker": "Narrator",
      "speakerEmotion": "contemplative",
      "narration": "Solution explanation - keep to ~12 seconds",
      "visualDescription": "Visual for solution scene",
      "caption": "SHORT TEXT OVERLAY",
      "geoReference": "Specific ${location} reference",
      "seoKeywords": ["keyword1", "keyword2"]
    },
    {
      "sceneNumber": 4,
      "timeRange": "34-46s",
      "targetDuration": 12,
      "speaker": "Narrator",
      "speakerEmotion": "inspirational",
      "narration": "Conclusion and benefits - keep to ~12 seconds",
      "visualDescription": "Visual for conclusion scene",
      "caption": "SHORT TEXT OVERLAY",
      "geoReference": "Specific ${location} reference",
      "seoKeywords": ["keyword1", "keyword2"]
    },
    {
      "sceneNumber": 5,
      "timeRange": "46-60s",
      "targetDuration": 14,
      "speaker": "Narrator",
      "speakerEmotion": "warm",
      "narration": "Brief helpful CTA mentioning ${companyName} as a resource - keep to ~14 seconds",
      "visualDescription": "Clean professional outro visual suitable for logo overlay - NOT overly promotional",
      "caption": "Learn More | ${companyName}",
      "geoReference": "Specific ${location} reference",
      "seoKeywords": ["keyword1", "keyword2"]
    }
  ],
  "hashtags": ["#HashtagWithoutSpaces", "#Another", ...],
  "callToAction": "Learn more about this topic",
  "companyName": "${companyName}",
  "location": "${location}"
}

CRITICAL: Return ONLY valid JSON. No markdown formatting, no explanations, just pure JSON.`;

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.8,
        maxOutputTokens: 2000,
      },
    });

    const text = (response.text || "").trim();
    
    // Remove markdown code blocks if present
    let cleanedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    // Auto-correct brand name case before parsing
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

    const script: VideoScript = JSON.parse(cleanedText);

    // Brand lock validation (Layer 2: Runtime Validation)
    if (companyName) {
      console.log(`🔒 Validating brand spelling: "${companyName}"`);
      const validationResult = validateBrandInOutput(cleanedText, companyName);
      
      if (!validationResult.valid) {
        const errorMsg = `Brand lock violation in video script! ${validationResult.errors.join("; ")}`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      console.log(`✅ Brand spelling validated successfully`);
    }

    // VALIDATION: Ensure no URLs were hallucinated (should be ZERO URLs in script)
    const scriptJson = JSON.stringify(script);
    const urlPattern = /https?:\/\/[^\s"',]+/g;
    const foundUrls = scriptJson.match(urlPattern) || [];
    
    if (foundUrls.length > 0) {
      console.error(`❌ URL HALLUCINATION DETECTED: Found URLs in script when none should exist:`, foundUrls);
      throw new Error(`URL hallucination detected! Found: ${foundUrls.join(", ")}. Script should not contain any URLs - they are added via FFmpeg overlay.`);
    }
    
    console.log(`✅ URL validation passed - no hallucinated URLs detected`);

    // Validation
    if (!script.scenes || script.scenes.length !== 5) {
      throw new Error(`Expected 5 scenes, got ${script.scenes?.length || 0}`);
    }

    if (script.totalDuration !== 60) {
      console.warn(`⚠️ Duration mismatch: ${script.totalDuration}s, forcing to 60s`);
      script.totalDuration = 60;
    }

    console.log(`✅ Generated 60-second video script with 5 scenes (intro, body1, body2, conclusion, branded CTA)`);

    // DETERMINISTIC HUMANIZATION: Apply burstiness and scrub AI-isms to narration
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      if (scene) {
        const humanized = humanizeVideoScript(scene.narration, 0.40);
        scene.narration = humanized.content;
      }
    }
    console.log(`🔧 [DH] Video script humanized: ${script.scenes.length} scenes processed`);

    if (request.enableFactValidation && request.teamId) {
      try {
        console.log(`🔍 [Anti-Hallucination] Starting fact validation for video script...`);
        
        const scriptContent = script.scenes.map(s => s.narration).join('\n');
        const validationResult = await validateContentWithFacts(
          scriptContent,
          "video",
          {
            teamId: request.teamId,
            enableFactValidation: true,
            minConfidence: 75,
            topic: request.topic,
            contentId: request.videoId,
          }
        );

        console.log(`✅ [Anti-Hallucination] Video script validated. Safety: ${validationResult.validationResult?.safetyScore}%, Facts: ${validationResult.factPack.totalCount}`);
      } catch (error) {
        console.warn('⚠️ Fact validation skipped for video script:', (error as Error).message);
      }
    }

    return script;
  } catch (error) {
    console.error("❌ Failed to generate video script:", error);
    throw new Error(`Video script generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
