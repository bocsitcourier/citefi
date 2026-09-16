import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("password reset links enforce the shared password policy", () => {
  const route = readFileSync("app/api/auth/reset-password-token/route.ts", "utf8");

  // The email-link reset path must enforce the same complexity policy as
  // signup, password changes, and code-based recovery. A length-only check
  // would allow a weak password to be installed through a valid reset token.
  assert.equal(
    /import\s*\{[^}]*\bvalidatePassword\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/s.test(route),
    true,
    "token reset route must import validatePassword",
  );
  assert.equal(
    /validatePassword\s*\(\s*newPassword\s*\)/.test(route),
    true,
    "token reset route must validate newPassword with the shared policy",
  );
});