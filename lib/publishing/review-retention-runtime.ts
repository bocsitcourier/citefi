import type { Pool, PoolClient } from "pg";
import { evidenceHash, REVIEW_RETENTION_LOCK, type ReferenceRows } from "./review-retention";

const TABLES = ["teams", "articles", "article_assets", "activity_logs", "publishing_jobs", "publishing_callbacks"] as const;

/** Operator-only whole-database inventory. A tenant/RLS-filtered view is NOT
 * proof that an object is unreferenced. Require actual BYPASSRLS authority. */
export async function withReviewRetentionInventory<T>(
  pool: Pool, deleting: boolean,
  operation: (input: { client: PoolClient; rows: ReferenceRows; databaseTarget: string }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(deleting ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const { rows: roles } = await client.query(
      "SELECT rolsuper OR rolbypassrls AS complete FROM pg_roles WHERE rolname = current_user",
    );
    if (roles[0]?.complete !== true) throw new Error("Unfiltered maintenance database authority required");
    if (deleting) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [REVIEW_RETENTION_LOCK]);
      // No approval/audit/job/callback or privacy change can commit between
      // fresh classification and object removal. Never use a skip-locked scan.
      await client.query("LOCK TABLE teams, articles, article_assets, activity_logs, publishing_jobs, publishing_callbacks IN SHARE MODE");
    }
    const identity = await client.query(
      "SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS host, inet_server_port() AS port",
    );
    const rows = {} as ReferenceRows;
    for (const table of TABLES) {
      // Table identifiers are fixed constants, never operator inputs.
      rows[table] = (await client.query(`SELECT * FROM public.${table}`)).rows;
    }
    const result = await operation({ client, rows, databaseTarget: evidenceHash(identity.rows[0]) });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
