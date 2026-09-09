import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("forgot-password never returns or console-delivers a reset credential", () => {
  const route = readFileSync("app/api/auth/forgot-password/route.ts", "utf8");
  const page = readFileSync("app/forgot-password/page.tsx", "utf8");

  assert.doesNotMatch(route, /NODE_ENV\s*===\s*["']development["'][\s\S]*\{\s*code/);
  assert.doesNotMatch(route, /NextResponse\.json\(\s*\{[\s\S]{0,200}\bcode\b/);
  assert.doesNotMatch(route, /\.\.\.\(process\.env\.NODE_ENV/);
  assert.match(route, /hasConfiguredEmailDelivery\(\)/);
  assert.match(route, /Never create or log a usable reset code/);
  assert.doesNotMatch(page, /Reset code:|setCode\(data\.code\)/);
});

test("controlled admin recovery is explicit, role-bound, and revokes sessions", () => {
  const script = readFileSync("scripts/recover-global-admin.ts", "utf8");
  assert.match(script, /RESET_EXISTING_GLOBAL_ADMIN/);
  assert.match(script, /REASSIGN_ORIGINAL_GLOBAL_ADMIN/);
  assert.match(script, /admin\.role !== "admin"/);
  assert.match(script, /admin\.accountStatus !== "active"/);
  assert.match(script, /eq\(sessions\.isActive, 1\)/);
  assert.match(script, /global_admin_credential_recovered/);
});