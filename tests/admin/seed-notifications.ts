/**
 * Admin Notification Test Seed/Cleanup
 * Creates and tears down isolated test users (no team) per test run.
 * Uses RUN_ID suffix so parallel runs don't collide.
 *
 * Auth tokens are generated directly (bypassing /api/auth/login) so the tests
 * are not blocked by the pre-existing 404 on that route.  The generated JWT +
 * matching session row are recognised by requireAdmin / requireTeamMember via
 * the standard Authorization: Bearer header path in lib/api/auth.ts.
 *
 * The signup-alert notification is created by calling notifyAdminsNewSignup()
 * directly — the same function that is triggered on real user signups — so the
 * test exercises the actual notification generation logic, not a hand-crafted
 * database insert.
 */
import { db } from "../../lib/db.js";
import {
  users,
  sessions,
  notifications,
  activityLogs,
  emailVerificationCodes,
} from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { generateAccessToken, hashToken } from "../../lib/auth.js";
import { notifyAdminsNewSignup } from "../../lib/notification-service.js";
import { and, eq, isNull, inArray } from "drizzle-orm";

export interface NotificationSeedResult {
  password: string;
  teamlessAdmin: { id: number; email: string; bearerToken: string };
  teamlessNonAdmin: { id: number; email: string; bearerToken: string };
  notificationId: number;
}

/**
 * Creates two team-less users (one admin, one regular), calls
 * notifyAdminsNewSignup() to exercise the real notification service, then
 * finds the resulting notification for the admin user.  Returns pre-built
 * bearer tokens so tests can call the API without going through the login route.
 */
export async function seedNotificationUsers(runId: string): Promise<NotificationSeedResult> {
  const password = "Test!Pass#123";
  const passwordHash = await hashPassword(password);
  const prefix = `test_notif_${runId}`;

  // Team-less admin — no defaultTeamId, no team membership
  const [adminRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_admin@test.invalid`,
      passwordHash,
      role: "admin",
      accountStatus: "active",
      fullName: "Teamless Admin",
    })
    .returning({ id: users.id, email: users.email });

  // Team-less regular user — acts as the "new signup" that triggers the alert,
  // and also as the non-admin subject used for the blocked-access tests.
  const [nonAdminRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_member@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      fullName: "Teamless Member",
    })
    .returning({ id: users.id, email: users.email });

  // Build bearer tokens directly — mirrors what /api/auth/login produces
  const adminToken = generateAccessToken({
    userId: adminRow.id,
    email: adminRow.email,
    role: "admin",
  });
  const nonAdminToken = generateAccessToken({
    userId: nonAdminRow.id,
    email: nonAdminRow.email,
    role: "team_member",
  });

  // Insert matching session rows so requireAdmin / requireTeamMember pass
  await db.insert(sessions).values([
    {
      userId: adminRow.id,
      tokenHash: hashToken(adminToken),
      isActive: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    {
      userId: nonAdminRow.id,
      tokenHash: hashToken(nonAdminToken),
      isActive: 1,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  ]);

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
    teamlessAdmin: { ...adminRow, bearerToken: adminToken },
    teamlessNonAdmin: { ...nonAdminRow, bearerToken: nonAdminToken },
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
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(emailVerificationCodes)
      .where(inArray(emailVerificationCodes.userId, userIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, userIds as number[]));
    // notifications cascade-delete via userId FK (onDelete: 'cascade')
    await db.delete(users).where(inArray(users.id, userIds));
  } catch (e) {
    console.warn("[seed-notifications] cleanup warning:", e);
  }
}
