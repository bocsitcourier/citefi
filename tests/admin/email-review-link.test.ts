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
  sessions,
  activityLogs,
  usedApprovalTokens,
} from "../../shared/schema.js";
import { hashPassword, generateAccessToken, hashToken } from "../../lib/auth.js";
import { generateApprovalToken, verifyApprovalToken } from "../../lib/approval-token.js";
import { emailService } from "../../lib/email.js";
import { and, eq, inArray } from "drizzle-orm";

import { GET, POST } from "../../app/api/admin/users/review/route.js";
import { POST as adminApprove } from "../../app/api/admin/users/[id]/approve/route.js";
import { POST as adminReject } from "../../app/api/admin/users/[id]/reject/route.js";

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

/** Build a NextRequest for an admin route handler call, authenticated via Bearer token. */
function makeAdminReq(path: string, bearerToken: string, body: unknown = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  });
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
  adminId: number;
  adminToken: string;
  adminSessionId: number;
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

  // Fetch the bootstrap user's email so we can generate a real JWT for it
  const [bootstrapFull] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, bootstrap.id))
    .limit(1);

  // Generate a JWT + persisted session so requireAdmin() passes in-process
  const adminToken = generateAccessToken({
    userId: bootstrap.id,
    email: bootstrapFull!.email,
    role: "admin",
  });
  const tokenHash = hashToken(adminToken);
  const [adminSession] = await db
    .insert(sessions)
    .values({
      userId: bootstrap.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isActive: 1,
      teamContextId: teamRow.id,
    })
    .returning({ id: sessions.id });

  seed = {
    teamId: teamRow.id,
    adminId: bootstrap.id,
    adminToken,
    adminSessionId: adminSession.id,
    pendingApproveId: pa.id,
    pendingApproveEmail: pa.email,
    pendingRejectId: pr.id,
    pendingRejectEmail: pr.email,
    activeUserId: active.id,
    extraPendingIds: [],
  };
});

