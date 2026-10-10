import { callOpenAI } from "./openai-client";
import { Readable } from "stream";
import {
  isNonReplayableProviderError,
  isProviderAccountingError,
  ProviderResultNotDurableError,
} from "./cost-telemetry";
import { executePaidMediaBoundary } from "./media-provider-boundary";
import { redactProviderError } from "./provider-diagnostics";
import { isProviderAttemptTerminalError } from "./provider-attempt-receipts";
import { getResolvedModel } from "./model-resolver";
import { mergeMp3Buffers } from "./merge-mp3-segments";

export interface TTSOptions {
  voice: 'nova' | 'onyx' | 'alloy' | 'echo' | 'fable' | 'shimmer';
  speed?: number;
}

export async function generateSpeech(
  text: string,
  options: TTSOptions,
  telemetryCtx?: { operationType?: "podcast_tts"; teamId?: number | null; userId?: number | null; articleId?: number | null; jobId?: string | null }
): Promise<Buffer> {
  const { voice, speed = 1.0 } = options;
  const model = await getResolvedModel("tts");
  try {
    return await executePaidMediaBoundary({
      mediaKind: "audio",
      submit: () => callOpenAI(
        (client) => client.audio.speech.create({
          model,
          voice: voice,
          input: text,
          speed: speed,
        }),
        `TTS: ${voice} (${text.length} chars)`,
        undefined,
        {
          operationType: telemetryCtx?.operationType ?? "podcast_tts",
          model,
          teamId: telemetryCtx?.teamId,
          userId: telemetryCtx?.userId,
          articleId: telemetryCtx?.articleId,
          jobId: telemetryCtx?.jobId,
          resourceType: telemetryCtx?.articleId != null ? "article" : undefined,
          resourceId: telemetryCtx?.articleId,
          usage: { characters: text.length },
          request: { model },
        }
      ),
      persist: async (mp3Response) => {
        return Buffer.from(await mp3Response.arrayBuffer());
      }
    });
  } catch (error) {
    if (isProviderAccountingError(error)) throw error;
    if (isProviderAttemptTerminalError(error)) throw error;
    if (isNonReplayableProviderError(error)) throw error;
    const diagnostic = redactProviderError(error, undefined, "podcast_tts");
    console.error(`Error generating speech for voice ${voice}:`, diagnostic);
    throw new Error(`TTS generation failed (${diagnostic})`);
  }
}

export async function mergeAudioSegments(
  segments: Array<{ voice: 'female' | 'male'; text: string }>,
  telemetryCtx?: { operationType?: "podcast_tts"; teamId?: number | null; userId?: number | null; articleId?: number | null; jobId?: string | null }
): Promise<Buffer> {
  const MAX_SEGMENTS = 40;
  const MAX_TOTAL_CHARACTERS = 30_000;
  if (segments.length === 0) throw new Error("Podcast TTS requires at least one segment");
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`Podcast TTS segment limit exceeded (${segments.length}/${MAX_SEGMENTS})`);
  }
  const totalCharacters = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  if (totalCharacters > MAX_TOTAL_CHARACTERS) {
    throw new Error(`Podcast TTS character limit exceeded (${totalCharacters}/${MAX_TOTAL_CHARACTERS})`);
  }

  const audioBuffers: Buffer[] = [];
  const completedSpeech = new Map<string, Buffer>();
  let paidSegments = 0;
  
  for (const segment of segments) {
    const voice = segment.voice === 'female' ? 'nova' : 'onyx';
    try {
      const key = `${voice}\0${segment.text}`;
      let buffer = completedSpeech.get(key);
      if (!buffer) {
        buffer = await generateSpeech(segment.text, { voice }, telemetryCtx);
        completedSpeech.set(key, buffer);
        paidSegments++;
      }
      audioBuffers.push(buffer);
    } catch (error) {
      if (isNonReplayableProviderError(error)) throw error;
      if (paidSegments > 0) {
        throw new ProviderResultNotDurableError(
          `${paidSegments} paid podcast TTS segment(s) completed before a later segment failed; refusing automatic replay`,
          null,
          error
        );
      }
      throw error;
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  try {
    return await mergeMp3Buffers(audioBuffers);
  } catch (error) {
    throw new ProviderResultNotDurableError(
      "Paid podcast audio could not be merged into a playable MP3; refusing automatic replay",
      null,
      error,
    );
  }
}

export function estimateAudioDuration(textLength: number): number {
  const wordsPerMinute = 150;
  const words = textLength / 5;
  const minutes = words / wordsPerMinute;
  return Math.ceil(minutes * 60);
}
