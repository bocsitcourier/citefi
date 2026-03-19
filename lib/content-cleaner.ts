
/**
 * Shared utilities for cleaning AI-generated content before saving to the database.
 * Prevents trailing dots, mid-word truncation, and other AI output artifacts.
 */

const DANGLING_TAIL_RE = /[\s,;:]+(?:and|or|for|to|in|of|with|by|from|but|nor|yet|so|as|if|on|at|a|an|the)?\s*$/i;

/**
 * Cleans a meta description:
 * - Strips trailing "...", ".....", "…" that AI generators often add
 * - Prefers last sentence-ending punctuation (. ! ?) within 160 chars
 * - Falls back to word-boundary trim, then strips dangling punctuation/conjunctions
 * - Appends "." when the result has no sentence-ending punctuation
 */
export function cleanMetaDescription(str: string | null | undefined): string | null {
  if (!str) return null;
  let cleaned = str
    .replace(/\.{2,}\s*$/, "")
    .replace(/…\s*$/, "")
    .trim();

  if (cleaned.length > 160) {
    const clipped = cleaned.substring(0, 160);

    // Prefer the last sentence-ending punctuation (at least 120 chars in)
    const lastSentenceEnd = Math.max(
      clipped.lastIndexOf("."),
      clipped.lastIndexOf("!"),
      clipped.lastIndexOf("?")
    );
    if (lastSentenceEnd >= 120) {
      cleaned = clipped.substring(0, lastSentenceEnd + 1).trim();
    } else {
      // Fallback: word-boundary trim, then strip dangling conjunctions/punctuation
      const lastSpace = clipped.lastIndexOf(" ");
      cleaned = (lastSpace > 100 ? clipped.substring(0, lastSpace) : clipped).trim();
      // Strip any trailing dangling conjunction or bare punctuation
      cleaned = cleaned.replace(DANGLING_TAIL_RE, "").trim();
      // Append a period so the sentence reads as complete
      if (cleaned && !/[.!?]$/.test(cleaned)) {
        cleaned = cleaned + ".";
      }
    }
  }

  return cleaned || null;
}

/**
 * Cleans an SEO title:
 * - Strips trailing "...", "…"
 * - Word-boundary trims to 60 chars max (never adds "...")
 */
export function cleanSeoTitle(str: string | null | undefined): string | null {
  if (!str) return null;
  let cleaned = str
    .replace(/\.{2,}\s*$/, "")
    .replace(/…\s*$/, "")
    .trim();
  if (cleaned.length > 60) {
    cleaned = cleaned.substring(0, 60);
    const lastSpace = cleaned.lastIndexOf(" ");
    if (lastSpace > 30) cleaned = cleaned.substring(0, lastSpace);
    cleaned = cleaned.trim();
  }
  return cleaned || null;
}

/**
 * Cleans FAQ answers:
 * - Strips trailing "...", ".....", "…" placeholder dots
 * - Replaces them with a proper period so the answer reads as complete
 */
export function cleanFaqAnswers(
  faq: Array<{ question: string; answer: string }>
): Array<{ question: string; answer: string }> {
  return faq.map((item) => ({
    question: item.question?.trim() || "",
    answer: (item.answer || "")
      .replace(/\.{3,}\s*$/, ".")
      .replace(/…\s*$/, ".")
      .trim(),
  }));
}

/**
 * Cleans any block of generated text:
 * - Strips trailing "...", "…", or run-on dots
 * - Optionally trims to a max character length at word boundaries
 */
export function cleanGeneratedText(
  str: string | null | undefined,
  maxLength?: number
): string | null {
  if (!str) return null;
  let cleaned = str
    .replace(/\.{3,}\s*$/, ".")
    .replace(/…\s*$/, ".")
    .trim();
  if (maxLength && cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength);
    const lastSpace = cleaned.lastIndexOf(" ");
    if (lastSpace > maxLength * 0.6) cleaned = cleaned.substring(0, lastSpace);
    cleaned = cleaned.trim();
  }
  return cleaned || null;
}
