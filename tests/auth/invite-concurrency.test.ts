import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { systemDb, closeDb } from "../../lib/db.js";
import { users, teams, userInvites, teamMembers } from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { POST as acceptInvite } from "../../app/api/admin/invites/accept/[token]/route.js";
import { eq, inArray } from "drizzle-orm";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
const createdUserIds: number[] = [];
const createdTeamIds: number[] = [];
let inviterId: number;

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function request(token: string, suffix: number): NextRequest {
  return new NextRequest(`http://localhost/api/admin/invites/accept/${token}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${suffix}`,
    },
    body: JSON.stringify({ fullName: `Invite User ${suffix}`, password: "Invite!Pass123" }),
  });
}

async function createTeam(name: string): Promise<number> {
  const [team] = await systemDb.insert(teams)
    .values({ name, createdBy: inviterId, billingPlan: "free" })
    .returning({ id: teams.id });
  if (!team) throw new Error("Failed to create invite test team");
  createdTeamIds.push(team.id);
  return team.id;
}

async function createInvite(teamId: number, email: string, token: string): Promise<void> {
  await systemDb.insert(userInvites).values({
    email,
    invitedBy: inviterId,
    teamId,
    role: "team_member",
    tokenHash: tokenHash(token),
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  });
}

before(async () => {
  const [inviter] = await systemDb.insert(users).values({
    email: `invite_owner_${RUN_ID}@test.invalid`,
    passwordHash: await hashPassword("Owner!Pass123"),
    role: "admin",
    accountStatus: "active",
  }).returning({ id: users.id });
  if (!inviter) throw new Error("Failed to create invite test owner");
  inviterId = inviter.id;
  createdUserIds.push(inviter.id);
});

after(async () => {
  try {
    if (createdTeamIds.length) {
      await systemDb.delete(userInvites).where(inArray(userInvites.teamId, createdTeamIds));
      const members = await systemDb.select({ userId: teamMembers.userId }).from(teamMembers)
        .where(inArray(teamMembers.teamId, createdTeamIds));
      createdUserIds.push(...members.map((row) => row.userId));
      await systemDb.update(users).set({ defaultTeamId: null })
        .where(inArray(users.defaultTeamId, createdTeamIds));
      await systemDb.delete(teams).where(inArray(teams.id, createdTeamIds));
    }
    await systemDb.delete(users).where(inArray(users.id, [...new Set(createdUserIds)]));
  } finally {
    await closeDb();
  }
});

describe("atomic invite acceptance", { concurrency: 1 }, () => {
  test("parallel acceptance of one token creates one account and membership", async () => {
    const teamId = await createTeam(`same-token-${RUN_ID}`);
    const token = crypto.randomBytes(32).toString("hex");
    const email = `same_${RUN_ID}@test.invalid`;
    await createInvite(teamId, email, token);

    const results = await Promise.all([
      acceptInvite(request(token, 31), { params: Promise.resolve({ token }) }),
      acceptInvite(request(token, 32), { params: Promise.resolve({ token }) }),
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 404]);
    const accounts = await systemDb.select({ id: users.id }).from(users).where(eq(users.email, email));
    assert.equal(accounts.length, 1);
    createdUserIds.push(...accounts.map((row) => row.id));
  });

  test("parallel distinct invites competing for the final seat yield one winner", async () => {
    const teamId = await createTeam(`final-seat-${RUN_ID}`);
    const tokenA = crypto.randomBytes(32).toString("hex");
    const tokenB = crypto.randomBytes(32).toString("hex");
    await createInvite(teamId, `seat_a_${RUN_ID}@test.invalid`, tokenA);
    await createInvite(teamId, `seat_b_${RUN_ID}@test.invalid`, tokenB);

    const results = await Promise.all([
      acceptInvite(request(tokenA, 33), { params: Promise.resolve({ token: tokenA }) }),
      acceptInvite(request(tokenB, 34), { params: Promise.resolve({ token: tokenB }) }),
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [200, 402]);
    const members = await systemDb.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    assert.equal(members.length, 1);
  });
});