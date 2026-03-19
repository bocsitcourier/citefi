import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seoLogs, articles, jobBatches } from "@/shared/schema";
import { eq, sql, desc } from "drizzle-orm";

export async function GET() {
  try {
    const costOverview = await db
      .select({
        totalTokenCost: sql<number>`sum(${seoLogs.tokenCost})`,
        avgGeoScore: sql<number>`avg(${seoLogs.geoAccuracyScore})`,
        totalArticles: sql<number>`count(distinct ${seoLogs.articleId})`,
        avgTokensPerArticle: sql<number>`avg(${seoLogs.tokenCost})`,
      })
      .from(seoLogs);

    const topPerformingArticles = await db
      .select({
        articleId: articles.id,
        title: articles.chosenTitle,
        geoScore: seoLogs.geoAccuracyScore,
        tokenCost: seoLogs.tokenCost,
        wordCount: articles.wordCount,
      })
      .from(seoLogs)
      .innerJoin(articles, eq(articles.id, seoLogs.articleId))
      .where(sql`${seoLogs.geoAccuracyScore} is not null`)
      .orderBy(desc(seoLogs.geoAccuracyScore))
      .limit(10);

    const bottomPerformingArticles = await db
      .select({
        articleId: articles.id,
        title: articles.chosenTitle,
        geoScore: seoLogs.geoAccuracyScore,
        tokenCost: seoLogs.tokenCost,
        wordCount: articles.wordCount,
      })
      .from(seoLogs)
      .innerJoin(articles, eq(articles.id, seoLogs.articleId))
      .where(sql`${seoLogs.geoAccuracyScore} is not null`)
      .orderBy(seoLogs.geoAccuracyScore)
      .limit(10);

    return NextResponse.json({
      costOverview: costOverview[0] || { totalTokenCost: 0, avgGeoScore: 0, totalArticles: 0, avgTokensPerArticle: 0 },
      topPerformingArticles,
      bottomPerformingArticles,
    });
  } catch (error) {
    console.error("SEO report error:", error);
    return NextResponse.json(
      { error: "Failed to fetch SEO report" },
      { status: 500 }
    );
  }
}
