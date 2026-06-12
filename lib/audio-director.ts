import { GEMINI_FLASH_MODEL } from "./ai-config";
import type { Scene, Emotion, SSMLSegment } from '@/types/video-schema';
import { GoogleGenAI } from '@google/genai';
import { throttledGeminiRequest } from './gemini';

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const EMOTION_TO_PROSODY: Record<Emotion, { rate: string; pitch: string; volume: string }> = {
  neutral: { rate: '100%', pitch: '+0st', volume: 'medium' },
  excited: { rate: '110%', pitch: '+3st', volume: 'loud' },
  whisper: { rate: '90%', pitch: '-2st', volume: 'soft' },
  authoritative: { rate: '95%', pitch: '-3st', volume: 'loud' },
  warm: { rate: '95%', pitch: '+1st', volume: 'medium' },
  passionate: { rate: '105%', pitch: '+2st', volume: 'loud' },
  urgent: { rate: '115%', pitch: '+1st', volume: 'loud' },
  contemplative: { rate: '85%', pitch: '-1st', volume: 'soft' },
  inspirational: { rate: '100%', pitch: '+2st', volume: 'medium' },
  conversational: { rate: '100%', pitch: '+0st', volume: 'medium' },
};

export class AudioDirector {
  private useGeminiForSSML: boolean;

  constructor(options: { useGeminiForSSML?: boolean } = {}) {
    this.useGeminiForSSML = options.useGeminiForSSML ?? true;
  }

  async generateSSML(scene: Scene): Promise<SSMLSegment> {
    const { audio } = scene;
    
    if (this.useGeminiForSSML) {
      return this.generateSSMLWithGemini(scene);
    }
    
    return this.generateSSMLDeterministic(scene);
  }

  async generateSSMLForScript(scenes: Scene[]): Promise<SSMLSegment[]> {
    const results: SSMLSegment[] = [];
    
    for (const scene of scenes) {
      const segment = await this.generateSSML(scene);
      results.push(segment);
    }
    
    return results;
  }

