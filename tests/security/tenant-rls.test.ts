import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client, Pool, type PoolClient } from "pg";
import { eq, sql } from "drizzle-orm";
import {
  closeDb,
  db,
  getTxDb,
  UnscopedDatabaseAccessError,
} from "../../lib/db";
import {
  enterBlockedDatabaseContext,
  runWithSystemContext,
  runWithTenantContext,
} from "../../lib/tenant-context";
import { teams } from "../../shared/schema";

const connectionString =
  process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for tenant RLS tests");
}

interface MembershipFixture {
  userId: number;
  teamId: number;
  role: string;
}

let owner: Client;
let memberships: MembershipFixture[] = [];
let viewerFixture: MembershipFixture & { articleId: number; batchId: number };

async function setWebTenant(
  client: PoolClient,
  membership: MembershipFixture
): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE citefi_tenant");
  await client.query(
    `SELECT
       set_config('citefi.actor_type', 'web', true),
       set_config('citefi.user_id', $1, true),
       set_config('citefi.team_id', $2, true),
       set_config('citefi.member_role', $3, true)`,
    [String(membership.userId), String(membership.teamId), membership.role]
  );
}

before(async () => {
  owner = new Client({ connectionString });
  await owner.connect();
  const result = await owner.query<MembershipFixture>(
    `SELECT tm.user_id AS "userId", tm.team_id AS "teamId", tm.role
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
      WHERE tm.role IN ('owner', 'admin', 'member')
        AND t.deleted_at IS NULL
        AND t.client_status = 'active'
      ORDER BY tm.team_id
      LIMIT 50`
  );
  const byTeam = new Map<number, MembershipFixture>();
  for (const row of result.rows) byTeam.set(row.teamId, row);
  memberships = [...byTeam.values()].slice(0, 2);

  const suffix = `${Date.now()}-${process.pid}`;
  const user = await owner.query<{ id: number }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [`tenant-rls-viewer-${suffix}@example.invalid`]
  );
  const userId = user.rows[0]!.id;
  const team = await owner.query<{ id: number }>(
    `INSERT INTO teams (name, created_by, client_status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`Tenant RLS viewer ${suffix}`, userId]
  );
  const teamId = team.rows[0]!.id;
  await owner.query(
    `UPDATE users SET default_team_id = $1 WHERE id = $2`,
    [teamId, userId]
  );
  await owner.query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1, $2, 'client_viewer')`,
    [teamId, userId]
  );
  const batch = await owner.query<{ id: number }>(
    `INSERT INTO job_batches
       (user_id, team_id, core_topic, target_url, num_articles_requested)
     VALUES ($1, $2, 'RLS fixture', 'https://example.invalid', 1)
     RETURNING id`,
    [userId, teamId]
  );
  const batchId = batch.rows[0]!.id;
  const article = await owner.query<{ id: number }>(
    `INSERT INTO articles
       (batch_id, team_id, chosen_title, approval_team_id, approval_status)
     VALUES ($1, $2, 'RLS viewer fixture', $2, 'in_review')
     RETURNING id`,
    [batchId, teamId]
  );
  viewerFixture = {
    userId,
    teamId,
    role: "client_viewer",
    articleId: article.rows[0]!.id,
    batchId,
  };
});

after(async () => {
  if (viewerFixture) {
    await owner.query(`DELETE FROM articles WHERE id = $1`, [viewerFixture.articleId]);
    await owner.query(`DELETE FROM job_batches WHERE id = $1`, [viewerFixture.batchId]);
    await owner.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [viewerFixture.teamId, viewerFixture.userId]
    );
    await owner.query(`UPDATE users SET default_team_id = NULL WHERE id = $1`, [viewerFixture.userId]);
    await owner.query(`DELETE FROM teams WHERE id = $1`, [viewerFixture.teamId]);
    await owner.query(`DELETE FROM users WHERE id = $1`, [viewerFixture.userId]);
  }
  await closeDb();
  await owner?.end();
});

test("unscoped application database access fails closed", async () => {
  assert.throws(
    () => getTxDb(),
    (error: unknown) => error instanceof UnscopedDatabaseAccessError
  );
  await assert.rejects(
    db.execute(sql`SELECT 1`),
    (error: unknown) => error instanceof UnscopedDatabaseAccessError
  );
  await runWithSystemContext("blocked-context regression test", async () => {
    enterBlockedDatabaseContext("authenticated user has no validated team");
    await assert.rejects(
      db.execute(sql`SELECT 1`),
      (error: unknown) => error instanceof UnscopedDatabaseAccessError
    );
  });
});

test("tenant role cannot read or update another team's rows", async (t) => {
  if (memberships.length < 2) {
    t.skip("requires two active teams with an owner/admin/member");
    return;
  }
  const [tenantA, tenantB] = memberships as [
    MembershipFixture,
    MembershipFixture,
  ];
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await setWebTenant(client, tenantA);

    const own = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE id = $1",
      [tenantA.teamId]
    );
    assert.equal(own.rowCount, 1, "the selected tenant must see its own team");

    const foreign = await client.query<{ id: number }>(
      "SELECT id FROM teams WHERE id = $1",
      [tenantB.teamId]
    );
    assert.equal(foreign.rowCount, 0, "a foreign team must be invisible");

    const foreignArticles = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM articles WHERE team_id <> $1",
      [tenantA.teamId]
    );
    assert.equal(foreignArticles.rows[0]?.count, "0");

    const forgedUpdate = await client.query(
      "UPDATE teams SET name = name WHERE id = $1 RETURNING id",
      [tenantB.teamId]
    );
    assert.equal(
      forgedUpdate.rowCount,
      0,
      "a write predicate omission must not modify a foreign tenant"
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});

