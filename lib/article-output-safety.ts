/**
 * Boundary validation for model-produced article text.
 *
 * Model responses are untrusted data.  In particular, a reviewer or formatter
 * can return its own analysis instead of the requested article.  This module
 * is intentionally deterministic and runs before that response is persisted,
 * reviewed as publishable, or exported.
 */

export type ArticleOutputFormat = "markdown" | "html" | "auto";

export interface ArticleOutputValidation {
  valid: boolean;
  format: "markdown" | "html";
  reasons: string[];
  wordCount: number;
  visibleText: string;
}

export interface ArticleOutputValidationOptions {
  format?: ArticleOutputFormat;
  minWords?: number;
  maxWords?: number;
}

const ARTICLE_URL_RE = /(?:https?:\/\/|mailto:)[^\s<>"'`()\[\]]+/gi;
const URL_TRAILING_PUNCTUATION_RE = /[.,!?;:]+$/;

function cleanUrlCandidate(value: string): string {
  return value.replace(URL_TRAILING_PUNCTUATION_RE, "");
}

/**
 * Return malformed article destinations without treating ordinary prose as a
 * link. This deliberately checks destinations, not factual assertions.
 */
export function findInvalidArticleUrls(content: string): string[] {
  const candidates = [
    ...(content.match(ARTICLE_URL_RE) ?? []),
    ...[...content.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? ""),
    ...[...content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)]
      .map((match) => match[1] ?? ""),
  ];

  return [...new Set(candidates.map(cleanUrlCandidate).filter((candidate) => {
    if (!candidate) return true;
    // Same-site relative and fragment links are valid HTML destinations. They
    // are never accepted for a scheme-relative URL, which otherwise inherits
    // an uncontrolled protocol/host.
    if (/^(?:\/(?!\/)|\.{1,2}\/|#)/.test(candidate)) {
      return /\s/.test(candidate);
    }
    try {
      const parsed = new URL(candidate);
      if (/\s/.test(candidate)) return true;
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return !parsed.hostname;
      }
      if (parsed.protocol === "mailto:") {
        return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(parsed.pathname);
      }
      return true;
    } catch {
      return true;
    }
  }))];
}

