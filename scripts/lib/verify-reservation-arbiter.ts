/** EXPLAIN (without ANALYZE) plans but never executes a financial write.
 * Checking table existence or an index name is insufficient: PostgreSQL must
 * actually accept the ON CONFLICT target used by reserveCredits.
 */
export async function verifyReservationArbiter(client: {
  query: (text: string) => Promise<unknown>;
}): Promise<void> {
  await client.query(`
    EXPLAIN INSERT INTO credit_reservations
      (team_id, run_id, operation_type, original_amount, remaining_amount, status)
    VALUES (0, 'schema-verification-never-executed', 'article', 1, 1, 'RESERVED')
    ON CONFLICT (team_id, run_id) DO NOTHING
  `);
}