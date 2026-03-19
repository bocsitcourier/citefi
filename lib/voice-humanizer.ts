import type { Emotion } from '@/types/video-schema';

export interface VoiceProfile {
  id: string;
  name: string;
  baseVoice: string;
  characteristics: {
    pitch: number;
    speed: number;
    stability: number;
    similarity: number;
    style: number;
  };
}

export interface HumanizationConfig {
  addBreathMarks: boolean;
  addMicroPauses: boolean;
  addFillers: boolean;
  addPitchVariation: boolean;
  addEmphasis: boolean;
  emphasisWords?: string[];
  targetBurstiness?: number;
}

const DEFAULT_CONFIG: HumanizationConfig = {
  addBreathMarks: true,
  addMicroPauses: true,
  addFillers: false,
  addPitchVariation: true,
  addEmphasis: true,
  targetBurstiness: 0.4,
};

export class VoiceHumanizer {
  private config: HumanizationConfig;

  constructor(config: Partial<HumanizationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * For TTS engines that support SSML (ElevenLabs, Google, Azure)
   */
  humanizeForTTS(text: string, emotion: Emotion = 'neutral'): string {
    let humanized = text;

    humanized = this.removeAIisms(humanized);

    if (this.config.addMicroPauses) {
      humanized = this.addMicroPauses(humanized);
    }

    if (this.config.addBreathMarks) {
      humanized = this.addBreathMarks(humanized);
    }

    if (this.config.addEmphasis) {
      humanized = this.addEmphasis(humanized, this.config.emphasisWords);
    }

    if (this.config.addFillers && emotion === 'conversational') {
      humanized = this.addNaturalFillers(humanized);
    }

    if (this.config.addPitchVariation) {
      humanized = this.addPitchVariation(humanized);
    }

    return humanized;
  }

  /**
   * For TTS engines that DON'T support SSML (OpenAI TTS)
   * Uses natural language patterns instead of markup
   */
  humanizeForPlainTextTTS(text: string, emotion: Emotion = 'neutral'): string {
    let humanized = text;

    // Always remove AI-isms
    humanized = this.removeAIisms(humanized);

    // Add natural pacing through punctuation (no SSML)
    if (this.config.addMicroPauses) {
      humanized = this.addPunctuationPauses(humanized);
    }

    // Add conversational fillers for casual tone
    if (this.config.addFillers && emotion === 'conversational') {
      humanized = this.addNaturalFillers(humanized);
    }

    // Clean up any accidental double spaces
    humanized = humanized.replace(/\s{2,}/g, ' ').trim();

    return humanized;
  }

  /**
   * Adds natural pacing through punctuation instead of SSML
   */
  private addPunctuationPauses(text: string): string {
    let result = text;
    
    // Convert ellipsis to comma for natural pause
    result = result.replace(/\.\.\./g, ', ');
    
    // Add comma before conjunctions in long sentences
    const sentences = result.split(/(?<=[.!?])\s+/);
    return sentences.map(sentence => {
      const words = sentence.split(' ');
      if (words.length > 12) {
        // Add comma pause before conjunctions if not already present
        const conjunctions = ['and', 'but', 'or', 'so', 'because', 'while'];
        return words.map((word, i) => {
          const cleanWord = word.toLowerCase().replace(/[.,;:!?]/g, '');
          const prevWord = i > 0 ? words[i - 1] : '';
          // Add comma if conjunction and previous word doesn't end with punctuation
          if (conjunctions.includes(cleanWord) && i > 3 && !/[,;:]$/.test(prevWord || '')) {
            return `, ${word}`;
          }
          return word;
        }).join(' ');
      }
      return sentence;
    }).join(' ');
  }

  private removeAIisms(text: string): string {
    const aiPatterns = [
      /\bLet's dive into?\b/gi,
      /\bIn today's (fast-paced|ever-changing|dynamic)\b/gi,
      /\bgame-?changer\b/gi,
      /\bparadigm shift\b/gi,
      /\bunlock (the |your )?(full |true )?potential\b/gi,
      /\btake (it |things )?to the next level\b/gi,
      /\bseamlessly\b/gi,
      /\bleverage\b/gi,
      /\bsynergy\b/gi,
      /\bholistic approach\b/gi,
      /\brobust solution\b/gi,
      /\bcutting-?edge\b/gi,
      /\bstate-of-the-art\b/gi,
      /\bworld-class\b/gi,
      /\bIn conclusion,?\b/gi,
      /\bTo summarize,?\b/gi,
      /\bAll in all,?\b/gi,
      /\bAt the end of the day,?\b/gi,
      /\bmoving forward\b/gi,
      /\bgoing forward\b/gi,
    ];

    let result = text;
    aiPatterns.forEach(pattern => {
      result = result.replace(pattern, '');
    });

    result = result.replace(/\s{2,}/g, ' ').trim();

    return result;
  }

  private addMicroPauses(text: string): string {
    let result = text;

    result = result.replace(/\.\s+/g, '. <break time="300ms"/> ');
    result = result.replace(/,\s+/g, ', <break time="150ms"/> ');
    result = result.replace(/;\s+/g, '; <break time="200ms"/> ');
    result = result.replace(/:\s+/g, ': <break time="200ms"/> ');

    result = result.replace(/\.\.\./g, '<break time="400ms"/>');
    result = result.replace(/—/g, ' <break time="250ms"/> ');
    result = result.replace(/ - /g, ' <break time="200ms"/> ');

    return result;
  }

  private addBreathMarks(text: string): string {
    const sentences = text.split(/(?<=[.!?])\s+/);

    return sentences.map(sentence => {
      const words = sentence.split(' ');

      if (words.length > 12) {
        const breakPoints = this.findNaturalBreakPoints(words);
        breakPoints.forEach((point, index) => {
          const adjustedPoint = point + index;
          if (adjustedPoint < words.length) {
            words.splice(adjustedPoint + 1, 0, '<break time="180ms"/>');
          }
        });
      } else if (words.length > 8) {
        const midpoint = Math.floor(words.length / 2);
        words.splice(midpoint, 0, '<break time="150ms"/>');
      }

      return words.join(' ');
    }).join(' ');
  }

  private findNaturalBreakPoints(words: string[]): number[] {
    const breakPoints: number[] = [];
    const breakAfter = ['and', 'but', 'or', 'so', 'then', 'because', 'while', 'when', 'if', 'that'];

    words.forEach((word, index) => {
      const cleanWord = word.toLowerCase().replace(/[.,;:!?]/g, '');
      if (breakAfter.includes(cleanWord) && index > 3 && index < words.length - 3) {
        breakPoints.push(index);
      }
    });

    if (breakPoints.length === 0 && words.length > 10) {
      breakPoints.push(Math.floor(words.length / 2));
    }

    return breakPoints.slice(0, 2);
  }

  private addEmphasis(text: string, emphasisWords?: string[]): string {
    let result = text;

    const defaultWords = [
      'secret', 'perfect', 'important', 'always', 'never', 'must',
      'critical', 'essential', 'key', 'powerful', 'amazing',
      'first', 'only', 'best', 'proven', 'exclusive', 'free',
      'now', 'today', 'immediately', 'finally', 'discover',
    ];

    const wordsToEmphasize = emphasisWords || defaultWords;

    wordsToEmphasize.forEach(word => {
      const regex = new RegExp(`\\b(${word})\\b`, 'gi');
      result = result.replace(regex, '<emphasis level="moderate">$1</emphasis>');
    });

    return result;
  }

  private addNaturalFillers(text: string): string {
    const fillers = ['you know,', 'well,', 'I mean,', 'honestly,'];

    const sentences = text.split(/(?<=[.!?])\s+/);

    if (sentences.length > 3) {
      const insertIndex = Math.floor(sentences.length / 3);
      const filler = fillers[Math.floor(Math.random() * fillers.length)];
      
      if (sentences[insertIndex]) {
        sentences[insertIndex] = `${filler} ${sentences[insertIndex]?.charAt(0).toLowerCase()}${sentences[insertIndex]?.slice(1)}`;
      }
    }

    return sentences.join(' ');
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

  toSSML(text: string, emotion: Emotion = 'neutral', voiceProfile?: VoiceProfile): string {
    const humanized = this.humanizeForTTS(text, emotion);

    const prosodySettings = this.getEmotionProsody(emotion, voiceProfile);

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis">
  <prosody rate="${prosodySettings.rate}" pitch="${prosodySettings.pitch}" volume="${prosodySettings.volume}">
    ${humanized}
  </prosody>
</speak>`;
  }

  private getEmotionProsody(emotion: Emotion, voiceProfile?: VoiceProfile): {
    rate: string;
    pitch: string;
    volume: string;
  } {
    const emotionSettings: Record<Emotion, { rate: string; pitch: string; volume: string }> = {
      neutral: { rate: '100%', pitch: '+0st', volume: 'medium' },
      excited: { rate: '110%', pitch: '+3st', volume: 'loud' },
      whisper: { rate: '90%', pitch: '-2st', volume: 'x-soft' },
      authoritative: { rate: '95%', pitch: '-3st', volume: 'loud' },
      warm: { rate: '95%', pitch: '+1st', volume: 'medium' },
      passionate: { rate: '105%', pitch: '+2st', volume: 'loud' },
      urgent: { rate: '115%', pitch: '+1st', volume: 'loud' },
      contemplative: { rate: '85%', pitch: '-1st', volume: 'soft' },
      inspirational: { rate: '100%', pitch: '+2st', volume: 'medium' },
      conversational: { rate: '100%', pitch: '+0st', volume: 'medium' },
    };

    const base = emotionSettings[emotion] || emotionSettings.neutral;

    if (voiceProfile) {
      const speedMultiplier = voiceProfile.characteristics.speed;
      const pitchOffset = voiceProfile.characteristics.pitch;

      return {
        rate: `${Math.round(parseInt(base.rate) * speedMultiplier)}%`,
        pitch: `${pitchOffset > 0 ? '+' : ''}${pitchOffset}st`,
        volume: base.volume,
      };
    }

    return base;
  }

  static applyBurstiness(text: string, targetCV: number = 0.4): string {
    const sentences = text.split(/(?<=[.!?])\s+/);

    const avgLength = sentences.reduce((sum, s) => sum + s.split(' ').length, 0) / sentences.length;
    const currentCV = Math.sqrt(
      sentences.reduce((sum, s) => {
        const diff = s.split(' ').length - avgLength;
        return sum + (diff * diff);
      }, 0) / sentences.length
    ) / avgLength;

    if (Math.abs(currentCV - targetCV) < 0.1) {
      return text;
    }

    return text;
  }
}

export function humanizeVideoNarration(
  narration: string,
  emotion: Emotion = 'warm',
  options: Partial<HumanizationConfig> = {}
): string {
  const humanizer = new VoiceHumanizer(options);
  return humanizer.humanizeForTTS(narration, emotion);
}

export function generateNarrationSSML(
  narration: string,
  emotion: Emotion = 'warm',
  voiceProfile?: VoiceProfile
): string {
  const humanizer = new VoiceHumanizer();
  return humanizer.toSSML(narration, emotion, voiceProfile);
}