  private async generateSSMLWithGemini(scene: Scene): Promise<SSMLSegment> {
    const { audio } = scene;
    const prosody = EMOTION_TO_PROSODY[audio.emotion] || EMOTION_TO_PROSODY.neutral;
    
    const systemPrompt = `You are a professional Voice Director for video narration. Convert the input dialogue to SSML (Speech Synthesis Markup Language) for natural, humanized speech.

EMOTION: ${audio.emotion}
CONTEXT: ${audio.prosodyNotes || 'Standard narration'}

CRITICAL RULES:
1. Use <break time="Xms"/> for natural pauses (50ms-500ms range)
2. Use <emphasis level="moderate|strong"> for key words and important phrases
3. Use <prosody rate="X%" pitch="Xst"> for emotional inflection
4. Add breath pauses (<break time="200ms"/>) between sentences
5. For "${audio.emotion}" emotion:
   - Rate: ${prosody.rate}
   - Pitch: ${prosody.pitch}
   - Volume: ${prosody.volume}

EMPHASIS WORDS TO HIGHLIGHT: ${audio.emphasisWords?.join(', ') || 'None specified - identify key words yourself'}

OUTPUT ONLY THE SSML - no explanations, no markdown, just the SSML string starting with <speak> and ending with </speak>.`;

    const userPrompt = audio.dialogue;

    try {
      const result = await throttledGeminiRequest(() => 
        genAI.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.3,
            maxOutputTokens: 1000,
          },
        })
      );

      const ssmlResponse = result.text || '';
      let ssml = ssmlResponse.trim();
      
      if (!ssml.startsWith('<speak>')) {
        ssml = `<speak>${ssml}</speak>`;
      }
      if (!ssml.endsWith('</speak>')) {
        ssml = ssml.replace(/<\/speak>.*$/s, '</speak>');
      }

      const estimatedDuration = this.estimateDuration(audio.dialogue, audio.emotion);

      return {
        sceneId: scene.id,
        ssml,
        estimatedDuration,
        emotion: audio.emotion,
      };
    } catch (error) {
      console.warn(`⚠️ Gemini SSML generation failed for scene ${scene.id}, using deterministic fallback:`, error);
      return this.generateSSMLDeterministic(scene);
    }
  }

  private generateSSMLDeterministic(scene: Scene): SSMLSegment {
    const { audio } = scene;
    const prosody = EMOTION_TO_PROSODY[audio.emotion] || EMOTION_TO_PROSODY.neutral;
    
    let text = audio.dialogue;
    
    text = this.addMicroPauses(text);
    text = this.addBreathMarks(text);
    text = this.addEmphasis(text, audio.emphasisWords);
    text = this.addPitchVariation(text);
    
    const ssml = `<speak>
  <prosody rate="${prosody.rate}" pitch="${prosody.pitch}" volume="${prosody.volume}">
    ${text}
  </prosody>
</speak>`;

    const estimatedDuration = this.estimateDuration(audio.dialogue, audio.emotion);

    return {
      sceneId: scene.id,
      ssml,
      estimatedDuration,
      emotion: audio.emotion,
    };
  }

  private addMicroPauses(text: string): string {
    let result = text;
    
    result = result.replace(/\.\s+/g, '. <break time="300ms"/> ');
    result = result.replace(/,\s+/g, ', <break time="150ms"/> ');
    result = result.replace(/;\s+/g, '; <break time="200ms"/> ');
    result = result.replace(/:\s+/g, ': <break time="200ms"/> ');
    result = result.replace(/\.\.\./g, '<break time="400ms"/>');
    
    return result;
  }

  private addBreathMarks(text: string): string {
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    return sentences.map(sentence => {
      const words = sentence.split(' ');
      
      if (words.length > 10) {
        const midpoint = Math.floor(words.length / 2);
        words.splice(midpoint, 0, '<break time="150ms" strength="weak"/>');
      }
      
      return words.join(' ');
    }).join(' ');
  }

  private addEmphasis(text: string, emphasisWords?: string[]): string {
    let result = text;
    
    const defaultEmphasisWords = [
      'secret', 'perfect', 'important', 'always', 'never', 'must',
      'critical', 'essential', 'key', 'powerful', 'amazing', 'incredible',
      'first', 'only', 'best', 'proven', 'guaranteed', 'exclusive',
    ];
    
    const wordsToEmphasize = emphasisWords || defaultEmphasisWords;
    
    wordsToEmphasize.forEach(word => {
      const regex = new RegExp(`\\b(${word})\\b`, 'gi');
      result = result.replace(regex, '<emphasis level="moderate">$1</emphasis>');
    });
    
    return result;
  }

  private addPitchVariation(text: string): string {
    let result = text;
    
    result = result.replace(
      /([^.!?]*\?)/g,
      '<prosody pitch="+5%">$1</prosody>'
    );
    
    result = result.replace(
      /([^.!?]*!)/g,
      '<prosody rate="105%" pitch="+3%">$1</prosody>'
    );
    
    return result;
  }

  private estimateDuration(text: string, emotion: Emotion): number {
    const wordCount = text.split(/\s+/).length;
    
    const rateMultipliers: Record<Emotion, number> = {
      neutral: 1.0,
      excited: 1.1,
      whisper: 0.85,
      authoritative: 0.9,
      warm: 0.95,
      passionate: 1.05,
      urgent: 1.15,
      contemplative: 0.8,
      inspirational: 1.0,
      conversational: 1.0,
    };
    
    const baseWPM = 150;
    const effectiveWPM = baseWPM * (rateMultipliers[emotion] || 1.0);
    
    const baseDuration = (wordCount / effectiveWPM) * 60;
    
    const pauseCount = (text.match(/[.,;:!?]/g) || []).length;
    const pauseDuration = pauseCount * 0.2;
    
    return baseDuration + pauseDuration;
  }

  combineSSMLSegments(segments: SSMLSegment[]): string {
    const content = segments.map(seg => {
      const innerContent = seg.ssml
        .replace(/<\/?speak>/g, '')
        .trim();
      return `<!-- Scene ${seg.sceneId} -->\n${innerContent}`;
    }).join('\n<break time="500ms"/>\n');

    return `<speak>
${content}
</speak>`;
  }
}

export async function generateVideoSSML(scenes: Scene[]): Promise<{
  combinedSSML: string;
  segments: SSMLSegment[];
  totalEstimatedDuration: number;
}> {
  const director = new AudioDirector({ useGeminiForSSML: true });
  
  const segments = await director.generateSSMLForScript(scenes);
  const combinedSSML = director.combineSSMLSegments(segments);
  const totalEstimatedDuration = segments.reduce((sum, seg) => sum + seg.estimatedDuration, 0);
  
  return {
    combinedSSML,
    segments,
    totalEstimatedDuration,
  };
}
