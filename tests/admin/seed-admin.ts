/**
 * Admin Approval Test Seed/Cleanup
 * Creates and tears down isolated test users + team per test run.
 * Uses RUN_ID suffix so parallel runs don't collide.
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

export interface AdminSeedResult {
  password: string;
  adminUser: { id: number; email: string };
  activeUser: { id: number; email: string };
  pendingUser1: { id: number; email: string };
  pendingUser2: { id: number; email: string };
  team: { id: number; name: string };
}

export async function seedAdminUsers(runId: string): Promise<AdminSeedResult> {
  const password = "Test!Pass#123";
  const passwordHash = await hashPassword(password);
  const prefix = `test_adm_${runId}`;

  // 1. Create admin user first (needed as teams.createdBy FK)
  const [adminRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_admin@test.invalid`,
      passwordHash,
      role: "admin",
      accountStatus: "active",
      fullName: "Admin User",
    })
    .returning({ id: users.id, email: users.email });

  // 2. Create team with admin as creator
  const teamName = `Admin Test Team ${runId}`;
  const [teamRow] = await db
    .insert(teams)
    .values({ name: teamName, createdBy: adminRow.id })
    .returning({ id: teams.id });

  // 3. Update admin's defaultTeamId now that team exists
  await db
    .update(users)
    .set({ defaultTeamId: teamRow.id })
    .where(eq(users.id, adminRow.id));

  // 4. Create an active user (for non-pending rejection test)
  const [activeRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_active@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      fullName: "Active User",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  // 5. Create pending_approval users — two so each destructive test gets its own
  const [pendingRow1] = await db
    .insert(users)
    .values({
      email: `${prefix}_pending1@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "pending_approval",
      fullName: "Pending User One",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  const [pendingRow2] = await db
    .insert(users)
    .values({
      email: `${prefix}_pending2@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "pending_approval",
      fullName: "Pending User Two",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  // 6. Wire team memberships
  await db.insert(teamMembers).values([
    { teamId: teamRow.id, userId: adminRow.id, role: "admin" },
    { teamId: teamRow.id, userId: activeRow.id, role: "member" },
    { teamId: teamRow.id, userId: pendingRow1.id, role: "member" },
    { teamId: teamRow.id, userId: pendingRow2.id, role: "member" },
  ]);

  return {
    password,
    adminUser: adminRow,
    activeUser: activeRow,
    pendingUser1: pendingRow1,
    pendingUser2: pendingRow2,
    team: { id: teamRow.id, name: teamName },
  };
}

export async function cleanupAdminUsers(seed: AdminSeedResult): Promise<void> {
  const userIds = [
    seed.adminUser.id,
    seed.activeUser.id,
    seed.pendingUser1.id,
    seed.pendingUser2.id,
  ];

  try {
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(emailVerificationCodes)
      .where(inArray(emailVerificationCodes.userId, userIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, userIds as number[]));

    // Nullify defaultTeamId before deleting team to avoid FK conflict
    await db
      .update(users)
      .set({ defaultTeamId: null })
      .where(eq(users.defaultTeamId, seed.team.id));

    // Delete team — cascades teamMembers
    await db.delete(teams).where(eq(teams.id, seed.team.id));

    // Delete test users
    await db.delete(users).where(inArray(users.id, userIds));
  } catch (e) {
    console.warn("[seed-admin] cleanup warning:", e);
  }
}
