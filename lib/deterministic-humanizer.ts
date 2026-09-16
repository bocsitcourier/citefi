/**
 * Deterministic Humanization (DH) System
 * 
 * Solves the "Uncanny Valley of Perfection" by adding structural entropy
 * to AI-generated content. This is a stateless middleware between the
 * Fact-Gated Validator and delivery.
 * 
 * Key Principles:
 * - Zero hallucination surface (scripts, not AI)
 * - Brand consistency (tune once, apply globally)
 * - Speed (regex/string manipulation runs in milliseconds)
 * - Legal safety (Entity Intersection test proves no new claims)
 */

export interface HumanizationConfig {
  burstinessTarget?: number;
  scrubLevel?: "minimal" | "standard" | "aggressive";
  preserveEntities?: boolean;
  channelFormat?: "article" | "social" | "video" | "podcast";
}

export interface HumanizationResult {
  content: string;
  metrics: {
    originalSentenceCount: number;
    burstinessApplied: number;
    scrubsApplied: number;
    integrityPassed: boolean;
    processingTimeMs: number;
  };
}

const AI_ISMS: RegExp[] = [
  /\bIt's worth noting that\b/gi,
  /\bIt is important to note that\b/gi,
  /\bIn today's fast-paced world\b/gi,
  /\bIn the realm of\b/gi,
  /\bLet's dive into\b/gi,
  /\bLet's explore\b/gi,
  /\bWithout further ado\b/gi,
  /\bIn conclusion\b/gi,
  /\bTo summarize\b/gi,
  /\bAll in all\b/gi,
  /\bAt the end of the day\b/gi,
  /\bMoving forward\b/gi,
  /\bThat being said\b/gi,
  /\bWith that said\b/gi,
  /\bHaving said that\b/gi,
  /\bIn essence\b/gi,
  /\bEssentially\b/gi,
  /\bFundamentally\b/gi,
  /\bInterestingly\b/gi,
  /\bNeedless to say\b/gi,
  /\bIt goes without saying\b/gi,
  /\bAs we delve into\b/gi,
  /\bAs we navigate\b/gi,
  /\bLet me be clear\b/gi,
  /\bTo be honest\b/gi,
  /\bTruth be told\b/gi,
  /\bThe fact of the matter is\b/gi,
  /\bAt its core\b/gi,
  /\bBy and large\b/gi,
  /\bFor the most part\b/gi,
  /\bIn a nutshell\b/gi,
  /\bLong story short\b/gi,
  /\bTo put it simply\b/gi,
  /\bSimply put\b/gi,
  /\bIn other words\b/gi,
  /\bThat is to say\b/gi,
  /\bSo to speak\b/gi,
  /\bAs it were\b/gi,
  /\bIf you will\b/gi,
  /\bOne might say\b/gi,
  /\bIt could be argued that\b/gi,
  /\bSome might argue\b/gi,
  /\bThere's no denying\b/gi,
  /\bIt's no secret that\b/gi,
  /\bAs a matter of fact\b/gi,
  /\bIn point of fact\b/gi,
  /\bThe bottom line is\b/gi,
  /\bWhen all is said and done\b/gi,
  /\bFirst and foremost\b/gi,
  /\bLast but not least\b/gi,
  /\bTime will tell\b/gi,
  /\bOnly time will tell\b/gi,
  /\bThe jury is still out\b/gi,
  /\bStay tuned\b/gi,
  /\bWatch this space\b/gi,
  /\bGame-changer\b/gi,
  /\bParadigm shift\b/gi,
  /\bSynergy\b/gi,
  /\bLeverage\b/gi,
  /\bStreamline\b/gi,
  /\bOptimize\b/gi,
  /\bHolistic\b/gi,
  /\bRobust\b/gi,
  /\bSeamless\b/gi,
  /\bCutting-edge\b/gi,
  /\bState-of-the-art\b/gi,
  /\bWorld-class\b/gi,
  /\bBest-in-class\b/gi,
  /\bIndustry-leading\b/gi,
  /\bUnparalleled\b/gi,
  /\bUnmatched\b/gi,
  /\bSecond to none\b/gi,
  /\bBar none\b/gi,
  /\bAbove and beyond\b/gi,
  /\bGo the extra mile\b/gi,
  /\bRaise the bar\b/gi,
  /\bPush the envelope\b/gi,
  /\bThink outside the box\b/gi,
  /\bMove the needle\b/gi,
  /\bLow-hanging fruit\b/gi,
  /\bQuick win\b/gi,
  /\bNo-brainer\b/gi,
  /\bWin-win\b/gi,
  /\bValue-add\b/gi,
  /\bActionable insights\b/gi,
  /\bKey takeaways\b/gi,
  /\bBest practices\b/gi,
  /\bCore competencies\b/gi,
  /\bMission-critical\b/gi,
  /\bResults-driven\b/gi,
  /\bData-driven\b/gi,
  /\bUser-centric\b/gi,
  /\bCustomer-centric\b/gi,
  /\bForward-thinking\b/gi,
  /\bInnovative solutions\b/gi,
  /\bComprehensive approach\b/gi,
  /\bStrategic initiative\b/gi,
  /\bValue proposition\b/gi,
  /\bCompetitive advantage\b/gi,
  /\bMarket leader\b/gi,
  /\bThought leader\b/gi,
];

