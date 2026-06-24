/**
 * Email Review Link Flow — Integration Tests
 * ===========================================
 * Tests GET and POST /api/admin/users/review covering all edge cases:
 *   - Valid approve token → status becomes active
 *   - Valid reject token → status becomes suspended
 *   - Expired token → 410 HTML expiry page
 *   - Tampered token → 400 HTML invalid page
 *   - Already-actioned account → graceful 200 page
 *   - Missing token → 400 HTML missing page
 *   - Replay attack → 400 HTML "already used"
 *   - Email notification triggered on success
 *
 * Strategy
 * --------
 * Route handlers are imported and called directly in-process (no live server
 * required). DB is seeded and torn down per run. emailService is intercepted
 * via t.mock.method so calls are asserted without requiring SMTP credentials.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/admin/email-review-link.test.ts
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import { db } from "../../lib/db.js";
import {
  users,
  teams,
  teamMembers,
  activityLogs,
  usedApprovalTokens,
} from "../../shared/schema.js";
import { hashPassword } from "../../lib/auth.js";
import { generateApprovalToken } from "../../lib/approval-token.js";
import { emailService } from "../../lib/email.js";
import { eq, inArray } from "drizzle-orm";

import { GET, POST } from "../../app/api/admin/users/review/route.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const RUN_ID = `rl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ── Token helpers ─────────────────────────────────────────────────────────────

function b64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Create a correctly-signed token whose exp is already in the past. */
function createExpiredToken(userId: number, action: "approve" | "reject"): string {
  const secret =
    process.env.APPROVAL_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.JWT_SECRET ||
    "";
  const payload = { userId, action, exp: Date.now() - 10_000 };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/** Tamper the last character of a token's signature segment. */
function tamperToken(token: string): string {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return token + "x";
  const sig = token.slice(dot + 1);
  // Flip the last character
  const flipped =
    sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
  return token.slice(0, dot + 1) + flipped;
}

// ── Request builders ──────────────────────────────────────────────────────────

function makeGetReq(token: string | null): NextRequest {
  const url = token
    ? new URL(`/api/admin/users/review?token=${encodeURIComponent(token)}`, "http://localhost")
    : new URL("/api/admin/users/review", "http://localhost");
  return new NextRequest(url);
}

function makePostReq(token: string | null, useForm = true): NextRequest {
  if (useForm) {
    const body = token ? new URLSearchParams({ token }).toString() : "";
    return new NextRequest(new URL("/api/admin/users/review", "http://localhost"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }
  return new NextRequest(new URL("/api/admin/users/review", "http://localhost"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(token !== null ? { token } : {}),
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchUserStatus(userId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.accountStatus;
}

// ── Seed ──────────────────────────────────────────────────────────────────────

interface ReviewLinkSeed {
  teamId: number;
  pendingApproveId: number;
  pendingApproveEmail: string;
  pendingRejectId: number;
  pendingRejectEmail: string;
  activeUserId: number;
  extraPendingIds: number[];
}

let seed: ReviewLinkSeed;

before(async () => {
  const passwordHash = await hashPassword("Test!Pass#123");
  const prefix = `rl_${RUN_ID}`;

  // Bootstrapper user (needed as teams.createdBy FK)
  const [bootstrap] = await db
    .insert(users)
    .values({
      email: `${prefix}_bootstrap@test.invalid`,
      passwordHash,
      role: "admin",
      accountStatus: "active",
      fullName: "Bootstrap",
    })
    .returning({ id: users.id });

  const [teamRow] = await db
    .insert(teams)
    .values({ name: `RL Team ${RUN_ID}`, createdBy: bootstrap.id })
    .returning({ id: teams.id });

  await db
    .update(users)
    .set({ defaultTeamId: teamRow.id })
    .where(eq(users.id, bootstrap.id));

  // Pending user for approve flow
  const [pa] = await db
    .insert(users)
    .values({
      email: `${prefix}_pa@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "pending_approval",
      fullName: "Pending Approve",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  // Pending user for reject flow
  const [pr] = await db
    .insert(users)
    .values({
      email: `${prefix}_pr@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "pending_approval",
      fullName: "Pending Reject",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id, email: users.email });

  // Active user for already-actioned tests
  const [active] = await db
    .insert(users)
    .values({
      email: `${prefix}_active@test.invalid`,
      passwordHash,
      role: "team_member",
      accountStatus: "active",
      fullName: "Active User",
      defaultTeamId: teamRow.id,
    })
    .returning({ id: users.id });

  await db.insert(teamMembers).values([
    { teamId: teamRow.id, userId: bootstrap.id, role: "admin" },
    { teamId: teamRow.id, userId: pa.id, role: "member" },
    { teamId: teamRow.id, userId: pr.id, role: "member" },
    { teamId: teamRow.id, userId: active.id, role: "member" },
  ]);

  seed = {
    teamId: teamRow.id,
    pendingApproveId: pa.id,
    pendingApproveEmail: pa.email,
    pendingRejectId: pr.id,
    pendingRejectEmail: pr.email,
    activeUserId: active.id,
    extraPendingIds: [bootstrap.id],
  };
});

after(async () => {
  try {
    const allIds = [
      ...seed.extraPendingIds,
      seed.pendingApproveId,
      seed.pendingRejectId,
      seed.activeUserId,
    ];

    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, allIds as number[]));

    // Clean up any used_approval_tokens seeded during tests
    await db
      .delete(usedApprovalTokens)
      .where(
        inArray(
          usedApprovalTokens.action,
          ["approve", "reject"] as unknown as string[]
        )
      )
      .catch(() => {});

    await db
      .update(users)
      .set({ defaultTeamId: null })
      .where(eq(users.defaultTeamId, seed.teamId));

    await db.delete(teams).where(eq(teams.id, seed.teamId));
    await db.delete(users).where(inArray(users.id, allIds));
  } catch (e) {
    console.warn("[email-review-link] cleanup warning:", e);
  }
});

// ── GET tests ─────────────────────────────────────────────────────────────────

describe("GET /api/admin/users/review", () => {
  test("missing token returns 400 HTML with 'Missing token'", async () => {
    const res = await GET(makeGetReq(null));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.includes("Missing token") || html.includes("Invalid link"),
      `Expected 'Missing token' or 'Invalid link' in body — got:\n${html.slice(0, 300)}`
    );
  });

  test("tampered token returns 400 HTML with 'Invalid'", async () => {
    const validToken = generateApprovalToken(seed.pendingApproveId, "approve");
    const badToken = tamperToken(validToken);
    const res = await GET(makeGetReq(badToken));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.toLowerCase().includes("invalid"),
      `Expected 'invalid' in body for tampered token — got:\n${html.slice(0, 300)}`
    );
  });

  test("expired token returns 410 HTML with 'Approval Link Expired'", async () => {
    const expiredToken = createExpiredToken(seed.pendingApproveId, "approve");
    const res = await GET(makeGetReq(expiredToken));
    assert.equal(res.status, 410);
    const html = await res.text();
    assert.ok(
      html.includes("Approval Link Expired") || html.includes("expired"),
      `Expected 'Approval Link Expired' in body — got:\n${html.slice(0, 300)}`
    );
  });

  test("expired token page surfaces the user's email", async () => {
    const expiredToken = createExpiredToken(seed.pendingApproveId, "approve");
    const res = await GET(makeGetReq(expiredToken));
    const html = await res.text();
    assert.ok(
      html.includes(seed.pendingApproveEmail),
      `Expected pending user's email (${seed.pendingApproveEmail}) in expired-link page — got:\n${html.slice(0, 500)}`
    );
  });

  test("valid token for pending user returns 200 confirmation page", async () => {
    const token = generateApprovalToken(seed.pendingApproveId, "approve");
    const res = await GET(makeGetReq(token));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes("Confirm") || html.includes("Approve"),
      `Expected confirmation page — got:\n${html.slice(0, 300)}`
    );
    assert.ok(
      html.includes(seed.pendingApproveEmail),
      `Expected user email in confirmation page — got:\n${html.slice(0, 500)}`
    );
  });

  test("valid token for already-active user returns 200 graceful 'Already actioned' page", async () => {
    const token = generateApprovalToken(seed.activeUserId, "approve");
    const res = await GET(makeGetReq(token));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(
      html.includes("already") || html.includes("Already"),
      `Expected 'Already actioned' page for active user — got:\n${html.slice(0, 300)}`
    );
  });

  test("token for non-existent user returns 400 HTML 'Account not found'", async () => {
    const token = generateApprovalToken(999_999_999, "approve");
    const res = await GET(makeGetReq(token));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.includes("not found") || html.includes("Account not found"),
      `Expected 'Account not found' — got:\n${html.slice(0, 300)}`
    );
  });
});

