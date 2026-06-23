/**
 * Admin Approval Email — Unit Tests
 * ===================================
 * Verifies that the approve and reject route handlers invoke the correct
 * email functions via the mutable `emailService` object.
 *
 * Strategy
 * --------
 * Node 20 does not support `mock.module()` (added in Node 22.3). We work
 * around this by exporting `emailService` from lib/email.ts as a plain
 * mutable object. Both the route handler and this test share the *same*
 * object reference (module cache). Because the route handler looks up
 * `emailService.sendAccountApprovedEmail` at *call time* rather than at
 * import time, replacing the property with a mock before calling the handler
 * is fully effective.
 *
 * The route handlers are imported and called directly in this process — no
 * live server required — which means the email interception is deterministic.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/admin/email-unit.test.ts
 */
import { describe, test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "../../lib/db.js";
import {
  users,
  teams,
  teamMembers,
  sessions,
  activityLogs,
} from "../../shared/schema.js";
import { hashPassword, generateAccessToken, hashToken } from "../../lib/auth.js";
import { emailService } from "../../lib/email.js";
import { eq, inArray } from "drizzle-orm";

// Import route handlers directly (same process — shares module cache with lib/email.ts)
import { POST as approvePost } from "../../app/api/admin/users/[id]/approve/route.js";
import { POST as rejectPost } from "../../app/api/admin/users/[id]/reject/route.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RUN_ID = `eu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Build a NextRequest for a direct (in-process) route handler call. */
function makeRequest(
  path: string,
  method: "POST" | "GET",
  body: unknown,
  bearerToken: string
): NextRequest {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  });
}

// ── In-process seed: admin user + active session + pending users ───────────────

interface UnitSeed {
  adminId: number;
  adminToken: string;
  teamId: number;
  pendingId: number;
  activeId: number;
  sessionId: number;
  allUserIds: number[];
  teamIdForCleanup: number;
}

async function seedUnitUsers(): Promise<UnitSeed> {
  const password = "Test!Pass#123";
  const passwordHash = await hashPassword(password);
  const prefix = `eu_${RUN_ID}`;

  // Admin user
  const [adminRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_admin@test.invalid`,
      passwordHash,
      role: "admin",
      accountStatus: "active",
      fullName: "Unit Admin",
    })
    .returning({ id: users.id, email: users.email });

  // Team
  const [teamRow] = await db
    .insert(teams)
    .values({ name: `Unit Team ${RUN_ID}`, createdBy: adminRow.id })
    .returning({ id: teams.id });

  await db
    .update(users)
    .set({ defaultTeamId: teamRow.id })
    .where(eq(users.id, adminRow.id));

  // Pending user
  const [pendingRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_pending@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "pending_approval",
      fullName: "Unit Pending",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id });

  // Active user (for non-pending guard tests)
  const [activeRow] = await db
    .insert(users)
    .values({
      email: `${prefix}_active@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      fullName: "Unit Active",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id });

  // Team memberships
  await db.insert(teamMembers).values([
    { teamId: teamRow.id, userId: adminRow.id, role: "admin" },
    { teamId: teamRow.id, userId: pendingRow.id, role: "member" },
    { teamId: teamRow.id, userId: activeRow.id, role: "member" },
  ]);

  // Generate a JWT + session for the admin user
  const token = generateAccessToken({
    userId: adminRow.id,
    email: adminRow.email,
    role: "admin",
  });
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const [sessionRow] = await db
    .insert(sessions)
    .values({
      userId: adminRow.id,
      tokenHash,
      expiresAt,
      isActive: 1,
      teamContextId: teamRow.id,
    })
    .returning({ id: sessions.id });

  return {
    adminId: adminRow.id,
    adminToken: token,
    teamId: teamRow.id,
    pendingId: pendingRow.id,
    activeId: activeRow.id,
    sessionId: sessionRow.id,
    allUserIds: [adminRow.id, pendingRow.id, activeRow.id],
    teamIdForCleanup: teamRow.id,
  };
}

async function cleanupUnitUsers(seed: UnitSeed): Promise<void> {
  try {
    await db
      .delete(sessions)
      .where(inArray(sessions.userId, seed.allUserIds));
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, seed.allUserIds as number[]));
    await db
      .update(users)
      .set({ defaultTeamId: null })
      .where(eq(users.defaultTeamId, seed.teamIdForCleanup));
    await db.delete(teams).where(eq(teams.id, seed.teamIdForCleanup));
    await db
      .delete(users)
      .where(inArray(users.id, seed.allUserIds));
  } catch (e) {
    console.warn("[email-unit] cleanup warning:", e);
  }
}

// ── Seed lifecycle ────────────────────────────────────────────────────────────

let seed: UnitSeed;