const AI_ISM_REPLACEMENTS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bIt's worth noting that\b/gi, replacement: "" },
  { pattern: /\bIt is important to note that\b/gi, replacement: "" },
  { pattern: /\bIn today's fast-paced world,?\s*/gi, replacement: "" },
  { pattern: /\bIn the realm of\b/gi, replacement: "In" },
  { pattern: /\bLet's dive into\b/gi, replacement: "Here's" },
  { pattern: /\bLet's explore\b/gi, replacement: "Consider" },
  { pattern: /\bWithout further ado,?\s*/gi, replacement: "" },
  { pattern: /\bIn conclusion,?\s*/gi, replacement: "" },
  { pattern: /\bTo summarize,?\s*/gi, replacement: "" },
  { pattern: /\bAll in all,?\s*/gi, replacement: "" },
  { pattern: /\bAt the end of the day,?\s*/gi, replacement: "" },
  { pattern: /\bMoving forward,?\s*/gi, replacement: "" },
  { pattern: /\bThat being said,?\s*/gi, replacement: "" },
  { pattern: /\bWith that said,?\s*/gi, replacement: "" },
  { pattern: /\bHaving said that,?\s*/gi, replacement: "" },
  { pattern: /\bIn essence,?\s*/gi, replacement: "" },
  { pattern: /\bEssentially,?\s*/gi, replacement: "" },
  { pattern: /\bFundamentally,?\s*/gi, replacement: "" },
  { pattern: /\bInterestingly,?\s*/gi, replacement: "" },
  { pattern: /\bNeedless to say,?\s*/gi, replacement: "" },
  { pattern: /\bIt goes without saying that\s*/gi, replacement: "" },
  { pattern: /\bAs we delve into\b/gi, replacement: "About" },
  { pattern: /\bAs we navigate\b/gi, replacement: "As we handle" },
  { pattern: /\bThe fact of the matter is,?\s*/gi, replacement: "" },
  { pattern: /\bBy and large,?\s*/gi, replacement: "" },
  { pattern: /\bFor the most part,?\s*/gi, replacement: "" },
  { pattern: /\bIn a nutshell,?\s*/gi, replacement: "" },
  { pattern: /\bLong story short,?\s*/gi, replacement: "" },
  { pattern: /\bTo put it simply,?\s*/gi, replacement: "" },
  { pattern: /\bSimply put,?\s*/gi, replacement: "" },
  { pattern: /\bFirst and foremost,?\s*/gi, replacement: "First," },
  { pattern: /\bLast but not least,?\s*/gi, replacement: "Finally," },
  { pattern: /\bgame-changer\b/gi, replacement: "significant change" },
  { pattern: /\bparadigm shift\b/gi, replacement: "major change" },
  { pattern: /\bsynergy\b/gi, replacement: "collaboration" },
  { pattern: /\bleverage\b/gi, replacement: "use" },
  { pattern: /\bstreamline\b/gi, replacement: "simplify" },
  { pattern: /\boptimize\b/gi, replacement: "improve" },
  { pattern: /\bholistic\b/gi, replacement: "complete" },
  { pattern: /\brobust\b/gi, replacement: "strong" },
  { pattern: /\bseamless\b/gi, replacement: "smooth" },
  { pattern: /\bcutting-edge\b/gi, replacement: "modern" },
  { pattern: /\bstate-of-the-art\b/gi, replacement: "advanced" },
  { pattern: /\bworld-class\b/gi, replacement: "excellent" },
  { pattern: /\bbest-in-class\b/gi, replacement: "top-quality" },
  { pattern: /\bindustry-leading\b/gi, replacement: "leading" },
  { pattern: /\bunparalleled\b/gi, replacement: "exceptional" },
  { pattern: /\bunmatched\b/gi, replacement: "outstanding" },
  { pattern: /\bsecond to none\b/gi, replacement: "the best" },
  { pattern: /\bgo the extra mile\b/gi, replacement: "do more" },
  { pattern: /\braise the bar\b/gi, replacement: "set higher standards" },
  { pattern: /\bpush the envelope\b/gi, replacement: "try new things" },
  { pattern: /\bthink outside the box\b/gi, replacement: "be creative" },
  { pattern: /\bmove the needle\b/gi, replacement: "make progress" },
  { pattern: /\blow-hanging fruit\b/gi, replacement: "easy wins" },
  { pattern: /\bquick win\b/gi, replacement: "fast result" },
  { pattern: /\bno-brainer\b/gi, replacement: "obvious choice" },
  { pattern: /\bwin-win\b/gi, replacement: "mutually beneficial" },
  { pattern: /\bvalue-add\b/gi, replacement: "benefit" },
  { pattern: /\bactionable insights\b/gi, replacement: "useful findings" },
  { pattern: /\bkey takeaways\b/gi, replacement: "main points" },
  { pattern: /\bbest practices\b/gi, replacement: "proven methods" },
  { pattern: /\bcore competencies\b/gi, replacement: "main skills" },
  { pattern: /\bmission-critical\b/gi, replacement: "essential" },
  { pattern: /\bresults-driven\b/gi, replacement: "focused on results" },
  { pattern: /\bdata-driven\b/gi, replacement: "based on data" },
  { pattern: /\buser-centric\b/gi, replacement: "focused on users" },
  { pattern: /\bcustomer-centric\b/gi, replacement: "focused on customers" },
  { pattern: /\bforward-thinking\b/gi, replacement: "progressive" },
  { pattern: /\binnovative solutions\b/gi, replacement: "new approaches" },
  { pattern: /\bcomprehensive approach\b/gi, replacement: "thorough approach" },
  { pattern: /\bstrategic initiative\b/gi, replacement: "planned effort" },
  { pattern: /\bvalue proposition\b/gi, replacement: "main benefit" },
  { pattern: /\bcompetitive advantage\b/gi, replacement: "edge" },
  { pattern: /\bmarket leader\b/gi, replacement: "top provider" },
  { pattern: /\bthought leader\b/gi, replacement: "expert" },
];

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  const regex = /[^.!?]*[.!?]+[\s]*/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const sentence = match[0].trim();
    if (sentence) sentences.push(sentence);
  }
  const remaining = text.replace(regex, "").trim();
  if (remaining) sentences.push(remaining);
  return sentences;
}

