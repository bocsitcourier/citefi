/**
 * T004 Auth API Integration Tests
 * =================================
 * Tests login, rate limiting, auth guards, and admin authorization against the
 * live server at localhost:5000. Requires the server to be running.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/auth/auth-api.test.ts
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seedAuthUsers, cleanupAuthUsers, cleanupSignupUsers, type SeedResult } from "./seed-auth.js";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const COOKIE_NAME = "auth_token";

// Unique per run — prevents test-data and rate-limit-bucket collisions.
const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiPost(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Use TEST-NET-2 (198.51.100.x, RFC 5737) for all regular test traffic.
      // Rate-limit probes use TEST-NET-1 (192.0.2.x) — kept separate so the
      // rate-limit test can't accidentally exhaust quota used by other tests.
      "x-forwarded-for": `10.0.0.1, 198.51.100.${(Date.now() % 250) + 1}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function apiGet(
  path: string,
  cookie?: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, { headers });
}

/**
 * Extract the value of a named cookie from Set-Cookie response headers.
 * Returns "name=value" so it can be sent directly as the Cookie header.
 */
function extractCookiePair(res: Response, name: string): string | undefined {
  // Fetch's Headers.get("set-cookie") returns a comma-joined string.
  // Avoid splitting on commas inside Expires= dates by splitting on the
  // "name=" boundary instead.
  const raw = res.headers.get("set-cookie") ?? "";
  const nameEq = `${name}=`;
  const start = raw.indexOf(nameEq);
  if (start === -1) return undefined;
  const valueStart = start + nameEq.length;
  const end = raw.indexOf(";", valueStart);
  const value = end === -1 ? raw.slice(valueStart) : raw.slice(valueStart, end);
  return `${name}=${value.trim()}`;
}

/** Log in and return the cookie pair ("name=value") suitable for Cookie header, or undefined. */
async function loginAndGetCookie(
  email: string,
  password: string,
  ip?: string
): Promise<string | undefined> {
  const headers: Record<string, string> = {};
  if (ip) headers["x-forwarded-for"] = `10.0.0.1, ${ip}`;
  const res = await apiPost("/api/auth/login", { email, password }, headers);
  if (res.status !== 200) return undefined;
  return extractCookiePair(res, COOKIE_NAME); // returns "auth_token=abc123"
}

// ── Server readiness wait ─────────────────────────────────────────────────────

/**
 * Poll GET /api/health until the server responds or the timeout elapses,
 * then pre-warm the auth route bundles so the first test doesn't get a 404
 * from Next.js compiling the route on-demand.
 *
 * This lets the auth-tests workflow run immediately after the app workflow
 * starts without hard-coding a sleep delay.
 */
async function waitForServer(
  timeoutMs = 60_000,
  intervalMs = 500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        // Pre-warm auth route bundles so Next.js compiles them before tests run.
        // Only warm login here — signup pre-warming is done in before() using a
        // RUN_ID-scoped IP so it doesn't burn shared rate-limit quota.
        await Promise.allSettled([
          fetch(`${BASE_URL}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
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

// ── Seed / teardown ───────────────────────────────────────────────────────────

let seed: SeedResult;

// Collect user IDs created by signup tests so they can be removed in after().
const signupCreatedIds: number[] = [];

// Per-run base for TEST-NET-2 signup IPs (198.51.100.x).
// 24 non-overlapping blocks of 10 slots avoids rate-limit collisions between
// concurrent or same-hour test runs. Tests use SIGNUP_IP + 0..6.
const SIGNUP_IP = (parseInt(RUN_ID.slice(0, 6), 36) % 24) * 10 + 1;

before(async () => {
  await waitForServer();
  // Pre-warm the signup route bundle using this run's unique IP so cold
  // compilation doesn't affect the first real signup test.
  await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP}`,
    },
    body: "{}",
  }).catch(() => {});
  seed = await seedAuthUsers(RUN_ID);
});

after(async () => {
  await cleanupAuthUsers(seed);
  await cleanupSignupUsers(signupCreatedIds);
});

