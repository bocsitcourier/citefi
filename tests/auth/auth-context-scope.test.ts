import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runWithAuthenticatedAdminContext,
  runWithAuthenticatedTeamContext,
  verifyTokenFromRequest,
} from "../../lib/api/auth";
import {
  getDatabaseExecutionContext,
  runWithBlockedDatabaseContext,
} from "../../lib/tenant-context";

test("authenticated team authority is callback-scoped across awaits", async () => {
  await runWithBlockedDatabaseContext("auth context scope test", async () => {
    const before = getDatabaseExecutionContext();

    await runWithAuthenticatedTeamContext(
      { userId: 41, teamId: 101, role: "member" },
      async () => {
        await Promise.resolve();
        assert.deepEqual(getDatabaseExecutionContext(), {
          scope: "tenant",
          actorType: "web",
          userId: 41,
          teamId: 101,
          role: "member",
        });
      },
    );

    assert.strictEqual(getDatabaseExecutionContext(), before);
    assert.equal(getDatabaseExecutionContext()?.scope, "blocked");
  });
});

test("admin system authority is callback-scoped across awaits", async () => {
  await runWithBlockedDatabaseContext("admin context scope test", async () => {
    const before = getDatabaseExecutionContext();

    await runWithAuthenticatedAdminContext(7, async () => {
      await Promise.resolve();
      assert.deepEqual(getDatabaseExecutionContext(), {
        scope: "system",
        reason: "platform admin request by user 7",
      });
    });

    assert.strictEqual(getDatabaseExecutionContext(), before);
    assert.equal(getDatabaseExecutionContext()?.scope, "blocked");
  });
});

test("web callback context rejects an invalid authenticated identity", () => {
  assert.throws(
    () => runWithAuthenticatedTeamContext(
      { userId: 0, teamId: 101, role: "member" },
      () => undefined,
    ),
    /positive userId/,
  );
});

test("session bootstrap restores the caller context after awaited authorization", async () => {
  await runWithBlockedDatabaseContext("session bootstrap scope test", async () => {
    const before = getDatabaseExecutionContext();
    const request = new Request("https://example.invalid/api/auth/me", {
      headers: { authorization: "Bearer invalid-token" },
    });

    const result = await verifyTokenFromRequest(request as never);

    assert.equal(result, null);
    assert.strictEqual(getDatabaseExecutionContext(), before);
    assert.equal(getDatabaseExecutionContext()?.scope, "blocked");
  });
});