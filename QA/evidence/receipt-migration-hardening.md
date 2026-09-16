# Provider receipt migration hardening

## Scope and safety

The migration fixture was run only through the owned disposable PostgreSQL
cluster on `127.0.0.1:55481` (`citefi_qa`, `qa_owner`) using:

```text
QA/support/with-isolated-database.sh --receipt-migration-fixture -- tests/qa/provider-receipt-durability.integration.test.ts
```

The harness discarded application database URLs and provider credentials,
started/stopped its own cluster, and enabled the offline network guard for the
receipt database suite. No application/customer database, provider, or
production write was used. The raw, secret-free harness/SQL output is retained
in `QA/evidence/receipt-migration-hardening.sql.log`.

## Migration correction

`migrations/0035_provider_attempt_receipt_state_hardening.sql` now uses
`jsonb_typeof(... ) IS DISTINCT FROM 'number'` in both malformed-aggregate
predicates. Missing `unitCount` therefore cannot pass through SQL `NULL`
comparison semantics. Rows downgraded from `accounted` to
`accounting_failed` also clear `accounted_at`.

## Historical fixture cases

The fixture removed only the three canonical state checks, asserted that the
pre-hardening table had no such checks, and seeded seven non-empty historical
receipt rows before applying 0035:

1. **Matching native ledger evidence** — `known: true` with absent
   `unitCount`, matching tenant/provider/model/request identity, and native
   ledger usage `tokens / 7 / input 5 / output 2`; backfilled exactly.
2. **Missing aggregate** — no response usage and no ledger evidence; remained
   without response usage and downgraded to `accounting_failed`.
3. **Malformed aggregate** — string `unitCount: "not-a-number"` and no ledger
   evidence; preserved as ambiguous evidence and downgraded, without a
   fabricated zero.
4. **Tenant conflict** — same source event but ledger tenant differs; no
   backfill.
5. **Provider conflict** — ledger provider differs; no backfill.
6. **Model conflict** — ledger model differs; no backfill.
7. **Provider request identity conflict** — ledger request ID differs; no
   backfill.

All six rows without trustworthy matching evidence were downgraded and had
`accounted_at` cleared. The matching row retained accounted state and exact
native usage. Migration re-execution made zero repair updates and preserved
the seven-row fixture cardinality.

## Constraint assertions

After repair, all three canonical checks were present and validated:

- positive `attempt`;
- exact allow-listed receipt `status`;
- non-null `response_usage` for `usage_captured` and `accounted`.

The fixture attempted writes violating each check (attempt zero, unknown
status, and accounted without usage); all three were rejected by PostgreSQL.

## Receipt database suite

The owned 55481 receipt integration suite passed all 3 tests:

- one physical concurrent submission / one durable receipt;
- DB capture plus ledger faults recover from recreated spool without provider
  replay;
- tenant RLS rejects another tenant's receipt during recovery.

Result: **3 passed, 0 failed**. The fixture and migration are isolated QA
evidence only; no real application/customer rows were written.