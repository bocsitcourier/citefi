import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const teamRoute = source("../../app/api/client/team/route.ts");
const auth = source("../../lib/api/auth.ts");
const adminInvariant = source("../../lib/admin-invariant.ts");

test("team administrator removal serializes invariant check and deletion per team", () => {
  const deleteHandler = teamRoute.split("export async function DELETE")[1];
  assert.ok(deleteHandler, "team membership DELETE handler must exist");
  assert.match(deleteHandler, /db\.transaction\(async \(tx\)/);
  assert.match(deleteHandler, /await lockTeamAdminMembershipState\(tx, teamId\)/);

  const lockIndex = deleteHandler.indexOf("await lockTeamAdminMembershipState");
  const countIndex = deleteHandler.indexOf("const adminRows = await tx");
  const deleteIndex = deleteHandler.indexOf(".delete(teamMembers)");
  assert.ok(lockIndex >= 0 && countIndex > lockIndex && deleteIndex > countIndex);
  assert.match(deleteHandler, /inArray\(teamMembers\.role, \["admin", "owner"\]\)/);
  assert.match(adminInvariant, /pg_advisory_xact_lock\(2026090902, \$\{teamId\}\)/);
});

test("platform admin lifecycle changes share the serialized last-admin invariant", () => {
  for (const path of [
    "../../app/api/admin/users/[id]/change-role/route.ts",
    "../../app/api/admin/users/[id]/suspend/route.ts",
    "../../app/api/admin/users/[id]/delete/route.ts",
  ]) {
    const route = source(path);
    const lockIndex = route.indexOf("await lockPlatformAdminState(tx)");
    const countIndex = route.indexOf("await countActivePlatformAdmins(tx)");
    assert.ok(lockIndex >= 0 && countIndex > lockIndex, `${path} must lock before recounting`);
  }

  const changeRole = source("../../app/api/admin/users/[id]/change-role/route.ts");
  assert.match(changeRole, /userId === adminUserId/);
});

test("identity lifecycle guards reject suspended users and removed team contexts", () => {
  for (const fnName of ["requireAdmin", "requireTeamMember", "requireClientReviewer"]) {
    const start = auth.indexOf(`export async function ${fnName}`);
    assert.ok(start >= 0, `${fnName} must be implemented`);
    const nextExport = auth.indexOf("\nexport ", start + 1);
    const body = auth.slice(start, nextExport < 0 ? undefined : nextExport);
    assert.match(body, /accountStatus !== "active"/, `${fnName} must reject suspended identities`);
  }

  assert.match(auth, /teamContextId set but no valid membership — hard-fail, never fall through/);
  assert.match(auth, /Client reviewers have read-only access/);
  assert.match(auth, /resourceTeamId !== authTeamId/);
});

test("password recovery issuance invalidates competing recovery channels", () => {
  const resetByCode = source("../../app/api/auth/forgot-password/route.ts");
  const resetByEmailCode = source("../../app/api/auth/send-email-code/route.ts");
  const resetByAdmin = source("../../app/api/admin/users/[id]/reset-password/route.ts");

  assert.match(resetByCode, /update\(passwordResets\)[\s\S]*?eq\(passwordResets\.status, "pending"\)/);
  assert.match(resetByEmailCode, /if \(purpose === "password_reset"\)[\s\S]*?update\(passwordResets\)/);
  assert.match(resetByAdmin, /update\(emailVerificationCodes\)[\s\S]*?eq\(emailVerificationCodes\.purpose, "password_reset"\)/);

  const completeByCode = source("../../app/api/auth/reset-password/route.ts");
  const completeByLink = source("../../app/api/auth/reset-password-token/route.ts");
  for (const route of [completeByCode, completeByLink]) {
    assert.match(route, /update\(sessions\)[\s\S]*?terminationReason/);
    assert.match(route, /update\(emailVerificationCodes\)/);
    assert.match(route, /update\(passwordResets\)/);
  }
});
