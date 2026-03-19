import { z } from 'zod';

/**
 * Sanitize Veo prompts to avoid content policy rejections
 * Filters emotional distress, cinematography jargon, and sensitive terms
 */
export function sanitizeVeoPrompt(prompt: string): string {
  const sensitiveTerms = [
    // Age-related terms that may trigger content policy
    { pattern: /\b(elderly|senior citizens?|old people)\b/gi, replacement: "adults" },
    // Medical content
    { pattern: /\b(hospital|medical equipment|medication|surgery)\b/gi, replacement: "" },
    { pattern: /\b(wheelchair|walker|crutches)\b/gi, replacement: "" },
    { pattern: /\b(blood|injury|wound|scar)\b/gi, replacement: "" },
    // Death/violence
    { pattern: /\b(funeral|death|cemetery)\b/gi, replacement: "" },
    { pattern: /\b(weapon|gun|knife|violence)\b/gi, replacement: "" },
    // Emotional distress terms that trigger content policy
    { pattern: /\byelling\s+furiously\b/gi, replacement: "speaking firmly" },
    { pattern: /\b(yelling|screaming|shrieking)\b/gi, replacement: "speaking loudly" },
    { pattern: /\b(furious|enraged|livid|irate)\b/gi, replacement: "frustrated" },
    { pattern: /\b(crying\s+uncontrollably|sobbing|weeping)\b/gi, replacement: "emotional" },
    { pattern: /\b(angry|angered)\b/gi, replacement: "concerned" },
    { pattern: /\b(distressed|anguished|devastated)\b/gi, replacement: "thoughtful" },
    // Cinematography terms Veo doesn't understand well
    { pattern: /\bSMASH CUT\b/gi, replacement: "Cut" },
    { pattern: /\bshaky camera\b/gi, replacement: "handheld camera" },
    { pattern: /\bcamera shakes violently\b/gi, replacement: "subtle camera movement" },
    { pattern: /\b(violent|aggressive)\s+(movement|motion|action)\b/gi, replacement: "dynamic movement" },
  ];
  
  let sanitized = prompt;
  for (const term of sensitiveTerms) {
    sanitized = sanitized.replace(term.pattern, term.replacement);
  }
  
  // Clean up extra spaces
  sanitized = sanitized.replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
  
  return sanitized;
}

export const CameraMovementSchema = z.enum([
  'static',
  'pan_left',
  'pan_right',
  'zoom_in',
  'zoom_out',
  'truck_in',
  'truck_out',
  'orbit',
  'handheld',
  'tilt_up',
  'tilt_down',
]);

export const EmotionSchema = z.enum([
  'neutral',
  'excited',
  'whisper',
  'authoritative',
  'warm',
  'passionate',
  'urgent',
  'contemplative',
  'inspirational',
  'conversational',
]);

export const VisualSchema = z.object({
  prompt: z.string().min(10, 'Visual prompt must be at least 10 characters'),
  cameraMovement: CameraMovementSchema.default('static'),
  lighting: z.string().default('Natural lighting, cinematic'),
  referenceImage: z.string().optional(),
  negativePrompt: z.string().optional(),
  cameraFocus: z.string().optional(),
  transitionFrom: z.string().optional(),
});

export const AudioSchema = z.object({
  dialogue: z.string().min(1, 'Dialogue is required'),
  emotion: EmotionSchema.default('neutral'),
  speaker: z.string().default('Narrator'),
  prosodyNotes: z.string().optional(),
  emphasisWords: z.array(z.string()).optional(),
  pauseAfter: z.number().min(0).max(2).optional(),
});

export const SceneSchema = z.object({
  id: z.number(),
  timeStart: z.number().min(0),
  duration: z.number().min(1).max(30),
  visual: VisualSchema,
  audio: AudioSchema,
});

export const VideoScriptSchema = z.object({
  title: z.string(),
  totalDuration: z.number().min(1).max(180),
  scenes: z.array(SceneSchema).min(1).max(20),
  characterProfiles: z.record(z.string(), z.object({
    description: z.string(),
    voiceProfile: z.string(),
    referenceImage: z.string().optional(),
  })).optional(),
  styleGuide: z.string().optional(),
  targetPlatform: z.enum(['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x']).default('facebook'),
});

export type CameraMovement = z.infer<typeof CameraMovementSchema>;
export type Emotion = z.infer<typeof EmotionSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type Audio = z.infer<typeof AudioSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type VideoScript = z.infer<typeof VideoScriptSchema>;

export interface SSMLSegment {
  sceneId: number;
  ssml: string;
  estimatedDuration: number;
  emotion: Emotion;
}

export interface VeoRequestPayload {
  prompt: string;
  negativePrompt?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  aspectRatio: string;
  motionStrength: number;
  duration: number;
}

export interface GeneratedClip {
  id: string;
  sceneId: number;
  videoPath: string;
  audioPath: string;
  duration: number;
  endFrame?: string;
  audioSeed?: string;
}

