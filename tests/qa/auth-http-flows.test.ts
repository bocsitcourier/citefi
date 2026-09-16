/**
 * Authenticated HTTP QA against an owned route-handler fixture.
 *
 * Run exactly (no app server, customer database, provider, or real email):
 *   node --import tsx/esm \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --test-concurrency=1 --test-force-exit --test \
 *     tests/qa/auth-http-flows.test.ts
 *
 * The fixture owns PostgreSQL :55485, Redis :16385, and HTTP :5105. The
 * route handlers are the production handlers; only the SMTP transport is a
 * loopback capture sink.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startAuthHttpFixture, type AuthHttpFixture } from "../../QA/support/auth-http-fixture.js";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "QA!Passw0rd#123";

interface Seed {
  admin: { id: number; email: string };
  member: { id: number; email: string };
  mfaMember: { id: number; email: string };
  notificationSubject: { id: number; email: string };
}

let fixture!: AuthHttpFixture;
let db!: typeof import("../../lib/db.js");
let schema!: typeof import("../../shared/schema.js");
let auth!: typeof import("../../lib/auth.js");
let seed!: Seed;
let adminToken = "";
let memberToken = "";

function setCookiePairs(response: Response): Record<string, string> {
  const header = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = header.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const pairs: Record<string, string> = {};
  for (const value of values) {
    const match = /^([^=;,]+)=([^;]*)/.exec(value.trim());
    if (match) pairs[match[1]!] = match[2]!;
  }
  return pairs;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function tokenFromCookies(cookies: Record<string, string>): string {
  const token = cookies.auth_token;
  assert.ok(token, "auth_token must be present");
  return token;
}

async function api(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${fixture.baseUrl}${path}`, init);
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

async function login(
  email: string,
  rememberMe = false,
): Promise<{ response: Response; body: any; cookies: Record<string, string>; token: string }> {
  const response = await api("/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(RUN_ID.length % 100) + 1}`,
    },
    body: JSON.stringify({ email, password: PASSWORD, rememberMe }),
  });
  const body = await json<any>(response);
  const cookies = setCookiePairs(response);
  return {
    response,
    body,
    cookies,
    token: cookies.auth_token ?? "",
  };
}

async function seedUsers(): Promise<Seed> {
  const passwordHash = await auth.hashPassword(PASSWORD);
  const prefix = `qa_auth_http_${RUN_ID}`;
  const [admin] = await db.systemDb
    .insert(schema.users)
    .values({
      email: `${prefix}_admin@citefi.invalid`,
      passwordHash,
      fullName: "QA HTTP Admin",
      role: "admin",
      accountStatus: "active",
      mfaEnrollmentDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning({ id: schema.users.id, email: schema.users.email });
  const [member] = await db.systemDb
    .insert(schema.users)
    .values({
      email: `${prefix}_member@citefi.invalid`,
      passwordHash,
      fullName: "QA HTTP Member",
      role: "team_member",
      accountStatus: "active",
    })
    .returning({ id: schema.users.id, email: schema.users.email });
  const [mfaMember] = await db.systemDb
    .insert(schema.users)
    .values({
      email: `${prefix}_mfa@citefi.invalid`,
      passwordHash,
      fullName: "QA HTTP MFA Member",
      role: "team_member",
      accountStatus: "active",
      twoFactorEnabled: 1,
      twoFactorMethod: "email",
    })
    .returning({ id: schema.users.id, email: schema.users.email });
  const [notificationSubject] = await db.systemDb
    .insert(schema.users)
    .values({
      email: `${prefix}_pending@citefi.invalid`,
      passwordHash,
      fullName: "QA HTTP Pending Member",
      role: "team_member",
      accountStatus: "pending_approval",
    })
    .returning({ id: schema.users.id, email: schema.users.email });
  if (!admin || !member || !mfaMember || !notificationSubject) {
    throw new Error("Auth HTTP fixture failed to seed all synthetic users");
  }
  return { admin, member, mfaMember, notificationSubject };
}

async function cleanupUsers(): Promise<void> {
  if (!seed) return;
  const userIds = [
    seed.admin.id,
    seed.member.id,
    seed.mfaMember.id,
    seed.notificationSubject.id,
  ];
  // Child rows are explicitly removed because this fixture intentionally uses
  // the source schema rather than a customer database with production cascades.
  await db.systemDb.delete(schema.notifications)
    .where((await import("drizzle-orm")).inArray(schema.notifications.entityId, [seed.notificationSubject.id]));
  await db.systemDb.delete(schema.sessions)
    .where((await import("drizzle-orm")).inArray(schema.sessions.userId, userIds));
  await db.systemDb.delete(schema.loginChallenges)
    .where((await import("drizzle-orm")).inArray(schema.loginChallenges.userId, userIds));
  await db.systemDb.delete(schema.emailVerificationCodes)
    .where((await import("drizzle-orm")).inArray(schema.emailVerificationCodes.userId, userIds));
  await db.systemDb.delete(schema.activityLogs)
    .where((await import("drizzle-orm")).inArray(schema.activityLogs.userId, userIds));
  await db.systemDb.delete(schema.adminActionLogs)
    .where((await import("drizzle-orm")).eq(schema.adminActionLogs.userId, seed.admin.id));
  await db.systemDb.delete(schema.users)
    .where((await import("drizzle-orm")).inArray(schema.users.id, userIds));
}

before(async () => {
  fixture = await startAuthHttpFixture();
  // The fixture sets all database/secret variables before these imports. No
  // auth or DB module is evaluated against the caller's environment.
  db = await import("../../lib/db.js");
  schema = await import("../../shared/schema.js");
  auth = await import("../../lib/auth.js");
  seed = await seedUsers();

  const adminLogin = await login(seed.admin.email);
  assert.equal(adminLogin.response.status, 200);
  adminToken = adminLogin.token;
  assert.ok(adminToken);

  const memberLogin = await login(seed.member.email);
  assert.equal(memberLogin.response.status, 200);
  memberToken = memberLogin.token;
  assert.ok(memberToken);
});

after(async () => {
  try {
    if (db && seed) await cleanupUsers();
  } finally {
    await db?.closeDb();
    await fixture?.stop();
  }
});

describe("authenticated HTTP fixture — successful login and guards", { concurrency: 1 }, () => {
  test("successful password login issues a cookie-backed session and /me resolves it", async () => {
    const result = await login(seed.member.email);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.email, seed.member.email);
    assert.equal(result.body.user.twoFactorEnabled, false);
    assert.ok(result.cookies.auth_token);
    assert.ok(result.cookies.csrf_token);
    assert.equal(result.body.previewToken, undefined, "test fixture must not expose preview tokens");

    const me = await api("/api/auth/me", {
      headers: { cookie: cookieHeader(result.cookies) },
    });
    assert.equal(me.status, 200);
    const meBody = await json<any>(me);
    assert.equal(meBody.user.email, seed.member.email);
    assert.equal(meBody.user.authAssurance, "password");
  });

  test("anonymous and invalid sessions are rejected by the production guard", async () => {
    assert.equal((await api("/api/auth/me")).status, 401);
    assert.equal(
      (await api("/api/auth/me", { headers: { authorization: "Bearer invalid-qa-token" } })).status,
      401,
    );
    const wrongPassword = await api("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.220" },
      body: JSON.stringify({ email: seed.member.email, password: "not-the-password" }),
    });
    assert.equal(wrongPassword.status, 401);
  });

  test("admin guard permits the synthetic admin and rejects a regular member", async () => {
    const adminUsers = await api("/api/admin/users", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminUsers.status, 200);
    const membersUsers = await api("/api/admin/users", {
      headers: { authorization: `Bearer ${memberToken}` },
    });
    assert.equal(membersUsers.status, 403);
  });
});

describe("authenticated HTTP fixture — email MFA", { concurrency: 1 }, () => {
  test("password challenge, loopback email OTP, session issuance, and replay defense", async () => {
    const challenged = await login(seed.mfaMember.email, true);
    assert.equal(challenged.response.status, 200);
    assert.equal(challenged.body.requiresTwoFactor, true);
    assert.equal(challenged.body.twoFactorMethod, "email");
    assert.ok(challenged.body.challengeToken);
    assert.equal(challenged.cookies.auth_token, undefined);

    const delivered = await fixture.waitForEmail(/Your verification code to sign in is:/);
    const code = /Your verification code to sign in is:\s*(\d{6})/.exec(delivered.raw)?.[1];
    assert.ok(code, "loopback SMTP sink must capture the OTP body");

    const verified = await api("/api/auth/verify-2fa", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.221" },
      body: JSON.stringify({
        challengeToken: challenged.body.challengeToken,
        code,
      }),
    });
    assert.equal(verified.status, 200);
    const verifiedBody = await json<any>(verified);
    assert.equal(verifiedBody.user.email, seed.mfaMember.email);
    assert.equal(verifiedBody.previewToken, undefined);
    const cookies = setCookiePairs(verified);
    assert.ok(cookies.auth_token);

    const me = await api("/api/auth/me", {
      headers: { authorization: `Bearer ${tokenFromCookies(cookies)}` },
    });
    assert.equal(me.status, 200);
    const meBody = await json<any>(me);
    assert.equal(meBody.user.authAssurance, "mfa");

    const replay = await api("/api/auth/verify-2fa", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.222" },
      body: JSON.stringify({
        challengeToken: challenged.body.challengeToken,
        code,
      }),
    });
    assert.equal(replay.status, 401);

    const { desc, eq } = await import("drizzle-orm");
    const [session] = await db.systemDb
      .select({ expiresAt: schema.sessions.expiresAt, authAssurance: schema.sessions.authAssurance, deviceInfo: schema.sessions.deviceInfo })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, seed.mfaMember.id))
      .orderBy(desc(schema.sessions.id))
      .limit(1);
    assert.ok(session);
    assert.equal(session.authAssurance, "mfa");
    assert.equal((session.deviceInfo as any)?.rememberedSession, true);
    const lifetimeDays = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
    assert.ok(lifetimeDays > 89.8 && lifetimeDays < 90.2, `expected 90-day MFA session, got ${lifetimeDays}`);
  });
});

describe("authenticated HTTP fixture — retention and revocation", { concurrency: 1 }, () => {
  test("remember-me retention is 90 days and logout revokes the exact session", async () => {
    const result = await login(seed.member.email, true);
    assert.equal(result.response.status, 200);
    const { desc, eq } = await import("drizzle-orm");
    const [session] = await db.systemDb
      .select({ id: schema.sessions.id, expiresAt: schema.sessions.expiresAt, deviceInfo: schema.sessions.deviceInfo })
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, auth.hashToken(result.token)))
      .orderBy(desc(schema.sessions.id))
      .limit(1);
    assert.ok(session);
    assert.equal((session.deviceInfo as any)?.rememberedSession, true);
    const lifetimeDays = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
    assert.ok(lifetimeDays > 89.8 && lifetimeDays < 90.2, `expected 90-day session, got ${lifetimeDays}`);

    const logout = await api("/api/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${result.token}` },
    });
    assert.equal(logout.status, 200);
    const afterLogout = await api("/api/auth/me", {
      headers: { authorization: `Bearer ${result.token}` },
    });
    assert.equal(afterLogout.status, 401);
    const [revoked] = await db.systemDb
      .select({ isActive: schema.sessions.isActive, forceLogoutAt: schema.sessions.forceLogoutAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, session.id))
      .limit(1);
    assert.equal(revoked?.isActive, 0);
    assert.ok(revoked?.forceLogoutAt);
  });

  test("admin force-logout revokes another active member session over HTTP", async () => {
    const target = await login(seed.member.email);
    assert.equal(target.response.status, 200);
    const targetToken = target.token;
    const forced = await api(`/api/admin/users/${seed.member.id}/force-logout`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "isolated authenticated QA revocation" }),
    });
    assert.equal(forced.status, 200);
    const forcedBody = await json<any>(forced);
    assert.ok(Number(forcedBody.sessionsTerminated) >= 1);
    const targetAfterForceLogout = await api("/api/auth/me", {
      headers: { authorization: `Bearer ${targetToken}` },
    });
    assert.equal(targetAfterForceLogout.status, 401);
  });
});

describe("authenticated HTTP fixture — admin notifications", { concurrency: 1 }, () => {
  test("real signup notification service and team-less admin HTTP guard stay scoped", async () => {
    const { notifyAdminsNewSignup } = await import("../../lib/notification-service.js");
    await notifyAdminsNewSignup(
      seed.notificationSubject.id,
      seed.notificationSubject.email,
      "QA HTTP Pending Member",
    );

    const response = await api("/api/notifications", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(response.status, 200);
    const body = await json<any>(response);
    assert.ok(Array.isArray(body.notifications));
    const notification = body.notifications.find(
      (item: any) => item.entityId === seed.notificationSubject.id,
    );
    assert.ok(notification, "team-less admin must receive the generated signup notification");
    assert.equal(notification.title, "New User Awaiting Approval");
    assert.equal(notification.category, "system");
    assert.equal(notification.type, "warning");

    const unread = await api("/api/notifications?unread=true", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(unread.status, 200);
    const unreadBody = await json<any>(unread);
    assert.ok(unreadBody.notifications.some((item: any) => item.id === notification.id));

    const count = await api("/api/notifications?count=true", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(count.status, 200);
    assert.ok(Number((await json<any>(count)).count) >= 1);

    // The preceding revocation flow intentionally terminated every prior
    // member session. Obtain a fresh production-issued session before checking
    // the non-admin authorization result (401 would only prove revocation).
    const freshMember = await login(seed.member.email);
    assert.equal(freshMember.response.status, 200);
    const memberDenied = await api("/api/notifications", {
      headers: { authorization: `Bearer ${freshMember.token}` },
    });
    assert.equal(memberDenied.status, 403);
    assert.equal((await api("/api/notifications")).status, 401);
  });
});