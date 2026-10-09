/**
 * Admin Notification Test Seed/Cleanup
 * Creates and tears down isolated test users (no team) per test run.
 * Uses RUN_ID suffix so parallel runs don't collide.
 *
 * The HTTP suite logs the seeded synthetic accounts through /api/auth/login,
 * then sends the resulting bearer token through the standard Authorization
 * header path in lib/api/auth.ts.
 *
 * The signup-alert notification is created by calling notifyAdminsNewSignup()
 * directly — the same function that is triggered on real user signups — so the
 * test exercises the actual notification generation logic, not a hand-crafted
 * database insert.
 */
import { systemDb as db } from "../../lib/db.js";
import {
  users,
  sessions,
  notifications,
  activityLogs,
  emailVerificationCodes,
} from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { notifyAdminsNewSignup } from "../../lib/notification-service.js";
import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  SYNTHETIC_ACCOUNT_PASSWORD,
  syntheticAccountEmail,
} from "../../QA/support/qa-fixtures.mjs";

export interface NotificationSeedResult {
  password: string;
  teamlessAdmin: { id: number; email: string };
  teamlessNonAdmin: { id: number; email: string };
  notificationId: number;
}

/**
 * Creates two team-less users (one admin, one regular), calls
 * notifyAdminsNewSignup() to exercise the real notification service, then
 * finds the resulting notification for the admin user.  The HTTP suite logs
 * these synthetic accounts in through /api/auth/login; this keeps the test on
 * the same credential/session path as a real admin instead of manufacturing a
 * recovery token and session row.
 */
export async function seedNotificationUsers(runId: string): Promise<NotificationSeedResult> {
  const password = SYNTHETIC_ACCOUNT_PASSWORD;
  const passwordHash = await hashPassword(password);
  const accountEmail = (role: string) => syntheticAccountEmail(runId, `notifications_${role}`);

  // Team-less admin — no defaultTeamId, no team membership
  const [adminRow] = await db
    .insert(users)
    .values({
      email: accountEmail("admin"),
      passwordHash,
      role: "admin",
      accountStatus: "active",
      fullName: "Teamless Admin",
      mfaEnrollmentDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: users.id, email: users.email });
  if (!adminRow) throw new Error("Failed to seed notification admin");

  // Team-less regular user — acts as the "new signup" that triggers the alert,
  // and also as the non-admin subject used for the blocked-access tests.
  const [nonAdminRow] = await db
    .insert(users)
    .values({
      email: accountEmail("member"),
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      fullName: "Teamless Member",
    })
    .returning({ id: users.id, email: users.email });
  if (!nonAdminRow) throw new Error("Failed to seed notification member");

  // Trigger the real notification service — this exercises notifyAdminsNewSignup's
  // admin-discovery query, notification payload, and userId/teamId scoping.
  await notifyAdminsNewSignup(
    nonAdminRow.id,
    nonAdminRow.email,
    "Teamless Member",
  );

  // Fetch the notification that was created for our specific test admin.
  // notifyAdminsNewSignup targets all active admins; we filter by userId so
  // real admins already in the system don't affect this assertion.
  const [notifRow] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, adminRow.id),
        isNull(notifications.teamId),
        eq(notifications.category, "system"),
        eq(notifications.title, "New User Awaiting Approval"),
      )
    )
    .limit(1);

  if (!notifRow) {
    throw new Error(
      `[seed-notifications] notifyAdminsNewSignup did not create a notification for admin ${adminRow.id} (${adminRow.email})`
    );
  }

  return {
    password,
    teamlessAdmin: adminRow,
    teamlessNonAdmin: nonAdminRow,
    notificationId: notifRow.id,
  };
}

/**
 * Removes all rows created by seedNotificationUsers.
 * Notifications cascade-delete when users are deleted (onDelete: 'cascade').
 */
export async function cleanupNotificationUsers(seed: NotificationSeedResult): Promise<void> {
  const userIds = [seed.teamlessAdmin.id, seed.teamlessNonAdmin.id];
  try {
    // The signup service notifies every active admin, so remove all notifications
    // generated for this seeded signup, including rows owned by non-test admins.
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.entityType, "user"),
          eq(notifications.entityId, seed.teamlessNonAdmin.id),
          eq(notifications.title, "New User Awaiting Approval"),
        )
      );
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(emailVerificationCodes)
      .where(inArray(emailVerificationCodes.userId, userIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, userIds as number[]));
    // Any remaining notification owned by the test admin cascades via userId.
    await db.delete(users).where(inArray(users.id, userIds));
  } catch (e) {
    console.warn("[seed-notifications] cleanup warning:", e);
  }
}
