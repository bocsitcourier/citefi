import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or NEON_DATABASE_URL is required");
const rollback = process.argv.includes("--rollback");
const fileName = rollback ? "0019_agency_client_reports_rollback.sql" : "0019_agency_client_reports.sql";
const client = new Client({ connectionString: databaseUrl, statement_timeout: 180_000, connectionTimeoutMillis: 30_000 });
try {
  await client.connect();
  const sqlText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", fileName), "utf8");
  console.log(`${rollback ? "Rolling back" : "Applying"} ${fileName}`);
  await client.query(sqlText);
  console.log(`${fileName} completed successfully`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}