import { db } from "./db";
import { articles } from "@/shared/schema";
import { and, isNotNull, not, like, or, sql, desc } from "drizzle-orm";

/**
 * Image Memory — "Search First, Generate Last"
 *
 * Before calling Gemini to generate a new hero image, check whether a
 * completed article with similar keywords or title already has a usable
 * hero image we can reuse at zero cost.
 *
 * Match strategy (in order of preference):
 *   1. Same team + primary keyword match in keywordsJson
 *   2. Same team + title prefix match (first 20 chars)
 *   3. Cross-team keyword match (fallback if same-team yields nothing)
 */
export async function findReusableHeroImage(
  keywords: string[],
  title: string,
  teamId?: number | null
): Promise<string | null> {
  if (keywords.length === 0 && !title) return null;

  const primaryKeyword = keywords[0]?.trim() ?? "";
  const titlePrefix = title.substring(0, 20).trim();

  // Need at least one usable search term
  if (primaryKeyword.length < 3 && titlePrefix.length < 8) return null;

  try {
    const semanticConditions = [];

    if (primaryKeyword.length >= 3) {
      // Cast JSONB array to text for fast ILIKE search — O(n) table scan
      // but articles table is small relative to image API cost
      semanticConditions.push(
        sql`${articles.keywordsJson}::text ilike ${"%" + primaryKeyword + "%"}`
      );
    }
    if (titlePrefix.length >= 8) {
      semanticConditions.push(
        sql`${articles.seoTitle} ilike ${"%" + titlePrefix + "%"}`
      );
    }

    if (semanticConditions.length === 0) return null;

    const baseConditions = [
      isNotNull(articles.heroImageUrl),
      not(like(articles.heroImageUrl, "data:%")),
      sql`${articles.articleStatus} = ANY(ARRAY['COMPLETE','GPT4_ENHANCED','CHATGPT_REVIEWED']::text[])`,
      or(...semanticConditions)!,
    ];

    // Prefer same team first (brand consistency)
    if (teamId) {
      const [match] = await db
        .select({ heroImageUrl: articles.heroImageUrl })
        .from(articles)
        .where(and(...baseConditions, sql`${articles.teamId} = ${teamId}`))
        .orderBy(desc(articles.updatedAt))
        .limit(1);

      if (match?.heroImageUrl) {
        console.log(
          `♻️ Image memory hit (same-team): reusing hero image (keyword: "${primaryKeyword}")`
        );
        return match.heroImageUrl;
      }
    }

    // Cross-team fallback
    const [match] = await db
      .select({ heroImageUrl: articles.heroImageUrl })
      .from(articles)
      .where(and(...baseConditions))
      .orderBy(desc(articles.updatedAt))
      .limit(1);

    if (match?.heroImageUrl) {
      console.log(
        `♻️ Image memory hit (cross-team): reusing hero image (keyword: "${primaryKeyword}")`
      );
      return match.heroImageUrl;
    }

    return null;
  } catch (err) {
    console.warn(
      "⚠️ Image memory lookup failed (non-fatal):",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
