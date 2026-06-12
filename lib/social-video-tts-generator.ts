import { openaiClient, callOpenAI } from "./openai-client";
import type { VideoScene } from "./gemini-video-script-generator";
import { objectStorageClient } from "./storage";
import { TTS_MODEL, TTS_VOICE } from "./ai-config";
import { VoiceHumanizer } from "./voice-humanizer";
import type { Emotion } from "@/types/video-schema";
import { 
  getVoiceProfile, 
  getEmotionInstruction, 
  assignVoiceProfilesToScenes,
  groupConsecutiveSpeakers,
  type SpeakerSegment,
  type OpenAIVoice 
} from "./voice-profiles";

// Map business tones to OpenAI TTS voices
const TONE_VOICE_MAP: Record<string, "alloy" | "ash" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer"> = {
  Professional: "coral",      // Warm, friendly
  Authoritative: "onyx",      // Deep, commanding
  "Friendly-Professional": "coral",
  Insightful: "sage",         // Wise, measured
  Executive: "onyx",
  Motivational: "nova",       // Energetic, upbeat
  Analytical: "ash",          // Clear, professional
  Conversational: "coral",    // Natural conversational tone
  Storytelling: "fable",      // Expressive, dramatic
  default: "coral",           // Warm default for educational content
};

// Emotional instructions for gpt-5.4-mini-tts based on content tone
const TONE_INSTRUCTIONS: Record<string, string> = {
  Professional: "Speak in a warm, confident, and approachable tone. Sound like a knowledgeable expert who genuinely wants to help. Use natural pacing with slight emphasis on key points. Convey trustworthiness and expertise without sounding robotic or overly formal.",
  Authoritative: "Speak with confident authority and gravitas. Use measured pacing and a deeper register. Sound like an experienced industry leader sharing important insights. Be commanding but not condescending.",
  "Friendly-Professional": "Sound like a friendly, helpful expert having a natural conversation. Be warm and approachable while maintaining credibility. Use conversational rhythm with genuine enthusiasm when discussing solutions.",
  Insightful: "Speak thoughtfully and reflectively, like sharing valuable wisdom. Use deliberate pacing with natural pauses for emphasis. Sound wise and considered, inviting the listener to think deeper.",
  Executive: "Speak with executive presence - confident, decisive, and strategic. Use clear, authoritative delivery. Sound like a respected leader addressing stakeholders.",
  Motivational: "Speak with genuine enthusiasm and energy. Be inspiring and uplifting while remaining authentic. Use dynamic pacing - build excitement at key moments, pause for impact.",
  Analytical: "Speak clearly and precisely, emphasizing logical structure. Sound intelligent and thorough. Use measured pacing that helps listeners follow complex information.",
  Conversational: "Speak naturally like having a friendly chat. Be warm and relatable. Use casual rhythm and genuine reactions. Sound like talking to a friend.",
  Storytelling: "Speak expressively like a skilled narrator. Vary your tone to create engagement. Build tension and release. Make the listener feel part of the story.",
  default: "Speak naturally and conversationally, like a knowledgeable friend explaining something important. Be warm, genuine, and engaging. Use natural pacing with appropriate emphasis on key insights.",
};

export interface TTSResult {
  audioUrl: string; // Permanent storage URL
  localPath: string; // Temporary local path for FFmpeg
  duration: number; // Estimated duration in seconds
  voice: string;
}

interface GenerateTTSRequest {
  socialPostId: number;
  scenes: VideoScene[];
  tone: string;
  companyName: string;
}

// Common pronunciation fixes for company names that TTS might mispronounce
// Maps exact company name (case-insensitive match) to phonetic spelling
const PRONUNCIATION_FIXES: Record<string, string> = {
  "bocsit": "Box-It",           // Prevents "boc shit" pronunciation
  "privateinhomecaregiver": "Private In-Home Caregiver",
};

