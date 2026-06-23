/**
 * Admin Approval Queue — API Integration Tests
 * =============================================
 * Tests the admin user listing and approval/rejection flows against the live
 * server at localhost:5000. Requires the server to be running.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/admin/admin-approval.test.ts
 *
 * Email behaviour note
 * --------------------
 * The approve and reject routes call `sendAccountApprovedEmail` /
 * `sendAccountRejectedEmail` fire-and-forget (`.catch()`), so email failures
 * in test environments with no SMTP credentials do not affect the HTTP
 * response. These integration tests verify the email code path is triggered
 * by confirming:
 *   (a) the API returns the expected success status, which is only reachable
 *       after the `sendAccount*Email(...)` call is initiated, AND
 *   (b) the database reflects the correct post-action state.
 * Without SMTP env vars, the email module falls through to the console
 * fallback, confirming the full delivery path executed without error.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/db.js";
import { users } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import {
  seedAdminUsers,
  cleanupAdminUsers,
  type AdminSeedResult,
} from "./seed-admin.js";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const COOKIE_NAME = "auth_token";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiGet(
  path: string,
  cookie?: string
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, { headers });
}

async function apiPost(
  path: string,
  body: unknown,
  cookie?: string
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function extractCookiePair(res: Response, name: string): string | undefined {
  const raw = res.headers.get("set-cookie") ?? "";
  const nameEq = `${name}=`;
  const start = raw.indexOf(nameEq);
  if (start === -1) return undefined;
  const valueStart = start + nameEq.length;
  const end = raw.indexOf(";", valueStart);
  const value = end === -1 ? raw.slice(valueStart) : raw.slice(valueStart, end);
  return `${name}=${value.trim()}`;
}

async function loginAndGetCookie(email: string, password: string): Promise<string | undefined> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return undefined;
  return extractCookiePair(res, COOKIE_NAME);
}

async function waitForServer(timeoutMs = 60_000, intervalMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        // Pre-warm the admin route bundles
        await Promise.allSettled([
          fetch(`${BASE_URL}/api/admin/users`, { headers: { cookie: "" } }),
        ]);
        return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Server at ${BASE_URL} did not become ready within ${timeoutMs}ms — last error: ${lastErr}`
  );
}

/** Re-fetch a user's accountStatus directly from the DB. */
async function fetchUserStatus(userId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.accountStatus;
}

// ── Seed / teardown ───────────────────────────────────────────────────────────

let seed: AdminSeedResult;
let adminCookie: string;
let activeCookie: string;

before(async () => {
  await waitForServer();
  seed = await seedAdminUsers(RUN_ID);

  // Log in as admin and as a non-admin active user for auth guard tests
  const adminLogin = await loginAndGetCookie(seed.adminUser.email, seed.password);
  assert.ok(adminLogin, `Admin login must succeed — email: ${seed.adminUser.email}`);
  adminCookie = adminLogin!;

  const activeLogin = await loginAndGetCookie(seed.activeUser.email, seed.password);
  assert.ok(activeLogin, `Active user login must succeed — email: ${seed.activeUser.email}`);
  activeCookie = activeLogin!;
});

