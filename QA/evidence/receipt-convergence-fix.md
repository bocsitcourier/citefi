# Provider receipt convergence fix

## Red cause

The production database receipt store finalized recovery with
`markStatus(accounted)` only.  After a response-capture and ledger outage,
the fallback spool held the provider request ID and exact usage, but the
database row could remain `response_usage = NULL` (and retain a stale
`accounting_failed` marker).  A later accounted fast path also returned
without healing the stale counterpart.  That split made durable evidence look
terminal while the primary receipt was not complete.

## Code fix

- Added a receipt-store `finalizeAccounted` contract implemented by the
  database and memory stores.
- Database finalization performs one update carrying provider request ID,
  response usage, response metadata, captured timestamp, `accounted` status,
  accounted timestamp, and cleared failure fields.
- Reconciliation writes the immutable ledger first, then converges both the
  primary row and independent spool.  Recovery never invokes the provider and
  keeps source-event ledger idempotency.
- Accounted fast paths now verify tenant/provider/model/attempt identity and
  heal a stale primary or spool counterpart.  Tenant context is checked even
  when a custom ownership seam is supplied.
- Added canonical receipt state checks to the Drizzle schema and migration
  `0035_provider_attempt_receipt_state_hardening.sql`.  The migration restores
  only matching immutable native ledger usage and downgrades terminal rows
  without genuine aggregate evidence to `accounting_failed`; it does not
  invent usage, costs, refunds, or provider responses.

## Focused results

Offline unit coverage passed:

- `tests/provider-attempt-receipts.test.ts`
- `tests/provider-accounting-regressions.test.ts`
- `tests/migration-start-version-regression.test.mjs`
- TypeScript `tsc --noEmit`

The focused regression covers stale-primary healing, complete spool
convergence, one ledger event, and rejection of a copied spool identity.

## Schema application

Not applied here.  The new migration is tracked by the versioned migration
runner and isolated QA harness catalog checks, but no application database or
production/customer rows were touched.