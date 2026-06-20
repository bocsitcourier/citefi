import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import {
  aiLearningLedger,
  articles,
} from "@/shared/schema";
import { eq, gte, and, sql, desc, isNull, or } from "drizzle-orm";

// Rough cost estimates per unit (USD)
const COST_PER_ARTICLE_GENERATION = 0.012;  // Gemini 2.5 Flash ~8K tokens
const COST_PER_ARTICLE_ENHANCEMENT = 0.001; // GPT-4o mini ~2K tokens
const COST_PER_HERO_IMAGE = 0.04;           // Gemini image generation
const COST_PER_ARTICLE = COST_PER_ARTICLE_GENERATION + COST_PER_ARTICLE_ENHANCEMENT;

const ERROR_LABEL: Record<string, string> = {
  MISSING_FAQ: "Missing FAQ section",
  MISSING_IMAGES: "Missing image tags",
  MISSING_HYPERLINKS: "Insufficient hyperlinks",
  LOW_WORD_COUNT: "Articles too short",
  TONE_MISMATCH: "Tone mismatch with persona",
  MISSING_FORMATTING: "Raw markdown in HTML",
  BARE_GEO_ANCHOR: "Bare city/state anchor text",
  SHORT_ANCHOR: "Anchor text under 4 words",
  MISSING_FAQ_LINKS: "FAQ answers lack hyperlinks",
  REFORMAT_STRIPPED_ANCHORS: "Reformatter stripped invalid anchors",
  GENERATION_ERROR: "Article generation crashed",
  GENERATION_TIMEOUT: "Generation timed out",
  API_RATE_LIMIT: "API rate limit hit",
  JSON_PARSE_ERROR: "JSON parse / format error",
  TOKEN_LIMIT_EXCEEDED: "Token limit exceeded",
  BRAND_VALIDATION_FAILED: "Brand safety validation failed",
  MISSING_FIELDS: "Missing required output fields",
  ARTICLE_FAILED: "Article marked failed",
};

export async function GET(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // 1. Guardian failure ledger — all errors for this team
    const failures = await db
      .select()
      .from(aiLearningLedger)
      .where(
        or(
          eq(aiLearningLedger.teamId, teamId),
          isNull(aiLearningLedger.teamId)
        )
      )
      .orderBy(desc(aiLearningLedger.count));

    // 2. Article stats — last 7 days
    const articleStats7d = await db
      .select({
        articleStatus: articles.articleStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(articles)
      .where(
        and(
          eq(articles.teamId, teamId),
          gte(articles.createdAt, sevenDaysAgo),
          isNull(articles.deletedAt),
        )
      )
      .groupBy(articles.articleStatus);

    // 3. Article stats — last 30 days (for billing)
    const articleStats30d = await db
      .select({
        articleStatus: articles.articleStatus,
        count: sql<number>`count(*)::int`,
        imagesGenerated: sql<number>`count(*) filter (where hero_image_url is not null and hero_image_url like 'http%')::int`,
      })
      .from(articles)
      .where(
        and(
          eq(articles.teamId, teamId),
          gte(articles.createdAt, thirtyDaysAgo),
          isNull(articles.deletedAt),
        )
      )
      .groupBy(articles.articleStatus);

    // Compute 7-day aggregates
    let complete7d = 0;
    let failed7d = 0;
    let total7d = 0;
    for (const row of articleStats7d) {
      total7d += row.count;
      if (row.articleStatus === "COMPLETE" || row.articleStatus === "GPT4_ENHANCED") {
        complete7d += row.count;
      } else if (row.articleStatus === "FAILED" || row.articleStatus === "REFORMAT_FAILED") {
        failed7d += row.count;
      }
    }

    // Compute 30-day billing aggregates
    let total30d = 0;
    let complete30d = 0;
    let imagesGenerated30d = 0;
    for (const row of articleStats30d) {
      total30d += row.count;
      imagesGenerated30d += row.imagesGenerated;
      if (row.articleStatus === "COMPLETE" || row.articleStatus === "GPT4_ENHANCED") {
        complete30d += row.count;
      }
    }

    const estimatedCost30d =
      complete30d * COST_PER_ARTICLE +
      imagesGenerated30d * COST_PER_HERO_IMAGE;

    // Format failures with labels
    const formattedFailures = failures.map((f) => ({
      errorType: f.errorType,
      label: ERROR_LABEL[f.errorType] || f.errorType,
      count: f.count,
      lastOccurrence: f.lastOccurrence.toISOString(),
      isActivelySupressed: f.count >= 2,
    }));

    return NextResponse.json({
      success: true,
      guardianFailures: formattedFailures,
      articleStats: {
        total7d,
        complete7d,
        failed7d,
        failureRate7d: total7d > 0 ? Math.round((failed7d / total7d) * 100) : 0,
        total30d,
        complete30d,
      },
      billing: {
        estimatedCost30dUsd: Math.round(estimatedCost30d * 100) / 100,
        articlesGenerated30d: complete30d,
        imagesGenerated30d,
        costPerArticle: COST_PER_ARTICLE,
        costPerImage: COST_PER_HERO_IMAGE,
      },
    });
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status !== 500) {
      return NextResponse.json({ success: false, error: error.message }, { status });
    }
    console.error("Failed to get learning intelligence:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get intelligence data" },
      { status: error?.statusCode || 500 }
    );
  }
}
