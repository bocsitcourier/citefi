/**
 * Offline route-boundary regressions for the email-link password reset route.
 * The route handler executes in-process while auth, rate limiting, schema,
 * Drizzle, and the database transaction are deterministic test doubles.
 *
 * Run:
 *   env -u DATABASE_URL -u NEON_DATABASE_URL \
 *     node --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/auth/password-reset-token-route.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

const calls = {
  hashPassword: 0,
  validatePassword: 0,
  transaction: 0,
  update: 0,
};
const hashInputs: unknown[] = [];
const policyInputs: unknown[] = [];

const users = {
  id: {},
  passwordHash: {},
  failedLoginAttempts: {},
  lockedUntil: {},
};
const passwordResets = {
  id: {},
  userId: {},
  tokenHash: {},
  status: {},
  expiresAt: {},
  usedAt: {},
};
const emailVerificationCodes = {
  userId: {},
  purpose: {},
  isUsed: {},
};
const sessions = {
  userId: {},
  isActive: {},
  forceLogoutAt: {},
  terminationReason: {},
};
const loginChallenges = {
  userId: {},
  consumedAt: {},
};
const activityLogs = {};

const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: 901, userId: 902 }],
      }),
    }),
  }),
  update: () => {
    calls.update++;
    const updateNumber = calls.update;
    return {
      set: () => ({
        where: () => ({
          returning: async () => {
            if (updateNumber === 1) return [{ id: 901 }];
            if (updateNumber === 2) return [{ id: 902, userId: 902 }];
            if (updateNumber === 3) return [{ id: 902 }];
            return [];
          },
        }),
      }),
    };
  },
  insert: () => ({
    values: async () => [],
  }),
};

const fakeDb = {
  transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
    calls.transaction++;
    return callback(tx);
  },
};

moduleMock(new URL("../../lib/db.ts", import.meta.url).href, {
  namedExports: { systemDb: fakeDb },
});
moduleMock(new URL("../../lib/db-rate-limit.ts", import.meta.url).href, {
  namedExports: {
    getClientIp: () => "offline-test-ip",
    rateLimitDb: async () => ({ allowed: true, retryAfter: 0 }),
  },
});
moduleMock(new URL("../../lib/auth.ts", import.meta.url).href, {
  namedExports: {
    hashToken: () => "offline-token-hash",
    hashPassword: async (password: unknown) => {
      calls.hashPassword++;
      hashInputs.push(password);
      return "offline-password-hash";
    },
    validatePassword: (password: unknown) => {
      calls.validatePassword++;
      policyInputs.push(password);
      return password === "Valid!Pass123"
        ? { isValid: true, errors: [] }
        : { isValid: false, errors: ["fixture weak password"] };
    },
  },
});
moduleMock(new URL("../../shared/schema.ts", import.meta.url).href, {
  namedExports: {
    users,
    passwordResets,
    emailVerificationCodes,
    sessions,
    loginChallenges,
    activityLogs,
  },
});
moduleMock("drizzle-orm", {
  namedExports: {
    and: () => ({}),
    eq: () => ({}),
    gt: () => ({}),
    isNull: () => ({}),
    ne: () => ({}),
    sql: () => ({}),
  },
});

function resetCalls(): void {
  calls.hashPassword = 0;
  calls.validatePassword = 0;
  calls.transaction = 0;
  calls.update = 0;
  hashInputs.length = 0;
  policyInputs.length = 0;
}

function request(body: unknown): NextRequest {
  return new NextRequest("https://app.example/api/auth/reset-password-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(resetCalls);

test("weak password is rejected before hashing or any database mutation", async () => {
  const { POST } = await import("../../app/api/auth/reset-password-token/route.js");
  const response = await POST(request({ token: "t".repeat(32), newPassword: "weak-password" }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Password does not meet security requirements",
    details: ["fixture weak password"],
  });
  assert.equal(calls.validatePassword, 1);
  assert.deepEqual(policyInputs, ["weak-password"]);
  assert.equal(calls.hashPassword, 0);
  assert.equal(calls.transaction, 0);
  assert.equal(calls.update, 0);
});

test("non-string password preserves the required-fields error contract", async () => {
  const { POST } = await import("../../app/api/auth/reset-password-token/route.js");
  const response = await POST(request({ token: "t".repeat(32), newPassword: 12345678 }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Token and new password are required",
  });
  assert.equal(calls.validatePassword, 0);
  assert.equal(calls.hashPassword, 0);
  assert.equal(calls.transaction, 0);
  assert.equal(calls.update, 0);
});

test("a policy-verified strong password reaches the stub hash and transaction", async () => {
  const { POST } = await import("../../app/api/auth/reset-password-token/route.js");
  const response = await POST(request({ token: "t".repeat(32), newPassword: "Valid!Pass123" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "Password updated successfully. Sign in again on every device.",
  });
  assert.equal(calls.validatePassword, 1);
  assert.deepEqual(policyInputs, ["Valid!Pass123"]);
  assert.equal(calls.hashPassword, 1);
  assert.deepEqual(hashInputs, ["Valid!Pass123"]);
  assert.equal(calls.transaction, 1);
  assert.ok(calls.update > 0);
});