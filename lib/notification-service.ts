import { db } from "@/lib/db";
import { notifications, type InsertNotification } from "@/shared/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";

export type NotificationType = 'success' | 'error' | 'warning' | 'info';
export type NotificationCategory = 'video' | 'article' | 'social_post' | 'batch' | 'system';

interface CreateNotificationParams {
  userId?: number;
  teamId?: number;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  message: string;
  entityId?: number;
  entityType?: string;
  actionUrl?: string;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId: params.userId ?? null,
      teamId: params.teamId ?? null,
      type: params.type,
      category: params.category,
      title: params.title,
      message: params.message,
      entityId: params.entityId ?? null,
      entityType: params.entityType ?? null,
      actionUrl: params.actionUrl ?? null,
      read: 0,
      dismissed: 0,
    });
    console.log(`📢 Notification created: [${params.type}] ${params.title}`);
  } catch (error) {
    console.error("Failed to create notification:", error);
  }
}

// Only show notifications from the last 7 days — prevents old stale alerts from surfacing on every login
const NOTIFICATION_MAX_AGE_DAYS = 7;

function notificationAgeFilter() {
  const cutoff = new Date(Date.now() - NOTIFICATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  return gte(notifications.createdAt, cutoff);
}

export async function getUnreadNotifications(teamId: number, limit: number = 20) {
  return db.select()
    .from(notifications)
    .where(and(
      eq(notifications.teamId, teamId),
      eq(notifications.read, 0),
      eq(notifications.dismissed, 0),
      notificationAgeFilter()
    ))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getAllNotifications(teamId: number, limit: number = 50) {
  return db.select()
    .from(notifications)
    .where(and(
      eq(notifications.teamId, teamId),
      eq(notifications.dismissed, 0),
      notificationAgeFilter()
    ))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(notificationId: number, teamId: number) {
  const result = await db.update(notifications)
    .set({ read: 1, readAt: new Date() })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.teamId, teamId)
    ));
  return result;
}

export async function markAllAsRead(teamId: number) {
  await db.update(notifications)
    .set({ read: 1, readAt: new Date() })
    .where(and(
      eq(notifications.teamId, teamId),
      eq(notifications.read, 0)
    ));
}

export async function dismissNotification(notificationId: number, teamId: number) {
  const result = await db.update(notifications)
    .set({ dismissed: 1 })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.teamId, teamId)
    ));
  return result;
}

export async function getUnreadCount(teamId: number): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(
      eq(notifications.teamId, teamId),
      eq(notifications.read, 0),
      eq(notifications.dismissed, 0),
      notificationAgeFilter()
    ));
  return result[0]?.count ?? 0;
}

export async function notifyVideoComplete(teamId: number, videoId: number, title: string) {
  await createNotification({
    teamId,
    type: 'success',
    category: 'video',
    title: 'Video Generated Successfully',
    message: `Your video "${title}" is ready to view.`,
    entityId: videoId,
    entityType: 'video_idea',
    actionUrl: `/social/idea-video`,
  });
}

export async function notifyVideoFailed(teamId: number, videoId: number, title: string, error: string) {
  const windowStart = new Date(Date.now() - 30 * 60 * 1000);
  const existing = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.teamId, teamId),
        eq(notifications.entityId, videoId),
        eq(notifications.entityType, "video_idea"),
        eq(notifications.type, "error"),
        gte(notifications.createdAt, windowStart)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(`🔕 Skipping duplicate video failure notification for video ${videoId} (already sent within 30 min)`);
    return;
  }

  await createNotification({
    teamId,
    type: 'error',
    category: 'video',
    title: 'Video Generation Failed',
    message: `Failed to generate video "${title}": ${error.slice(0, 200)}`,
    entityId: videoId,
    entityType: 'video_idea',
    actionUrl: `/social/idea-video`,
  });
}

export async function notifyArticleComplete(teamId: number, articleId: number, title: string) {
  await createNotification({
    teamId,
    type: 'success',
    category: 'article',
    title: 'Article Generated Successfully',
    message: `Your article "${title}" is ready.`,
    entityId: articleId,
    entityType: 'article',
    actionUrl: `/articles/${articleId}`,
  });
}

export async function notifyBatchComplete(teamId: number, batchId: number, articleCount: number) {
  await createNotification({
    teamId,
    type: 'success',
    category: 'batch',
    title: 'Batch Generation Complete',
    message: `${articleCount} articles have been generated.`,
    entityId: batchId,
    entityType: 'batch',
    actionUrl: `/batches/${batchId}`,
  });
}

export async function notifySocialPostComplete(teamId: number, postId: number, platform: string) {
  await createNotification({
    teamId,
    type: 'success',
    category: 'social_post',
    title: 'Social Post Ready',
    message: `Your ${platform} post has been generated.`,
    entityId: postId,
    entityType: 'social_post',
    actionUrl: `/social/dashboard`,
  });
}