export interface RenderJob {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  targetDuration: number;
  actualAudioDuration?: number;
  actualVideoDuration?: number;
}

export interface SceneValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSingleSpeakerScene(scene: Scene): SceneValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dialogue = scene.audio.dialogue;
  
  const multiSpeakerPatterns = [
    { pattern: /\w+:\s*"/g, description: 'Contains "Name:" dialogue format' },
    { pattern: /"\s*\n\s*"/g, description: 'Contains multiple quoted sections' },
    { pattern: /said\s+\w+.*said\s+\w+/gi, description: 'Contains multiple "said X" attributions' },
    { pattern: /[A-Z][a-z]+:\s*[A-Z]/g, description: 'Contains speaker label pattern' },
  ];
  
  for (const { pattern, description } of multiSpeakerPatterns) {
    if (pattern.test(dialogue)) {
      errors.push(`Scene ${scene.id}: ${description}. Each scene must have exactly ONE speaker.`);
    }
  }
  
  if (dialogue.includes(':') && /^[A-Z][a-z]+:/.test(dialogue)) {
    errors.push(
      `Scene ${scene.id}: Don't include speaker labels in dialogue. ` +
      `Use the 'speaker' field instead.`
    );
  }
  
  if (!scene.audio.speaker || scene.audio.speaker.trim() === '') {
    errors.push(`Scene ${scene.id}: Missing required 'speaker' field.`);
  }
  
  if (scene.duration > 60) {
    errors.push(`Scene ${scene.id}: Duration ${scene.duration}s exceeds Veo's 60s per-clip limit.`);
  } else if (scene.duration > 30) {
    warnings.push(`Scene ${scene.id}: Long scene (${scene.duration}s). Works for narration, may be long for dialogue.`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateVideoScript(script: VideoScript): SceneValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  
  for (const scene of script.scenes) {
    const result = validateSingleSpeakerScene(scene);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }
  
  const totalDuration = script.scenes.reduce((sum, s) => sum + s.duration, 0);
  if (totalDuration > 180) {
    allErrors.push(`Total duration ${totalDuration}s exceeds 180s limit`);
  }
  
  if (allErrors.length === 0) {
    console.log(`✅ Script valid: ${script.scenes.length} scenes, ${totalDuration}s total`);
  }
  
  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Sanitize dialogue for optimal Veo TTS pacing
 * - Ellipses (...) force 0.5-1.0s pauses
 * - Commas force brief breaths
 * - Standardize quotes
 */
export function sanitizeDialogue(text: string): string {
  return text
    .replace(/([.!?])\s*/g, "$1 ")     // Ensure single spacing after sentences
    .replace(/--/g, "...")              // Convert dashes to ellipses for better AI pausing
    .replace(/[""]/g, '"')              // Ensure standard quotes only
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .trim();
}

/**
 * Validate script density - humans speak ~130-150 words/minute
 * Max 3.0 words/sec or Veo may skip dialogue entirely
 */
export function validateScriptDensity(dialogue: string, durationSeconds: number): { 
  valid: boolean; 
  wordsPerSecond: number; 
  recommendation?: string 
} {
  const words = dialogue.split(' ').filter(w => w.length > 0).length;
  const wps = words / durationSeconds;
  
  if (wps > 3.0) {
    return {
      valid: false,
      wordsPerSecond: wps,
      recommendation: `Script too dense (${wps.toFixed(1)} words/sec). Max is 3.0. Either shorten dialogue or increase duration.`
    };
  }
  
  if (wps > 2.5) {
    return {
      valid: true,
      wordsPerSecond: wps,
      recommendation: `Script is dense (${wps.toFixed(1)} words/sec). May feel rushed.`
    };
  }
  
  return { valid: true, wordsPerSecond: wps };
}

/**
 * Build bulletproof Veo prompt using the "Anchor Technique"
 * - Dialogue enforcement at TOP (primary directive)
 * - Visual description in MIDDLE
 * - Dialogue enforcement at BOTTOM (final validation)
 * 
 * This sandwiches visuals between dialogue to prevent AI improvisation
 */
export function buildVeoPrompt(scene: Scene, otherCharacters: string[] = []): string {
  const speaker = scene.audio.speaker || 'Narrator';
  const cameraFocus = scene.visual.cameraFocus || `Medium shot of ${speaker}`;
  const cleanDialogue = sanitizeDialogue(scene.audio.dialogue);
  
  // Validate density
  const density = validateScriptDensity(cleanDialogue, scene.duration);
  if (!density.valid) {
    console.warn(`⚠️ Scene ${scene.id}: ${density.recommendation}`);
  }
  
  // Voice direction
  const voiceDirection = [
    scene.audio.emotion,
    scene.audio.prosodyNotes
  ].filter(Boolean).join(', ');

  // Build prompt with ANCHOR technique - dialogue at TOP and BOTTOM
  return `
###############################################
# PRIMARY DIRECTIVE: SPEECH SYNCHRONIZATION
###############################################

CHARACTER: ${speaker}
EXACT SCRIPT: "${cleanDialogue}"
VOICE: ${voiceDirection}

CRITICAL: Lip-sync must match these EXACT words - word-for-word.
DO NOT paraphrase, summarize, or improvise.
DO NOT add words before or after.
The character says ONLY and EXACTLY: "${cleanDialogue}"

###############################################
# SCENE DESIGN
###############################################

${scene.visual.prompt}

Camera: ${cameraFocus}
Movement: ${scene.visual.cameraMovement || 'static'}
Lighting: ${scene.visual.lighting || 'Natural, cinematic'}
${scene.visual.transitionFrom ? `Transition from: ${scene.visual.transitionFrom}` : ''}

###############################################
# TECHNICAL REQUIREMENTS
###############################################

1. ONLY ${speaker} speaks - all other characters are SILENT (mouths closed)
2. Lip-sync matches the EXACT dialogue above at 1:1 ratio
3. Scene duration: ${scene.duration} seconds
4. No background music unless specified
5. No subtitles or text on screen

###############################################
# FINAL VALIDATION
###############################################

The ONLY words spoken in this video are: "${cleanDialogue}"
Do not hallucinate extra dialogue.
${speaker} says these exact words and nothing else.
  `.trim();
}

export function buildVeoNegativePrompt(scene: Scene, otherCharacters: string[] = []): string {
  const speaker = scene.audio.speaker || 'Narrator';
  const silentCharacters = otherCharacters
    .filter(c => c !== speaker)
    .map(c => `${c} speaking, ${c} talking, ${c} with open mouth`)
    .join(', ');
  
  const baseNegative = scene.visual.negativePrompt || '';
  
  return `
${baseNegative}
(no subtitles, no captions, no text overlay, no watermarks)
(no background music, no ambient sounds unless specified)
(no multiple people talking, no crowd chatter)
(no improvised dialogue, no extra words, no paraphrasing)
(no dialogue variations, no ad-libbing)
${silentCharacters ? `(no ${silentCharacters})` : ''}
(no dialogue from anyone except ${speaker})
(no mouth movement on non-speaking characters)
(no filler words like "um", "uh", "well", "so")
  `.trim();
}

/**
 * Pre-generation checklist for scene validation
 * Returns issues that should be fixed before sending to Veo
 */
export function preGenerationChecklist(scene: Scene): string[] {
  const issues: string[] = [];
  const dialogue = scene.audio.dialogue;
  
  // 1. Speaker specified
  if (!scene.audio.speaker || scene.audio.speaker.trim() === '') {
    issues.push('❌ No speaker specified');
  }
  
  // 2. Dialogue length check
  const wordCount = dialogue.split(' ').filter(w => w.length > 0).length;
  if (wordCount > 30) {
    issues.push(`⚠️ Dialogue may be too long (${wordCount} words). Consider splitting.`);
  }
  
  // 3. Duration vs dialogue length
  const estimatedSpeechDuration = wordCount / 2.5; // ~2.5 words per second
  if (estimatedSpeechDuration > scene.duration * 0.9) {
    issues.push(`⚠️ Dialogue (${estimatedSpeechDuration.toFixed(1)}s) may not fit in ${scene.duration}s scene`);
  }
  
  // 4. Special characters
  if (/[<>{}[\]]/.test(dialogue)) {
    issues.push('❌ Dialogue contains special characters that may cause issues');
  }
  
  // 5. Multiple sentences check
  const sentences = dialogue.split(/[.!?]+/).filter(s => s.trim());
  if (sentences.length > 3) {
    issues.push(`⚠️ ${sentences.length} sentences - consider splitting into multiple scenes`);
  }
  
  // 6. Script density
  const density = validateScriptDensity(dialogue, scene.duration);
  if (!density.valid) {
    issues.push(`❌ ${density.recommendation}`);
  } else if (density.recommendation) {
    issues.push(`⚠️ ${density.recommendation}`);
  }
  
  return issues;
}

/**
 * Build Veo API request payload with optimal settings for dialogue
 */
export function buildVeoApiRequest(scene: Scene, options: {
  audioRefUrl?: string;
  aspectRatio?: string;
} = {}): {
  model: string;
  aspect_ratio: string;
  duration: string;
  audio: {
    enable_speech: boolean;
    speech_fidelity: string;
    audio_reference_url?: string;
  };
  prompt: string;
  negative_prompt: string;
} {
  const density = validateScriptDensity(scene.audio.dialogue, scene.duration);
  if (!density.valid) {
    throw new Error(`Script exceeds physical duration limits: ${density.recommendation}`);
  }

  return {
    model: "veo-3.1-standard",
    aspect_ratio: options.aspectRatio || "16:9",
    duration: `${scene.duration}s`,
    audio: {
      enable_speech: true,
      speech_fidelity: "high",
      // Audio reference is the 'Cheat Code' for perfect script adherence
      ...(options.audioRefUrl && { audio_reference_url: options.audioRefUrl })
    },
    prompt: buildVeoPrompt(scene),
    negative_prompt: buildVeoNegativePrompt(scene)
  };
}
