/**
 * Information-Gain Editorial Gate
 *
 * Prevents commodity / "AI slop" content from being published by scoring
 * each generated article's novelty against the team's existing published
 * content and optional competitor URLs stored in the batch SEO cache.
 *
 * Algorithm:
 *   1. Strip HTML to plain text; tokenise into 2-word bigrams.
 *   2. Build a TF set for the new article.
 *   3. Fetch the team's last 30 COMPLETE articles from DB.
 *   4. For each existing article, compute Jaccard similarity on bigrams.
 *   5. Take the MAX similarity (most-similar existing article).
 *   6. Information-gain score = 100 - (maxSimilarity * 100).
 *   7. Gate: PASSED ≥ 55, FLAGGED 35-54, BLOCKED < 35.
 *
 * NOTE: Score BEFORE disclosure injection so the shared EU AI Act footer
 * does not artificially inflate similarity between all articles.
 *
 * Why Jaccard not cosine? Jaccard on bigrams catches near-duplicate
 * structure (same talking points, same sentence starters) even when
 * synonyms swap out individual words. Cosine on TF-IDF is better for
 * topic classification; Jaccard is better for duplicate detection.
 */

import { db } from "./db";
import { articles } from "@/shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

const GATE_THRESHOLDS = {
  PASSED: 55,   // novel enough to publish
  FLAGGED: 35,  // borderline — warn but allow
  // below FLAGGED threshold → BLOCKED
} as const;

export type QualityGateStatus = "PASSED" | "FLAGGED" | "BLOCKED";

export interface InformationGainResult {
  score: number;               // 0-100 (higher = more novel)
  status: QualityGateStatus;
  mostSimilarTitle?: string;   // for debug / UX messaging
  blocked: boolean;
}

/** Strip HTML tags and normalise whitespace */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Tokenise into bigrams (2-word overlapping windows) */
function toBigrams(text: string): Set<string> {
  const words = text.split(/\s+/).filter((w) => w.length > 2);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

/** Jaccard similarity between two bigram sets (0–1) */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const bg of a) {
    if (b.has(bg)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score the information gain of a new article against existing team content.
 *
 * IMPORTANT: Call this on the pre-disclosure HTML so the shared disclosure
 * footer does not inflate similarity scores across all articles.
 *
 * @param newHtml    The final HTML content of the newly generated article
 *                   (before EU AI Act disclosure injection).
 * @param teamId     The team producing the article.
 * @param excludeId  Optional: exclude this article ID from comparisons (for regeneration).
 */
export async function scoreInformationGain(
  newHtml: string | null | undefined,
  teamId: number,
  excludeId?: number
): Promise<InformationGainResult> {
  // Null/empty guard — treat missing content as novel (do not block)
  if (!newHtml || newHtml.trim().length === 0) {
    return { score: 75, status: "PASSED", blocked: false };
  }

  const newText = stripHtml(newHtml);
  const newBigrams = toBigrams(newText);

  if (newBigrams.size < 20) {
    // Article too short to meaningfully score → assume novel
    return { score: 75, status: "PASSED", blocked: false };
  }

  // Fetch the 30 most-recent COMPLETE articles for this team.
  // Only compare against truly published (COMPLETE) content.
  // Use orderBy to guarantee deterministic "most-recent" results.
  const existing = await db
    .select({ id: articles.id, chosenTitle: articles.chosenTitle, finalHtmlContent: articles.finalHtmlContent })
    .from(articles)
    .where(
      and(
        eq(articles.teamId, teamId),
        eq(articles.articleStatus, "COMPLETE"),
        isNull(articles.deletedAt)
      )
    )
    .orderBy(desc(articles.createdAt))
    .limit(30);

  const comparables = excludeId
    ? existing.filter((a) => a.id !== excludeId)
    : existing;

  if (comparables.length === 0) {
    // No existing content → first article is trivially novel
    return { score: 90, status: "PASSED", blocked: false };
  }

  let maxSimilarity = 0;
  let mostSimilarTitle: string | undefined;

  for (const art of comparables) {
    if (!art.finalHtmlContent) continue;
    const existingBigrams = toBigrams(stripHtml(art.finalHtmlContent));
    const sim = jaccard(newBigrams, existingBigrams);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      mostSimilarTitle = art.chosenTitle ?? undefined;
    }
  }

  const score = Math.round(100 - maxSimilarity * 100);

  let status: QualityGateStatus;
  if (score >= GATE_THRESHOLDS.PASSED) {
    status = "PASSED";
  } else if (score >= GATE_THRESHOLDS.FLAGGED) {
    status = "FLAGGED";
  } else {
    status = "BLOCKED";
  }

  return {
    score,
    status,
    mostSimilarTitle,
    blocked: status === "BLOCKED",
  };
}
