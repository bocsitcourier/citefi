/**
 * Citation Probe Worker
 *
 * Measures AI citation attribution for published articles.
 * Runs as a pg-boss queue worker ("citation-probe").
 *
 * Strategy (MVP):
 *   For each article + target query pair, submit the query to Gemini and
 *   measure content overlap between the AI response and the article.
 *   High overlap → the AI is drawing from the article's content/style.
 *   This is a practical approximation; true citation tracking requires API
 *   access to end-user AI tools (ChatGPT, Perplexity) which requires agreement.
 *
 * Future upgrade: use Brave Search to check if the article appears in
 * search results for the target query, then infer citation likelihood.
 *
 * Output: updates article.citationRate (0-100) and logs a citationProbes row.
 */

import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { articles, citationProbes } from "@/shared/schema";
import { eq, avg, and, isNotNull } from "drizzle-orm";
import { GEMINI_FLASH_MODEL } from "./ai-config";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface CitationProbeJob {
  articleId: number;
  teamId: number;
  targetQuery: string;
}

/**
 * Compute a content-overlap score (0-100) between the AI response and the article.
 * Uses bigram Jaccard similarity — same algorithm as information-gain gate.
 */
function overlapScore(articleText: string, aiResponse: string): number {
  const toBigrams = (text: string): Set<string> => {
    const words = text
      .toLowerCase()
      .replace(/<[^>]+>/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const bigrams = new Set<string>();
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.add(`${words[i]} ${words[i + 1]}`);
    }
    return bigrams;
  };

  const articleBigrams = toBigrams(articleText);
  const responseBigrams = toBigrams(aiResponse);

  if (articleBigrams.size === 0 || responseBigrams.size === 0) return 0;

  let intersection = 0;
  for (const bg of responseBigrams) {
    if (articleBigrams.has(bg)) intersection++;
  }
  const union = articleBigrams.size + responseBigrams.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Scale to 0-100; Jaccard of 0.05 is already high for distinct documents
  return Math.min(100, Math.round(jaccard * 1000));
}

/**
 * Process a single citation probe job.
 * Called by the pg-boss worker for queue "citation-probe".
 */
export async function processCitationProbe(job: CitationProbeJob): Promise<void> {
  const { articleId, teamId, targetQuery } = job;

  const [article] = await db
    .select({ finalHtmlContent: articles.finalHtmlContent, chosenTitle: articles.chosenTitle })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!article?.finalHtmlContent) {
    console.warn(`[CitationProbe] Article ${articleId} has no content — skipping`);
    return;
  }

  const [probe] = await db
    .insert(citationProbes)
    .values({
      articleId,
      teamId,
      targetQuery,
      aiProvider: "gemini",
      probeStatus: "RUNNING",
    })
    .returning({ id: citationProbes.id });

  try {
    const response = await genAI.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: targetQuery,
    });
    const aiResponse = response.text ?? "";

    const confidence = overlapScore(article.finalHtmlContent, aiResponse);
    const citationDetected = confidence >= 15;

    await db
      .update(citationProbes)
      .set({
        citationDetected,
        confidenceScore: confidence,
        responseSnippet: aiResponse.slice(0, 500),
        probeStatus: "COMPLETE",
        completedAt: new Date(),
      })
      .where(eq(citationProbes.id, probe.id));

    const [aggResult] = await db
      .select({ avgConfidence: avg(citationProbes.confidenceScore) })
      .from(citationProbes)
      .where(
        and(
          eq(citationProbes.articleId, articleId),
          isNotNull(citationProbes.confidenceScore)
        )
      );

    const newCitationRate = Math.round(Number(aggResult?.avgConfidence ?? confidence));

    await db
      .update(articles)
      .set({ citationRate: newCitationRate, lastCitationCheckedAt: new Date() })
      .where(eq(articles.id, articleId));

    console.log(
      `[CitationProbe] Article ${articleId} "${targetQuery.slice(0, 50)}" → overlap: ${confidence}, cited: ${citationDetected}, rate: ${newCitationRate}`
    );
  } catch (err) {
    await db
      .update(citationProbes)
      .set({ probeStatus: "FAILED", completedAt: new Date() })
      .where(eq(citationProbes.id, probe.id));
    throw err;
  }
}

/**
 * Enqueue citation probes for an article based on its title and keywords.
 * Call this fire-and-forget after an article reaches COMPLETE status.
 * Gets the pg-boss instance internally.
 */
export async function enqueueCitationProbes(
  articleId: number,
  teamId: number,
  chosenTitle: string,
  keywords: string[] = []
): Promise<void> {
  const { getQueue } = await import("./queue");
  const q = getQueue("citation-probe");

  const queries: string[] = [
    chosenTitle,
    ...keywords.slice(0, 3).map((kw) => `What is ${kw}?`),
    `Tell me about ${chosenTitle.split(" ").slice(0, 6).join(" ")}`,
  ];

  const bulkJobs = queries.map((query) => ({
    name: "citation-probe",
    data: { articleId, teamId, targetQuery: query } satisfies CitationProbeJob,
    opts: { attempts: 2, backoff: { type: "exponential" as const, delay: 30000 } },
  }));

  await q.addBulk(bulkJobs);
  console.log(`[CitationProbe] Enqueued ${bulkJobs.length} probes for article ${articleId}`);
}