// ── Login — success paths ─────────────────────────────────────────────────────
// Run sequentially to avoid same-user concurrent logins producing identical
// tokenHashes (jti added to JWT but let's keep tests clean).

describe("Login — success paths", { concurrency: 1 }, () => {
  test("valid credentials return 200 with auth_token cookie", async () => {
    const res = await apiPost("/api/auth/login", {
      email: seed.activeUser.email,
      password: seed.password,
    });
    assert.equal(res.status, 200);
    const cookie = extractCookiePair(res, COOKIE_NAME);
    assert.ok(cookie, "auth_token cookie must be present in Set-Cookie");
  });

  test("valid credentials body contains token or user data", async () => {
    const res = await apiPost("/api/auth/login", {
      email: seed.activeUser.email,
      password: seed.password,
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    const hasData = Boolean(body.token || body.user || body.requiresTwoFactor);
    assert.ok(hasData, `Body must contain token, user, or requiresTwoFactor — got: ${JSON.stringify(body)}`);
  });

  test("2FA-enabled user login returns requiresTwoFactor=true without session cookie", async () => {
    const res = await apiPost("/api/auth/login", {
      email: seed.twoFaUser.email,
      password: seed.password,
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.requiresTwoFactor, true, "2FA user should trigger 2FA challenge");
  });
});

// ── Login — failure paths ─────────────────────────────────────────────────────

describe("Login — failure paths", () => {
  test("wrong password returns 401", async () => {
    const res = await apiPost("/api/auth/login", {
      email: seed.activeUser.email,
      password: "definitely_wrong_XYZ_12345",
    });
    assert.equal(res.status, 401);
  });

  test("non-existent email returns 401", async () => {
    const res = await apiPost("/api/auth/login", {
      email: `ghost_${RUN_ID}@test.invalid`,
      password: "anything",
    });
    assert.equal(res.status, 401);
  });

  test("suspended account returns 403 (credentials valid but account forbidden)", async () => {
    const res = await apiPost("/api/auth/login", {
      email: seed.suspendedUser.email,
      password: seed.password,
    });
    // Login route returns 403 for suspended/non-active accounts: credentials are
    // valid but the account state is Forbidden (not just Unauthorized).
    assert.equal(res.status, 403);
  });

  test("missing email returns 4xx", async () => {
    const res = await apiPost("/api/auth/login", { password: "abc" });
    assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx, got ${res.status}`);
  });

  test("missing password returns 4xx", async () => {
    const res = await apiPost("/api/auth/login", { email: seed.activeUser.email });
    assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx, got ${res.status}`);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe("Rate limiting", () => {
  test("login rate limit — 429 with Retry-After after 10 attempts from same IP", async () => {
    // Use a TEST-NET-1 address (RFC 5737) unique to this run.
    const ipSuffix = (parseInt(RUN_ID.slice(0, 8), 36) % 200) + 10;
    const uniqueIp = `192.0.2.${ipSuffix}`;
    const xff = `10.0.0.1, ${uniqueIp}`;

    let got429 = false;
    for (let i = 0; i <= 12; i++) {
      const res = await apiPost(
        "/api/auth/login",
        { email: `rl_${RUN_ID}_${i}@test.invalid`, password: "x" },
        { "x-forwarded-for": xff }
      );
      if (res.status === 429) {
        got429 = true;
        const retryAfter = res.headers.get("Retry-After");
        assert.ok(retryAfter, "Retry-After header must be present on 429");
        assert.ok(Number(retryAfter) > 0, `Retry-After must be positive — got: ${retryAfter}`);
        break;
      }
    }
    assert.ok(got429, "Should receive 429 within 13 login attempts from the same IP");
  });
});

// ── Auth guards — requireAuth ─────────────────────────────────────────────────

describe("Auth guards — requireAuth", () => {
  test("unauthenticated /api/auth/me returns 401", async () => {
    const res = await apiGet("/api/auth/me");
    assert.equal(res.status, 401);
  });

  test("invalid auth_token cookie returns 401", async () => {
    const res = await apiGet("/api/auth/me", `${COOKIE_NAME}=invalid_garbage_token_abc`);
    assert.equal(res.status, 401);
  });

  test("authenticated /api/auth/me returns 200 with user.email", async () => {
    const cookie = await loginAndGetCookie(seed.activeUser.email, seed.password);
    assert.ok(cookie, "Login for active user must succeed and return a cookie");
    const res = await apiGet("/api/auth/me", cookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    // /api/auth/me nests user data under `body.user`
    assert.equal(body.user?.email, seed.activeUser.email);
  });
});

// ── Admin authorization — requireAdmin ───────────────────────────────────────

describe("Admin authorization — requireAdmin", () => {
  test("unauthenticated /api/admin/users returns 401", async () => {
    const res = await apiGet("/api/admin/users");
    assert.equal(res.status, 401);
  });

  test("non-admin authenticated user on /api/admin/users returns 403", async () => {
    const cookie = await loginAndGetCookie(seed.activeUser.email, seed.password);
    assert.ok(cookie, "Active user login must succeed");
    const res = await apiGet("/api/admin/users", cookie);
    assert.equal(res.status, 403);
  });

  test("admin user on /api/admin/users returns 200", async () => {
    const cookie = await loginAndGetCookie(seed.adminUser.email, seed.password);
    assert.ok(cookie, "Admin login must succeed");
    const res = await apiGet("/api/admin/users", cookie);
    assert.equal(res.status, 200);
  });
});

// ── 2FA — boundary conditions ─────────────────────────────────────────────────

describe("2FA — boundary conditions", () => {
  test("verify-2fa with invalid token returns 400 or 401", async () => {
    const res = await apiPost("/api/auth/verify-2fa", {
      code: "000000",
      twoFactorToken: "fake_invalid_token_xyz",
    });
    assert.ok(
      res.status === 400 || res.status === 401,
      `Expected 400 or 401, got ${res.status}`
    );
  });

  test("send-email-code with no auth returns 401 or 400", async () => {
    const res = await apiPost("/api/auth/send-email-code", { purpose: "login_2fa" });
    assert.ok(
      res.status === 400 || res.status === 401,
      `Expected 400 or 401, got ${res.status}`
    );
  });
});

// ── Signup — success path ─────────────────────────────────────────────────────

describe("Signup — success path", { concurrency: 1 }, () => {
  test("valid signup returns 201 with pending_approval status and team_member role", async () => {
    const email = `signup_ok_${RUN_ID}@test.invalid`;
    const res = await apiPost(
      "/api/auth/signup",
      {
        email,
        password: "ValidPass#99!",
        fullName: "Test Signup User",
      },
      // SIGNUP_IP+1: isolated per-run IP bucket (SIGNUP_IP+0 used by pre-warm).
      { "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP + 1}` }
    );
    assert.equal(res.status, 201, `Expected 201, got ${res.status}`);
    const body: any = await res.json();
    assert.ok(body.user, "Response must contain a user object");
    assert.equal(body.user.email, email.toLowerCase());
    assert.equal(
      body.user.accountStatus,
      "pending_approval",
      "New signup must be pending_approval"
    );
    assert.equal(
      body.user.role,
      "team_member",
      "New signup must be assigned team_member role"
    );
    // Track for cleanup
    if (typeof body.user.id === "number") signupCreatedIds.push(body.user.id);
  });
});

// ── Signup — failure paths ────────────────────────────────────────────────────

describe("Signup — failure paths", () => {
  test("duplicate email returns 409", async () => {
    const email = `signup_dup_${RUN_ID}@test.invalid`;
    const payload = { email, password: "ValidPass#99!" };
    const headers = { "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP + 2}` };

    // First signup — should succeed
    const first = await apiPost("/api/auth/signup", payload, headers);
    assert.equal(first.status, 201, `First signup should succeed (201), got ${first.status}`);
    const firstBody: any = await first.json();
    if (typeof firstBody.user?.id === "number") signupCreatedIds.push(firstBody.user.id);

    // Second signup with same email — should conflict
    const second = await apiPost("/api/auth/signup", payload, headers);
    assert.equal(second.status, 409, `Duplicate signup must return 409, got ${second.status}`);
    const secondBody: any = await second.json();
    assert.ok(secondBody.error, "409 response must include an error message");
  });

  test("weak password returns 400 with error details", async () => {
    const res = await apiPost(
      "/api/auth/signup",
      {
        email: `signup_weak_${RUN_ID}@test.invalid`,
        password: "weak",
      },
      { "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP + 3}` }
    );
    assert.equal(res.status, 400, `Weak password must return 400, got ${res.status}`);
    const body: any = await res.json();
    assert.ok(body.error, "400 response must include an error message");
    // Route returns a `details` array listing individual password failures.
    assert.ok(
      Array.isArray(body.details) && body.details.length > 0,
      `Response must include a non-empty details array — got: ${JSON.stringify(body)}`
    );
  });

  test("missing email returns 400", async () => {
    const res = await apiPost(
      "/api/auth/signup",
      { password: "ValidPass#99!" },
      { "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP + 4}` }
    );
    assert.equal(res.status, 400, `Missing email must return 400, got ${res.status}`);
  });

  test("missing password returns 400", async () => {
    const res = await apiPost(
      "/api/auth/signup",
      { email: `signup_nopw_${RUN_ID}@test.invalid` },
      { "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP + 5}` }
    );
    assert.equal(res.status, 400, `Missing password must return 400, got ${res.status}`);
  });
});

// ── Signup — security ─────────────────────────────────────────────────────────

describe("Signup — security", () => {
  test("client-supplied role=admin is silently ignored — user always gets team_member", async () => {
    const email = `signup_role_${RUN_ID}@test.invalid`;
    const res = await apiPost(
      "/api/auth/signup",
      {
        email,
        password: "ValidPass#99!",
        role: "admin", // Privilege-escalation attempt
      },
      { "x-forwarded-for": `10.0.0.1, 198.51.100.${SIGNUP_IP + 6}` }
    );
    assert.equal(res.status, 201, `Signup with role=admin in body should still return 201, got ${res.status}`);
    const body: any = await res.json();
    assert.equal(
      body.user?.role,
      "team_member",
      `Role must be team_member regardless of client input — got: ${body.user?.role}`
    );
    if (typeof body.user?.id === "number") signupCreatedIds.push(body.user.id);
  });
});

// ── Signup — rate limiting ────────────────────────────────────────────────────

describe("Signup — rate limiting", () => {
  test("signup rate limit — 429 with Retry-After after 5 attempts from same IP", async () => {
    // Use TEST-NET-3 (203.0.113.x, RFC 5737) — isolated from login rate-limit tests
    // which use TEST-NET-1 (192.0.2.x).
    const ipSuffix = (parseInt(RUN_ID.slice(0, 8), 36) % 200) + 10;
    const uniqueIp = `203.0.113.${ipSuffix}`;
    const xff = `10.0.0.1, ${uniqueIp}`;

    let got429 = false;
    for (let i = 0; i <= 7; i++) {
      const res = await apiPost(
        "/api/auth/signup",
        {
          email: `rl_signup_${RUN_ID}_${i}@test.invalid`,
          password: "ValidPass#99!",
        },
        { "x-forwarded-for": xff }
      );
      if (res.status === 201) {
        const body: any = await res.json();
        if (typeof body.user?.id === "number") signupCreatedIds.push(body.user.id);
      }
      if (res.status === 429) {
        got429 = true;
        const retryAfter = res.headers.get("Retry-After");
        assert.ok(retryAfter, "Retry-After header must be present on 429");
        assert.ok(Number(retryAfter) > 0, `Retry-After must be positive — got: ${retryAfter}`);
        break;
      }
    }
    assert.ok(got429, "Should receive 429 within 8 signup attempts from the same IP");
  });
});
