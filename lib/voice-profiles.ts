import type { Emotion } from "@/types/video-schema";

export type OpenAIVoice = "alloy" | "ash" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer";

export interface VoiceProfile {
  id: string;
  name: string;
  voice: OpenAIVoice;
  description: string;
  defaultEmotion: Emotion;
  emotionalInstruction: string;
}

export const VOICE_PROFILES: Record<string, VoiceProfile> = {
  narrator: {
    id: "narrator",
    name: "Narrator",
    voice: "coral",
    description: "Warm, professional narrator for general content",
    defaultEmotion: "warm",
    emotionalInstruction: "Speak in a warm, confident, and approachable tone. Sound like a knowledgeable expert who genuinely wants to help.",
  },
  host: {
    id: "host",
    name: "Host",
    voice: "nova",
    description: "Energetic host for presentations and introductions",
    defaultEmotion: "excited",
    emotionalInstruction: "Be enthusiastic and welcoming. Sound like a friendly TV host introducing something exciting.",
  },
  expert: {
    id: "expert",
    name: "Expert",
    voice: "sage",
    description: "Thoughtful expert sharing insights and analysis",
    defaultEmotion: "contemplative",
    emotionalInstruction: "Speak thoughtfully and reflectively, like sharing valuable wisdom. Use deliberate pacing with natural pauses.",
  },
  interviewer: {
    id: "interviewer",
    name: "Interviewer",
    voice: "alloy",
    description: "Curious interviewer asking questions",
    defaultEmotion: "conversational",
    emotionalInstruction: "Sound genuinely curious and engaged. Ask questions with interest and respond with active listening.",
  },
  guest: {
    id: "guest",
    name: "Guest",
    voice: "echo",
    description: "Interview guest providing insights",
    defaultEmotion: "warm",
    emotionalInstruction: "Sound knowledgeable and genuine. Share insights as if in a real conversation.",
  },
  teacher: {
    id: "teacher",
    name: "Teacher",
    voice: "sage",
    description: "Patient teacher explaining concepts",
    defaultEmotion: "warm",
    emotionalInstruction: "Be patient and clear. Explain concepts in a way that makes complex topics accessible.",
  },
  storyteller: {
    id: "storyteller",
    name: "Storyteller",
    voice: "fable",
    description: "Expressive storyteller for narrative content",
    defaultEmotion: "passionate",
    emotionalInstruction: "Speak expressively like a skilled narrator. Vary tone to create engagement. Build tension and release.",
  },
  executive: {
    id: "executive",
    name: "Executive",
    voice: "onyx",
    description: "Authoritative executive voice for leadership content",
    defaultEmotion: "authoritative",
    emotionalInstruction: "Speak with executive presence - confident, decisive, and strategic. Sound like a respected leader.",
  },
  coach: {
    id: "coach",
    name: "Coach",
    voice: "nova",
    description: "Motivational coach for inspiring content",
    defaultEmotion: "inspirational",
    emotionalInstruction: "Be inspiring and uplifting while remaining authentic. Build excitement at key moments.",
  },
  analyst: {
    id: "analyst",
    name: "Analyst",
    voice: "ash",
    description: "Clear analyst for data and technical content",
    defaultEmotion: "neutral",
    emotionalInstruction: "Speak clearly and precisely, emphasizing logical structure. Sound intelligent and thorough.",
  },
};

export interface SpeakerSegment {
  speaker: string;
  text: string;
  emotion: Emotion;
  voiceProfile: VoiceProfile;
  sceneNumber: number;
}

export function getVoiceProfile(speakerName: string): VoiceProfile {
  const normalized = speakerName.toLowerCase().trim();
  
  const directMatch = VOICE_PROFILES[normalized];
  if (directMatch) {
    return directMatch;
  }
  
  for (const [key, profile] of Object.entries(VOICE_PROFILES)) {
    if (normalized.includes(key) || profile.name.toLowerCase().includes(normalized)) {
      console.log(`  📢 Speaker "${speakerName}" mapped to voice profile: ${profile.name} (${profile.voice})`);
      return profile;
    }
  }
  
  console.log(`  ⚠️ Unknown speaker "${speakerName}" - defaulting to Narrator voice`);
  return VOICE_PROFILES["narrator"] as VoiceProfile;
}

export function validateSpeakerName(speakerName: string): boolean {
  const normalized = speakerName.toLowerCase().trim();
  
  if (VOICE_PROFILES[normalized]) {
    return true;
  }
  
  for (const [key, profile] of Object.entries(VOICE_PROFILES)) {
    if (normalized.includes(key) || profile.name.toLowerCase().includes(normalized)) {
      return true;
    }
  }
  
  return false;
}

export function getAvailableSpeakers(): string[] {
  return Object.values(VOICE_PROFILES).map(p => p.name);
}

export function getEmotionInstruction(emotion: Emotion, baseInstruction: string): string {
  const emotionModifiers: Record<Emotion, string> = {
    neutral: "",
    excited: " Add energy and enthusiasm to your delivery.",
    whisper: " Speak softly and intimately, as if sharing a secret.",
    authoritative: " Be commanding and confident in your delivery.",
    warm: " Add warmth and genuine care to your voice.",
    passionate: " Let your passion show through. Be emotionally engaged.",
    urgent: " Convey urgency without rushing. Make it feel important.",
    contemplative: " Be thoughtful and measured. Take your time.",
    inspirational: " Be uplifting and motivating. Inspire action.",
    conversational: " Be natural and relaxed, like talking to a friend.",
  };
  
  const modifier = emotionModifiers[emotion] || "";
  return baseInstruction + modifier;
}

export function assignVoiceProfilesToScenes(
  scenes: Array<{ speaker?: string; speakerEmotion?: string; narration: string; sceneNumber: number }>
): SpeakerSegment[] {
  return scenes.map(scene => {
    const speaker = scene.speaker || "Narrator";
    const voiceProfile = getVoiceProfile(speaker);
    const emotion = (scene.speakerEmotion as Emotion) || voiceProfile.defaultEmotion;
    
    return {
      speaker,
      text: scene.narration,
      emotion,
      voiceProfile,
      sceneNumber: scene.sceneNumber,
    };
  });
}

export function groupConsecutiveSpeakers(segments: SpeakerSegment[]): SpeakerSegment[][] {
  const groups: SpeakerSegment[][] = [];
  let currentGroup: SpeakerSegment[] = [];
  let currentSpeaker = "";
  
  for (const segment of segments) {
    if (segment.speaker === currentSpeaker && currentGroup.length > 0) {
      currentGroup.push(segment);
    } else {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [segment];
      currentSpeaker = segment.speaker;
    }
  }
  
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }
  
  return groups;
}