function calculateBurstiness(sentenceLengths: number[]): number {
  if (sentenceLengths.length < 2) return 0;
  const mean = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
  const variance = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - mean, 2), 0) / sentenceLengths.length;
  const stdDev = Math.sqrt(variance);
  return mean > 0 ? stdDev / mean : 0;
}

function applyBurstiness(content: string, targetCV: number = 0.45): string {
  const sentences = splitSentences(content);
  if (sentences.length < 3) return content;

  const lengths = sentences.map(s => s.split(/\s+/).length);
  const currentCV = calculateBurstiness(lengths);
  
  if (currentCV >= targetCV * 0.9) {
    return content;
  }

  const modifiedSentences = [...sentences];
  const modifications: number[] = [];
  
  for (let i = 0; i < sentences.length; i += 3) {
    if (i < sentences.length) modifications.push(i);
  }

  for (const idx of modifications) {
    const sentence = modifiedSentences[idx]!;
    const words = sentence.split(/\s+/);
    
    if (words.length > 12 && Math.random() > 0.5) {
      const midPoint = Math.floor(words.length / 2);
      const conjunctions = [" and ", " but ", " so ", ", which ", " – "];
      const splitWord = words[midPoint]!;
      
      if (!conjunctions.some(c => splitWord.includes(c.trim()))) {
        const firstHalf = words.slice(0, midPoint).join(" ");
        const secondHalf = words.slice(midPoint).join(" ");
        
        if (secondHalf.length > 3) {
          const capitalizedSecond = secondHalf.charAt(0).toUpperCase() + secondHalf.slice(1);
          modifiedSentences[idx] = firstHalf + ". " + capitalizedSecond;
        }
      }
    }
    else if (words.length < 8 && idx + 1 < modifiedSentences.length) {
      const nextSentence = modifiedSentences[idx + 1]!;
      const nextWords = nextSentence.split(/\s+/);
      
      if (nextWords.length < 8 && words.length + nextWords.length < 20) {
        const connectors = [" – ", " and ", "; "];
        const connector = connectors[Math.floor(Math.random() * connectors.length)];
        const combined = sentence.replace(/[.!?]$/, "") + connector + 
          nextSentence.charAt(0).toLowerCase() + nextSentence.slice(1);
        modifiedSentences[idx] = combined;
        modifiedSentences[idx + 1] = "";
      }
    }
  }

  return modifiedSentences.filter(s => s.length > 0).join(" ");
}

