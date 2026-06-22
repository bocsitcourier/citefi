/**
 * Client Dashboard API Integration Tests
 * ==========================================
 * Covers /api/client/usage, /api/billing/status, /api/client/team, and the
 * 402 paywall gate on /api/seo/create-articles.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/client/client-dashboard.test.ts
 */
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  seedClientTeam,
  seedCreditUsage,
  patchTeamBilling,
  resetTeamBilling,
  cleanupClientTeam,
  type ClientSeedResult,
} from "./seed-client.js";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const COOKIE_NAME = "auth_token";

// Unique per run — prevents data collisions with other concurrent test runs.
const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function apiGet(path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, { headers });
}

async function apiPost(path: string, body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function apiDelete(path: string, body: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify(body),
  });
}

async function waitForServer(timeoutMs = 60_000, intervalMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms — last error: ${lastErr}`);
}

// ── Seed / teardown ───────────────────────────────────────────────────────────

let seed: ClientSeedResult;
let adminCookie: string;
let memberCookie: string;

before(async () => {
  await waitForServer();
  seed = await seedClientTeam(RUN_ID);

  const admin = await loginAndGetCookie(seed.adminUser.email, seed.password);
  assert.ok(admin, "Admin login must succeed");
  adminCookie = admin;

  const member = await loginAndGetCookie(seed.memberUser.email, seed.password);
  assert.ok(member, "Member login must succeed");
  memberCookie = member;
});

after(async () => {
  await cleanupClientTeam(seed);
});

// ── /api/client/usage ─────────────────────────────────────────────────────────

describe("/api/client/usage — auth guards", () => {
  test("unauthenticated request returns 401", async () => {
    const res = await apiGet("/api/client/usage");
    assert.equal(res.status, 401);
  });

  test("authenticated team member returns 200", async () => {
    const res = await apiGet("/api/client/usage", memberCookie);
    assert.equal(res.status, 200);
  });

  test("authenticated admin returns 200", async () => {
    const res = await apiGet("/api/client/usage", adminCookie);
    assert.equal(res.status, 200);
  });
});

describe("/api/client/usage — response shape", () => {
  test("response includes credits, breakdown, dailySeries, articlesThisPeriod, planName", async () => {
    const res = await apiGet("/api/client/usage", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();

    assert.ok(typeof body.credits === "object", "credits must be an object");
    assert.ok(typeof body.credits.balance === "number", "credits.balance must be a number");
    assert.ok(typeof body.credits.used === "number", "credits.used must be a number");
    assert.ok(typeof body.credits.allocated === "number", "credits.allocated must be a number");
    assert.ok(typeof body.credits.usedPct === "number", "credits.usedPct must be a number");

    assert.ok(typeof body.breakdown === "object", "breakdown must be an object");
    assert.ok("article" in body.breakdown, "breakdown.article must exist");
    assert.ok("social" in body.breakdown, "breakdown.social must exist");
    assert.ok("podcast" in body.breakdown, "breakdown.podcast must exist");
    assert.ok("video" in body.breakdown, "breakdown.video must exist");

    assert.ok(Array.isArray(body.dailySeries), "dailySeries must be an array");
    assert.ok(typeof body.articlesThisPeriod === "number", "articlesThisPeriod must be a number");
    assert.ok(typeof body.planName === "string", "planName must be a string");
  });
});

describe("/api/client/usage — low-credit banner trigger (usedPct >= 80)", () => {
  before(async () => {
    // Free plan = 30 monthly credits. Insert 25 debit entries → usedPct = 83 (>= 80).
    await seedCreditUsage(seed.team.id, seed.adminUser.id, 25, "article", RUN_ID);
  });

  test("usedPct is >= 80 when >= 80% of plan credits are used", async () => {
    const res = await apiGet("/api/client/usage", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(
      body.credits.usedPct >= 80,
      `Expected usedPct >= 80 but got ${body.credits.usedPct}. ` +
      `used=${body.credits.used}, allocated=${body.credits.allocated}`
    );
  });

  test("credits.allocated reflects the plan monthly allowance (> 0 for free plan)", async () => {
    const res = await apiGet("/api/client/usage", adminCookie);
    const body: any = await res.json();
    assert.ok(body.credits.allocated > 0, "allocated must be > 0 so banner condition can trigger");
  });

  test("breakdown.article reflects the seeded debit entries", async () => {
    const res = await apiGet("/api/client/usage", adminCookie);
    const body: any = await res.json();
    assert.ok(
      body.breakdown.article >= 25,
      `Expected breakdown.article >= 25, got ${body.breakdown.article}`
    );
  });
});

// ── /api/billing/status ───────────────────────────────────────────────────────

describe("/api/billing/status — auth guards", () => {
  test("unauthenticated request returns 401", async () => {
    const res = await apiGet("/api/billing/status");
    assert.equal(res.status, 401);
  });

  test("authenticated team member returns 200", async () => {
    const res = await apiGet("/api/billing/status", memberCookie);
    assert.equal(res.status, 200);
  });
});

describe("/api/billing/status — response shape", () => {
  test("response includes plan, billing, and credits objects", async () => {
    const res = await apiGet("/api/billing/status", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();

    assert.ok(typeof body.plan === "object", "plan must be an object");
    assert.ok(typeof body.plan.id === "string", "plan.id must be a string");
    assert.ok(typeof body.plan.name === "string", "plan.name must be a string");
    assert.ok(typeof body.plan.monthlyCredits === "number", "plan.monthlyCredits must be a number");
    assert.ok(typeof body.plan.priceUsd === "number", "plan.priceUsd must be a number");
    assert.ok(Array.isArray(body.plan.features), "plan.features must be an array");

    assert.ok(typeof body.billing === "object", "billing must be an object");
    assert.ok(typeof body.billing.hasActivePlan === "boolean", "billing.hasActivePlan must be a boolean");
    assert.ok(typeof body.billing.hasCustomer === "boolean", "billing.hasCustomer must be a boolean");
    assert.ok(typeof body.billing.hasSubscription === "boolean", "billing.hasSubscription must be a boolean");

    assert.ok(typeof body.credits === "object", "credits must be an object");
  });
});

describe("/api/billing/status — trial-expired banner trigger", () => {
  before(async () => {
    // Put team into trialing state with a past period end and no Stripe subscription.
    // This is the state that triggers the trial-expired banner in the UI.
    await patchTeamBilling(seed.team.id, {
      billingStatus: "trialing",
      currentPeriodEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      stripeSubscriptionId: null,
    });
  });

  after(async () => {
    await resetTeamBilling(seed.team.id);
  });

  test("billing.status is 'trialing' for a trialing team", async () => {
    const res = await apiGet("/api/billing/status", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(
      body.billing.status,
      "trialing",
      `Expected status='trialing', got '${body.billing.status}'`
    );
  });

  test("billing.currentPeriodEnd is in the past (trial has expired)", async () => {
    const res = await apiGet("/api/billing/status", adminCookie);
    const body: any = await res.json();
    assert.ok(body.billing.currentPeriodEnd, "currentPeriodEnd must be set for a trialing team");
    const periodEnd = new Date(body.billing.currentPeriodEnd);
    assert.ok(
      periodEnd < new Date(),
      `currentPeriodEnd (${body.billing.currentPeriodEnd}) must be in the past`
    );
  });

  test("billing.hasSubscription is false (no payment method attached)", async () => {
    const res = await apiGet("/api/billing/status", adminCookie);
    const body: any = await res.json();
    assert.equal(
      body.billing.hasSubscription,
      false,
      "hasSubscription must be false for a trial-expired team with no payment method"
    );
  });
});

describe("/api/billing/status — past-due banner trigger", () => {
  before(async () => {
    await patchTeamBilling(seed.team.id, {
      billingStatus: "past_due",
    });
  });

  after(async () => {
    await resetTeamBilling(seed.team.id);
  });

  test("billing.status is 'past_due'", async () => {
    const res = await apiGet("/api/billing/status", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(
      body.billing.status,
      "past_due",
      `Expected status='past_due', got '${body.billing.status}'`
    );
  });
});

// ── /api/client/team ──────────────────────────────────────────────────────────

describe("/api/client/team — auth guards", () => {
  test("unauthenticated GET returns 401", async () => {
    const res = await apiGet("/api/client/team");
    assert.equal(res.status, 401);
  });

  test("authenticated member can GET team data", async () => {
    const res = await apiGet("/api/client/team", memberCookie);
    assert.equal(res.status, 200);
  });

  test("authenticated admin can GET team data", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    assert.equal(res.status, 200);
  });
});

describe("/api/client/team — GET response shape", () => {
  test("response includes members array and pendingInvites array", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();

    assert.ok(Array.isArray(body.members), "members must be an array");
    assert.ok(Array.isArray(body.pendingInvites), "pendingInvites must be an array");
  });

  test("members include both the admin and the regular member", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    const body: any = await res.json();

    const adminEmails = body.members.map((m: any) => m.email);
    assert.ok(
      adminEmails.includes(seed.adminUser.email),
      `Admin email ${seed.adminUser.email} must appear in members`
    );
    assert.ok(
      adminEmails.includes(seed.memberUser.email),
      `Member email ${seed.memberUser.email} must appear in members`
    );
  });

  test("each member row has memberId, userId, role, email, joinedAt", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    const body: any = await res.json();

    for (const m of body.members) {
      assert.ok(typeof m.memberId === "number", "memberId must be a number");
      assert.ok(typeof m.userId === "number", "userId must be a number");
      assert.ok(typeof m.role === "string", "role must be a string");
      assert.ok(typeof m.email === "string", "email must be a string");
      assert.ok(typeof m.joinedAt === "string", "joinedAt must be a string");
    }
  });

  test("admin member has role='admin'", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    const body: any = await res.json();
    const adminMember = body.members.find((m: any) => m.email === seed.adminUser.email);
    assert.ok(adminMember, "Admin must appear in members list");
    assert.equal(adminMember.role, "admin");
  });

  test("regular member has role='member'", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    const body: any = await res.json();
    const regularMember = body.members.find((m: any) => m.email === seed.memberUser.email);
    assert.ok(regularMember, "Regular member must appear in members list");
    assert.equal(regularMember.role, "member");
  });
});

describe("/api/client/team — non-admin read-only enforcement", { concurrency: 1 }, () => {
  const inviteEmail = `test_nonauth_invite_${RUN_ID}@test.invalid`;

  test("non-admin POST invite returns 403", async () => {
    const res = await apiPost(
      "/api/client/team",
      { email: inviteEmail, role: "member" },
      memberCookie
    );
    assert.equal(
      res.status,
      403,
      `Non-admin must not be able to invite (expected 403, got ${res.status})`
    );
    const body: any = await res.json();
    assert.ok(body.error, "Error message must be present");
  });

  test("non-admin DELETE remove-member returns 403", async () => {
    const res = await apiDelete(
      "/api/client/team",
      { memberId: seed.adminMemberId },
      memberCookie
    );
    assert.equal(
      res.status,
      403,
      `Non-admin must not be able to remove members (expected 403, got ${res.status})`
    );
    const body: any = await res.json();
    assert.ok(body.error, "Error message must be present");
  });
});

describe("/api/client/team — admin invite flow", { concurrency: 1 }, () => {
  const inviteEmail = `test_invite_${RUN_ID}@test.invalid`;
  let createdInviteId: number | null = null;

  test("admin POST creates an invite and returns inviteUrl", async () => {
    const res = await apiPost(
      "/api/client/team",
      { email: inviteEmail, role: "member" },
      adminCookie
    );
    assert.equal(
      res.status,
      200,
      `Admin invite must succeed (expected 200, got ${res.status})`
    );
    const body: any = await res.json();
    assert.equal(body.success, true, "success must be true");
    assert.ok(typeof body.inviteUrl === "string", "inviteUrl must be a string");
    assert.ok(
      body.inviteUrl.includes("/accept-invite/"),
      `inviteUrl must contain /accept-invite/ — got: ${body.inviteUrl}`
    );
  });

  test("pending invite appears in GET /api/client/team after creation", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();

    const invite = body.pendingInvites.find((i: any) => i.email === inviteEmail);
    assert.ok(
      invite,
      `Invite for ${inviteEmail} must appear in pendingInvites after creation`
    );
    assert.equal(invite.status, "pending", "Invite status must be 'pending'");
    assert.ok(invite.expiresAt, "Invite must have an expiresAt timestamp");

    // Record invite ID for later cleanup check
    createdInviteId = invite.id;
  });

  test("duplicate invite for same active email returns 409", async () => {
    const res = await apiPost(
      "/api/client/team",
      { email: inviteEmail, role: "member" },
      adminCookie
    );
    assert.equal(
      res.status,
      409,
      `Duplicate active invite must return 409, got ${res.status}`
    );
  });

  test("invite for existing team member returns 409", async () => {
    const res = await apiPost(
      "/api/client/team",
      { email: seed.memberUser.email, role: "member" },
      adminCookie
    );
    assert.equal(
      res.status,
      409,
      `Inviting an existing member must return 409, got ${res.status}`
    );
  });
});

describe("/api/client/team — admin remove member flow", { concurrency: 1 }, () => {
  // We'll create an extra user to remove so the seed member is preserved.
  let extraMemberId: number | null = null;

  before(async () => {
    // Seed an extra team member to remove, so we don't disrupt other tests.
    const { seedClientTeam: _, ...seedModule } = await import("./seed-client.js");
    const { db } = await import("../../lib/db.js");
    const { users: usersTable, teamMembers: tmTable } = await import("../../shared/schema.js");
    const { hashPassword: hp } = await import("../../lib/auth.js");

    const hash = await hp("Test!Pass#123");
    const [extraUser] = await db
      .insert(usersTable)
      .values({
        email: `test_extra_${RUN_ID}@test.invalid`,
        passwordHash: hash,
        role: "team_member",
        accountStatus: "active",
        defaultTeamId: seed.team.id,
      })
      .returning({ id: usersTable.id });

    const [extraMember] = await db
      .insert(tmTable)
      .values({ teamId: seed.team.id, userId: extraUser.id, role: "member" })
      .returning({ id: tmTable.id });

    extraMemberId = extraMember.id;
  });

  test("admin DELETE removes the target member (returns 200)", async () => {
    assert.ok(extraMemberId !== null, "Extra member must have been seeded");
    const res = await apiDelete(
      "/api/client/team",
      { memberId: extraMemberId },
      adminCookie
    );
    assert.equal(
      res.status,
      200,
      `Remove member must return 200, got ${res.status}`
    );
    const body: any = await res.json();
    assert.equal(body.success, true, "success must be true");
  });

  test("removed member no longer appears in GET /api/client/team", async () => {
    const res = await apiGet("/api/client/team", adminCookie);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    const found = body.members.find((m: any) => m.memberId === extraMemberId);
    assert.ok(!found, "Removed member must not appear in members list after deletion");
  });

  test("admin cannot remove themselves (self-removal returns 400)", async () => {
    const res = await apiDelete(
      "/api/client/team",
      { memberId: seed.adminMemberId },
      adminCookie
    );
    assert.equal(
      res.status,
      400,
      `Self-removal must return 400, got ${res.status}`
    );
  });
});

// ── /api/seo/create-articles — 402 paywall for trial-expired teams ────────────

describe("/api/seo/create-articles — paywall enforcement", { concurrency: 1 }, () => {
  before(async () => {
    // Configure the team as trial-expired with no subscription and no credits.
    await patchTeamBilling(seed.team.id, {
      billingStatus: "trialing",
      currentPeriodEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      stripeSubscriptionId: null,
    });
  });

  after(async () => {
    await resetTeamBilling(seed.team.id);
  });

  test("unauthenticated POST returns 401", async () => {
    const res = await apiPost("/api/seo/create-articles", {
      seoToolType: "local_research",
      seoToolOutput: { location: "Austin, TX", business_type: "plumber" },
      targetUrl: "https://example.com",
    });
    assert.equal(res.status, 401);
  });

  test("trial-expired team returns 402 with error=TRIAL_EXPIRED", async () => {
    const res = await apiPost(
      "/api/seo/create-articles",
      {
        seoToolType: "local_research",
        seoToolOutput: { location: "Austin, TX", business_type: "plumber" },
        targetUrl: "https://example.com",
      },
      adminCookie
    );
    assert.equal(
      res.status,
      402,
      `Expected 402 for trial-expired team, got ${res.status}`
    );
    const body: any = await res.json();
    assert.equal(
      body.error,
      "TRIAL_EXPIRED",
      `Expected error='TRIAL_EXPIRED', got '${body.error}'`
    );
    assert.ok(body.upgradeUrl, "upgradeUrl must be present in paywall response");
    assert.equal(body.trialExpired, true, "trialExpired flag must be true");
    assert.ok(typeof body.message === "string", "message must be present");
  });
});