test("concurrent pooled tenant contexts stay isolated and reset on release", async (t) => {
  if (memberships.length < 2) {
    t.skip("requires two active teams with an owner/admin/member");
    return;
  }
  const [tenantA, tenantB] = memberships as [
    MembershipFixture,
    MembershipFixture,
  ];
  const pool = new Pool({ connectionString, max: 2 });

  const exercise = async (
    mine: MembershipFixture,
    foreign: MembershipFixture
  ) => {
    const client = await pool.connect();
    try {
      await setWebTenant(client, mine);
      const context = await client.query<{ teamId: string; role: string }>(
        `SELECT current_setting('citefi.team_id', true) AS "teamId",
                current_role AS role`
      );
      assert.equal(context.rows[0]?.teamId, String(mine.teamId));
      assert.equal(context.rows[0]?.role, "citefi_tenant");
      const hidden = await client.query(
        "SELECT id FROM teams WHERE id = $1",
        [foreign.teamId]
      );
      assert.equal(hidden.rowCount, 0);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  };

  try {
    await Promise.all([
      exercise(tenantA, tenantB),
      exercise(tenantB, tenantA),
    ]);

    const released = await pool.connect();
    try {
      const reset = await released.query<{ teamId: string | null; role: string }>(
        `SELECT NULLIF(current_setting('citefi.team_id', true), '') AS "teamId",
                current_role AS role`
      );
      assert.notEqual(reset.rows[0]?.role, "citefi_tenant");
      assert.equal(reset.rows[0]?.teamId, null);
    } finally {
      released.release();
    }
  } finally {
    await pool.end();
  }
});

test("worker context is restricted to the claimed active team", async (t) => {
  if (memberships.length < 2) {
    t.skip("requires two active teams");
    return;
  }
  const [tenantA, tenantB] = memberships as [
    MembershipFixture,
    MembershipFixture,
  ];
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE citefi_tenant");
    await client.query(
      `SELECT
         set_config('citefi.actor_type', 'worker', true),
         set_config('citefi.user_id', '', true),
         set_config('citefi.team_id', $1, true),
         set_config('citefi.member_role', 'system_worker', true)`,
      [String(tenantA.teamId)]
    );
    const own = await client.query("SELECT id FROM teams WHERE id = $1", [
      tenantA.teamId,
    ]);
    const foreign = await client.query("SELECT id FROM teams WHERE id = $1", [
      tenantB.teamId,
    ]);
    assert.equal(own.rowCount, 1);
    assert.equal(foreign.rowCount, 0);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});

test("legacy getTxDb statements and transactions cannot bypass tenant RLS", async (t) => {
  if (memberships.length < 2) {
    t.skip("requires two active teams with an owner/admin/member");
    return;
  }
  const [tenantA, tenantB] = memberships as [
    MembershipFixture,
    MembershipFixture,
  ];

  await runWithTenantContext(
    {
      actorType: "web",
      userId: tenantA.userId,
      teamId: tenantA.teamId,
      role: tenantA.role,
    },
    async () => {
      const direct = await getTxDb()
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, tenantB.teamId));
      assert.equal(direct.length, 0, "one-off legacy queries must use the tenant role");

      const transactional = await getTxDb().transaction(async (tx) =>
        tx
          .select({ id: teams.id })
          .from(teams)
          .where(eq(teams.id, tenantB.teamId))
      );
      assert.equal(
        transactional.length,
        0,
        "legacy interactive transactions must use the tenant role"
      );
    }
  );
});

test("client reviewers can change only approval fields and lose access when deactivated", async () => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await setWebTenant(client, viewerFixture);
    await assert.rejects(
      client.query(
        `UPDATE articles
            SET chosen_title = 'forged title'
          WHERE id = $1`,
        [viewerFixture.articleId]
      ),
      (error: any) =>
        error?.code === "42501" &&
        /only update approval fields/.test(error?.message ?? "")
    );
    await client.query("ROLLBACK");

    await setWebTenant(client, viewerFixture);
    await assert.rejects(
      client.query(
        `UPDATE articles
            SET approval_status = NULL,
                approval_reviewed_at = NOW(),
                approval_reviewed_by = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [viewerFixture.articleId, viewerFixture.userId]
      ),
      (error: any) =>
        error?.code === "42501" &&
        /only approve or request changes/.test(error?.message ?? "")
    );
    await client.query("ROLLBACK");

    await setWebTenant(client, viewerFixture);
    const allowed = await client.query(
      `UPDATE articles
          SET approval_status = 'approved',
              approval_reviewed_at = NOW(),
              approval_reviewed_by = $2,
              approval_feedback = 'approved in adversarial test',
              updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [viewerFixture.articleId, viewerFixture.userId]
    );
    assert.equal(allowed.rowCount, 1);
    await client.query("COMMIT");

    await owner.query(
      `UPDATE teams SET client_status = 'inactive' WHERE id = $1`,
      [viewerFixture.teamId]
    );
    await setWebTenant(client, viewerFixture);
    const hidden = await client.query(
      `SELECT id FROM articles WHERE id = $1`,
      [viewerFixture.articleId]
    );
    assert.equal(hidden.rowCount, 0, "deactivated reviewer teams must lose access");
    await client.query("ROLLBACK");
  } finally {
    await owner.query(
      `UPDATE teams SET client_status = 'active' WHERE id = $1`,
      [viewerFixture.teamId]
    ).catch(() => {});
    client.release();
    await pool.end();
  }
});