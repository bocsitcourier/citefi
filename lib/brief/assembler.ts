import { db } from "@/lib/db";
import { 
  articles, 
  contentPerformanceMetrics, 
  learningPatterns, 
  audiencePersonas, 
  batchSeoCache, 
  clientBrandProfiles 
} from "@shared/schema";
import { eq, and, desc, gte, sql, lt } from "drizzle-orm";

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
  daysSinceLastArticle: number | null;
  decayingContent: any[];       // articles > 14 days with low views
  momentumContent: any[];       // articles with moderate-high views (climbing signal)
  contentVelocityLow: boolean;  // fewer than 4 articles this month
}

export async function assembleBriefContext(
  userId: number,
  teamId: number,
  localDate: string
): Promise<BriefContext> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    brandProfile,
    recentArticles,
    topPerformers,
    learningPatternsResult,
    seoCacheResult,
    persona,
    articlesThisMonth,
    page1Estimate,
    oldArticlesLowViews,
    recentHighViews,
  ] = await Promise.all([
    // 1. Brand profile
    db.query.clientBrandProfiles.findFirst({
      where: eq(clientBrandProfiles.teamId, teamId)
    }),

    // 2. Last 10 articles for context
    db.query.articles.findMany({
      where: eq(articles.teamId, teamId),
      orderBy: [desc(articles.createdAt)],
      limit: 10
    }),

    // 3. Top performers by views
    db.select({ article: articles, metrics: contentPerformanceMetrics })
      .from(contentPerformanceMetrics)
      .leftJoin(articles, eq(contentPerformanceMetrics.articleId, articles.id))
      .where(eq(contentPerformanceMetrics.teamId, teamId))
      .orderBy(desc(contentPerformanceMetrics.views))
      .limit(5),

    // 4. Active learning patterns
    db.query.learningPatterns.findMany({
      where: and(
        eq(learningPatterns.teamId, teamId),
        eq(learningPatterns.isArchived, false)
      ),
      orderBy: [desc(learningPatterns.successRate)],
      limit: 5
    }),

    // 5. Competitor insights from latest SEO cache
    db.select()
      .from(batchSeoCache)
      .innerJoin(articles, eq(batchSeoCache.batchId, articles.batchId))
      .where(eq(articles.teamId, teamId))
      .orderBy(desc(batchSeoCache.generatedAt))
      .limit(1),

    // 6. Active persona
    db.query.audiencePersonas.findFirst({
      where: and(
        eq(audiencePersonas.teamId, teamId),
        eq(audiencePersonas.isActive, 1)
      )
    }),

    // 7. Articles published this month
    db.select({ count: sql<number>`count(*)` })
      .from(articles)
      .where(and(
        eq(articles.teamId, teamId),
        gte(articles.createdAt, startOfMonth)
      )),

    // 8. Page 1 estimate (views > 500 as proxy)
    db.select({ count: sql<number>`count(*)` })
      .from(contentPerformanceMetrics)
      .where(and(
        eq(contentPerformanceMetrics.teamId, teamId),
        gte(contentPerformanceMetrics.views, 500)
      )),

    // 9. Decaying content: articles > 14 days old with low views (< 100)
    db.select({ article: articles, metrics: contentPerformanceMetrics })
      .from(articles)
      .leftJoin(contentPerformanceMetrics, eq(contentPerformanceMetrics.articleId, articles.id))
      .where(and(
        eq(articles.teamId, teamId),
        lt(articles.createdAt, fourteenDaysAgo)
      ))
      .orderBy(desc(articles.createdAt))
      .limit(3),

    // 10. Momentum content: published in last 7 days with views 200-2000 (climbing)
    db.select({ article: articles, metrics: contentPerformanceMetrics })
      .from(contentPerformanceMetrics)
      .innerJoin(articles, eq(contentPerformanceMetrics.articleId, articles.id))
      .where(and(
        eq(contentPerformanceMetrics.teamId, teamId),
        gte(contentPerformanceMetrics.views, 200),
        lt(contentPerformanceMetrics.views, 2000),
        gte(articles.createdAt, sevenDaysAgo)
      ))
      .orderBy(desc(contentPerformanceMetrics.views))
      .limit(3),
  ]);

  const competitorInsights = seoCacheResult[0]?.batch_seo_cache?.competitorInsightsJson || null;
  const totalArticlesThisMonth = Number(articlesThisMonth[0]?.count || 0);

  // Compute days since last article
  let daysSinceLastArticle: number | null = null;
  if (recentArticles.length > 0 && recentArticles[0].createdAt) {
    const lastDate = new Date(recentArticles[0].createdAt);
    daysSinceLastArticle = Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
  }

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
    articlesPublishedThisMonth: totalArticlesThisMonth,
    articlesOnPage1: Number(page1Estimate[0]?.count || 0),
    daysSinceLastArticle,
    decayingContent: oldArticlesLowViews.map(r => r.article).filter(Boolean),
    momentumContent: recentHighViews.map(r => r.article).filter(Boolean),
    contentVelocityLow: totalArticlesThisMonth < 4,
  };
}

export interface ScoredAction {
  type: 'content' | 'review_reply' | 'competitor_response' | 'optimize_existing' | 'momentum_push';
  action: string;
  why: string;
  ctaPath: string;
  score: number;
  signal: string;
}

export interface ScoringResult {
  scored: ScoredAction[];
  top: ScoredAction;
}

/**
 * Scores candidate actions based on real signals from the brief context.
 * Implements the spec's prioritization engine:
 * - Momentum: near-term wins already in motion
 * - Decay: things that lose value if ignored today
 * - Opportunity window: time-sensitive openings
 * - Effort vs payoff: one-click actions score higher than multi-step projects
 * - Variety: penalizes the same type as yesterday
 */