// Apply pronunciation fixes to text
function applyPronunciationFixes(text: string, companyName: string): string {
  let result = text;
  
  // First check if the company name has a known pronunciation fix
  const lowerCompanyName = companyName.toLowerCase();
  if (PRONUNCIATION_FIXES[lowerCompanyName]) {
    const phoneticName = PRONUNCIATION_FIXES[lowerCompanyName];
    // Replace all occurrences of the company name with its phonetic version
    const regex = new RegExp(companyName, 'gi');
    result = result.replace(regex, phoneticName);
  }
  
  return result;
}

const TONE_TO_EMOTION: Record<string, Emotion> = {
  Professional: "warm",
  Authoritative: "authoritative",
  "Friendly-Professional": "warm",
  Insightful: "contemplative",
  Executive: "authoritative",
  Motivational: "inspirational",
  Analytical: "neutral",
  Conversational: "conversational",
  Storytelling: "passionate",
  default: "warm",
};

export async function generateVideoTTS(
  request: GenerateTTSRequest
): Promise<TTSResult> {
  const { socialPostId, scenes, tone, companyName } = request;

  console.log(`🎙️ Generating 60-second voiceover with OpenAI TTS + Voice Humanization`);

  const emotion = TONE_TO_EMOTION[tone] || TONE_TO_EMOTION.default;
  const humanizer = new VoiceHumanizer({
    addBreathMarks: true,
    addMicroPauses: true,
    addFillers: false,
    addPitchVariation: true,
    addEmphasis: true,
  });

  // Use plain-text humanization for OpenAI TTS (no SSML support)
  let fullNarration = scenes
    .map((scene) => {
      let narration = scene.narration;
      // Use plain-text method - removes AI-isms and adds natural punctuation pacing
      narration = humanizer.humanizeForPlainTextTTS(narration, emotion);
      return narration;
    })
    .join("\n\n");
  
  fullNarration = fullNarration.trim();
  
  if (companyName) {
    fullNarration = applyPronunciationFixes(fullNarration, companyName);
    console.log(`  🔊 Applied pronunciation fixes for: ${companyName}`);
  }

  const voice = TONE_VOICE_MAP[tone] || TONE_VOICE_MAP["default"] || "coral";
  const emotionInstructions = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS["default"] || "Speak naturally and conversationally.";

  try {
    console.log(`  🎤 Using voice: ${voice} (tone: ${tone})`);
    console.log(`  🎭 Emotion: ${emotionInstructions.slice(0, 60)}...`);

    // Log the narration for debugging
    console.log(`  📝 Full narration (${fullNarration.split(/\s+/).length} words):`, fullNarration.slice(0, 200) + "...");
    
    // Use gpt-5.4-mini-tts for emotional steering
    const useEmotionalTTS = TTS_MODEL === "gpt-5.4-mini-tts";
    
    const mp3 = await callOpenAI(
      (client) => client.audio.speech.create({
        model: TTS_MODEL,
        voice: voice as any,
        input: fullNarration,
        speed: 1.0, // Natural speaking pace
        ...(useEmotionalTTS ? { instructions: emotionInstructions } : {}),
      } as any),
      `Video TTS: ${voice} for post ${socialPostId}`
    );

    // Convert response to buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    console.log(`  ✅ Audio generated, uploading to storage...`);

    // Upload to Replit Object Storage
    const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
    const timestamp = Date.now();
    const fileName = `video-${socialPostId}-voiceover-${timestamp}.mp3`;
    const objectPath = `public/social-videos/${fileName}`;

    const bucket = objectStorageClient.bucket(BUCKET_ID);
    const file = bucket.file(objectPath);

    await file.save(buffer, {
      contentType: "audio/mpeg",
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    // Public URL
    const audioUrl = `/api/public-objects/social-videos/${fileName}`;

    // Also save to temporary local file for FFmpeg processing
    const fs = await import("fs/promises");
    const path = await import("path");
    const tempDir = "/tmp/video-audio";
    await fs.mkdir(tempDir, { recursive: true });
    const localPath = path.join(tempDir, `${socialPostId}-voiceover.mp3`);
    await fs.writeFile(localPath, buffer);

    // Estimate duration (rough calculation: ~150 words per minute, ~5 chars per word)
    const wordCount = fullNarration.split(/\s+/).length;
    const estimatedDuration = Math.ceil((wordCount / 150) * 60);

    console.log(`✅ Voiceover generated (${voice}, ~${estimatedDuration}s)`);

    return {
      audioUrl,
      localPath,
      duration: estimatedDuration,
      voice: voice as string,
    };
  } catch (error) {
    console.error("❌ Failed to generate TTS:", error);
    throw new Error(`TTS generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface MultiVoiceTTSRequest {
  socialPostId: number;
  scenes: VideoScene[];
  tone: string;
  companyName: string;
  enableMultiVoice?: boolean;
}

interface AudioSegment {
  buffer: Buffer;
  speaker: string;
  voice: OpenAIVoice;
  duration: number;
  sceneNumbers: number[];
}

export async function generateMultiVoiceTTS(
  request: MultiVoiceTTSRequest
): Promise<TTSResult> {
  const { socialPostId, scenes, tone, companyName, enableMultiVoice = true } = request;

  const hasDifferentSpeakers = scenes.some(s => s.speaker && s.speaker !== "Narrator");
  
  if (!enableMultiVoice || !hasDifferentSpeakers) {
    console.log(`🎙️ Single-voice mode (no speaker variety detected)`);
    return generateVideoTTS({ socialPostId, scenes, tone, companyName });
  }

  console.log(`🎭 Multi-voice mode: generating character dialogue`);

  const humanizer = new VoiceHumanizer({
    addBreathMarks: false,
    addMicroPauses: true,
    addFillers: false,
    addPitchVariation: false,
    addEmphasis: false,
  });

  const speakerSegments = assignVoiceProfilesToScenes(scenes);
  const groupedSegments = groupConsecutiveSpeakers(speakerSegments);

  console.log(`  📊 Found ${groupedSegments.length} speaker groups across ${scenes.length} scenes`);
  
  const uniqueSpeakers = [...new Set(speakerSegments.map(s => s.speaker))];
  console.log(`  🗣️ Speakers: ${uniqueSpeakers.join(", ")}`);

  const audioSegments: AudioSegment[] = [];
  const useEmotionalTTS = TTS_MODEL === "gpt-5.4-mini-tts";

  for (let i = 0; i < groupedSegments.length; i++) {
    const group = groupedSegments[i];
    if (!group || group.length === 0) continue;

    const firstSegment = group[0];
    if (!firstSegment) continue;

    const { voiceProfile, emotion, speaker } = firstSegment;
    const sceneNumbers = group.map(s => s.sceneNumber);
    
    let combinedText = group
      .map(s => {
        let text = s.text;
        text = humanizer.humanizeForPlainTextTTS(text, emotion);
        if (companyName) {
          text = applyPronunciationFixes(text, companyName);
        }
        return text;
      })
      .join("\n\n");

    const emotionalInstruction = getEmotionInstruction(emotion, voiceProfile.emotionalInstruction);

    console.log(`  🎤 Generating segment ${i + 1}/${groupedSegments.length}: ${speaker} (${voiceProfile.voice})`);
    console.log(`     Scenes: ${sceneNumbers.join(", ")}, Words: ${combinedText.split(/\s+/).length}`);

    try {
      const mp3 = await callOpenAI(
        (client) => client.audio.speech.create({
          model: TTS_MODEL,
          voice: voiceProfile.voice as any,
          input: combinedText,
          speed: 1.0,
          ...(useEmotionalTTS ? { instructions: emotionalInstruction } : {}),
        } as any),
        `Multi-voice TTS: ${speaker} (${voiceProfile.voice}) for post ${socialPostId}`
      );

      const buffer = Buffer.from(await mp3.arrayBuffer());
      const wordCount = combinedText.split(/\s+/).length;
      const estimatedDuration = Math.ceil((wordCount / 150) * 60);

      audioSegments.push({
        buffer,
        speaker,
        voice: voiceProfile.voice,
        duration: estimatedDuration,
        sceneNumbers,
      });

    } catch (error) {
      console.error(`  ❌ Failed to generate TTS for ${speaker}:`, error);
      throw new Error(`TTS generation failed for ${speaker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`  🔗 Stitching ${audioSegments.length} audio segments...`);

  const combinedBuffer = await stitchAudioSegments(audioSegments);
  
  const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
  const timestamp = Date.now();
  const fileName = `video-${socialPostId}-multivoice-${timestamp}.mp3`;
  const objectPath = `public/social-videos/${fileName}`;

  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const file = bucket.file(objectPath);

  await file.save(combinedBuffer, {
    contentType: "audio/mpeg",
    metadata: {
      cacheControl: "public, max-age=31536000",
    },
  });

  const audioUrl = `/api/public-objects/social-videos/${fileName}`;

  const fs = await import("fs/promises");
  const path = await import("path");
  const tempDir = "/tmp/video-audio";
  await fs.mkdir(tempDir, { recursive: true });
  const localPath = path.join(tempDir, `${socialPostId}-multivoice.mp3`);
  await fs.writeFile(localPath, combinedBuffer);

  const totalDuration = audioSegments.reduce((sum, seg) => sum + seg.duration, 0);
  const voicesUsed = [...new Set(audioSegments.map(s => s.voice))].join(", ");

  console.log(`✅ Multi-voice audio generated (${voicesUsed}, ~${totalDuration}s)`);

  return {
    audioUrl,
    localPath,
    duration: totalDuration,
    voice: voicesUsed,
  };
}

async function stitchAudioSegments(segments: AudioSegment[]): Promise<Buffer> {
  if (segments.length === 0) {
    throw new Error("No audio segments to stitch");
  }

  if (segments.length === 1 && segments[0]) {
    return segments[0].buffer;
  }

  const fs = await import("fs/promises");
  const path = await import("path");
  const { execSync } = await import("child_process");

  const tempDir = "/tmp/audio-stitch";
  const timestamp = Date.now();
  await fs.mkdir(tempDir, { recursive: true });

  const normalizedPaths: string[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment || segment.buffer.length === 0) {
      console.log(`  ⚠️ Skipping empty segment ${i}`);
      continue;
    }
    
    const rawPath = path.join(tempDir, `raw-${timestamp}-${i}.mp3`);
    const normPath = path.join(tempDir, `norm-${timestamp}-${i}.mp3`);
    
    await fs.writeFile(rawPath, segment.buffer);
    
    try {
      execSync(
        `ffmpeg -y -i "${rawPath}" -ar 44100 -ac 1 -b:a 128k "${normPath}"`,
        { stdio: "pipe", timeout: 30000 }
      );
      normalizedPaths.push(normPath);
      await fs.unlink(rawPath).catch(() => {});
    } catch (normError) {
      console.log(`  ⚠️ Normalization failed for segment ${i}, using raw`);
      normalizedPaths.push(rawPath);
    }
  }

  if (normalizedPaths.length === 0) {
    throw new Error("No valid audio segments after normalization");
  }

  if (normalizedPaths.length === 1) {
    const singleBuffer = await fs.readFile(normalizedPaths[0] as string);
    await fs.unlink(normalizedPaths[0] as string).catch(() => {});
    return singleBuffer;
  }

  const listFile = path.join(tempDir, `segments-${timestamp}.txt`);
  const listContent = normalizedPaths.map(p => `file '${p}'`).join("\n");
  await fs.writeFile(listFile, listContent);

  const outputPath = path.join(tempDir, `stitched-${timestamp}.mp3`);

  try {
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:a libmp3lame -q:a 2 "${outputPath}"`,
      { stdio: "pipe", timeout: 60000 }
    );

    const stitchedBuffer = await fs.readFile(outputPath);

    for (const segPath of normalizedPaths) {
      await fs.unlink(segPath).catch(() => {});
    }
    await fs.unlink(listFile).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});

    return stitchedBuffer;
  } catch (error) {
    console.error("FFmpeg stitch failed:", error);
    console.log("Falling back to simple concatenation...");
    
    for (const segPath of normalizedPaths) {
      await fs.unlink(segPath).catch(() => {});
    }
    await fs.unlink(listFile).catch(() => {});
    
    return Buffer.concat(segments.filter(s => s.buffer.length > 0).map(s => s.buffer));
  }
}
