/**
 * EU AI Act Article 50 Compliance — AI-Generated Content Disclosure
 *
 * Article 50 of the EU AI Act (effective Aug 2 2026) requires that AI-generated
 * content be disclosed to end users. This module generates the required disclosure
 * HTML and tracks compliance status per article.
 *
 * Scope: applies to all article, social post, podcast, and video content generated
 * by this platform when consumed by EU residents.
 */

export interface DisclosureOptions {
  generatorModel?: string;
  reviewModel?: string;
  generatedAt?: Date;
  includeModelDetails?: boolean;
}

/** Sentinel class used to check idempotency — do not rename without updating injectDisclosureIntoHtml */
const DISCLOSURE_SENTINEL = "ai-disclosure-notice";

/**
 * Generates the EU AI Act Article 50 compliant disclosure footer HTML.
 * This is appended to finalHtmlContent before the article is marked COMPLETE.
 */
export function generateDisclosureFooter(opts: DisclosureOptions = {}): string {
  const {
    generatorModel,
    reviewModel,
    generatedAt = new Date(),
    includeModelDetails = false,
  } = opts;

  const dateStr = generatedAt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const modelDetail =
    includeModelDetails && generatorModel
      ? ` using ${[generatorModel, reviewModel].filter(Boolean).join(" and ")}`
      : "";

  return `
<aside class="${DISCLOSURE_SENTINEL}" role="note" aria-label="AI content disclosure" style="margin-top:2rem;padding:1rem 1.25rem;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font-size:0.85rem;color:#64748b;line-height:1.5;">
  <strong style="color:#475569;">AI-Generated Content Disclosure</strong><br>
  This article was created with the assistance of artificial intelligence tools${modelDetail} on ${dateStr}.
  While AI assisted in drafting this content, it has been reviewed for accuracy.
  In accordance with <a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689" target="_blank" rel="noopener noreferrer" style="color:#3b82f6;">EU AI Act Article 50</a>,
  we disclose that AI technology was used in the creation of this content.
</aside>`;
}

/**
 * Injects the EU AI Act disclosure footer into the final article HTML.
 * - Null/undefined-safe: returns empty string if html is falsy.
 * - Idempotent: skips injection if the sentinel is already present
 *   (prevents duplicate footers on regeneration/reprocessing).
 */
export function injectDisclosureIntoHtml(
  html: string | null | undefined,
  opts: DisclosureOptions = {}
): string {
  if (!html) return "";

  // Idempotency guard — already has a disclosure footer
  if (html.includes(DISCLOSURE_SENTINEL)) {
    return html;
  }

  const disclosureHtml = generateDisclosureFooter(opts);

  if (html.includes("</article>")) {
    return html.replace("</article>", `${disclosureHtml}\n</article>`);
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", `${disclosureHtml}\n</body>`);
  }
  return html + disclosureHtml;
}

/**
 * Returns the plain-text disclosure statement for use in social posts, podcasts,
 * and other non-HTML content formats.
 */
export function getDisclosureText(): string {
  return "This content was created with the assistance of AI tools. EU AI Act Article 50.";
}