after(async () => {
  try {
    const allIds = [
      seed.adminId,
      ...seed.extraPendingIds,
      seed.pendingApproveId,
      seed.pendingRejectId,
      seed.activeUserId,
    ];

    await db.delete(sessions).where(eq(sessions.id, seed.adminSessionId)).catch(() => {});

    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.userId, allIds as number[]));

    // Also delete activity_logs keyed by resourceId (from admin approve route)
    await db
      .delete(activityLogs)
      .where(inArray(activityLogs.resourceId, allIds as number[]))
      .catch(() => {});

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

  test("expired token returns 410 HTML 'expired'", async () => {
    const expiredToken = createExpiredToken(seed.pendingApproveId, "approve");
    const res = await POST(makePostReq(expiredToken));
    assert.equal(res.status, 410);
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

  test("expired reject token returns 410 HTML 'expired'", async () => {
    const expiredToken = createExpiredToken(seed.pendingRejectId, "reject");
    const res = await POST(makePostReq(expiredToken));
    assert.equal(res.status, 410);
    const html = await res.text();
    assert.ok(
      html.toLowerCase().includes("expired"),
      `Expected 'expired' for expired reject token — got:\n${html.slice(0, 300)}`
    );
  });
});

// ── Key rotation tests ────────────────────────────────────────────────────────
//
// These tests simulate rotating APPROVAL_TOKEN_SECRET by temporarily overriding
// process.env, then restoring it in a finally block so subsequent tests are unaffected.
//
// Two isolated secrets are used so their derived kids never collide with the
// real test-env secret, keeping the keyring predictable.

const ROTATION_PREV_KEY = "approval-rotation-test-prev-secret-xk9q";
const ROTATION_NEW_KEY  = "approval-rotation-test-new-secret-zp2m";

/** Save, override, and return a restore thunk for process.env APPROVAL_TOKEN_SECRET vars. */
function overrideApprovalSecrets(current: string, prev?: string): () => void {
  const savedCurrent = process.env.APPROVAL_TOKEN_SECRET;
  const savedPrev    = process.env.APPROVAL_TOKEN_SECRET_PREV;

  process.env.APPROVAL_TOKEN_SECRET = current;
  if (prev !== undefined) {
    process.env.APPROVAL_TOKEN_SECRET_PREV = prev;
  } else {
    delete process.env.APPROVAL_TOKEN_SECRET_PREV;
  }

  return () => {
    if (savedCurrent !== undefined) process.env.APPROVAL_TOKEN_SECRET = savedCurrent;
    else delete process.env.APPROVAL_TOKEN_SECRET;
    if (savedPrev !== undefined) process.env.APPROVAL_TOKEN_SECRET_PREV = savedPrev;
    else delete process.env.APPROVAL_TOKEN_SECRET_PREV;
  };
}

describe("Key rotation — previous-key tokens survive rotation", () => {
  test("token signed with previous key verifies after rotation (verifyApprovalToken)", () => {
    // Step 1 — sign with the old key
    const restore1 = overrideApprovalSecrets(ROTATION_PREV_KEY);
    let oldToken: string;
    try {
      oldToken = generateApprovalToken(seed.pendingApproveId, "approve");
    } finally {
      restore1();
    }

    // Step 2 — rotate: new key is current, old key is prev
    const restore2 = overrideApprovalSecrets(ROTATION_NEW_KEY, ROTATION_PREV_KEY);
    try {
      const payload = verifyApprovalToken(oldToken);
      assert.equal(payload.userId, seed.pendingApproveId);
      assert.equal(payload.action, "approve");
    } finally {
      restore2();
    }
  });

  test("token signed with current key verifies after rotation (verifyApprovalToken)", () => {
    // Sign with NEW_KEY as current
    const restore1 = overrideApprovalSecrets(ROTATION_NEW_KEY);
    let newToken: string;
    try {
      newToken = generateApprovalToken(seed.pendingApproveId, "approve");
    } finally {
      restore1();
    }

    // Same keyring: NEW_KEY current, PREV_KEY as previous
    const restore2 = overrideApprovalSecrets(ROTATION_NEW_KEY, ROTATION_PREV_KEY);
    try {
      const payload = verifyApprovalToken(newToken);
      assert.equal(payload.userId, seed.pendingApproveId);
      assert.equal(payload.action, "approve");
    } finally {
      restore2();
    }
  });

  test("token signed with previous key shows confirmation page via GET handler", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_rot_get@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Rotation GET User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    // Sign with old key
    const restore1 = overrideApprovalSecrets(ROTATION_PREV_KEY);
    let oldToken: string;
    try {
      oldToken = generateApprovalToken(fp.id, "approve");
    } finally {
      restore1();
    }

    // Verify via GET with rotated keyring
    const restore2 = overrideApprovalSecrets(ROTATION_NEW_KEY, ROTATION_PREV_KEY);
    try {
      const res = await GET(makeGetReq(oldToken));
      assert.equal(res.status, 200, `Expected 200 confirmation page — got ${res.status}`);
      const html = await res.text();
      assert.ok(
        html.includes("Confirm") || html.includes("Approve"),
        `Expected confirmation page — got:\n${html.slice(0, 300)}`
      );
    } finally {
      restore2();
    }
  });

  test("token signed with previous key can be actioned via POST handler", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_rot_post@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Rotation POST User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    // Sign with old key
    const restore1 = overrideApprovalSecrets(ROTATION_PREV_KEY);
    let oldToken: string;
    try {
      oldToken = generateApprovalToken(fp.id, "approve");
    } finally {
      restore1();
    }

    // POST with rotated keyring — old-key token must still be accepted
    const restore2 = overrideApprovalSecrets(ROTATION_NEW_KEY, ROTATION_PREV_KEY);
    try {
      const res = await POST(makePostReq(oldToken));
      assert.equal(res.status, 200, `Expected 200 for old-key approve — got ${res.status}`);
      const after = await fetchUserStatus(fp.id);
      assert.equal(after, "active", `DB must show active after old-key approve — got: ${after}`);
    } finally {
      restore2();
    }
  });

  test("token signed with fully retired key (not in keyring) returns 400 Invalid", async () => {
    const RETIRED_KEY = "approval-rotation-test-retired-secret-bv7n";

    // Sign with a key that will NOT appear in the keyring during verification
    const restore1 = overrideApprovalSecrets(RETIRED_KEY);
    let retiredToken: string;
    try {
      retiredToken = generateApprovalToken(seed.pendingApproveId, "approve");
    } finally {
      restore1();
    }

    // Verify with a keyring that has NEW_KEY + PREV_KEY — RETIRED_KEY is absent
    const restore2 = overrideApprovalSecrets(ROTATION_NEW_KEY, ROTATION_PREV_KEY);
    try {
      const res = await GET(makeGetReq(retiredToken));
      assert.equal(res.status, 400, `Expected 400 for retired-key token — got ${res.status}`);
      const html = await res.text();
      assert.ok(
        html.toLowerCase().includes("invalid"),
        `Expected 'invalid' in body — got:\n${html.slice(0, 300)}`
      );
    } finally {
      restore2();
    }
  });
});

