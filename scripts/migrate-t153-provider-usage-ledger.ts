import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const dirnameHere = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or NEON_DATABASE_URL is required");
const rollback = process.argv.includes("--rollback");
const client = new Client({ connectionString: databaseUrl, statement_timeout: 180_000, connectionTimeoutMillis: 30_000 });
try {
  await client.connect();
  // A rollback drops the Task #153 tables, so no narrowing migration is needed
  // (and attempting one could fail after legitimate bigint values are stored).
  let fileNames: string[];
  if (rollback) {
    fileNames = ["0017_provider_usage_ledger_rollback.sql"];
  } else {
    const existing = await client.query<{ ledger: string | null; rateVersions: string | null; rates: string | null; invoices: string | null }>(
      `SELECT to_regclass('public.provider_usage_ledger')::text AS ledger,
              to_regclass('public.provider_rate_versions')::text AS "rateVersions",
              to_regclass('public.provider_rates')::text AS rates,
              to_regclass('public.provider_invoice_reconciliations')::text AS invoices`
    );
    const tables = Object.values(existing.rows[0] ?? {});
    const existingCount = tables.filter(Boolean).length;
    if (existingCount !== 0 && existingCount !== 4) {
      throw new Error("Task #153 migration is partially installed; refusing to guess a recovery path");
    }
    fileNames = existingCount === 0
      ? ["0017_provider_usage_ledger.sql", "0018_provider_monetary_bigint.sql"]
      : ["0018_provider_monetary_bigint.sql"];
  }
  for (const fileName of fileNames) {
    const sqlText = readFileSync(join(dirnameHere, "..", "migrations", fileName), "utf8");
    console.log(`${rollback ? "Rolling back" : "Applying"} ${fileName}`);
    await client.query(sqlText);
    console.log(`${fileName} completed successfully`);
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined); throw error;
} finally { await client.end().catch(() => undefined); }