/**
 * Article Markdown is a document, not a flat string.  Keep the legacy
 * sentence algorithm for the other channels, but use a deterministic variant
 * for article prose so headings, lists, and other Markdown syntax are never
 * consumed by sentence splitting.
 */
function applyBurstinessToProse(content: string, targetCV: number = 0.45): string {
  const sentences = splitSentences(content);
  if (sentences.length < 3) return content;

  const lengths = sentences.map((sentence) => sentence.split(/\s+/).length);
  const currentCV = calculateBurstiness(lengths);
  if (currentCV >= targetCV * 0.9) return content;

  const modifiedSentences = [...sentences];
  // Pick stable positions rather than Math.random().  Humanization is
  // deliberately repeatable for retries and receipt-safe worker redelivery.
  for (let index = 0; index < sentences.length; index += 3) {
    const sentence = modifiedSentences[index];
    if (!sentence) continue;
    const words = sentence.split(/\s+/);
    if (words.length > 12) {
      const midpoint = Math.floor(words.length / 2);
      const firstHalf = words.slice(0, midpoint).join(" ");
      const secondHalf = words.slice(midpoint).join(" ");
      if (firstHalf && secondHalf.length > 3) {
        modifiedSentences[index] =
          `${firstHalf}. ${secondHalf.charAt(0).toUpperCase()}${secondHalf.slice(1)}`;
      }
    } else if (words.length < 8 && index + 1 < modifiedSentences.length) {
      const nextSentence = modifiedSentences[index + 1];
      const nextWords = nextSentence?.split(/\s+/) ?? [];
      if (nextSentence && nextWords.length < 8 && words.length + nextWords.length < 20) {
        modifiedSentences[index] =
          `${sentence.replace(/[.!?]$/, "")} – ${nextSentence.charAt(0).toLowerCase()}${nextSentence.slice(1)}`;
        modifiedSentences[index + 1] = "";
      }
    }
  }

  return modifiedSentences.filter((sentence) => sentence.length > 0).join(" ");
}

