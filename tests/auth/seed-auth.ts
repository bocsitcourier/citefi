/**
 * T004 Auth Test Seed/Cleanup
 * Creates and tears down isolated test users + team per test run.
 * Uses RUN_ID suffix so parallel runs don't collide.
 *
 * Run with:  npx tsx --test tests/auth/auth-api.test.ts
 */
import { db } from "../../lib/db.js";
import {
  users,
  teams,
  teamMembers,
  sessions,
  activityLogs,
  emailVerificationCodes,
} from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { eq, inArray } from "drizzle-orm";

export interface SeedResult {
  password: string;
  activeUser: { id: number; email: string };
  adminUser: { id: number; email: string };
  suspendedUser: { id: number; email: string };
  twoFaUser: { id: number; email: string };
  team: { id: number };
}

export async function seedAuthUsers(runId: string): Promise<SeedResult> {
  const password = "Test!Pass#123";
  const passwordHash = await hashPassword(password);
  const prefix = `test_auth_${runId}`;

  // 1. Create admin user first (needed as teams.createdBy FK)
  const [adminRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_admin@test.invalid`,
      passwordHash,
      role: "admin",
      accountStatus: "active",
    })
    .returning({ id: users.id, email: users.email });

  // 2. Create team with admin as creator
  const [teamRow] = await db
    .insert(teams)
    .values({ name: `Test Team ${runId}`, createdBy: adminRow.id })
    .returning({ id: teams.id });

  // 3. Update admin's defaultTeamId now that team exists
  await db
    .update(users)
    .set({ defaultTeamId: teamRow.id })
    .where(eq(users.id, adminRow.id));

  // 4. Create remaining test users
  const [activeRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_active@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  const [suspendedRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_suspended@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "suspended",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  const [twoFaRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_2fa@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      twoFactorEnabled: 1,
      twoFactorMethod: "email",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  // 5. Wire team memberships
  await db.insert(teamMembers).values([
    { teamId: teamRow.id, userId: adminRow.id, role: "admin" },
    { teamId: teamRow.id, userId: activeRow.id, role: "member" },
    { teamId: teamRow.id, userId: suspendedRow.id, role: "member" },
    { teamId: teamRow.id, userId: twoFaRow.id, role: "member" },
  ]);

  return {
    password,
    activeUser: activeRow,
    adminUser: { ...adminRow },
    suspendedUser: suspendedRow,
    twoFaUser: twoFaRow,
    team: teamRow,
  };
}

/**
 * Clean up users created directly by signup flow tests (no team rows to delete).
 * Accepts an array of user IDs collected during the test run.
 */
export async function cleanupSignupUsers(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(emailVerificationCodes)
      .where(inArray(emailVerificationCodes.userId, userIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, userIds as number[]));
    await db.delete(users).where(inArray(users.id, userIds));
  } catch (e) {
    console.warn("[seed-auth] cleanupSignupUsers warning:", e);
  }
}

export async function cleanupAuthUsers(seed: SeedResult): Promise<void> {
  const userIds = [
    seed.activeUser.id,
    seed.adminUser.id,
    seed.suspendedUser.id,
    seed.twoFaUser.id,
  ];

  try {
    // Delete child rows that reference users.id with RESTRICT (no cascade)
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(emailVerificationCodes)
      .where(inArray(emailVerificationCodes.userId, userIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, userIds as number[]));

    // Nullify users.defaultTeamId so we can delete the team without FK conflict
    await db
      .update(users)
      .set({ defaultTeamId: null })
      .where(eq(users.defaultTeamId, seed.team.id));

    // Delete team — cascades teamMembers (onDelete: 'cascade')
    await db.delete(teams).where(eq(teams.id, seed.team.id));

    // Delete test users — teams.createdBy FK is gone since team was deleted
    await db.delete(users).where(inArray(users.id, userIds));
  } catch (e) {
    // Best-effort cleanup; log but don't throw so test suite still exits clean
    console.warn("[seed-auth] cleanup warning:", e);
  }
}
