import assert from "node:assert/strict";
import { Pool } from "pg";
import { withReviewRetentionInventory } from "../../lib/publishing/review-retention-runtime.ts";
import { REVIEW_RETENTION_LOCK } from "../../lib/publishing/review-retention.ts";

if (process.env.QA_ISOLATED_DATABASE !== "true") throw new Error("Owned disposable PostgreSQL required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const writer = await pool.connect();
try {
  // No production reads/writes. The owned fixture's existing rows are enough
  // to prove the scanner sees all six sources and obtains a target identity.
  await withReviewRetentionInventory(pool, false, async ({ rows, databaseTarget }) => {
    assert.deepEqual(Object.keys(rows).sort(), [
      "activity_logs", "article_assets", "articles", "publishing_callbacks", "publishing_jobs", "teams",
    ]);
    assert.match(databaseTarget, /^[a-f0-9]{64}$/);
  });
  await withReviewRetentionInventory(pool, true, async () => {
    const lock = await writer.query(
      "SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1, 0)) AS acquired", [REVIEW_RETENTION_LOCK],
    );
    assert.equal(lock.rows[0].acquired, false, "manifest pin/read cannot start during deletion");
    await writer.query("BEGIN");
    for (const table of ["teams", "articles", "article_assets", "activity_logs", "publishing_jobs", "publishing_callbacks"]) {
      await writer.query("SAVEPOINT probe");
      await assert.rejects(writer.query(`LOCK TABLE public.${table} IN ROW EXCLUSIVE MODE NOWAIT`),
        error => error.code === "55P03", `${table} writes must be fenced`);
      await writer.query("ROLLBACK TO SAVEPOINT probe");
    }
    await writer.query("ROLLBACK");
  });
  // The reverse direction protects a manifest until approval/admission commit.
  await writer.query("BEGIN");
  await writer.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))", [REVIEW_RETENTION_LOCK]);
  let entered = false;
  const cleanup = withReviewRetentionInventory(pool, true, async () => { entered = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(entered, false);
  await writer.query("COMMIT");
  await cleanup;
  assert.equal(entered, true);
  // A tenant view must never certify orphanhood; explicit operator bypass only.
  const { rows: identities } = await writer.query("SELECT current_user AS role");
  await writer.query(`CREATE ROLE qa_retention_filtered LOGIN`);
  await writer.query("GRANT qa_retention_filtered TO CURRENT_USER");
  const filteredPool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 1, options: "-c role=qa_retention_filtered",
  });
  try {
    await assert.rejects(withReviewRetentionInventory(filteredPool, false, async () => {
      assert.fail("Filtered role cannot scan");
    }), /Unfiltered maintenance database authority required/);
  } finally {
    await filteredPool.end();
    await writer.query(`REVOKE qa_retention_filtered FROM "${identities[0].role}"`);
    await writer.query("DROP ROLE qa_retention_filtered");
  }
  console.log("PASS review retention: full inventory, pin/reference barriers, released locks, RLS fail-closed");
} finally {
  await writer.query("ROLLBACK").catch(() => {});
  writer.release();
  await pool.end();
}