export function scoreActions(ctx: BriefContext, prevFocusType?: string): ScoringResult {
  const actions: ScoredAction[] = [];

  // ── MOMENTUM SIGNAL ──────────────────────────────────────────────────────
  // Pages climbing toward page 1 (views 200-2000, published < 7 days) — high priority
  if (ctx.momentumContent.length > 0) {
    const piece = ctx.momentumContent[0];
    const title = piece?.chosenTitle || piece?.title || 'recent article';
    actions.push({
      type: 'optimize_existing',
      action: `Boost "${title.slice(0, 60)}" — it's gaining traction`,
      why: `Published recently and already seeing views. A quick optimization or internal link push can accelerate it to page 1 before momentum fades.`,
      ctaPath: piece?.id ? `/content/${piece.id}` : '/content',
      score: prevFocusType === 'optimize_existing' ? 55 : 88,
      signal: 'momentum_recent_views'
    });
  }

  // ── DECAY SIGNAL ─────────────────────────────────────────────────────────
  // Old articles with no performance data = being ignored by Google
  if (ctx.decayingContent.length > 0) {
    const piece = ctx.decayingContent[0];
    const title = piece?.chosenTitle || piece?.title || 'older article';
    const age = ctx.daysSinceLastArticle;
    actions.push({
      type: 'optimize_existing',
      action: `Refresh "${title.slice(0, 60)}" — it's going stale`,
      why: `Content older than 14 days with no engagement loses crawl priority. A fast refresh (updated stats, new H2, or internal link) costs 15 minutes and signals freshness.`,
      ctaPath: piece?.id ? `/content/${piece.id}` : '/content',
      score: prevFocusType === 'optimize_existing' ? 40 : (age && age > 21 ? 85 : 72),
      signal: 'content_decay'
    });
  }

  // ── CONTENT VELOCITY DECAY ────────────────────────────────────────────────
  // Fewer than 4 articles this month = falling behind on content cadence
  if (ctx.contentVelocityLow) {
    const companyName = ctx.brandProfile?.companyName || 'your brand';
    actions.push({
      type: 'content',
      action: `Publish a new article for ${companyName}`,
      why: `Only ${ctx.articlesPublishedThisMonth} article${ctx.articlesPublishedThisMonth !== 1 ? 's' : ''} published this month. Google's crawl budget rewards consistent publishing — falling behind compounds quickly.`,
      ctaPath: '/dashboard',
      score: prevFocusType === 'content' ? 50 : 80,
      signal: 'velocity_low'
    });
  }

  // ── CONTENT AS MAINTENANCE ────────────────────────────────────────────────
  // Healthy velocity: still encourage new content, lower priority
  if (!ctx.contentVelocityLow) {
    actions.push({
      type: 'content',
      action: `Generate a new piece for ${ctx.brandProfile?.companyName || 'your brand'}`,
      why: `${ctx.articlesPublishedThisMonth} articles this month — strong cadence. Add one more to keep the compound SEO effect growing.`,
      ctaPath: '/dashboard',
      score: prevFocusType === 'content' ? 35 : 60,
      signal: 'healthy_velocity'
    });
  }

  // ── COMPETITOR OPPORTUNITY ────────────────────────────────────────────────
  if (ctx.competitorInsights) {
    actions.push({
      type: 'competitor_response',
      action: 'Capture a competitor gap in your market',
      why: `Competitor intelligence found an opening in your niche. A targeted piece today claims territory before they do.`,
      ctaPath: '/seo-tools',
      score: prevFocusType === 'competitor_response' ? 40 : 85,
      signal: 'competitor_gap'
    });
  }

  // ── LEARNING PATTERN APPLICATION ─────────────────────────────────────────
  if (ctx.learningPatterns.length > 0 && ctx.recentArticles.length > 0) {
    const pattern = ctx.learningPatterns[0];
    actions.push({
      type: 'optimize_existing',
      action: `Apply "${pattern.patternName}" to existing content`,
      why: `This pattern has a ${Math.round((pattern.successRate || 0) * 100)}% success rate. Applying it to underperforming articles costs one click and compounds over time.`,
      ctaPath: '/content',
      score: prevFocusType === 'optimize_existing' ? 30 : 70,
      signal: 'learning_pattern'
    });
  }

  // ── REVIEW REPLY (social proof maintenance) ───────────────────────────────
  // Scored conservatively since we don't have real review data yet
  actions.push({
    type: 'review_reply',
    action: 'Respond to recent customer reviews',
    why: 'Review replies are a local ranking signal Google weighs. Engagement within 24-48 hours of a new review shows activity that feeds E-E-A-T signals.',
    ctaPath: '/seo-tools',
    score: prevFocusType === 'review_reply' ? 65 : 50,
    signal: 'reputation_maintenance'
  });

  // ── VARIETY ROTATION ──────────────────────────────────────────────────────
  // The spec says: rotate type to match rhythm of real marketing.
  // Boost any type that hasn't been chosen recently.
  const typeOrder: Array<ScoredAction['type']> = ['content', 'review_reply', 'competitor_response', 'optimize_existing'];
  const prevIndex = typeOrder.indexOf(prevFocusType as any);
  if (prevIndex !== -1) {
    const nextType = typeOrder[(prevIndex + 1) % typeOrder.length];
    for (const a of actions) {
      if (a.type === nextType) {
        a.score = Math.min(a.score + 12, 100);
        break;
      }
    }
  }

  // Sort descending by score
  const sorted = actions.sort((a, b) => b.score - a.score);

  // Dedup: remove same-type duplicates, keep highest score
  const seen = new Set<string>();
  const deduped = sorted.filter(a => {
    if (seen.has(a.type)) return false;
    seen.add(a.type);
    return true;
  });

  return { scored: deduped, top: deduped[0] };
}
