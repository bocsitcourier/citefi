import { openaiClient, callOpenAI } from "./openai-client";
import type { VeoClipPrompt } from "./veo-video-generator";
import { objectStorageClient } from "./storage";
import { TTS_MODEL, TTS_VOICE } from "./ai-config";

// Voice selection based on content tone
const TONE_VOICE_MAP: Record<string, "alloy" | "ash" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer"> = {
  Professional: "coral",      // Warm, friendly
  Authoritative: "onyx",      // Deep, commanding
  "Friendly-Professional": "coral",
  Insightful: "sage",         // Wise, measured
  Executive: "onyx",
  Motivational: "nova",       // Energetic, upbeat
  Analytical: "ash",          // Clear, professional
  Storytelling: "fable",      // Expressive, dramatic
  default: "coral",           // Warm default for educational content
};

// Emotional instructions for gpt-4o-mini-tts based on content tone
const TONE_INSTRUCTIONS: Record<string, string> = {
  Professional: "Speak in a warm, confident, and approachable tone. Sound like a knowledgeable expert who genuinely wants to help. Use natural pacing with slight emphasis on key points. Convey trustworthiness and expertise without sounding robotic or overly formal.",
  Authoritative: "Speak with confident authority and gravitas. Use measured pacing and a deeper register. Sound like an experienced industry leader sharing important insights. Be commanding but not condescending.",
  "Friendly-Professional": "Sound like a friendly, helpful expert having a natural conversation. Be warm and approachable while maintaining credibility. Use conversational rhythm with genuine enthusiasm when discussing solutions.",
  Insightful: "Speak thoughtfully and reflectively, like sharing valuable wisdom. Use deliberate pacing with natural pauses for emphasis. Sound wise and considered, inviting the listener to think deeper.",
  Executive: "Speak with executive presence - confident, decisive, and strategic. Use clear, authoritative delivery. Sound like a respected leader addressing stakeholders.",
  Motivational: "Speak with genuine enthusiasm and energy. Be inspiring and uplifting while remaining authentic. Use dynamic pacing - build excitement at key moments, pause for impact.",
  Analytical: "Speak clearly and precisely, emphasizing logical structure. Sound intelligent and thorough. Use measured pacing that helps listeners follow complex information.",
  Storytelling: "Speak expressively like a skilled narrator. Vary your tone to create engagement. Build tension and release. Make the listener feel part of the story.",
  default: "Speak naturally and conversationally, like a knowledgeable friend explaining something important. Be warm, genuine, and engaging. Use natural pacing with appropriate emphasis on key insights.",
};

// Phonetic pronunciation map for brand names that TTS mispronounces
// These replacements are applied to TTS input only, not captions/display text
const PRONUNCIATION_MAP: Record<string, string> = {
  "Bocsit": "Bock-sit",
  "BOCSIT": "Bock-sit", 
  "bocsit": "bock-sit",
};

