import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { verifyReservationArbiter } from "../../scripts/lib/verify-reservation-arbiter.js";

test("live reservation arbiter supports the exact billing INSERT without writing rows", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL });
  await client.connect();
  try {
    await verifyReservationArbiter(client);
  } finally {
    await client.end();
  }
});

test("schema gate rejects missing/partial arbiters and accepts a full tenant/run unique", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL });
  await client.connect();
  try {
    // Connection-local temporary table shadows the public table; no customer
    // rows or shared financial schema are changed by this adversarial test.
    await client.query(`CREATE TEMP TABLE credit_reservations (
      team_id integer, run_id text, operation_type text,
      original_amount integer, remaining_amount integer, status text
    )`);
    await assert.rejects(verifyReservationArbiter(client), (error: any) => error.code === "42P10");
    await client.query(`CREATE UNIQUE INDEX partial_arbiter ON credit_reservations(team_id,run_id)
      WHERE status = 'RESERVED'`);
    await assert.rejects(verifyReservationArbiter(client), (error: any) => error.code === "42P10");
    await client.query(`ALTER TABLE credit_reservations ADD UNIQUE(team_id,run_id)`);
    await verifyReservationArbiter(client);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM credit_reservations")).rows[0].count, 0);
  } finally {
    await client.end();
  }
});