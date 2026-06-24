import { db } from "@/lib/db";
import { notifications, users, type InsertNotification } from "@/shared/schema";
import { eq, and, or, isNull, desc, sql, gte } from "drizzle-orm";

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

/**
 * Build the visibility predicate for notification queries when a team context is present.
 * Matches team-scoped notifications OR user-targeted notifications
 * (userId = $userId AND teamId IS NULL) so admin-specific alerts are
 * only surfaced to the intended recipient and not to other team members.
 */
function visibilityFilter(teamId: number, userId?: number) {
  const teamClause = eq(notifications.teamId, teamId);
  if (!userId) return teamClause;
  const userClause = and(eq(notifications.userId, userId), isNull(notifications.teamId));
  return or(teamClause, userClause)!;
}

/**
 * Visibility predicate for team-less admins: only userId-scoped notifications
 * (teamId IS NULL) that were explicitly addressed to this user.
 */
function userOnlyFilter(userId: number) {
  return and(eq(notifications.userId, userId), isNull(notifications.teamId))!;
}

export async function getUnreadNotifications(teamId: number | null, limit: number = 20, userId?: number) {
  const filter = teamId === null
    ? and(userOnlyFilter(userId!), eq(notifications.read, 0), eq(notifications.dismissed, 0), notificationAgeFilter())
    : and(visibilityFilter(teamId, userId), eq(notifications.read, 0), eq(notifications.dismissed, 0), notificationAgeFilter());
  return db.select()
    .from(notifications)
    .where(filter)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getAllNotifications(teamId: number | null, limit: number = 50, userId?: number) {
  const filter = teamId === null
    ? and(userOnlyFilter(userId!), eq(notifications.dismissed, 0), notificationAgeFilter())
    : and(visibilityFilter(teamId, userId), eq(notifications.dismissed, 0), notificationAgeFilter());
  return db.select()
    .from(notifications)
    .where(filter)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markNotificationAsRead(notificationId: number, teamId: number | null, userId?: number) {
  const ownershipFilter = teamId === null
    ? and(eq(notifications.id, notificationId), userOnlyFilter(userId!))
    : and(eq(notifications.id, notificationId), visibilityFilter(teamId, userId));
  const result = await db.update(notifications)
    .set({ read: 1, readAt: new Date() })
    .where(ownershipFilter);
  return result;
}

export async function markAllAsRead(teamId: number | null, userId?: number) {
  const filter = teamId === null
    ? and(userOnlyFilter(userId!), eq(notifications.read, 0))
    : and(visibilityFilter(teamId, userId), eq(notifications.read, 0));
  await db.update(notifications)
    .set({ read: 1, readAt: new Date() })
    .where(filter);
}

export async function dismissNotification(notificationId: number, teamId: number | null, userId?: number) {
  const ownershipFilter = teamId === null
    ? and(eq(notifications.id, notificationId), userOnlyFilter(userId!))
    : and(eq(notifications.id, notificationId), visibilityFilter(teamId, userId));
  const result = await db.update(notifications)
    .set({ dismissed: 1 })
    .where(ownershipFilter);
  return result;
}

export async function dismissAllNotifications(teamId: number | null, userId?: number) {
  const filter = teamId === null
    ? userOnlyFilter(userId!)
    : visibilityFilter(teamId, userId);
  await db.update(notifications)
    .set({ dismissed: 1 })
    .where(filter);
}

export async function getUnreadCount(teamId: number | null, userId?: number): Promise<number> {
  const filter = teamId === null
    ? and(userOnlyFilter(userId!), eq(notifications.read, 0), eq(notifications.dismissed, 0), notificationAgeFilter())
    : and(visibilityFilter(teamId, userId), eq(notifications.read, 0), eq(notifications.dismissed, 0), notificationAgeFilter());
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(filter);
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

/**
 * Creates a private in-app notification for every active admin user when a new
 * user registers and is waiting for approval.
 *
 * All active admins — whether they belong to a team or not — are intentionally
 * notified, because any admin may need to act on pending approvals regardless of
 * their team membership.  Task #83 ensured team-less admins can also READ these
 * notifications; the write side has always targeted every active admin.
 *
 * Notifications are stored with userId only (teamId = NULL) so they are
 * strictly private to each admin — regular team members never see them,
 * regardless of which team the admin belongs to.  The visibilityFilter in all
 * query helpers surfaces userId-scoped notifications alongside team-scoped
 * ones, so the existing NotificationBell will display these to admins.
 */
export async function notifyAdminsNewSignup(newUserId: number, newUserEmail: string, newUserName: string | null): Promise<void> {
  try {
    const adminUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));

    if (adminUsers.length === 0) return;

    await Promise.all(
      adminUsers.map((admin) =>
        createNotification({
          userId: admin.id,
          // teamId intentionally omitted — this is a private per-user notification
          type: 'warning',
          category: 'system',
          title: 'New User Awaiting Approval',
          message: `${newUserName || newUserEmail} has signed up and is pending review.`,
          entityId: newUserId,
          entityType: 'user',
          actionUrl: '/admin/users',
        }).catch((err) =>
          console.error(`Failed to notify admin ${admin.id} of new signup:`, err)
        )
      )
    );
  } catch (err) {
    console.error("notifyAdminsNewSignup failed:", err);
  }
}