// ── Race-condition tests ──────────────────────────────────────────────────────
//
// These tests prove that the approve/reject routes on both sides (email-link and
// admin panel) use the same atomic `AND accountStatus='pending_approval'` WHERE
// guard, so exactly one concurrent action can win regardless of which arrives first.
//
// Strategy: both code paths are exercised via their actual in-process route
// handlers. The admin routes require a live session — the seed's bootstrap user
// has a real JWT + DB session so requireAdmin() passes without a live HTTP server.
// Tests run sequentially to keep DB state predictable.

describe("Race-condition guard — email-link wins, admin panel blocked", () => {
  test("after email-link approves, admin panel approve route returns 409 (no double-write)", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_race_approve@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Race Approve User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    // Step 1: email-link POST wins the race — approves the user
    const token = generateApprovalToken(fp.id, "approve");
    const linkRes = await POST(makePostReq(token));
    assert.equal(linkRes.status, 200, `Email-link approve must return 200 — got ${linkRes.status}`);
    assert.equal(await fetchUserStatus(fp.id), "active", "User must be active after email-link approve");

    // Step 2: admin panel approve route arrives too late — WHERE guard blocks it
    const adminRes = await adminApprove(
      makeAdminReq(`/api/admin/users/${fp.id}/approve`, seed.adminToken),
      { params: Promise.resolve({ id: String(fp.id) }) }
    );
    assert.equal(
      adminRes.status,
      409,
      `Admin panel approve must return 409 when user is no longer pending — got ${adminRes.status}`
    );

    // Step 3: exactly one activity log — no double-write
    const logs = await db
      .select({ action: activityLogs.action })
      .from(activityLogs)
      .where(eq(activityLogs.resourceId, fp.id));
    assert.equal(
      logs.length,
      1,
      `Expected exactly 1 activity log entry — found ${logs.length} (double-write would produce 2)`
    );
    assert.equal(logs[0]?.action, "user_approved");
  });

  test("after email-link rejects, admin panel reject route returns 409 (no double-write)", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_race_reject@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Race Reject User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    // Step 1: email-link POST wins the race — rejects the user
    const token = generateApprovalToken(fp.id, "reject");
    const linkRes = await POST(makePostReq(token));
    assert.equal(linkRes.status, 200, `Email-link reject must return 200 — got ${linkRes.status}`);
    assert.equal(await fetchUserStatus(fp.id), "suspended", "User must be suspended after email-link reject");

    // Step 2: admin panel reject route arrives too late — WHERE guard blocks it
    // The pre-check (SELECT shows suspended, not pending) returns 400; the atomic
    // UPDATE guard would return 409 if it were reached first. Both prevent the
    // double-write — the key is that exactly 0 rows change a second time.
    const adminRes = await adminReject(
      makeAdminReq(`/api/admin/users/${fp.id}/reject`, seed.adminToken),
      { params: Promise.resolve({ id: String(fp.id) }) }
    );
    assert.ok(
      adminRes.status === 400 || adminRes.status === 409,
      `Admin panel reject must return 400 or 409 when user is no longer pending — got ${adminRes.status}`
    );

    // Step 3: exactly one activity log — no double-write
    const logs = await db
      .select({ action: activityLogs.action })
      .from(activityLogs)
      .where(eq(activityLogs.resourceId, fp.id));
    assert.equal(
      logs.length,
      1,
      `Expected exactly 1 activity log entry — found ${logs.length} (double-write would produce 2)`
    );
    assert.equal(logs[0]?.action, "user_rejected");
  });
});