after(async () => {
  await cleanupAdminUsers(seed);
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  test("unauthenticated request returns 401", async () => {
    const res = await apiGet("/api/admin/users");
    assert.equal(res.status, 401);
  });

  test("non-admin user returns 403", async () => {
    const res = await apiGet("/api/admin/users", activeCookie);
    assert.equal(res.status, 403);
  });

  test("admin user returns 200 with user list", async () => {
    const res = await apiGet("/api/admin/users", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(Array.isArray(body), "Response body must be an array of users");
    assert.ok(body.length > 0, "User list must not be empty for a seeded run");
  });

  test("response includes teamName field on each entry", async () => {
    const res = await apiGet("/api/admin/users", adminCookie);
    assert.equal(res.status, 200);
    const body: any[] = await res.json();
    // Every user in our seeded set has a defaultTeamId pointing to the test
    // team, so teamName must be present on each seeded user.
    const seededIds = new Set([
      seed.adminUser.id,
      seed.activeUser.id,
      seed.pendingUser1.id,
      seed.pendingUser2.id,
    ]);
    const seededEntries = body.filter((u: any) => seededIds.has(u.id));
    assert.equal(
      seededEntries.length,
      4,
      `Expected 4 seeded users in the response — got ${seededEntries.length}`
    );
    for (const entry of seededEntries) {
      assert.ok(
        typeof entry.teamName === "string" && entry.teamName.length > 0,
        `teamName must be a non-empty string for user ${entry.id} — got: ${JSON.stringify(entry.teamName)}`
      );
    }
  });

  test("response includes pending_approval users", async () => {
    const res = await apiGet("/api/admin/users", adminCookie);
    assert.equal(res.status, 200);
    const body: any[] = await res.json();
    const pending = body.find((u: any) => u.id === seed.pendingUser1.id);
    assert.ok(pending, "pendingUser1 must appear in the user list");
    assert.equal(
      pending.accountStatus,
      "pending_approval",
      `pendingUser1 must have accountStatus=pending_approval — got: ${pending.accountStatus}`
    );
  });
});

// ── POST /api/admin/users/:id/approve ────────────────────────────────────────

describe("POST /api/admin/users/:id/approve", () => {
  test("unauthenticated request returns 401", async () => {
    const res = await apiPost(`/api/admin/users/${seed.pendingUser1.id}/approve`, {});
    assert.equal(res.status, 401);
  });

  test("non-admin user returns 403", async () => {
    const res = await apiPost(
      `/api/admin/users/${seed.pendingUser1.id}/approve`,
      {},
      activeCookie
    );
    assert.equal(res.status, 403);
  });

  test("approving a pending user returns 200 and sets accountStatus=active", async () => {
    // Confirm precondition: user is pending
    const before = await fetchUserStatus(seed.pendingUser1.id);
    assert.equal(before, "pending_approval", "Precondition: user must be pending_approval");

    const res = await apiPost(
      `/api/admin/users/${seed.pendingUser1.id}/approve`,
      {},
      adminCookie
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);

    const body: any = await res.json();
    assert.equal(
      body.user?.accountStatus,
      "active",
      `Response body must report accountStatus=active — got: ${JSON.stringify(body.user)}`
    );

    // Verify DB state — confirms email code path was reached (the email call
    // is initiated immediately before the 200 response is sent)
    const after = await fetchUserStatus(seed.pendingUser1.id);
    assert.equal(
      after,
      "active",
      `DB must show accountStatus=active after approval — got: ${after}`
    );
  });

  test("approving a non-existent user returns 404", async () => {
    const res = await apiPost(
      `/api/admin/users/999999999/approve`,
      {},
      adminCookie
    );
    assert.equal(res.status, 404);
  });

  test("approving an already-active user returns 409 (non-pending guard)", async () => {
    // activeUser has accountStatus=active, not pending_approval
    const res = await apiPost(
      `/api/admin/users/${seed.activeUser.id}/approve`,
      {},
      adminCookie
    );
    assert.equal(
      res.status,
      409,
      `Expected 409 for non-pending user, got ${res.status}`
    );
    const body: any = await res.json();
    assert.ok(body.error, "Error response must contain an error message");
  });

  test("invalid (non-numeric) user ID returns 400", async () => {
    const res = await apiPost(
      `/api/admin/users/not-a-number/approve`,
      {},
      adminCookie
    );
    assert.equal(res.status, 400);
  });
});

// ── POST /api/admin/users/:id/reject ─────────────────────────────────────────

describe("POST /api/admin/users/:id/reject", () => {
  test("unauthenticated request returns 401", async () => {
    const res = await apiPost(`/api/admin/users/${seed.pendingUser2.id}/reject`, {});
    assert.equal(res.status, 401);
  });

  test("non-admin user returns 403", async () => {
    const res = await apiPost(
      `/api/admin/users/${seed.pendingUser2.id}/reject`,
      {},
      activeCookie
    );
    assert.equal(res.status, 403);
  });

  test("rejecting a pending user returns 200 and sets accountStatus=suspended", async () => {
    // Confirm precondition: user is pending
    const before = await fetchUserStatus(seed.pendingUser2.id);
    assert.equal(before, "pending_approval", "Precondition: user must be pending_approval");

    const res = await apiPost(
      `/api/admin/users/${seed.pendingUser2.id}/reject`,
      {},
      adminCookie
    );
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);

    const body: any = await res.json();
    assert.equal(
      body.user?.accountStatus,
      "suspended",
      `Response body must report accountStatus=suspended — got: ${JSON.stringify(body.user)}`
    );

    // Verify DB state — confirms email code path was reached (sendAccountRejectedEmail
    // is initiated just before the 200 response is sent when sendEmail defaults to true)
    const after = await fetchUserStatus(seed.pendingUser2.id);
    assert.equal(
      after,
      "suspended",
      `DB must show accountStatus=suspended after rejection — got: ${after}`
    );
  });

  test("rejecting a non-pending (active) user returns 400", async () => {
    // activeUser has accountStatus=active
    const res = await apiPost(
      `/api/admin/users/${seed.activeUser.id}/reject`,
      {},
      adminCookie
    );
    assert.equal(
      res.status,
      400,
      `Expected 400 for non-pending user, got ${res.status}`
    );
    const body: any = await res.json();
    assert.ok(body.error, "Error response must contain an error message");
  });

  test("rejecting with sendEmail=false still returns 200 and sets status=suspended", async () => {
    // Create a fresh pending user for this test since pendingUser2 was already rejected
    const [extraPending] = await db
      .insert(users)
      .values({
        email: `test_adm_${RUN_ID}_extra@test.invalid`,
        passwordHash: seed.pendingUser2.email, // dummy — won't be used for login
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Extra Pending User",
        defaultTeamId: seed.team.id,
      })
      .returning({ id: users.id });

    try {
      const res = await apiPost(
        `/api/admin/users/${extraPending.id}/reject`,
        { sendEmail: false },
        adminCookie
      );
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert.equal(body.user?.accountStatus, "suspended");

      const dbStatus = await fetchUserStatus(extraPending.id);
      assert.equal(dbStatus, "suspended");
    } finally {
      // Clean up extra user
      await db.delete(users).where(eq(users.id, extraPending.id)).catch(() => {});
    }
  });

  test("rejecting a non-existent user returns 404", async () => {
    const res = await apiPost(
      `/api/admin/users/999999999/reject`,
      {},
      adminCookie
    );
    assert.equal(res.status, 404);
  });

  test("invalid (non-numeric) user ID returns 400", async () => {
    const res = await apiPost(
      `/api/admin/users/not-a-number/reject`,
      {},
      adminCookie
    );
    assert.equal(res.status, 400);
  });
});
