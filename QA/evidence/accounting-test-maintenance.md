# Provider accounting test maintenance

**Execution boundary:** offline guard only. The commands below did not load an
env file, contact a provider, use application DB/Redis services, restart a
workflow, or send application-port traffic.

## Affected test results

Each command was run as:

```text
NODE_ENV=test node --import ./QA/support/offline-guard.mjs --import tsx/esm --test <file>
```

| Test file | Tests | Passed | Failed | Exit | Exact retained TAP |
|---|---:|---:|---:|---:|---|
| `tests/provider-accounting-boundary.test.ts` | 9 | 9 | 0 | 0 | `QA/evidence/accounting-execution/provider-accounting-boundary.maintenance.tap` |
| `tests/provider-accounting-regressions.test.ts` | 4 | 4 | 0 | 0 | `QA/evidence/accounting-execution/provider-accounting-regressions.maintenance.tap` |
| `tests/provider-accounting-social-behavior.test.ts` | 2 | 2 | 0 | 0 | `QA/evidence/accounting-execution/provider-accounting-social-behavior.maintenance.tap` |
| **Total** | **15** | **15** | **0** | **0** | |

The new social behavior test compiles the production `retryWithBackoff`
initializer, its production non-retryable classifier, and the production
terminal platform aggregation statements from the TypeScript AST. It injects
each immutable accounting/receipt-terminal error, verifies one callback
attempt with no backoff, and verifies terminal aggregation remains pending
until the sibling settles. The terminal path does not continue into image
generation or worker-side release.

The receipt, 100-redelivery, and spool/reconciliation cases remain in
`provider-accounting-regressions.test.ts`. The all-provider direct,
transitive, catch, TTS, hold, fallback, and settled-result guards remain in
`provider-accounting-boundary.test.ts`. The social callback check now follows
the callback's AST ownership by the `retryWithBackoff` first argument and
checks the accounting guard's position before `setTimeout`; it no longer uses
the unrelated nearest outer platform catch.

## Historical red evidence retained

The pre-maintenance red TAP files were not overwritten:

- `QA/evidence/accounting-execution/provider-accounting-boundary.existing.tap`
  retains the prior 9-test / 8-pass / 1-failure result.
- `QA/evidence/accounting-execution/provider-accounting-regressions.new.tap`
  retains the prior 4-test / 3-pass / 1-failure result.

Those files recorded the false-positive lexical-nearest-catch finding at the
two social callback sites. The maintenance TAP files above are the post-test
rule results.

## Historical amount correction

`QA/evidence/historical-reconciliation.md` retains its original
`$0.51707199` wording and appends the correction that this was an agent
spelling/precision typo, not an observed value. The canonical retained
snapshot is **$0.517071 across 99 unique provider events**. This is a
historical recorded snapshot, not an invoice or reconciliation of the two
unknown calls.