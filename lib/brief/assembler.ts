import { db } from "@/lib/db";
import { 
  articles, 
  contentPerformanceMetrics, 
  learningPatterns, 
  audiencePersonas, 
  batchSeoCache, 
  clientBrandProfiles 
} from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

export interface BriefContext {
  teamId: number;
  userId: number;
  localDate: string;
  brandProfile: any | null;
  recentArticles: any[];
  topPerformers: any[];
  learningPatterns: any[];
  competitorInsights: any | null;
  persona: any | null;
  articlesPublishedThisMonth: number;
  articlesOnPage1: number;
}

export async function assembleBriefContext(userId: number, teamId: number, localDate: string): Promise<BriefContext> {
  // 1. brandProfile (from client_brand_profiles)
  const brandProfilePromise = db.query.clientBrandProfiles.findFirst({
    where: eq(clientBrandProfiles.teamId, teamId)
  });

  // 2. recentArticles (last 10)
  const recentArticlesPromise = db.query.articles.findMany({
    where: eq(articles.teamId, teamId),
    orderBy: [desc(articles.createdAt)],
    limit: 10
  });

  // 3. topPerformers (top 3 by impressions/views from content_performance_metrics LEFT JOIN articles)
  const topPerformersPromise = db.select({
    article: articles,
    metrics: contentPerformanceMetrics
  })
  .from(contentPerformanceMetrics)
  .leftJoin(articles, eq(contentPerformanceMetrics.articleId, articles.id))
  .where(eq(contentPerformanceMetrics.teamId, teamId))
  .orderBy(desc(contentPerformanceMetrics.views))
  .limit(3);

  // 4. learningPatterns (top 5 active from learning_patterns)
  const learningPatternsPromise = db.query.learningPatterns.findMany({
    where: and(
      eq(learningPatterns.teamId, teamId),
      eq(learningPatterns.isArchived, false)
    ),
    orderBy: [desc(learningPatterns.successRate)],
    limit: 5
  });

  // 5. competitorInsights (from batch_seo_cache latest row for teamId, parse competitor_insights_json)
  // Need to find latest batch for team first
  const latestSeoCachePromise = db.select()
    .from(batchSeoCache)
    .innerJoin(articles, eq(batchSeoCache.batchId, articles.batchId))
    .where(eq(articles.teamId, teamId))
    .orderBy(desc(batchSeoCache.generatedAt))
    .limit(1);

  // 6. persona (first active audience_personas for team)
  const personaPromise = db.query.audiencePersonas.findFirst({
    where: and(
      eq(audiencePersonas.teamId, teamId),
      eq(audiencePersonas.isActive, 1)
    )
  });

  // 7. articlesPublishedThisMonth: number
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const articlesThisMonthPromise = db.select({ count: sql<number>`count(*)` })
    .from(articles)
    .where(and(
      eq(articles.teamId, teamId),
      gte(articles.createdAt, startOfMonth)
    ));

  // 8. articlesOnPage1: number (estimate from performance: impressions > 500)
  const page1EstimatePromise = db.select({ count: sql<number>`count(*)` })
    .from(contentPerformanceMetrics)
    .where(and(
      eq(contentPerformanceMetrics.teamId, teamId),
      gte(contentPerformanceMetrics.views, 500) // Using views > 500 as estimate for Page 1
    ));

  const [
    brandProfile,
    recentArticles,
    topPerformers,
    learningPatternsResult,
    seoCacheResult,
    persona,
    articlesThisMonth,
    page1Estimate
  ] = await Promise.all([
    brandProfilePromise,
    recentArticlesPromise,
    topPerformersPromise,
    learningPatternsPromise,
    latestSeoCachePromise,
    personaPromise,
    articlesThisMonthPromise,
    page1EstimatePromise
  ]);

  const competitorInsights = seoCacheResult[0]?.batch_seo_cache?.competitorInsightsJson || null;

  return {
    teamId,
    userId,
    localDate,
    brandProfile: brandProfile || null,
    recentArticles: recentArticles || [],
    topPerformers: topPerformers.map(tp => tp.article).filter(Boolean),
    learningPatterns: learningPatternsResult || [],
    competitorInsights,
    persona: persona || null,
    articlesPublishedThisMonth: Number(articlesThisMonth[0]?.count || 0),
    articlesOnPage1: Number(page1Estimate[0]?.count || 0)
  };
}

export interface ScoredAction {
  type: 'content' | 'review_reply' | 'competitor_response' | 'optimize_existing';
  action: string;
  why: string;
  ctaPath: string;
  score: number;
}

export function scoreActions(ctx: BriefContext, prevFocusType?: string): ScoredAction[] {
  const actions: ScoredAction[] = [];

  // Content Creation Action
  actions.push({
    type: 'content',
    action: `Generate new ${ctx.brandProfile?.companyName || 'brand'} content`,
    why: ctx.articlesPublishedThisMonth < 4 
      ? "You're below your monthly target for fresh content." 
      : "Keep the momentum going with a new perspective on your core topics.",
    ctaPath: '/dashboard',
    score: prevFocusType === 'content' ? 50 : 80
  });

  // Review reply action (Stubbed as we don't have review metrics in ctx yet, but requested in Details)
  actions.push({
    type: 'review_reply',
    action: 'Reply to recent customer reviews',
    why: 'Engaging with your audience improves brand trust and conversion rates.',
    ctaPath: '/client/review',
    score: prevFocusType === 'review_reply' ? 100 : 40
  });

  // Competitor Response Action
  if (ctx.competitorInsights) {
    actions.push({
      type: 'competitor_response',
      action: "Respond to competitor content trends",
      why: "Recent competitor activity shows an opportunity in your niche.",
      ctaPath: '/intelligence',
      score: prevFocusType === 'competitor_response' ? 40 : 90
    });
  }

  // Optimize Existing Action
  if (ctx.recentArticles.length > 0) {
    actions.push({
      type: 'optimize_existing',
      action: "Optimize recent underperforming content",
      why: "Some of your recent articles aren't reaching their full potential yet.",
      ctaPath: '/content',
      score: prevFocusType === 'optimize_existing' ? 30 : 70
    });
  }

  // Momentum Pick (Low impressions but good learning patterns)
  if (ctx.learningPatterns.length > 0 && ctx.recentArticles.length > 0) {
    actions.push({
      type: 'optimize_existing',
      action: "Apply high-performing patterns to existing content",
      why: `We've identified ${ctx.learningPatterns.length} new patterns that can boost your reach.`,
      ctaPath: `/content/${ctx.recentArticles[0].id}`,
      score: 85
    });
  }

  // Cycle through types (content → review_reply → competitor_response → optimize_existing → content)
  // This logic is partially handled by the score penalties for prevFocusType
  
  return actions.sort((a, b) => b.score - a.score);
}
