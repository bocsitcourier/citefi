/**
 * video-guards.ts — Script Enforcer
 *
 * A pure utility that guarantees the TTS engine never receives more words
 * than will fit in a 60-second video, no matter what the LLM generates.
 *
 * It runs BEFORE TTS so the audio is always the right length,
 * complementing the compositor's hard audio trim (which is the safety net
 * for anything that slips through).
 */

export interface VideoScene {
  sceneNumber: number;
  narration: string;
  targetDuration: number;
  [key: string]: unknown;
}

export interface VideoScript {
  scenes: VideoScene[];
  totalDuration: number;
  [key: string]: unknown;
}

/**
 * Enforce a maximum word count across all scene narrations.
 *
 * When the total word count exceeds maxWords:
 * - Scenes within budget are left untouched.
 * - The first over-budget scene is trimmed at the last sentence boundary
 *   (. ! ?) that fits, so speech sounds complete rather than cutting mid-word.
 * - All subsequent scenes are zeroed out.
 * - Each affected scene's targetDuration is recalculated from actual word count
 *   so the compositor assigns the right amount of screen time.
 *
 * @param script     Raw VideoScript object from Gemini (mutated in-place, also returned).
 * @param maxWords   Hard ceiling — default 215 (~65 s at 3.3 wps).
 * @param wordsPerSec Speech rate used to recalculate targetDuration — default 3.
 */
export function enforceScriptLength(
  script: VideoScript,
  maxWords = 215,
  wordsPerSec = 3
): VideoScript {
  if (!script?.scenes?.length) return script;

  let totalWordsSoFar = 0;
  let trimmedAny = false;

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i]!;
    const narration = (scene.narration || "").trim();
    const words = narration.split(/\s+/).filter(Boolean);
    const remaining = maxWords - totalWordsSoFar;

    if (words.length === 0) continue;

    if (remaining <= 0) {
      // All budget consumed — zero this scene out
      scene.narration = "";
      scene.targetDuration = 0;
      trimmedAny = true;
      console.warn(`✂️ [ScriptEnforcer] Scene ${i + 1} removed (over budget)`);
      continue;
    }

    if (totalWordsSoFar + words.length > maxWords) {
      // This scene is the overflow scene — trim it at a sentence boundary
      const allowedWords = remaining;
      const candidate = words.slice(0, allowedWords).join(" ");

      // Walk backwards to find last sentence-ending punctuation that fits
      const sentenceMatch = candidate.match(/^(.*[.!?])\s*/s);
      scene.narration = sentenceMatch ? sentenceMatch[1]!.trim() : candidate;

      // Recalculate target duration from the trimmed word count
      const actualWords = scene.narration.split(/\s+/).filter(Boolean).length;
      scene.targetDuration = Math.max(1, Math.ceil(actualWords / wordsPerSec));

      trimmedAny = true;
      console.warn(
        `✂️ [ScriptEnforcer] Scene ${i + 1} trimmed: ${words.length} → ${actualWords} words, targetDuration → ${scene.targetDuration}s`
      );
      totalWordsSoFar += actualWords;
    } else {
      totalWordsSoFar += words.length;
    }
  }

  if (trimmedAny) {
    const newTotal = script.scenes.reduce((sum, s) => sum + (s.targetDuration || 0), 0);
    script.totalDuration = Math.min(script.totalDuration, newTotal);
    console.warn(
      `✂️ [ScriptEnforcer] Script enforced: ${totalWordsSoFar} words, ~${newTotal}s total duration`
    );
  } else {
    const actualTotal = script.scenes.reduce(
      (sum, s) => sum + ((s.narration || "").split(/\s+/).filter(Boolean).length),
      0
    );
    console.log(`✅ [ScriptEnforcer] Script within budget: ${actualTotal} words (max ${maxWords})`);
  }

  return script;
}
