/**
 * Migration — T118: reservation state-machine column.
 *
 * Adds `reservation_status` to `credit_ledger` for reserve rows so that
 * debitReservation() and releaseReservation() can atomically transition
 * RESERVED → DEBITED | RELEASED, preventing free content on BullMQ retries
 * and double-releases on worker crashes.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t118-reservation-status.ts
 */
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or NEON_DATABASE_URL is required");

const sql = neon(databaseUrl);

// 1. Add the column
await sql`
  ALTER TABLE credit_ledger
    ADD COLUMN IF NOT EXISTS reservation_status VARCHAR(20)
`;

// 2. Backfill: all existing reserve rows start as RESERVED
await sql`
  UPDATE credit_ledger
  SET reservation_status = 'RESERVED'
  WHERE event_type = 'reserve'
    AND reservation_status IS NULL
`;

// 3. Mark rows that were already debited
await sql`
  UPDATE credit_ledger cl
  SET reservation_status = 'DEBITED'
  WHERE cl.event_type = 'reserve'
    AND cl.reservation_status = 'RESERVED'
    AND EXISTS (
      SELECT 1 FROM credit_ledger d
      WHERE d.team_id = cl.team_id
        AND d.run_id  = cl.run_id
        AND d.event_type = 'debit'
    )
`;

// 4. Mark rows that were released (not already debited)
await sql`
  UPDATE credit_ledger cl
  SET reservation_status = 'RELEASED'
  WHERE cl.event_type = 'reserve'
    AND cl.reservation_status = 'RESERVED'
    AND EXISTS (
      SELECT 1 FROM credit_ledger r
      WHERE r.team_id = cl.team_id
        AND r.run_id  = cl.run_id
        AND r.event_type = 'release'
    )
`;

// 5. Partial index — the sweeper only scans RESERVED rows
await sql`
  CREATE INDEX IF NOT EXISTS credit_ledger_reservation_status_idx
    ON credit_ledger (reservation_status, created_at)
    WHERE reservation_status = 'RESERVED'
`;

// 6. DB-enforced debit idempotency for batch jobs (non-null jobId only).
//    If two concurrent workers deliver the same article (same jobId), the
//    second INSERT on event_type='debit' will fail with a unique constraint
//    violation that the caller catches and converts to an idempotent ok:true.
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_debit_jobid_unique_idx
    ON credit_ledger (team_id, run_id, job_id)
    WHERE event_type = 'debit' AND job_id IS NOT NULL
`;

console.log("✅ T118 reservation-status migration complete");
