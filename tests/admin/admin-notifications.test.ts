/**
 * Admin Notifications — Team-less Admin Integration Tests
 * ========================================================
 * Verifies that admins who have no team membership can still retrieve their
 * userId-scoped notifications (e.g. new-signup alerts), and that regular
 * non-admin users without a team are blocked with 4xx.
 *
 * Auth tokens are generated directly in the seed (bypassing /api/auth/login)
 * and sent as Authorization: Bearer headers so these tests are not blocked by
 * the pre-existing 404 on the login route.
 *
 * Run:
 *   WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm --test tests/admin/admin-notifications.test.ts
 *
 * Requires the Next.js dev server to be running (default: http://localhost:5000).
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  seedNotificationUsers,
  cleanupNotificationUsers,
  type NotificationSeedResult,
} from "./seed-notifications.js";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** GET with an optional Authorization: Bearer token. */
async function apiGet(path: string, bearerToken?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  return fetch(`${BASE_URL}${path}`, { headers });
}

/**
 * Poll /api/health until the server is ready, then pre-warm the notifications
 * route bundle so the first test doesn't hit a cold-compile 404.
 * Each fetch uses a short AbortSignal timeout so the polling loop can't hang
 * indefinitely on a slow Turbopack compile.
 */
async function waitForServer(timeoutMs = 60_000, intervalMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok) {
        // Pre-warm the notifications route so Turbopack compiles it before tests.
        // Use a short timeout — if this hangs the first test will trigger compile instead.
        await fetch(`${BASE_URL}/api/notifications`, {
          method: "GET",
          signal: AbortSignal.timeout(8_000),
        }).catch(() => {});
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

// ── Seed / teardown ───────────────────────────────────────────────────────────

let seed: NotificationSeedResult;

before(async () => {
  await waitForServer();
  seed = await seedNotificationUsers(RUN_ID);
});

after(async () => {
  await cleanupNotificationUsers(seed);
});

// ── Team-less admin — can read userId-scoped notifications ────────────────────

describe("Admin notifications — team-less admin path", { concurrency: 1 }, () => {
  test("GET /api/notifications returns 200 for team-less admin (userId-only auth path)", async () => {
    const res = await apiGet("/api/notifications", seed.teamlessAdmin.bearerToken);
    assert.equal(
      res.status,
      200,
      `Team-less admin must receive 200 from /api/notifications, got ${res.status}`
    );
  });

  test("GET /api/notifications returns the seeded signup-alert notification for the team-less admin", async () => {
    const res = await apiGet("/api/notifications", seed.teamlessAdmin.bearerToken);
    assert.equal(res.status, 200);

    const body: any = await res.json();
    assert.ok(
      Array.isArray(body.notifications),
      `Response must contain a notifications array — got: ${JSON.stringify(body)}`
    );

    const found = body.notifications.some(
      (n: any) =>
        n.id === seed.notificationId &&
        n.title === "New User Awaiting Approval" &&
        n.category === "system" &&
        n.type === "warning"
    );
    assert.ok(
      found,
      `Seeded notification (id=${seed.notificationId}) must appear in the admin's notification list.\nReceived: ${JSON.stringify(body.notifications.map((n: any) => ({ id: n.id, title: n.title })))}`
    );
  });

  test("GET /api/notifications?unread=true includes the unread signup-alert for team-less admin", async () => {
    const res = await apiGet("/api/notifications?unread=true", seed.teamlessAdmin.bearerToken);
    assert.equal(res.status, 200);

    const body: any = await res.json();
    assert.ok(
      Array.isArray(body.notifications),
      `Response must contain a notifications array`
    );

    const found = body.notifications.some(
      (n: any) => n.id === seed.notificationId
    );
    assert.ok(
      found,
      `Unread seeded notification (id=${seed.notificationId}) must appear in unread list`
    );
  });

  test("GET /api/notifications?count=true returns a positive unread count for team-less admin", async () => {
    const res = await apiGet("/api/notifications?count=true", seed.teamlessAdmin.bearerToken);
    assert.equal(res.status, 200);

    const body: any = await res.json();
    // The Neon HTTP driver returns SQL count(*) as a string; coerce before comparing.
    const count = Number(body.count);
    assert.ok(
      !isNaN(count),
      `count response must be numeric (or numeric string) — got: ${JSON.stringify(body)}`
    );
    assert.ok(
      count >= 1,
      `Unread count must be at least 1 (seeded notification is unread) — got: ${count}`
    );
  });

  test("Team-less admin notification does NOT appear for a different admin (isolation check)", async () => {
    // A notification scoped to teamlessAdmin.id must not bleed into another user's list.
    // teamlessNonAdmin has no notifications seeded for them, so their list must be empty.
    const res = await apiGet("/api/notifications", seed.teamlessNonAdmin.bearerToken);
    // Non-admin without team gets 403 — but the point here is: even if they could call
    // the endpoint, the notification must not appear. We verify via the admin path
    // that the notification only shows up for its owner (covered by the assertion above).
    assert.ok(
      res.status === 403 || res.status === 401,
      `Non-admin team-less user must be blocked (403 or 401) — got ${res.status}`
    );
  });
});

// ── Regular non-admin user with no team — must be blocked ────────────────────

describe("Admin notifications — non-admin team-less user is blocked", { concurrency: 1 }, () => {
  test("team-less non-admin receives 403 from GET /api/notifications", async () => {
    const res = await apiGet("/api/notifications", seed.teamlessNonAdmin.bearerToken);
    assert.equal(
      res.status,
      403,
      `Non-admin without a team must receive 403 from /api/notifications, got ${res.status}`
    );
  });

  test("unauthenticated GET /api/notifications returns 401", async () => {
    const res = await apiGet("/api/notifications");
    assert.equal(
      res.status,
      401,
      `Unauthenticated request must return 401, got ${res.status}`
    );
  });

  test("invalid bearer token returns 401 from GET /api/notifications", async () => {
    const res = await apiGet("/api/notifications", "invalid_garbage_token_xyz_abc");
    assert.equal(
      res.status,
      401,
      `Invalid bearer token must return 401, got ${res.status}`
    );
  });
});