function applyLexicalScrub(content: string, level: "minimal" | "standard" | "aggressive"): { content: string; scrubCount: number } {
  let scrubbed = content;
  let scrubCount = 0;

  const replacementsToApply = level === "minimal" 
    ? AI_ISM_REPLACEMENTS.slice(0, 20)
    : level === "standard"
    ? AI_ISM_REPLACEMENTS.slice(0, 50)
    : AI_ISM_REPLACEMENTS;

  for (const { pattern, replacement } of replacementsToApply) {
    const matches = scrubbed.match(pattern);
    if (matches) {
      scrubCount += matches.length;
      scrubbed = scrubbed.replace(pattern, replacement);
    }
  }

  scrubbed = scrubbed.replace(/\s{2,}/g, " ");
  scrubbed = scrubbed.replace(/\.\s*\./g, ".");
  scrubbed = scrubbed.replace(/,\s*,/g, ",");
  scrubbed = scrubbed.replace(/^\s+/, "");
  
  const sentences = splitSentences(scrubbed);
  const capitalizedSentences = sentences.map(s => {
    if (s.length > 0) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return s;
  });
  scrubbed = capitalizedSentences.join(" ");

  return { content: scrubbed, scrubCount };
}

function isFenceStart(line: string): boolean {
  return /^\s{0,3}(?:`{3,}|~{3,})/.test(line);
}

function getFenceMarker(line: string): string {
  return line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1] ?? "";
}

function isFenceEnd(line: string, fence: string): boolean {
  return new RegExp(`^\\s{0,3}${fence}`).test(line);
}

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

function isListItem(line: string): boolean {
  return /^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(line);
}

function isBlockQuote(line: string): boolean {
  return /^\s{0,3}>/.test(line);
}

function isIndentedCode(line: string): boolean {
  return /^(?: {4}|\t)\S?/.test(line);
}

function isTableDelimiter(line: string): boolean {
  return /^\s{0,3}\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  return index + 1 < lines.length &&
    lines[index]!.trim().length > 0 &&
    isTableDelimiter(lines[index + 1]!);
}

function isProtectedMarkdownLine(lines: string[], index: number): boolean {
  const line = lines[index]!;
  return isFenceStart(line) ||
    isHeading(line) ||
    isListItem(line) ||
    isBlockQuote(line) ||
    isIndentedCode(line) ||
    isTableStart(lines, index) ||
    /^\s{0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line) ||
    /^\s*<\/?[A-Za-z][^>]*>\s*$/.test(line);
}

/**
 * Humanize only paragraph blocks in an article Markdown document.  Protected
 * blocks are copied byte-for-byte: this includes blank lines around them,
 * headings, list indentation/continuations, quotes, tables, fenced/indented
 * code, and standalone HTML.  This boundary is intentionally Markdown-only;
 * social/video/podcast channels continue to use their existing flat-string
 * behavior.
 */
function humanizeArticleMarkdown(
  content: string,
  targetCV: number,
  level: "minimal" | "standard" | "aggressive",
): { content: string; scrubCount: number } {
  const lines = content.split("\n");
  const output: string[] = [];
  let scrubCount = 0;
  let index = 0;

  while (index < lines.length) {
    if (lines[index]!.trim() === "") {
      output.push(lines[index]!);
      index += 1;
      continue;
    }

    const protectedBlock = isProtectedMarkdownLine(lines, index);
    const block: string[] = [lines[index]!];
    const fence = isFenceStart(lines[index]!) ? getFenceMarker(lines[index]!) : "";
    index += 1;

    if (fence) {
      while (index < lines.length) {
        block.push(lines[index]!);
        const closingLine = lines[index]!;
        index += 1;
        if (isFenceEnd(closingLine, fence)) break;
      }
      output.push(...block);
      continue;
    }

    // Keep only the structural continuation of this protected block. A
    // heading/list/quote may legally be followed by a paragraph without a
    // blank line; that paragraph is still prose and should be transformed.
    if (protectedBlock && !fence) {
      const first = block[0]!;
      const continuation = (line: string): boolean => {
        if (isListItem(first)) return isListItem(line) || /^\s{2,}\S/.test(line);
        if (isBlockQuote(first)) return isBlockQuote(line);
        if (isTableStart(lines, index - block.length)) {
          return /^\s*\|/.test(line) || isTableDelimiter(line);
        }
        if (isIndentedCode(first)) return isIndentedCode(line);
        if (/^\s*<\/?[A-Za-z][^>]*>\s*$/.test(first)) {
          return /^\s*<\/?[A-Za-z][^>]*>\s*$/.test(line);
        }
        return false;
      };
      while (index < lines.length && lines[index]!.trim() !== "" && continuation(lines[index]!)) {
        block.push(lines[index]!);
        index += 1;
      }
    } else {
      while (index < lines.length && lines[index]!.trim() !== "") {
        const nextProtected = isProtectedMarkdownLine(lines, index);
        if (!protectedBlock && nextProtected) break;
        block.push(lines[index]!);
        index += 1;
      }
    }

    if (protectedBlock) {
      output.push(...block);
      continue;
    }

    // Keep soft line breaks in prose blocks. Each physical line is a prose
    // unit, while blank-line paragraph boundaries remain untouched.
    for (const proseLine of block) {
      const hardBreak = / {2,}$/.test(proseLine) ? "  " : "";
      const sourceLine = proseLine.replace(/ {2,}$/, "");
      const bursty = applyBurstinessToProse(sourceLine, targetCV);
      const scrubbed = applyLexicalScrub(bursty, level);
      scrubCount += scrubbed.scrubCount;
      output.push(scrubbed.content + hardBreak);
    }
  }

  return { content: output.join("\n"), scrubCount };
}

function extractEntities(content: string): Set<string> {
  const entities = new Set<string>();
  
  const properNouns = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  properNouns.forEach(e => entities.add(e));
  
  const numbers = content.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|percent|dollars|million|billion|thousand))?\b/gi) || [];
  numbers.forEach(e => entities.add(e));
  
  const dates = content.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi) || [];
  dates.forEach(e => entities.add(e));
  
  const quotes = content.match(/"[^"]+"/g) || [];
  quotes.forEach(e => entities.add(e));
  
  return entities;
}

function integrityCheck(original: string, humanized: string): { passed: boolean; newEntities: string[]; removedEntities: string[] } {
  const originalEntities = extractEntities(original);
  const humanizedEntities = extractEntities(humanized);
  
  const newEntities: string[] = [];
  const removedEntities: string[] = [];
  
  humanizedEntities.forEach(entity => {
    if (!originalEntities.has(entity)) {
      const isSubstring = Array.from(originalEntities).some(orig => 
        orig.includes(entity) || entity.includes(orig)
      );
      if (!isSubstring) {
        newEntities.push(entity);
      }
    }
  });
  
  originalEntities.forEach(entity => {
    if (!humanizedEntities.has(entity)) {
      const isSubstring = Array.from(humanizedEntities).some(hum => 
        hum.includes(entity) || entity.includes(hum)
      );
      if (!isSubstring) {
        removedEntities.push(entity);
      }
    }
  });
  
  const significantNewEntities = newEntities.filter(e => 
    e.length > 3 && 
    !/^\d+$/.test(e) &&
    !["The", "This", "That", "These", "Those", "Here", "There"].includes(e)
  );
  
  return {
    passed: significantNewEntities.length === 0,
    newEntities: significantNewEntities,
    removedEntities
  };
}

function applyChannelFormatting(content: string, channel: "article" | "social" | "video" | "podcast"): string {
  switch (channel) {
    case "social":
      let social = content;
      if (social.length > 280) {
        const sentences = splitSentences(social);
        social = sentences.slice(0, Math.ceil(sentences.length / 2)).join(" ");
        if (social.length > 280) {
          social = social.substring(0, 277) + "...";
        }
      }
      return social;
      
    case "video":
      let video = content;
      video = video.replace(/\([^)]+\)/g, "");
      video = video.replace(/\[[^\]]+\]/g, "");
      video = video.replace(/\b(?:i\.e\.|e\.g\.|etc\.)\b/gi, "");
      return video.trim();
      
    case "podcast":
      let podcast = content;
      podcast = podcast.replace(/(\d),(\d)/g, "$1 $2");
      podcast = podcast.replace(/(\d)\.(\d)/g, "$1 point $2");
      podcast = podcast.replace(/\b(\d+)%/g, "$1 percent");
      podcast = podcast.replace(/\$(\d+)/g, "$1 dollars");
      podcast = podcast.replace(/&/g, "and");
      return podcast;
      
    case "article":
    default:
      return content;
  }
}

export function humanizeContent(
  content: string,
  config: HumanizationConfig = {}
): HumanizationResult {
  const startTime = Date.now();
  
  const {
    burstinessTarget = 0.45,
    scrubLevel = "standard",
    preserveEntities = true,
    channelFormat = "article"
  } = config;

  const originalSentences = splitSentences(content);
  
  let processed = content;
  
  let scrubCount = 0;
  if (channelFormat === "article") {
    const article = humanizeArticleMarkdown(processed, burstinessTarget, scrubLevel);
    processed = article.content;
    scrubCount = article.scrubCount;
  } else {
    processed = applyBurstiness(processed, burstinessTarget);
    const scrubbed = applyLexicalScrub(processed, scrubLevel);
    processed = scrubbed.content;
    scrubCount = scrubbed.scrubCount;
  }
  
  processed = applyChannelFormatting(processed, channelFormat);
  
  let integrityPassed = true;
  if (preserveEntities) {
    const integrity = integrityCheck(content, processed);
    integrityPassed = integrity.passed;
    
    if (!integrityPassed) {
      console.warn("[DH] Integrity check failed - new entities detected:", integrity.newEntities);
      processed = content;
    }
  }

  const newSentences = splitSentences(processed);
  const newLengths = newSentences.map(s => s.split(/\s+/).length);
  const appliedBurstiness = calculateBurstiness(newLengths);

  return {
    content: processed,
    metrics: {
      originalSentenceCount: originalSentences.length,
      burstinessApplied: Math.round(appliedBurstiness * 100) / 100,
      scrubsApplied: scrubCount,
      integrityPassed,
      processingTimeMs: Date.now() - startTime
    }
  };
}

export function humanizeArticle(content: string, burstiness: number = 0.45): HumanizationResult {
  return humanizeContent(content, {
    burstinessTarget: burstiness,
    scrubLevel: "standard",
    preserveEntities: true,
    channelFormat: "article"
  });
}

export function humanizeSocialPost(content: string, burstiness: number = 0.35): HumanizationResult {
  return humanizeContent(content, {
    burstinessTarget: burstiness,
    scrubLevel: "aggressive",
    preserveEntities: true,
    channelFormat: "social"
  });
}

export function humanizeVideoScript(content: string, burstiness: number = 0.40): HumanizationResult {
  return humanizeContent(content, {
    burstinessTarget: burstiness,
    scrubLevel: "standard",
    preserveEntities: true,
    channelFormat: "video"
  });
}

export function humanizePodcastScript(content: string, burstiness: number = 0.50): HumanizationResult {
  return humanizeContent(content, {
    burstinessTarget: burstiness,
    scrubLevel: "minimal",
    preserveEntities: true,
    channelFormat: "podcast"
  });
}

export function getAIismCount(content: string): number {
  let count = 0;
  for (const pattern of AI_ISMS) {
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

export function analyzeContentQuality(content: string): {
  burstiness: number;
  aiIsmCount: number;
  averageSentenceLength: number;
  sentenceCount: number;
  readabilityScore: number;
} {
  const sentences = splitSentences(content);
  const lengths = sentences.map(s => s.split(/\s+/).length);
  const burstiness = calculateBurstiness(lengths);
  const aiIsmCount = getAIismCount(content);
  const averageSentenceLength = lengths.length > 0 
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length 
    : 0;
  
  const words = content.split(/\s+/).length;
  const syllables = content.split(/[aeiou]/gi).length - 1;
  const fleschKincaid = 206.835 - (1.015 * (words / sentences.length)) - (84.6 * (syllables / words));
  
  return {
    burstiness: Math.round(burstiness * 100) / 100,
    aiIsmCount,
    averageSentenceLength: Math.round(averageSentenceLength * 10) / 10,
    sentenceCount: sentences.length,
    readabilityScore: Math.round(Math.max(0, Math.min(100, fleschKincaid)))
  };
}

export const deterministicHumanizer = {
  humanize: humanizeContent,
  humanizeArticle,
  humanizeSocialPost,
  humanizeVideoScript,
  humanizePodcastScript,
  analyze: analyzeContentQuality,
  getAIismCount
};
