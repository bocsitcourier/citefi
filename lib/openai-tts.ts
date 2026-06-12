import { openaiClient, callOpenAI } from "./openai-client";
import { Readable } from "stream";

export interface TTSOptions {
  voice: 'nova' | 'onyx' | 'alloy' | 'echo' | 'fable' | 'shimmer';
  speed?: number;
}

export async function generateSpeech(
  text: string,
  options: TTSOptions
): Promise<Buffer> {
  const { voice, speed = 1.0 } = options;

  try {
    const mp3Response = await callOpenAI(
      (client) => client.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: voice,
        input: text,
        speed: speed,
      }),
      `TTS: ${voice} (${text.length} chars)`
    );

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    return buffer;
  } catch (error) {
    console.error(`Error generating speech for voice ${voice}:`, error);
    throw new Error(`TTS generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function mergeAudioSegments(
  segments: Array<{ voice: 'female' | 'male'; text: string }>
): Promise<Buffer> {
  const audioBuffers: Buffer[] = [];
  
  for (const segment of segments) {
    const voice = segment.voice === 'female' ? 'nova' : 'onyx';
    const buffer = await generateSpeech(segment.text, { voice });
    audioBuffers.push(buffer);
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
  const mergedBuffer = Buffer.concat(audioBuffers, totalLength);
  
  return mergedBuffer;
}

export function estimateAudioDuration(textLength: number): number {
  const wordsPerMinute = 150;
  const words = textLength / 5;
  const minutes = words / wordsPerMinute;
  return Math.ceil(minutes * 60);
}
