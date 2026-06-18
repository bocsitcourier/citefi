import { db, getTxDb } from "@/lib/db";
import { contentEvents, clientIntelligence } from "@/shared/schema";
import { eq, and, gte, count, countDistinct, sql } from "drizzle-orm";

export interface IntelligenceRow {
  id: number;
  teamId: number;
  contentType: string;
  articleId: number | null;
  socialPostId: number | null;
  windowDays: number;
  views: number;
  clicks: number;
  shares: number;
  conversions: number;
  uniqueSessions: number;
  ctr: number;
  conversionRate: number;
  engagementScore: number;
  computedAt: Date;
}

/**
 * Compute an engagement score in the range 0–100.
 * Formula weights conversions > shares > clicks > views.
 */
function computeEngagementScore(
  views: number,
  clicks: number,
  shares: number,
  conversions: number
): number {
  const weighted = clicks * 3 + shares * 5 + conversions * 10;
  if (views === 0) return 0;
  // Ratio of weighted actions to views, scaled to 0–100 and capped
  const raw = (weighted / views) * 100;
  return Math.min(100, Math.round(raw * 10) / 10);
}

/**
 * Read content_events for a team, aggregate per content item, compute derived
 * metrics, and atomically snapshot results into client_intelligence.
 *
 * - Delete always runs first so stale snapshots are cleared even when the
 *   window contains zero events (prevents serving outdated intelligence).
 * - Delete + insert are wrapped in a transaction so readers never observe a
 *   partial/empty state.
 * - This is an admin-triggered or scheduled operation — not called per-request.
 */
export async function computeIntelligence(
  teamId: number,
  windowDays = 30
): Promise<{ processed: number }> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  // Aggregate raw event counts per content item (read-only, outside tx)
  const rows = await db
    .select({
      contentType: contentEvents.contentType,
      articleId: contentEvents.articleId,
      socialPostId: contentEvents.socialPostId,
      views: count(
        sql<number>`CASE WHEN ${contentEvents.eventType} IN ('view','page_view') THEN 1 END`
      ),
      clicks: count(
        sql<number>`CASE WHEN ${contentEvents.eventType} IN ('click','cta_click') THEN 1 END`
      ),
      shares: count(
        sql<number>`CASE WHEN ${contentEvents.eventType} = 'share' THEN 1 END`
      ),
      conversions: count(
        sql<number>`CASE WHEN ${contentEvents.eventType} = 'conversion' THEN 1 END`
      ),
      uniqueSessions: countDistinct(contentEvents.sessionId),
    })
    .from(contentEvents)
    .where(
      and(
        eq(contentEvents.teamId, teamId),
        gte(contentEvents.createdAt, since)
      )
    )
    .groupBy(
      contentEvents.contentType,
      contentEvents.articleId,
      contentEvents.socialPostId
    );

  // Compute derived metrics (pure, before tx)
  const toInsert = rows.map((r) => {
    const views = Number(r.views);
    const clicks = Number(r.clicks);
    const shares = Number(r.shares);
    const conversions = Number(r.conversions);
    const safeDivisor = Math.max(1, views);

    return {
      teamId,
      contentType: r.contentType,
      articleId: r.articleId,
      socialPostId: r.socialPostId,
      windowDays,
      views,
      clicks,
      shares,
      conversions,
      uniqueSessions: Number(r.uniqueSessions),
      ctr: Math.round((clicks / safeDivisor) * 10_000) / 10_000,
      conversionRate: Math.round((conversions / safeDivisor) * 10_000) / 10_000,
      engagementScore: computeEngagementScore(views, clicks, shares, conversions),
    };
  });

  // Atomically replace the snapshot — delete first so zero-event windows also
  // clear stale rows, then insert fresh rows (skipped if none to insert).
  const txDb = getTxDb();
  await txDb.transaction(async (tx) => {
    await tx
      .delete(clientIntelligence)
      .where(
        and(
          eq(clientIntelligence.teamId, teamId),
          eq(clientIntelligence.windowDays, windowDays)
        )
      );

    if (toInsert.length > 0) {
      await tx.insert(clientIntelligence).values(toInsert);
    }
  });

  console.log(
    `[client-intelligence] computed ${toInsert.length} rows for team ${teamId} (${windowDays}d window)`
  );

  return { processed: toInsert.length };
}

/**
 * Fetch pre-computed intelligence for a team, sorted by engagementScore desc.
 */
export async function getIntelligence(
  teamId: number,
  options: {
    contentType?: "article" | "social_post";
    windowDays?: number;
    limit?: number;
  } = {}
): Promise<IntelligenceRow[]> {
  const { contentType, windowDays = 30, limit = 100 } = options;

  const conditions = [
    eq(clientIntelligence.teamId, teamId),
    eq(clientIntelligence.windowDays, windowDays),
  ];
  if (contentType) {
    conditions.push(eq(clientIntelligence.contentType, contentType) as any);
  }

  const rows = await db
    .select()
    .from(clientIntelligence)
    .where(and(...(conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]])))
    .orderBy(sql`${clientIntelligence.engagementScore} DESC`)
    .limit(limit);

  return rows as IntelligenceRow[];
}