before(async () => {
  seed = await seedUnitUsers();
});

after(async () => {
  await cleanupUnitUsers(seed);
});

// ── Email invocation tests ─────────────────────────────────────────────────────

describe("Approve route — email invocation", () => {
  test("sendAccountApprovedEmail is called once with the approved user's email", async (t) => {
    const approvedSpy = t.mock.method(emailService, "sendAccountApprovedEmail", async () => {});

    const req = makeRequest(
      `/api/admin/users/${seed.pendingId}/approve`,
      "POST",
      {},
      seed.adminToken
    );
    const res = await approvePost(req, { params: Promise.resolve({ id: String(seed.pendingId) }) });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(
      approvedSpy.mock.callCount(),
      1,
      `sendAccountApprovedEmail must be called exactly once — called ${approvedSpy.mock.callCount()} time(s)`
    );

    const callArgs = approvedSpy.mock.calls[0]?.arguments[0] as { to: string; fullName?: string | null };
    assert.ok(callArgs, "sendAccountApprovedEmail must receive an argument");
    assert.equal(
      callArgs.to,
      `eu_${RUN_ID}_pending@test.invalid`,
      `sendAccountApprovedEmail must be called with the pending user's email — got: ${callArgs.to}`
    );
  });

  test("sendAccountApprovedEmail is NOT called when user is already active (409 guard)", async (t) => {
    const approvedSpy = t.mock.method(emailService, "sendAccountApprovedEmail", async () => {});

    const req = makeRequest(
      `/api/admin/users/${seed.activeId}/approve`,
      "POST",
      {},
      seed.adminToken
    );
    const res = await approvePost(req, { params: Promise.resolve({ id: String(seed.activeId) }) });

    assert.equal(res.status, 409, `Expected 409 for non-pending user, got ${res.status}`);
    assert.equal(
      approvedSpy.mock.callCount(),
      0,
      `sendAccountApprovedEmail must NOT be called for a non-pending user`
    );
  });
});

describe("Reject route — email invocation", () => {
  test("sendAccountRejectedEmail is called once with the rejected user's email when sendEmail defaults to true", async (t) => {
    // Seed a fresh pending user for this test (pendingId was approved above)
    const [freshPending] = await db
      .insert(users)
      .values({
        email: `eu_${RUN_ID}_fresh_pending@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Fresh Pending",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id, email: users.email });
    seed.allUserIds.push(freshPending.id);

    const rejectedSpy = t.mock.method(emailService, "sendAccountRejectedEmail", async () => {});

    const req = makeRequest(
      `/api/admin/users/${freshPending.id}/reject`,
      "POST",
      {}, // no sendEmail field → defaults to true
      seed.adminToken
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: String(freshPending.id) }) });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(
      rejectedSpy.mock.callCount(),
      1,
      `sendAccountRejectedEmail must be called exactly once — called ${rejectedSpy.mock.callCount()} time(s)`
    );

    const callArgs = rejectedSpy.mock.calls[0]?.arguments[0] as { to: string; fullName?: string | null };
    assert.ok(callArgs, "sendAccountRejectedEmail must receive an argument");
    assert.equal(
      callArgs.to,
      freshPending.email,
      `sendAccountRejectedEmail must be called with the user's email — got: ${callArgs.to}`
    );
  });

  test("sendAccountRejectedEmail is NOT called when sendEmail=false", async (t) => {
    // Seed another fresh pending user
    const [noemailPending] = await db
      .insert(users)
      .values({
        email: `eu_${RUN_ID}_noemail_pending@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "No Email Pending",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.allUserIds.push(noemailPending.id);

    const rejectedSpy = t.mock.method(emailService, "sendAccountRejectedEmail", async () => {});

    const req = makeRequest(
      `/api/admin/users/${noemailPending.id}/reject`,
      "POST",
      { sendEmail: false },
      seed.adminToken
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: String(noemailPending.id) }) });

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(
      rejectedSpy.mock.callCount(),
      0,
      `sendAccountRejectedEmail must NOT be called when sendEmail=false`
    );
  });

  test("sendAccountRejectedEmail is NOT called for a non-pending (active) user — 400 guard", async (t) => {
    const rejectedSpy = t.mock.method(emailService, "sendAccountRejectedEmail", async () => {});

    const req = makeRequest(
      `/api/admin/users/${seed.activeId}/reject`,
      "POST",
      {},
      seed.adminToken
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: String(seed.activeId) }) });

    assert.equal(res.status, 400, `Expected 400 for non-pending user, got ${res.status}`);
    assert.equal(
      rejectedSpy.mock.callCount(),
      0,
      `sendAccountRejectedEmail must NOT be called for a non-pending user`
    );
  });
});