// ── POST tests ────────────────────────────────────────────────────────────────

describe("POST /api/admin/users/review — approve", () => {
  test("missing token returns 400 HTML", async () => {
    const res = await POST(makePostReq(null));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.includes("Missing token") || html.includes("Invalid"),
      `Expected 'Missing token' in body — got:\n${html.slice(0, 300)}`
    );
  });

  test("tampered token returns 400 HTML 'Invalid'", async () => {
    const validToken = generateApprovalToken(seed.pendingApproveId, "approve");
    const badToken = tamperToken(validToken);
    const res = await POST(makePostReq(badToken));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.toLowerCase().includes("invalid"),
      `Expected 'invalid' in body for tampered token — got:\n${html.slice(0, 300)}`
    );
  });

  test("expired token returns 400 HTML 'expired'", async () => {
    const expiredToken = createExpiredToken(seed.pendingApproveId, "approve");
    const res = await POST(makePostReq(expiredToken));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.toLowerCase().includes("expired"),
      `Expected 'expired' in body — got:\n${html.slice(0, 300)}`
    );
  });

  test("valid approve token sets accountStatus=active and returns 200 HTML", async () => {
    const before = await fetchUserStatus(seed.pendingApproveId);
    assert.equal(before, "pending_approval", "Precondition: user must be pending_approval");

    const token = generateApprovalToken(seed.pendingApproveId, "approve");
    const res = await POST(makePostReq(token));
    assert.equal(res.status, 200, `Expected 200 for approve, got ${res.status}`);

    const html = await res.text();
    assert.ok(
      html.includes("approved") || html.includes("Approved"),
      `Expected 'approved' in success HTML — got:\n${html.slice(0, 400)}`
    );

    const after = await fetchUserStatus(seed.pendingApproveId);
    assert.equal(after, "active", `DB must show accountStatus=active — got: ${after}`);
  });

  test("sendAccountApprovedEmail is triggered on successful approval", async (t) => {
    // Seed a fresh pending user for this isolated test
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_fp_approve@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Fresh Pending Approve",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id, email: users.email });
    seed.extraPendingIds.push(fp.id);

    const approvedSpy = t.mock.method(emailService, "sendAccountApprovedEmail", async () => {});

    const token = generateApprovalToken(fp.id, "approve");
    const res = await POST(makePostReq(token));

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(
      approvedSpy.mock.callCount(),
      1,
      `sendAccountApprovedEmail must be called exactly once — called ${approvedSpy.mock.callCount()} time(s)`
    );

    const callArgs = approvedSpy.mock.calls[0]?.arguments[0] as { to: string };
    assert.equal(
      callArgs?.to,
      fp.email,
      `sendAccountApprovedEmail must be called with user email ${fp.email} — got: ${callArgs?.to}`
    );
  });

  test("replay attack: reusing an approve token returns 400 HTML 'already used'", async () => {
    // Seed a fresh pending user
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_replay_approve@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Replay Approve",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    const token = generateApprovalToken(fp.id, "approve");

    // First use — should succeed
    const res1 = await POST(makePostReq(token));
    assert.equal(res1.status, 200, `First use must succeed — got ${res1.status}`);

    // Second use — same token, should be rejected
    const res2 = await POST(makePostReq(token));
    assert.equal(res2.status, 400, `Replay must fail with 400 — got ${res2.status}`);
    const html = await res2.text();
    assert.ok(
      html.toLowerCase().includes("already") || html.toLowerCase().includes("used"),
      `Expected 'already used' in replay rejection body — got:\n${html.slice(0, 300)}`
    );
  });

  test("already-active account returns graceful 200 'Already actioned' (race-condition guard)", async () => {
    // The active user has accountStatus=active — simulate the WHERE guard firing
    const token = generateApprovalToken(seed.activeUserId, "approve");
    const res = await POST(makePostReq(token));
    // Route returns 200 with "Already actioned" page (not an error HTTP code)
    assert.equal(res.status, 200, `Expected graceful 200 — got ${res.status}`);
    const html = await res.text();
    assert.ok(
      html.toLowerCase().includes("already") || html.includes("actioned"),
      `Expected graceful 'Already actioned' message — got:\n${html.slice(0, 300)}`
    );
  });

  test("approve token accepts JSON content-type body", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_json_approve@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "JSON Approve",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    const token = generateApprovalToken(fp.id, "approve");
    const res = await POST(makePostReq(token, false)); // JSON body
    assert.equal(res.status, 200, `JSON approve must return 200 — got ${res.status}`);

    const after = await fetchUserStatus(fp.id);
    assert.equal(after, "active", `DB must show active after JSON approve — got: ${after}`);
  });
});

