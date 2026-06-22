/**
 * Client Dashboard Test Seed/Cleanup
 * Creates and tears down isolated test users, teams, and billing state per run.
 * Uses RUN_ID suffix so parallel runs don't collide.
 *
 * Run with:  node --env-file=.env.local --import tsx/esm --test tests/client/client-dashboard.test.ts
 */
import { db } from "../../lib/db.js";
import {
  users,
  teams,
  teamMembers,
  sessions,
  creditBalances,
  creditLedger,
  userInvites,
  activityLogs,
  emailVerificationCodes,
} from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { eq, inArray, and } from "drizzle-orm";

export interface ClientSeedResult {
  password: string;
  adminUser: { id: number; email: string };
  memberUser: { id: number; email: string };
  team: { id: number };
  adminMemberId: number;
  memberMemberId: number;
}

/**
 * Seed a minimal team: one admin + one regular member.
 * Teams start with default billing (free plan, active status).
 */
export async function seedClientTeam(runId: string): Promise<ClientSeedResult> {
  const password = "Test!Pass#123";
  const passwordHash = await hashPassword(password);
  const prefix = `test_client_${runId}`;

  // 1. Create admin user
  const [adminRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_admin@test.invalid`,
      passwordHash,
      role: "admin",
      accountStatus: "active",
    })
    .returning({ id: users.id, email: users.email });

  // 2. Create team
  const [teamRow] = await db
    .insert(teams)
    .values({ name: `Client Test Team ${runId}`, createdBy: adminRow.id })
    .returning({ id: teams.id });

  // 3. Link admin defaultTeamId
  await db
    .update(users)
    .set({ defaultTeamId: teamRow.id })
    .where(eq(users.id, adminRow.id));

  // 4. Create regular member
  const [memberRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_member@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  // 5. Wire team memberships
  const [adminMemberRow] = await db
    .insert(teamMembers)
    .values({ teamId: teamRow.id, userId: adminRow.id, role: "admin" })
    .returning({ id: teamMembers.id });

  const [memberMemberRow] = await db
    .insert(teamMembers)
    .values({ teamId: teamRow.id, userId: memberRow.id, role: "member" })
    .returning({ id: teamMembers.id });

  return {
    password,
    adminUser: adminRow,
    memberUser: memberRow,
    team: teamRow,
    adminMemberId: adminMemberRow.id,
    memberMemberId: memberMemberRow.id,
  };
}

/**
 * Insert credit ledger debit entries to simulate high usage.
 * @param teamId     target team
 * @param userId     user who "used" the credits
 * @param amount     number of credits to debit (positive; stored as negative)
 * @param productType  "article" | "social" | "podcast" | "video"
 * @param runId      run-scoped suffix for idempotency key uniqueness
 */
export async function seedCreditUsage(
  teamId: number,
  userId: number,
  amount: number,
  productType: string,
  runId: string
): Promise<void> {
  await db.insert(creditLedger).values({
    teamId,
    userId,
    amount: -amount,          // negative = debit
    balanceAfter: 0,
    eventType: "debit",
    productType,
    idempotencyKey: `test_usage_${runId}_${productType}_${Date.now()}`,
  });
}

/**
 * Patch the team's billing state.
 * Pass only the fields you want to change.
 */
export async function patchTeamBilling(
  teamId: number,
  patch: {
    billingStatus?: string;
    billingPlan?: string;
    currentPeriodEnd?: Date | null;
    stripeSubscriptionId?: string | null;
  }
): Promise<void> {
  await db.update(teams).set(patch as any).where(eq(teams.id, teamId));
}

/**
 * Reset team billing back to clean defaults (free plan, active, no period).
 */
export async function resetTeamBilling(teamId: number): Promise<void> {
  await patchTeamBilling(teamId, {
    billingStatus: "active",
    billingPlan: "free",
    currentPeriodEnd: null,
    stripeSubscriptionId: null,
  });
}

/**
 * Full teardown — removes all test-created rows in dependency order.
 */
export async function cleanupClientTeam(seed: ClientSeedResult): Promise<void> {
  const userIds = [seed.adminUser.id, seed.memberUser.id];

  try {
    // Remove child rows without cascade
    await db.delete(sessions).where(inArray(sessions.userId, userIds));
    await db
      .delete(emailVerificationCodes)
      .where(inArray(emailVerificationCodes.userId, userIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, userIds as number[]));

    // Remove credit data
    await db.delete(creditLedger).where(eq(creditLedger.teamId, seed.team.id));
    await db.delete(creditBalances).where(eq(creditBalances.teamId, seed.team.id));

    // Remove invites
    await db.delete(userInvites).where(eq(userInvites.teamId, seed.team.id));

    // Nullify users.defaultTeamId so we can delete the team
    await db
      .update(users)
      .set({ defaultTeamId: null })
      .where(eq(users.defaultTeamId, seed.team.id));

    // Delete team (cascades teamMembers)
    await db.delete(teams).where(eq(teams.id, seed.team.id));

    // Delete test users
    await db.delete(users).where(inArray(users.id, userIds));
  } catch (e) {
    console.warn("[seed-client] cleanup warning:", e);
  }
}