// Apply phonetic corrections to narration text for TTS
function applyPhoneticCorrections(text: string, companyName: string, website?: string): string {
  let corrected = text;
  
  // Apply brand-specific pronunciation fixes
  for (const [original, phonetic] of Object.entries(PRONUNCIATION_MAP)) {
    corrected = corrected.replace(new RegExp(escapeRegExp(original), 'g'), phonetic);
  }
  
  // Handle full URLs with protocol - convert to natural speech
  // "https://bocsit.com/contact" -> "bocsit dot com slash contact"
  corrected = corrected.replace(/https?:\/\//gi, '');
  
  // Handle www prefix - keep it natural
  corrected = corrected.replace(/www\./gi, '');
  
  // Handle URL paths with hyphens: "get-started" -> "get started"
  // Match domain/path patterns and convert hyphens to spaces in the path
  corrected = corrected.replace(/(\w+)\.(\w+)\/([a-zA-Z0-9-]+)/gi, (match, domain, tld, path) => {
    const cleanPath = path.replace(/-/g, ' ');
    return `${domain} dot ${tld} slash ${cleanPath}`;
  });
  
  // Handle simple domains without paths
  // "bocsit.com" -> "bocsit dot com"
  corrected = corrected.replace(/(\w+)\.(com|org|net|io|co|ai|app|dev|us|uk|ca)/gi, '$1 dot $2');
  
  // Pronounce TLDs properly
  corrected = corrected.replace(/\bdot io\b/gi, 'dot I O');
  corrected = corrected.replace(/\bdot co\b/gi, 'dot C O');
  corrected = corrected.replace(/\bdot ai\b/gi, 'dot A I');
  
  // Add natural pauses for better pacing
  // Convert ellipsis to natural pause
  corrected = corrected.replace(/\s*\.\.\.\s*/g, ', ');
  
  // Collapse any double spaces from replacements
  corrected = corrected.replace(/\s{2,}/g, ' ');
  
  // Trim each sentence's extra whitespace
  corrected = corrected.trim();
  
  return corrected;
}

// Helper to escape regex special characters
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface VeoTTSResult {
  audioUrl: string;
  localPath: string;
  duration: number;
  voice: string;
}

interface GenerateVeoTTSRequest {
  socialPostId: number;
  clips: VeoClipPrompt[];
  tone: string;
  companyName: string;
  website?: string;
}

export async function generateVeoTTS(
  request: GenerateVeoTTSRequest
): Promise<VeoTTSResult> {
  const { socialPostId, clips, tone, companyName, website } = request;

  console.log(`🎙️ Generating natural voiceover for ${clips.length} Veo clips`);

  const fullNarration = clips
    .map((clip) => clip.narration)
    .join(" ... ");

  // Apply phonetic corrections for proper brand and website pronunciation
  const ttsNarration = applyPhoneticCorrections(fullNarration, companyName, website);
  console.log(`  📝 Applied phonetic corrections for natural TTS delivery`);

  const voice = (TONE_VOICE_MAP[tone] || TONE_VOICE_MAP['default'])!;
  const emotionInstructions = (TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS['default'])!;

  try {
    console.log(`  🎤 Using voice: ${voice} (tone: ${tone})`);
    console.log(`  🎭 Emotion: ${emotionInstructions.slice(0, 60)}...`);

    // Use gpt-4o-mini-tts for emotional steering
    const useEmotionalTTS = TTS_MODEL === "gpt-4o-mini-tts";
    
    const _veoTtsStart = Date.now();
    const mp3 = await callOpenAI(
      (client) => client.audio.speech.create({
        model: TTS_MODEL,
        voice: voice as any,
        input: ttsNarration,
        speed: 0.95,
        ...(useEmotionalTTS ? { instructions: emotionInstructions } : {}),
      } as any),
      `Veo Video TTS: ${voice} for post ${socialPostId}`
    );

    const buffer = Buffer.from(await mp3.arrayBuffer());
    void import("./cost-telemetry").then(({ safeLogCostTelemetry }) => {
      safeLogCostTelemetry(
        { operationType: "video_tts", provider: "openai", model: TTS_MODEL },
        { characters: ttsNarration.length },
        Date.now() - _veoTtsStart, true
      );
    }).catch(() => {});

    console.log(`  ✅ Audio generated, uploading to storage...`);

    const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    const timestamp = Date.now();
    const fileName = `veo-${socialPostId}-voiceover-${timestamp}.mp3`;
    const objectPath = `public/social-videos/${fileName}`;

    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectPath);

    await file.save(buffer, {
      contentType: "audio/mpeg",
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    const audioUrl = `/api/public-objects/social-videos/${fileName}`;

    const fs = await import("fs/promises");
    const path = await import("path");
    const { execSync } = await import("child_process");
    const tempDir = "/tmp/veo-audio";
    await fs.mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `${socialPostId}-voiceover.mp3`);
    await fs.writeFile(localPath, buffer);

    // Get actual audio duration from MP3 using ffprobe
    let actualDuration = null;
    try {
      const ffprobeOutput = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1:noprint_wrappers=1 "${localPath}"`, { encoding: 'utf-8' }).trim();
      actualDuration = Math.ceil(parseFloat(ffprobeOutput));
      console.log(`  📊 Audio duration from ffprobe: ${actualDuration}s`);
    } catch (err) {
      // Fallback to estimate if ffprobe fails
      const wordCount = fullNarration.split(/\s+/).length;
      actualDuration = Math.ceil((wordCount / 150) * 60);
      console.log(`  ⚠️ ffprobe failed, using word-count estimate: ${actualDuration}s`);
    }

    console.log(`✅ Veo voiceover generated (${voice}, ${actualDuration}s)`);

    return {
      audioUrl,
      localPath,
      duration: actualDuration,
      voice,
    };
  } catch (error) {
    console.error("❌ Failed to generate Veo TTS:", error);
    throw new Error(`Veo TTS generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
