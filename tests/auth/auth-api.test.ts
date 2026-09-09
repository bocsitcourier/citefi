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
import speakeasy from "speakeasy";
import { seedAuthUsers, cleanupAuthUsers, cleanupSignupUsers, type SeedResult } from "./seed-auth.js";
import { closeDb, systemDb } from "../../lib/db.js";
import {
  errorLogs,
  teams,
  users,
  sessions,
  loginChallenges,
  passwordResets,
  emailVerificationCodes,
  totpSecrets,
} from "../../shared/schema.js";
import { eq, and, isNull, count, desc } from "drizzle-orm";
import { hashPassword, hashToken, verifyTOTPSetupToken } from "../../lib/auth.js";

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

function bearerFromCookiePair(cookie: string): string {
  return `Bearer ${cookie.slice(cookie.indexOf("=") + 1)}`;
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
 * Poll the mounted /api/auth/me route until the server responds with its
 * expected unauthenticated status. Production-readiness health can
 * intentionally be 503 in development when external certification inputs are
 * absent, and Next 16 returns 404 (not 405) for GET on POST-only routes.
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
      const res = await fetch(`${BASE_URL}/api/auth/me`, { method: "GET" });
      if (res.status === 401) {
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

let seed!: SeedResult;

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
  try {
    if (seed) await cleanupAuthUsers(seed);
    await cleanupSignupUsers(signupCreatedIds);
  } finally {
    await closeDb();
  }
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

  test("remember me creates a revocable 90-day session and aligned cookie", async () => {
    const res = await apiPost("/api/auth/login", {
      email: seed.activeUser.email,
      password: seed.password,
      rememberMe: true,
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /auth_token=[^;]+/);
    assert.match(setCookie, /Max-Age=7776000/i);

    const [session] = await systemDb.select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      deviceInfo: sessions.deviceInfo,
    }).from(sessions)
      .where(eq(sessions.userId, seed.activeUser.id))
      .orderBy(desc(sessions.id))
      .limit(1);
    assert.ok(session);
    const lifetimeDays = (session.expiresAt.getTime() - session.createdAt.getTime()) / 86_400_000;
    assert.ok(lifetimeDays >= 89.9 && lifetimeDays <= 90.1, `expected 90-day lifetime, got ${lifetimeDays}`);
    assert.equal((session.deviceInfo as any)?.rememberedSession, true);
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

  test("expired administrator MFA grace period blocks privileged routes", async () => {
    const cookie = await loginAndGetCookie(
      seed.adminUser.email,
      seed.password,
      "198.51.100.212",
    );
    assert.ok(cookie);
    await systemDb.update(users)
      .set({ mfaEnrollmentDeadline: new Date(Date.now() - 60_000) })
      .where(eq(users.id, seed.adminUser.id));
    try {
      const res = await apiGet("/api/admin/users", cookie);
      assert.equal(res.status, 403);
    } finally {
      await systemDb.update(users)
        .set({ mfaEnrollmentDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) })
        .where(eq(users.id, seed.adminUser.id));
    }
  });

  test("missing administrator MFA policy state fails closed", async () => {
    const cookie = await loginAndGetCookie(
      seed.adminUser.email,
      seed.password,
      "198.51.100.213",
    );
    assert.ok(cookie);
    await systemDb.update(users)
      .set({ mfaEnrollmentDeadline: null })
      .where(eq(users.id, seed.adminUser.id));
    try {
      const res = await apiGet("/api/admin/users", cookie);
      assert.equal(res.status, 403);
    } finally {
      await systemDb.update(users)
        .set({ mfaEnrollmentDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) })
        .where(eq(users.id, seed.adminUser.id));
    }
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

describe("2FA — method-bound challenge concurrency", { concurrency: 1 }, () => {
  test("parallel verification consumes one challenge and creates one session", async () => {
    const login = await apiPost("/api/auth/login", {
      email: seed.twoFaUser.email,
      password: seed.password,
      rememberMe: true,
    }, { "x-forwarded-for": "10.0.0.1, 198.51.100.201" });
    assert.equal(login.status, 200);
    const loginBody: any = await login.json();
    assert.equal(loginBody.twoFactorMethod, "email");
    assert.ok(loginBody.challengeToken);

    // Email delivery is exercised by login; replace only the stored hash with a
    // deterministic code so this integration test can complete without reading
    // or logging the delivered OTP.
    const code = "483921";
    await systemDb.update(loginChallenges)
      .set({ emailCodeHash: hashToken(code) })
      .where(and(
        eq(loginChallenges.userId, seed.twoFaUser.id),
        isNull(loginChallenges.consumedAt)
      ));
    const [{ n: sessionsBefore } = { n: 0 }] = await systemDb
      .select({ n: count() }).from(sessions)
      .where(eq(sessions.userId, seed.twoFaUser.id));

    const verify = (ip: string) => apiPost("/api/auth/verify-2fa", {
      code,
      challengeToken: loginBody.challengeToken,
      // Must be ignored: the server-selected challenge method is authoritative.
      method: "totp",
      userId: seed.adminUser.id,
    }, { "x-forwarded-for": `10.0.0.1, ${ip}` });
    const responses = await Promise.all([
      verify("198.51.100.202"),
      verify("198.51.100.203"),
    ]);
    assert.deepEqual(responses.map((res) => res.status).sort(), [200, 401]);

    const [{ n: sessionsAfter } = { n: 0 }] = await systemDb
      .select({ n: count() }).from(sessions)
      .where(eq(sessions.userId, seed.twoFaUser.id));
    assert.equal(sessionsAfter - sessionsBefore, 1);
    const [session] = await systemDb.select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      deviceInfo: sessions.deviceInfo,
    }).from(sessions)
      .where(eq(sessions.userId, seed.twoFaUser.id))
      .orderBy(desc(sessions.id))
      .limit(1);
    assert.ok(session);
    const lifetimeDays = (session.expiresAt.getTime() - session.createdAt.getTime()) / 86_400_000;
    assert.ok(lifetimeDays >= 89.9 && lifetimeDays <= 90.1, `expected 90-day 2FA session, got ${lifetimeDays}`);
    assert.equal((session.deviceInfo as any)?.rememberedSession, true);
  });

  test("suspension after password challenge prevents session issuance", async () => {
    const login = await apiPost("/api/auth/login", {
      email: seed.twoFaUser.email,
      password: seed.password,
    }, { "x-forwarded-for": "10.0.0.1, 198.51.100.204" });
    assert.equal(login.status, 200);
    const body: any = await login.json();
    const code = "739215";
    await systemDb.update(loginChallenges).set({ emailCodeHash: hashToken(code) })
      .where(and(eq(loginChallenges.userId, seed.twoFaUser.id), isNull(loginChallenges.consumedAt)));
    await systemDb.update(users).set({ accountStatus: "suspended" })
      .where(eq(users.id, seed.twoFaUser.id));
    try {
      const result = await apiPost("/api/auth/verify-2fa", {
        code,
        challengeToken: body.challengeToken,
      }, { "x-forwarded-for": "10.0.0.1, 198.51.100.205" });
      assert.equal(result.status, 401);
    } finally {
      await systemDb.update(users).set({ accountStatus: "active" })
        .where(eq(users.id, seed.twoFaUser.id));
    }
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

// ── Explicit privileged route scopes ─────────────────────────────────────────

describe("Explicit system-scoped lifecycle routes", { concurrency: 1 }, () => {
  test("authenticated client error screenshot can create its system error row", async () => {
    const cookie = await loginAndGetCookie(seed.activeUser.email, seed.password);
    assert.ok(cookie, "Active user login must succeed");

    const form = new FormData();
    form.append(
      "screenshot",
      new Blob(
        [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
        { type: "image/png" }
      ),
      "tenant-scope-test.png"
    );
    form.append("errorMessage", `Tenant scope route test ${RUN_ID}`);
    form.append("pageUrl", "/tenant-scope-test");

    const res = await fetch(`${BASE_URL}/api/client/error-screenshot`, {
      method: "POST",
      headers: { authorization: bearerFromCookiePair(cookie) },
      body: form,
    });
    assert.equal(res.status, 200, `Expected screenshot route 200, got ${res.status}`);
    const body: any = await res.json();
    assert.equal(typeof body.errorLogId, "number");

    const [row] = await systemDb
      .select({ screenshotUrl: errorLogs.screenshotUrl })
      .from(errorLogs)
      .where(eq(errorLogs.id, body.errorLogId))
      .limit(1);
    assert.ok(row, "System error row must be persisted");

    await systemDb.delete(errorLogs).where(eq(errorLogs.id, body.errorLogId));

    if (
      row.screenshotUrl?.startsWith("[private]") &&
      process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID
    ) {
      const { objectStorageClient } = await import("../../lib/storage.js");
      const objectName = `.private/${row.screenshotUrl.slice("[private]".length)}`;
      await objectStorageClient
        .bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID)
        .file(objectName)
        .delete()
        .catch(() => {});
    }
  });

  test("password reset atomically revokes sessions and pending login challenges", async () => {
    const resetToken = `reset-${RUN_ID}-${"x".repeat(40)}`;
    const replacementPassword = `Replacement-${RUN_ID}-Password!`;
    await systemDb.insert(passwordResets).values({
      userId: seed.twoFaUser.id,
      tokenHash: hashToken(resetToken),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      resetType: "self_service",
    });
    const [preexistingEmailReset] = await systemDb.insert(emailVerificationCodes).values({
      userId: seed.twoFaUser.id,
      code: "194827",
      purpose: "password_reset",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning({ id: emailVerificationCodes.id });
    const preResetSessionToken = `session-${RUN_ID}-${"y".repeat(40)}`;
    const [preResetSession] = await systemDb.insert(sessions).values({
      userId: seed.twoFaUser.id,
      tokenHash: hashToken(preResetSessionToken),
      ipAddress: "198.51.100.230",
      userAgent: "auth-reset-test",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      authAssurance: "mfa",
      mfaVerifiedAt: new Date(),
    }).returning({ id: sessions.id });
    assert.ok(preResetSession);

    const challenged = await apiPost(
      "/api/auth/login",
      { email: seed.twoFaUser.email, password: seed.password },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.230" },
    );
    assert.equal(challenged.status, 200);
    const challengedBody: any = await challenged.json();
    assert.equal(challengedBody.requiresTwoFactor, true);

    const applied = await apiPost(
      "/api/auth/reset-password-token",
      { token: resetToken, newPassword: replacementPassword },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.231" },
    );
    assert.equal(applied.status, 200);

    const [revoked] = await systemDb.select({
      active: sessions.isActive,
      reason: sessions.terminationReason,
    }).from(sessions).where(eq(sessions.id, preResetSession.id)).limit(1);
    assert.equal(revoked?.active, 0);
    assert.equal(revoked?.reason, "Password reset completed");
    const pendingChallenges = await systemDb.select({ id: loginChallenges.id })
      .from(loginChallenges)
      .where(and(
        eq(loginChallenges.userId, seed.twoFaUser.id),
        isNull(loginChallenges.consumedAt),
      ));
    assert.equal(pendingChallenges.length, 0);
    const [invalidatedEmailReset] = await systemDb.select({ isUsed: emailVerificationCodes.isUsed })
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.id, preexistingEmailReset!.id))
      .limit(1);
    assert.equal(invalidatedEmailReset?.isUsed, 1);

    const oldPasswordLogin = await apiPost(
      "/api/auth/login",
      { email: seed.twoFaUser.email, password: seed.password },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.232" },
    );
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await apiPost(
      "/api/auth/login",
      { email: seed.twoFaUser.email, password: replacementPassword },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.233" },
    );
    assert.equal(newPasswordLogin.status, 200);
  });

  test("email-code password reset is one-time and revokes sessions and challenges", async () => {
    const cookie = await loginAndGetCookie(
      seed.activeUser.email,
      seed.password,
      "198.51.100.234",
    );
    assert.ok(cookie);
    const [activeSession] = await systemDb.select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, seed.activeUser.id))
      .orderBy(desc(sessions.id))
      .limit(1);
    assert.ok(activeSession);

    const challengeToken = `code-reset-challenge-${RUN_ID}`;
    const [challenge] = await systemDb.insert(loginChallenges).values({
      tokenHash: hashToken(challengeToken),
      userId: seed.activeUser.id,
      method: "email",
      emailCodeHash: hashToken("test-email-code"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning({ id: loginChallenges.id });
    const code = "847263";
    await systemDb.insert(emailVerificationCodes).values({
      userId: seed.activeUser.id,
      code,
      purpose: "password_reset",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const displacedResetToken = `displaced-reset-${RUN_ID}-${"z".repeat(32)}`;
    const [displacedReset] = await systemDb.insert(passwordResets).values({
      userId: seed.activeUser.id,
      tokenHash: hashToken(displacedResetToken),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      resetType: "self_service",
    }).returning({ id: passwordResets.id });
    const replacementPassword = `Code-Reset-${RUN_ID}!A1`;

    const applied = await apiPost(
      "/api/auth/reset-password",
      { email: seed.activeUser.email, code, newPassword: replacementPassword },
      { "x-forwarded-for": "10.0.0.1, 198.51.100.235" },
    );
    assert.equal(applied.status, 200);
    const [revokedSession] = await systemDb.select({
      active: sessions.isActive,
      reason: sessions.terminationReason,
    }).from(sessions).where(eq(sessions.id, activeSession.id)).limit(1);
    assert.equal(revokedSession?.active, 0);
    assert.equal(revokedSession?.reason, "Password reset");
    const [consumedChallenge] = await systemDb.select({
      consumedAt: loginChallenges.consumedAt,
    }).from(loginChallenges).where(eq(loginChallenges.id, challenge!.id)).limit(1);
    assert.ok(consumedChallenge?.consumedAt);
    const [cancelledReset] = await systemDb.select({ status: passwordResets.status })
      .from(passwordResets)
      .where(eq(passwordResets.id, displacedReset!.id))
      .limit(1);
    assert.equal(cancelledReset?.status, "cancelled");

    const replay = await apiPost(
      "/api/auth/reset-password",
      { email: seed.activeUser.email, code, newPassword: replacementPassword },
      { "x-forwarded-for": "10.0.0.1, 198.51.100.236" },
    );
    assert.equal(replay.status, 400);

    await systemDb.update(users)
      .set({ passwordHash: await hashPassword(seed.password) })
      .where(eq(users.id, seed.activeUser.id));
  });

  test("password change invalidates every pre-existing recovery credential", async () => {
    const cookie = await loginAndGetCookie(
      seed.activeUser.email,
      seed.password,
      "198.51.100.237",
    );
    assert.ok(cookie);

    const code = "573920";
    const [emailReset] = await systemDb.insert(emailVerificationCodes).values({
      userId: seed.activeUser.id,
      code,
      purpose: "password_reset",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning({ id: emailVerificationCodes.id });
    const token = `change-password-reset-${RUN_ID}-${"q".repeat(32)}`;
    const [linkReset] = await systemDb.insert(passwordResets).values({
      userId: seed.activeUser.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      resetType: "self_service",
    }).returning({ id: passwordResets.id });
    const changedPassword = `Changed-${RUN_ID}-Password!`;

    const changed = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: "POST",
      headers: {
        authorization: bearerFromCookiePair(cookie),
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.1, 198.51.100.238",
      },
      body: JSON.stringify({
        currentPassword: seed.password,
        newPassword: changedPassword,
      }),
    });
    assert.equal(changed.status, 200);

    const [invalidatedCode] = await systemDb.select({ isUsed: emailVerificationCodes.isUsed })
      .from(emailVerificationCodes)
      .where(eq(emailVerificationCodes.id, emailReset!.id))
      .limit(1);
    assert.equal(invalidatedCode?.isUsed, 1);
    const [cancelledLink] = await systemDb.select({ status: passwordResets.status })
      .from(passwordResets)
      .where(eq(passwordResets.id, linkReset!.id))
      .limit(1);
    assert.equal(cancelledLink?.status, "cancelled");

    const codeReplay = await apiPost(
      "/api/auth/reset-password",
      { email: seed.activeUser.email, code, newPassword: `Replay-${RUN_ID}-Password!` },
      { "x-forwarded-for": "10.0.0.1, 198.51.100.239" },
    );
    assert.equal(codeReplay.status, 400);
    const linkReplay = await apiPost(
      "/api/auth/reset-password-token",
      { token, newPassword: `Replay-${RUN_ID}-Password!` },
      { "x-forwarded-for": "10.0.0.1, 198.51.100.240" },
    );
    assert.equal(linkReplay.status, 400);

    await systemDb.update(users)
      .set({ passwordHash: await hashPassword(seed.password) })
      .where(eq(users.id, seed.activeUser.id));
  });

  test("self-service account deletion can remove the authenticated user", async () => {
    const fakeSubscriptionId = `sub_account_delete_guard_${RUN_ID}`;
    await systemDb
      .update(teams)
      .set({
        stripeSubscriptionId: fakeSubscriptionId,
        billingStatus: "active",
      })
      .where(eq(teams.id, seed.team.id));

    const cookie = await loginAndGetCookie(seed.activeUser.email, seed.password);
    assert.ok(cookie, "Active user login must succeed");

    const rejected = await fetch(`${BASE_URL}/api/account/delete`, {
      method: "POST",
      headers: {
        authorization: bearerFromCookiePair(cookie),
        "content-type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "wrong-password" }),
    });
    assert.equal(rejected.status, 403);
    const [stillPresent] = await systemDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, seed.activeUser.id))
      .limit(1);
    assert.ok(stillPresent, "Wrong password must not delete the account");

    const res = await fetch(`${BASE_URL}/api/account/delete`, {
      method: "POST",
      headers: {
        authorization: bearerFromCookiePair(cookie),
        "content-type": "application/json",
      },
      body: JSON.stringify({ currentPassword: seed.password }),
    });
    const body: any = await res.json();
    assert.equal(
      res.status,
      200,
      `Expected account deletion 200, got ${res.status}: ${JSON.stringify(body)}`
    );

    const deleted = await systemDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, seed.activeUser.id));
    assert.equal(deleted.length, 0, "Deleted user must no longer exist");

    const [sharedTeam] = await systemDb
      .select({
        stripeSubscriptionId: teams.stripeSubscriptionId,
        billingStatus: teams.billingStatus,
      })
      .from(teams)
      .where(eq(teams.id, seed.team.id))
      .limit(1);
    assert.ok(sharedTeam, "The shared team must survive a member deleting their account");
    assert.equal(
      sharedTeam.stripeSubscriptionId,
      fakeSubscriptionId,
      "A member deleting their account must not cancel the shared subscription"
    );
    assert.equal(sharedTeam.billingStatus, "active");
  });
});

describe("Google Authenticator step-up security", { concurrency: 1 }, () => {
  test("encrypted setup, one-time recovery, replay defense, and protected disable", async () => {
    const cookie = await loginAndGetCookie(seed.adminUser.email, seed.password);
    assert.ok(cookie, "Admin login must succeed");
    const authorization = bearerFromCookiePair(cookie);

    const unverifiedSetup = await apiPost(
      "/api/auth/setup-totp",
      { action: "generate" },
      { authorization }
    );
    assert.equal(unverifiedSetup.status, 401);

    const setup = await apiPost(
      "/api/auth/setup-totp",
      { action: "generate", currentPassword: seed.password },
      { authorization }
    );
    assert.equal(setup.status, 200);
    const setupBody: any = await setup.json();
    assert.ok(setupBody.setupToken);
    assert.equal(setupBody.secret, undefined, "raw secret must not be accepted back from the client");
    const signedSetup = verifyTOTPSetupToken(setupBody.setupToken);
    assert.ok(signedSetup && signedSetup.userId === seed.adminUser.id);

    // Use the previous accepted window so the later disable step can use a
    // strictly newer counter. Avoid crossing a 30-second boundary between
    // generation and verification, which would make the previous code two
    // windows old and turn this security test into a clock-boundary flake.
    const secondsIntoTotpWindow = Math.floor(Date.now() / 1000) % 30;
    if (secondsIntoTotpWindow >= 25) {
      await new Promise((resolve) =>
        setTimeout(resolve, (31 - secondsIntoTotpWindow) * 1000)
      );
    }
    const code = speakeasy.totp({
      secret: signedSetup.secret,
      encoding: "base32",
      time: Math.floor(Date.now() / 1000) - 30,
    });
    const activate = await apiPost(
      "/api/auth/setup-totp",
      { action: "verify", setupToken: setupBody.setupToken, verificationCode: code },
      { authorization }
    );
    assert.equal(activate.status, 200);
    const activateBody: any = await activate.json();
    assert.equal(activateBody.backupCodes.length, 10);

    const [enabled] = await systemDb.select({
      enabled: users.twoFactorEnabled,
      method: users.twoFactorMethod,
      storedSecret: totpSecrets.secret,
      ciphertext: totpSecrets.secretCiphertext,
      keyVersion: totpSecrets.secretKeyVersion,
      lastUsedCounter: totpSecrets.lastUsedCounter,
    }).from(users)
      .innerJoin(totpSecrets, eq(totpSecrets.userId, users.id))
      .where(eq(users.id, seed.adminUser.id))
      .limit(1);
    assert.equal(enabled?.enabled, 1);
    assert.equal(enabled?.method, "totp");
    assert.equal(enabled?.storedSecret, "encrypted");
    assert.ok(enabled?.ciphertext);
    assert.equal(enabled?.keyVersion, "v1");
    assert.equal(typeof enabled?.lastUsedCounter, "number");

    const replaySetup = await apiPost(
      "/api/auth/setup-totp",
      { action: "verify", setupToken: setupBody.setupToken, verificationCode: code },
      { authorization }
    );
    assert.equal(replaySetup.status, 409, "setup challenge must be single-use");

    const recoveryLogin = await apiPost(
      "/api/auth/login",
      { email: seed.adminUser.email, password: seed.password },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.221" }
    );
    const recoveryLoginBody: any = await recoveryLogin.json();
    assert.equal(recoveryLogin.status, 200);
    assert.equal(recoveryLoginBody.requiresTwoFactor, true);
    const recoveryVerify = await apiPost(
      "/api/auth/verify-2fa",
      {
        challengeToken: recoveryLoginBody.challengeToken,
        code: activateBody.backupCodes[0],
      },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.222" }
    );
    assert.equal(recoveryVerify.status, 200, "a saved recovery code must complete login");

    const replayLogin = await apiPost(
      "/api/auth/login",
      { email: seed.adminUser.email, password: seed.password },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.223" }
    );
    const replayLoginBody: any = await replayLogin.json();
    const recoveryReplay = await apiPost(
      "/api/auth/verify-2fa",
      {
        challengeToken: replayLoginBody.challengeToken,
        code: activateBody.backupCodes[0],
      },
      { "x-forwarded-for": "10.0.0.1, 192.0.2.224" }
    );
    assert.equal(recoveryReplay.status, 401, "a recovery code must work exactly once");

    const unverifiedDisable = await apiPost(
      "/api/auth/disable-totp",
      {},
      { authorization }
    );
    assert.equal(unverifiedDisable.status, 401);

    const currentCode = speakeasy.totp({
      secret: signedSetup.secret,
      encoding: "base32",
    });
    const disable = await apiPost(
      "/api/auth/disable-totp",
      { currentPassword: seed.password, verificationCode: currentCode },
      { authorization }
    );
    assert.equal(disable.status, 200);

    const [disabled] = await systemDb.select({
      enabled: users.twoFactorEnabled,
      method: users.twoFactorMethod,
    }).from(users).where(eq(users.id, seed.adminUser.id)).limit(1);
    assert.equal(disabled?.enabled, 0);
    assert.equal(disabled?.method, null);
    const secrets = await systemDb.select({ id: totpSecrets.id })
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, seed.adminUser.id));
    assert.equal(secrets.length, 0);
  });
});
