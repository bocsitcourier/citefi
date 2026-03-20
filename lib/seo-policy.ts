/**
 * CENTRALIZED SEO GOVERNANCE POLICY
 * ===================================
 * Single source of truth for anchor text quality rules used by:
 *   - applyHyperlinksDom (DOM injector)
 *   - buildSlugMap / buildFallbackTerms (slug map builder)
 *   - buildIntentDrivenAnchors (intent engine)
 *   - Any future route or script that generates hyperlinks
 *
 * Changing a rule here propagates to the ENTIRE app instantly.
 */

const ANCHOR_STOP_WORDS = new Set([
  "the","a","an","in","on","at","to","for","of","is","are","was","were",
  "and","or","but","this","that","these","those","it","its","we","our",
  "you","your","they","their","with","from","by","about","as","into",
  "how","what","when","where","which","who","why","be","been","being",
  "have","has","had","do","does","did","will","would","could","should",
  "may","might","must","shall","can","not","no","so","if","then","than",
  "also","more","most","any","all","each","both","few","many","some",
  "very","just","only","even","new","such","other","same","here","there",
  "learn","click","read","visit","contact","view","find","get","call",
  "info","information","details","page","home","menu","search","provide",
  "include","including","ensure","offer","require","allows","enables",
]);

const US_STATE_ABBREVS = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in",
  "ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv",
  "nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn",
  "tx","ut","vt","va","wa","wv","wi","wy","dc",
]);

/**
 * Returns true if the phrase is a bare geographic anchor —
 * a standalone city, state, or "City ST" / "City, ST" pattern
 * that provides zero topical context for Google.
 *
 * Examples rejected:
 *   "Boston"         → bare city
 *   "Boston MA"      → city + state abbrev only
 *   "Weston MA"      → city + state abbrev only
 *   "Boston, MA"     → city, state format
 *   "Massachusetts"  → bare state name
 */
export function isBareGeoAnchor(phrase: string): boolean {
  const trimmed = phrase.trim();
  const words = trimmed.split(/\s+/);

  if (words.length > 3) return false; // 4+ words always have enough context

  // Single word — if it looks like a proper noun city or a state abbrev, reject
  if (words.length === 1) {
    const lower = words[0].toLowerCase();
    // State abbreviations
    if (US_STATE_ABBREVS.has(lower)) return true;
    // Looks like a proper noun (capitalized single word) — could be a city name
    if (/^[A-Z][a-z]{2,}$/.test(words[0])) return true;
    return false;
  }

  // Two or three words: check if ALL non-punctuation tokens are geo tokens
  const cleaned = trimmed.replace(/[,\.]/g, " ").split(/\s+/).filter(Boolean);
  const nonGeoTokens = cleaned.filter((w) => {
    const lower = w.toLowerCase();
    if (US_STATE_ABBREVS.has(lower)) return false; // state abbrev → geo
    if (/^[A-Z][a-z]{1,}$/.test(w)) return false;  // proper noun → geo
    return true; // everything else is non-geo
  });

  // If every token is a geo token, reject
  return nonGeoTokens.length === 0;
}

/**
 * Returns true if the anchor phrase passes ALL quality gates:
 *   1. Minimum 4 words (not a bare location or vague phrase)
 *   2. Maximum 10 words (not a sentence fragment)
 *   3. Does not start or end with a stop word
 *   4. Contains no commas (comma = list, never good anchor text)
 *   5. Not a bare geographic anchor (city/state only)
 */
export function isHighQualityAnchor(phrase: string): boolean {
  if (!phrase || typeof phrase !== "string") return false;

  const trimmed = phrase.trim();
  if (trimmed.includes(",")) return false; // commas = list fragment

  const words = trimmed.split(/\s+/);
  if (words.length < 4) return false;  // must be 4+ words
  if (words.length > 10) return false; // reject sentence-length anchors

  const first = words[0].toLowerCase();
  const last = words[words.length - 1].toLowerCase();
  if (ANCHOR_STOP_WORDS.has(first)) return false;
  if (ANCHOR_STOP_WORDS.has(last)) return false;

  if (isBareGeoAnchor(trimmed)) return false;

  return true;
}

/**
 * Strips the article HTML to clean prose text for AI processing.
 * Returns HEAD (first N chars) + TAIL (last M chars) as a combined
 * context string so that FAQ sections at the end of long articles
 * are never truncated away from the AI's view.
 *
 * @param html           Full article HTML
 * @param headChars      Characters to keep from the beginning (default 8 000)
 * @param tailChars      Characters to keep from the end (default 6 000)
 * @param totalLimit     Hard cap — if text <= this, return it whole (default 14 000)
 */
export function getFullArticleContext(
  html: string,
  headChars = 8000,
  tailChars = 6000,
  totalLimit = 14000
): string {
  const plain = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/p>/gi, " | ")
    .replace(/<\/li>/gi, " | ")
    .replace(/<\/dd>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ \| +/g, " | ")
    .trim();

  if (plain.length <= totalLimit) return plain;

  const head = plain.substring(0, headChars);
  const tail = plain.substring(plain.length - tailChars);

  return `${head} [...] [FAQ/CONCLUSION]: ${tail}`;
}