// These are deliberately specific.  A technical article may legitimately
// mention prompts or JSON-LD, but it should not narrate a model's inspection
// of its prompt, tags, or reasoning.
const DEBUG_MARKERS: RegExp[] = [
  /\blook\s+at\s+the\s+prompt(?:['’]s)?\b/i,
  /\bprompt(?:['’]s)?\s+(?:input|instruction|text)\b/i,
  /\binternal\s+(?:reasoning|analysis)\b/i,
  /\bchain[-\s]of[-\s]thought\b/i,
  /\b(?:let['’]s|let us)\s+(?:look|inspect|check)\b/i,
  /\b(?:is there|are there)\s+(?:a\s+)?(?:missing|closing)\s+(?:closing\s+)?tag\b/i,
  /\b(?:my copy of|the prompt['’]s)\b/i,
  /^\s*wait\s*[!,:-]/i,
];

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Extract reader-visible text without allowing JSON-LD or CSS/script content
 * to satisfy the article checks.
 */
export function visibleArticleText(content: string, format: "markdown" | "html"): string {
  if (format === "html") {
    return decodeBasicEntities(
      content
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        // Hashtags are often links without terminal punctuation and are
        // enrichment metadata rather than article prose. Match the enclosing
        // container rather than its first child anchor.
        .replace(
          /<((?:div|section|aside|nav|ul))\b[^>]*class=["'][^"']*\bhashtags\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
          " ",
        )
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_~>`]/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferFormat(content: string): "markdown" | "html" {
  return /<article\b/i.test(content) || /<h[1-6]\b/i.test(content) ? "html" : "markdown";
}

function containsDebugMarker(content: string, visibleText: string): boolean {
  return DEBUG_MARKERS.some((marker) => marker.test(content) || marker.test(visibleText));
}

/**
 * Validate that a model response is an article rather than a wrapper,
 * reasoning trace, JSON object, or incomplete fragment.
 */
export function validateArticleOutput(
  content: string | null | undefined,
  options: ArticleOutputValidationOptions = {},
): ArticleOutputValidation {
  const raw = typeof content === "string" ? content.trim() : "";
  const format = options.format === "auto" || !options.format
    ? inferFormat(raw)
    : options.format;
  const reasons: string[] = [];

  if (!raw) reasons.push("empty output");
  if (/^```(?:markdown|html)?\s*[\s\S]*```\s*$/i.test(raw)) {
    reasons.push("code-fenced output");
  }
  if (/^\s*\{\s*["'](?:articleText|content|analysis|reasoning)["']\s*:/i.test(raw)) {
    reasons.push("JSON/debug wrapper instead of article");
  }

  if (format === "html") {
    if (!/<article\b[^>]*>/i.test(raw) || !/<\/article>/i.test(raw)) {
      reasons.push("HTML article wrapper is missing");
    }
    if (!/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/i.test(raw)) {
      reasons.push("article heading is missing");
    }
    if (
      !/<(?:p|li)\b[^>]*>[\s\S]*?<\/(?:p|li)>/i.test(raw) &&
      !/<br\s*\/?>/i.test(raw)
    ) {
      reasons.push("article body elements are missing");
    }
  } else if (!/^\s{0,3}#{1,6}\s+\S/m.test(raw)) {
    reasons.push("markdown article heading is missing");
  }

  const text = visibleArticleText(raw, format);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const minWords = options.minWords ?? 80;
  if (wordCount < minWords) reasons.push(`article body is too short (${wordCount} words)`);
  if (options.maxWords !== undefined && wordCount > options.maxWords) {
    reasons.push(`article body is too long (${wordCount} words; maximum ${options.maxWords})`);
  }
  if (containsDebugMarker(raw, text)) reasons.push("debug/reasoning text detected");
  const invalidUrls = findInvalidArticleUrls(raw);
  if (invalidUrls.length > 0) {
    reasons.push(`article contains invalid URL link(s): ${invalidUrls.join(", ")}`);
  }
  if (text && !/[.!?]["')\]]?\s*$/.test(text)) {
    reasons.push("article body does not end with terminal punctuation");
  }

  return {
    valid: reasons.length === 0,
    format,
    reasons,
    wordCount,
    visibleText: text,
  };
}

/**
 * Repair URL whitespace/casing corruption introduced by a model while keeping
 * the caller's canonical target URL as the only destination.  The common
 * failure is a model rendering a hostname as e.g. "www. Energy. Gov"; URL
 * parsers quite reasonably reject that string, so this must happen before
 * Markdown/HTML link processing.
 */
export function normalizeArticleTargetUrls(
  content: string,
  targetUrl: string | null | undefined,
): string {
  if (!content || !targetUrl) return content;

  let canonical: URL;
  try {
    canonical = new URL(targetUrl);
  } catch {
    return content;
  }

  const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hostPattern = canonical.hostname
    .split(".")
    .map(escapeRegex)
    .join("\\s*\\.\\s*");
  const pathPattern = canonical.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => escapeRegex(segment))
    .join("\\s*\\/\\s*");
  const pathSuffix = pathPattern ? `\\s*\\/\\s*${pathPattern}` : "";

  // Match only the canonical host, allowing whitespace around protocol
  // punctuation and host dots.  This avoids rewriting unrelated external
  // links while repairing both Markdown and HTML attribute values.
  const malformedTarget = new RegExp(
    `https?\\s*:\\s*\\/\\s*\\/\\s*${hostPattern}${pathSuffix}`,
    "gi",
  );

  return content.replace(malformedTarget, () => canonical.toString().replace(/\/$/, ""));
}

export function assertValidArticleOutput(
  content: string | null | undefined,
  options: ArticleOutputValidationOptions = {},
): asserts content is string {
  const result = validateArticleOutput(content, options);
  if (!result.valid) {
    throw new Error(`INVALID_ARTICLE_OUTPUT: ${result.reasons.join("; ")}`);
  }
}