describe("POST /api/admin/users/review — reject", () => {
  test("valid reject token sets accountStatus=suspended and returns 200 HTML", async () => {
    const before = await fetchUserStatus(seed.pendingRejectId);
    assert.equal(before, "pending_approval", "Precondition: user must be pending_approval");

    const token = generateApprovalToken(seed.pendingRejectId, "reject");
    const res = await POST(makePostReq(token));
    assert.equal(res.status, 200, `Expected 200 for reject, got ${res.status}`);

    const html = await res.text();
    assert.ok(
      html.includes("rejected") || html.includes("Rejected"),
      `Expected 'rejected' in success HTML — got:\n${html.slice(0, 400)}`
    );

    const after = await fetchUserStatus(seed.pendingRejectId);
    assert.equal(after, "suspended", `DB must show accountStatus=suspended — got: ${after}`);
  });

  test("sendAccountRejectedEmail is triggered on successful rejection", async (t) => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_fp_reject@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Fresh Pending Reject",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id, email: users.email });
    seed.extraPendingIds.push(fp.id);

    const rejectedSpy = t.mock.method(emailService, "sendAccountRejectedEmail", async () => {});

    const token = generateApprovalToken(fp.id, "reject");
    const res = await POST(makePostReq(token));

    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.equal(
      rejectedSpy.mock.callCount(),
      1,
      `sendAccountRejectedEmail must be called exactly once — called ${rejectedSpy.mock.callCount()} time(s)`
    );

    const callArgs = rejectedSpy.mock.calls[0]?.arguments[0] as { to: string };
    assert.equal(
      callArgs?.to,
      fp.email,
      `sendAccountRejectedEmail must be called with user email ${fp.email} — got: ${callArgs?.to}`
    );
  });

  test("replay attack: reusing a reject token returns 400 HTML 'already used'", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_replay_reject@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Replay Reject",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    const token = generateApprovalToken(fp.id, "reject");

    const res1 = await POST(makePostReq(token));
    assert.equal(res1.status, 200, `First use must succeed — got ${res1.status}`);

    const res2 = await POST(makePostReq(token));
    assert.equal(res2.status, 400, `Replay must fail with 400 — got ${res2.status}`);
    const html = await res2.text();
    assert.ok(
      html.toLowerCase().includes("already") || html.toLowerCase().includes("used"),
      `Expected 'already used' in replay rejection — got:\n${html.slice(0, 300)}`
    );
  });

  test("expired reject token returns 400 HTML 'expired'", async () => {
    const expiredToken = createExpiredToken(seed.pendingRejectId, "reject");
    const res = await POST(makePostReq(expiredToken));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(
      html.toLowerCase().includes("expired"),
      `Expected 'expired' for expired reject token — got:\n${html.slice(0, 300)}`
    );
  });
});
