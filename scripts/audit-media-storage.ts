import { Pool } from "pg";
import { runStorageAudit } from "../lib/storage-audit";
import { createLegacyInventory, createPrimaryInventory, loadStorageOwners } from "../lib/storage-inventory";

// A one-shot inventory for environments with legacy-bucket access. Scheduling,
// operator notifications, and bounded history are owned by the worker monitor.
async function main() {
  const connectionString = process.env.DATABASE_POOLED_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Database configuration required");
  const pool = new Pool({
    connectionString, max: 1, connectionTimeoutMillis: 10_000,
    query_timeout: 60_000, statement_timeout: 60_000,
    options: "-c default_transaction_read_only=on",
  });
  pool.on("error", () => console.error("[storage-audit] database connection failed"));
  try {
    const report = await runStorageAudit({
      owners: () => loadStorageOwners(pool),
      primary: createPrimaryInventory, legacy: createLegacyInventory,
    });
    console.log(JSON.stringify(report));
    process.exitCode = report.status === "PASS" ? 0 : report.status === "DRIFT" ? 1 : 2;
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("[storage-audit] inventory could not run; check operator configuration");
  process.exitCode = 2;
});