describe("Race-condition guard — admin panel wins, email-link blocked", () => {
  test("after admin panel approves, email-link POST returns graceful 'Already actioned'", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_race_adm_approve@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Race Admin Approve User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    // Step 1: admin panel approve route wins the race
    const adminRes = await adminApprove(
      makeAdminReq(`/api/admin/users/${fp.id}/approve`, seed.adminToken),
      { params: Promise.resolve({ id: String(fp.id) }) }
    );
    assert.equal(adminRes.status, 200, `Admin panel approve must return 200 — got ${adminRes.status}`);
    assert.equal(await fetchUserStatus(fp.id), "active", "User must be active after admin panel approve");

    // Step 2: email-link POST arrives too late — atomic WHERE guard blocks it
    const token = generateApprovalToken(fp.id, "approve");
    const linkRes = await POST(makePostReq(token));
    // Email-link route returns graceful 200 "Already actioned" (not an error HTTP code)
    assert.equal(linkRes.status, 200, `Expected graceful 200 — got ${linkRes.status}`);
    const html = await linkRes.text();
    assert.ok(
      html.toLowerCase().includes("already") || html.toLowerCase().includes("actioned"),
      `Expected 'Already actioned' page — got:\n${html.slice(0, 300)}`
    );

    // Step 3: exactly one activity log written (by the admin route), none by the blocked email-link
    const logs = await db
      .select({ action: activityLogs.action })
      .from(activityLogs)
      .where(eq(activityLogs.resourceId, fp.id));
    assert.equal(
      logs.length,
      1,
      `Expected exactly 1 activity log — found ${logs.length} (email-link must not write a second one)`
    );
    assert.equal(logs[0]?.action, "user_approved");
  });

  test("after admin panel rejects, email-link POST returns graceful 'Already actioned'", async () => {
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_race_adm_reject@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Race Admin Reject User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    // Step 1: admin panel reject route wins the race
    const adminRes = await adminReject(
      makeAdminReq(`/api/admin/users/${fp.id}/reject`, seed.adminToken),
      { params: Promise.resolve({ id: String(fp.id) }) }
    );
    assert.equal(adminRes.status, 200, `Admin panel reject must return 200 — got ${adminRes.status}`);
    assert.equal(await fetchUserStatus(fp.id), "suspended", "User must be suspended after admin panel reject");

    // Step 2: email-link POST arrives too late — atomic WHERE guard blocks it
    const token = generateApprovalToken(fp.id, "reject");
    const linkRes = await POST(makePostReq(token));
    assert.equal(linkRes.status, 200, `Expected graceful 200 — got ${linkRes.status}`);
    const html = await linkRes.text();
    assert.ok(
      html.toLowerCase().includes("already") || html.toLowerCase().includes("actioned"),
      `Expected 'Already actioned' page — got:\n${html.slice(0, 300)}`
    );

    // Step 3: exactly one activity log written (by the admin route), none by the blocked email-link
    const logs = await db
      .select({ action: activityLogs.action })
      .from(activityLogs)
      .where(eq(activityLogs.resourceId, fp.id));
    assert.equal(
      logs.length,
      1,
      `Expected exactly 1 activity log — found ${logs.length} (email-link must not write a second one)`
    );
    assert.equal(logs[0]?.action, "user_rejected");
  });
});

// ── Pruning tests ─────────────────────────────────────────────────────────────

describe("POST /api/admin/users/review — expired token pruning", () => {
  test("expired used_approval_tokens rows are pruned when a POST is processed", async () => {
    // Insert two rows that are already past their expiresAt so they qualify for pruning.
    // Use unique fake signatures that won't collide with real tokens in this run.
    const sig1 = `fake_expired_sig_${RUN_ID}_a`;
    const sig2 = `fake_expired_sig_${RUN_ID}_b`;
    const pastDate = new Date(Date.now() - 60_000); // 1 minute ago

    await db.insert(usedApprovalTokens).values([
      { tokenSignature: sig1, expiresAt: pastDate, action: "approve" },
      { tokenSignature: sig2, expiresAt: pastDate, action: "reject" },
    ]);

    // Confirm the rows are present before the POST
    const before = await db
      .select({ id: usedApprovalTokens.id })
      .from(usedApprovalTokens)
      .where(inArray(usedApprovalTokens.tokenSignature, [sig1, sig2]));
    assert.equal(before.length, 2, "Precondition: both expired rows must be present before the POST");

    // Seed a fresh pending user to have a valid token for the POST
    const [fp] = await db
      .insert(users)
      .values({
        email: `rl_${RUN_ID}_prune_test@test.invalid`,
        passwordHash: "unused",
        role: "team_member",
        accountStatus: "pending_approval",
        fullName: "Prune Test User",
        defaultTeamId: seed.teamId,
      })
      .returning({ id: users.id });
    seed.extraPendingIds.push(fp.id);

    const token = generateApprovalToken(fp.id, "approve");

    // This POST triggers pruneExpiredTokens() as a fire-and-forget side-effect.
    const res = await POST(makePostReq(token));
    assert.equal(res.status, 200, `Expected 200 to confirm POST succeeded — got ${res.status}`);

    // pruneExpiredTokens() is fire-and-forget (not awaited by the route), so give
    // it a short window to complete before checking the DB.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The two expired rows must now be gone
    const after = await db
      .select({ id: usedApprovalTokens.id })
      .from(usedApprovalTokens)
      .where(inArray(usedApprovalTokens.tokenSignature, [sig1, sig2]));
    assert.equal(
      after.length,
      0,
      `Expected 0 expired rows after pruning — found ${after.length}. ` +
        "pruneExpiredTokens() may not have deleted rows with expiresAt in the past."
    );
  });
});
