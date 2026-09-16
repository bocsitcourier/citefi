/**
 * Deterministic, local Markdown renderer for the Gemini speed path.
 *
 * Model Markdown is untrusted input.  This renderer deliberately emits a
 * small, renderer-owned HTML vocabulary and treats source HTML as text.  It
 * is not intended to be a general Markdown implementation: article content
 * needs headings, paragraphs, lists, inline emphasis/code, and safe links,
 * without giving a model a way to supply executable markup.
 */
import { findInvalidArticleUrls } from "./article-output-safety";

const BLOCK_TAGS = new Set(["article", "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "strong", "em", "del", "pre", "code", "a", "br"]);

export class ArticleMarkdownError extends Error {
  readonly code = "UNSAFE_ARTICLE_MARKDOWN";

  constructor(message: string) {
    super(message);
    this.name = "ArticleMarkdownError";
  }
}

function decodeBasicEntities(value: string): string {
  return value.replace(/&(?:nbsp|amp|lt|gt|quot|#39|apos);/gi, (entity) => {
    switch (entity.toLowerCase()) {
      case "&nbsp;": return " ";
      case "&amp;": return "&";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      case "&#39;":
      case "&apos;": return "'";
      default: return entity;
    }
  });
}

function escapeHtml(value: string): string {
  return decodeBasicEntities(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function assertRendererTag(tag: string): void {
  if (!BLOCK_TAGS.has(tag)) {
    throw new ArticleMarkdownError(`renderer attempted to emit unsupported tag: ${tag}`);
  }
}

function safeDestination(destination: string): string {
  const candidate = destination.trim();
  // Keep the shared article URL policy as the source of truth and add the
  // syntax guard needed before a value is placed in a quoted HTML attribute.
  if (
    !candidate ||
    /[\u0000-\u0020<>"'`]/.test(candidate) ||
    findInvalidArticleUrls(`[link](${candidate})`).length > 0
  ) {
    throw new ArticleMarkdownError(`unsafe Markdown link destination: ${destination}`);
  }
  return candidate;
}

function findUnescaped(value: string, needle: string, start: number): number {
  for (let index = start; index <= value.length - needle.length; index += 1) {
    if (value[index] !== needle[0] || value.slice(index, index + needle.length) !== needle) {
      continue;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function findClosingBracket(value: string, start: number): number {
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "]") {
      return index;
    }
  }
  return -1;
}

type LinkDestination = {
  destination: string;
  end: number;
};

/**
 * Parse the destination part of a Markdown link without allowing a closing
 * parenthesis inside a URL path to truncate the value.  Titles are metadata,
 * not visible article text, and are intentionally ignored.
 */
function parseLinkDestination(value: string, start: number): LinkDestination | null {
  let index = start;
  let destination = "";

  if (value[index] === "<") {
    const close = value.indexOf(">", index + 1);
    if (close < 0) return null;
    destination = value.slice(index + 1, close);
    index = close + 1;
  } else {
    let depth = 0;
    let escaped = false;
    const destinationStart = index;
    for (; index < value.length; index += 1) {
      const character = value[index] ?? "";
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(character) && depth === 0) {
        break;
      }
    }
    destination = value.slice(destinationStart, index);
  }

  // A Markdown link may include an optional title.  Locate its final closing
  // parenthesis while keeping title text out of the href.  Unquoted trailing
  // text is left malformed and therefore rendered as ordinary text.
  while (index < value.length && /\s/.test(value[index]!)) index += 1;
  if (index >= value.length) return null;
  if (value[index] !== ")") {
    const quote = value[index];
    if (quote !== '"' && quote !== "'" && quote !== "(") return null;
    const titleEndCharacter = quote === "(" ? ")" : quote;
    let titleEnd = index + 1;
    let escaped = false;
    for (; titleEnd < value.length; titleEnd += 1) {
      const character = value[titleEnd];
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === titleEndCharacter) {
        break;
      }
    }
    if (titleEnd >= value.length) return null;
    index = titleEnd + 1;
    while (index < value.length && /\s/.test(value[index]!)) index += 1;
  }
  if (value[index] !== ")") return null;
  return { destination, end: index + 1 };
}

function renderLink(label: string, destination: string): string {
  assertRendererTag("a");
  const href = escapeAttribute(safeDestination(destination));
  return `<a href="${href}" rel="noopener noreferrer">${renderInline(label)}</a>`;
}

function renderInline(source: string): string {
  let output = "";
  let plainText = "";

  const flushText = () => {
    if (plainText) {
      output += escapeHtml(plainText);
      plainText = "";
    }
  };

  for (let index = 0; index < source.length;) {
    const character = source[index]!;

    // Backslash escapes are Markdown punctuation escapes, not HTML escapes.
    if (character === "\\" && index + 1 < source.length && /[\\`*_[\]{}()#+.!~<>-]/.test(source[index + 1]!)) {
      plainText += source[index + 1]!;
      index += 2;
      continue;
    }

    // Code spans take precedence over emphasis and link syntax.
    if (character === "`") {
      let ticks = 1;
      while (source[index + ticks] === "`") ticks += 1;
      const fence = "`".repeat(ticks);
      const close = source.indexOf(fence, index + ticks);
      if (close >= 0) {
        flushText();
        assertRendererTag("code");
        output += `<code>${escapeHtml(source.slice(index + ticks, close).trim())}</code>`;
        index = close + ticks;
        continue;
      }
    }

    const isImage = character === "!" && source[index + 1] === "[";
    const openingBracket = isImage ? index + 1 : character === "[" ? index : -1;
    if (openingBracket >= 0) {
      const labelEnd = findClosingBracket(source, openingBracket + 1);
      if (labelEnd >= 0 && source[labelEnd + 1] === "(") {
        const parsed = parseLinkDestination(source, labelEnd + 2);
        if (parsed) {
          flushText();
          const label = source.slice(openingBracket + 1, labelEnd);
          // Alt text remains visible text, while image markup itself is not
          // emitted.  This avoids remote-image execution in generated HTML.
          output += isImage ? renderInline(label) : renderLink(label, parsed.destination);
          index = parsed.end;
          continue;
        }
      }
    }

    // Markdown autolinks are the only angle-bracket construct that is
    // renderer-owned. All other angle brackets are escaped as source text.
    if (character === "<") {
      const close = source.indexOf(">", index + 1);
      if (close >= 0) {
        const candidate = source.slice(index + 1, close);
        if (/^(?:https?:\/\/|mailto:)/i.test(candidate)) {
          flushText();
          output += renderLink(candidate, candidate);
          index = close + 1;
          continue;
        }
      }
    }

    let marker: string | null = null;
    if (source.startsWith("**", index) || source.startsWith("__", index)) {
      marker = source.slice(index, index + 2);
    } else if (source.startsWith("~~", index)) {
      marker = "~~";
    } else if (character === "*" || character === "_") {
      marker = character;
    }
    if (marker) {
      const close = findUnescaped(source, marker, index + marker.length);
      if (close > index + marker.length) {
        flushText();
        const inner = renderInline(source.slice(index + marker.length, close));
        if (marker === "~~") {
          assertRendererTag("del");
          output += `<del>${inner}</del>`;
        } else if (marker.length === 2) {
          assertRendererTag("strong");
          output += `<strong>${inner}</strong>`;
        } else {
          assertRendererTag("em");
          output += `<em>${inner}</em>`;
        }
        index = close + marker.length;
        continue;
      }
    }

    plainText += character;
    index += 1;
  }

  flushText();
  return output;
}

function renderCodeBlock(lines: string[]): string {
  assertRendererTag("pre");
  assertRendererTag("code");
  return `<pre><code>${escapeHtml(lines.join("\n"))}</code></pre>`;
}

function renderList(lines: string[], start: number): { html: string; end: number } | null {
  const first = lines[start];
  if (first === undefined) return null;
  const firstMatch = first.match(/^ {0,3}([-+*])\s+(.+)$/);
  const firstOrderedMatch = first.match(/^ {0,3}(\d+)[.)]\s+(.+)$/);
  if (!firstMatch && !firstOrderedMatch) return null;

  const ordered = Boolean(firstOrderedMatch);
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    const match = ordered
      ? line.match(/^ {0,3}\d+[.)]\s+(.+)$/)
      : line.match(/^ {0,3}[-+*]\s+(.+)$/);
    if (!match) break;
    items.push(match[1]!);
    index += 1;
    // Preserve continuation lines as part of the same list item. A blank
    // line terminates the list; nested list syntax remains visible text.
    while (index < lines.length && /^\s{2,}\S/.test(lines[index]!) && !/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(lines[index]!)) {
      items[items.length - 1] += ` ${lines[index]!.trim()}`;
      index += 1;
    }
  }

  const tag = ordered ? "ol" : "ul";
  assertRendererTag(tag);
  assertRendererTag("li");
  return {
    html: `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`,
    end: index,
  };
}

function renderMarkdownBlocks(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*[^`~]*$/);
    if (fence) {
      const marker = fence[1]!;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index]!)) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(renderCodeBlock(codeLines));
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      const headingText = heading[2]!.replace(/\s+#+\s*$/, "").trimEnd();
      assertRendererTag(`h${level}`);
      blocks.push(`<h${level}>${renderInline(headingText)}</h${level}>`);
      index += 1;
      continue;
    }

    const setext = lines[index + 1]?.match(/^ {0,3}(=+|-+)\s*$/);
    if (setext && line.trim()) {
      const level = setext[1]![0] === "=" ? 1 : 2;
      assertRendererTag(`h${level}`);
      blocks.push(`<h${level}>${renderInline(line.trim())}</h${level}>`);
      index += 2;
      continue;
    }

    const list = renderList(lines, index);
    if (list) {
      blocks.push(list.html);
      index = list.end;
      continue;
    }

    // Four-space indented code blocks are standard Markdown and are safer to
    // render as code than to interpret as an HTML-looking paragraph.
    if (/^ {4}\S/.test(line)) {
      const codeLines: string[] = [];
      while (index < lines.length && (/^ {4}\S/.test(lines[index]!) || !lines[index]!.trim())) {
        codeLines.push(lines[index]!.startsWith("    ") ? lines[index]!.slice(4) : "");
        index += 1;
      }
      while (codeLines.at(-1) === "") codeLines.pop();
      blocks.push(renderCodeBlock(codeLines));
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index]!.trim()) {
      const next = lines[index]!;
      if (
        /^ {0,3}(?:#{1,6})[ \t]+/.test(next) ||
        /^ {0,3}(?:`{3,}|~{3,})/.test(next) ||
        /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(next) ||
        (lines[index + 1] && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1]!))
      ) {
        break;
      }
      paragraphLines.push(next.trim());
      index += 1;
    }
    assertRendererTag("p");
    blocks.push(`<p>${renderInline(paragraphLines.join(" "))}</p>`);
  }

  return blocks.join("");
}

/**
 * Convert model-produced Markdown into safe semantic HTML.  The result always
 * has one renderer-owned article wrapper and never copies source HTML tags.
 */
export function renderArticleMarkdown(markdown: string): string {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new ArticleMarkdownError("article Markdown is empty");
  }
  assertRendererTag("article");
  return `<article>${renderMarkdownBlocks(markdown)}</article>`;
}

/** Backwards-friendly descriptive alias for callers outside the worker. */
export const markdownToSafeHtml = renderArticleMarkdown;