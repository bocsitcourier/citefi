# Operations test-maintenance evidence

## Disposition

This note retracts two false findings from the earlier operations execution
record. The original red results remain in
`QA/evidence/operations-execution.md`; that record is historical evidence and
was not rewritten or deleted.

The initial maintenance changed only the two affected tests and this evidence
note. A follow-up static configuration review then found that the deployment
contract's remaining `6379` failure was real: `.replit` exposed Redis through
an external port mapping. The follow-up changed only that external mapping;
the migration runner, environment values, application databases, deployment
execution, migration execution, and process restarts were not changed or run.

## Retracted migration-selection finding

The original red ledger entry is retained at
`QA/evidence/operations-execution.md:57`, with the detailed claim at
`:280-300`. It described the exact start value
`0034_provider_attempt_receipts.sql` as a defect because it did not select
`0034_agency_report_period_unique.sql`.

That premise was invalid. The runner's selection key is the complete filename,
and an exact filename resume is intentionally narrow: starting at
`0034_provider_attempt_receipts.sql` resumes at that file and does not replay
the earlier agency migration. A numeric start of `0034` is the family-level
resume and selects both files in their checked-in order:

1. `0034_agency_report_period_unique.sql`
2. `0034_provider_attempt_receipts.sql`

`tests/migration-start-version-regression.test.mjs` now asserts both semantics
and the fixed order. The production runner was not changed. Disposition:
**RETRACTED — false test premise, not a production defect.**

## Retracted deployment-contract finding

The original red ledger entry is retained at
`QA/evidence/operations-execution.md:62`, with the detailed claim at
`:259-266`. It expected `MIGRATION_START_VERSION=0022` in
`scripts/post-merge.sh`, although the intentional `500b4fe` incident baseline
uses `0020` so the incident-intelligence migrations beginning at `0020` are
included.

`tests/deployment/deploy-contract.test.sh` now asserts the intentional
`MIGRATION_START_VERSION=0020` contract and explicitly rejects a regression to
`0022`. It also checks that the host release continuously invokes the tracked
migration runner before cutover, and that full readiness health runs before the
public-listener gate and success status. These are source contracts only; no
deployment or migration was executed. Disposition:
**RETRACTED — stale test expectation, not a deployment defect.**

## Confirmed Redis exposure and minimal configuration fix

The first post-maintenance deployment-contract run stopped on this real
configuration finding:

```toml
[[ports]]
localPort = 6379
externalPort = 3001
```

That mapping made the developer Redis listener externally reachable. It was
removed from `.replit` and nothing else in the configuration was changed:

* `localPort = 5000` → `externalPort = 80` remains unchanged.
* `localPort = 5904` → `externalPort = 3000` remains unchanged.
* The `.replit` modules, environment declarations, workflow names, and
  workflow commands remain unchanged.
* `LOCAL_DEV_REDIS = "true"` remains enabled.
* The developer workflow still starts Redis internally and uses
  `redis://127.0.0.1:6379`; local Redis on 6379 is preserved for development
  and tests, but it no longer has an external `[[ports]]` mapping.
* No publishing/deployment operation was performed.

The `.replit` replacement was schema-validated with the required configuration
guard before the file was replaced. This is a confirmed configuration
security defect and a minimal fix, not a test relaxation.

## Affected offline retest

The initial maintenance retests were:

```text
node --test tests/migration-start-version-regression.test.mjs
PASS — 1 test, 1 pass, 0 fail

bash tests/deployment/deploy-contract.test.sh
EXIT 1 — existing unrelated contract rejects .replit localPort=6379
```

The migration selector test passed. The deployment contract reached the
updated `0020`, explicit `0022` rejection, migration-continuity, and readiness
ordering assertions; it then stopped at its pre-existing `.replit`
`localPort=6379` prohibition. That unrelated contract was not changed because
this maintenance scope is limited to the two retracted findings above and
production configuration must remain untouched.

Both procedures are source/static or local-contract checks. They did not load
environment files, read environment values, contact an application database,
run a migration, deploy an artifact, restart a process, contact a provider, or
open an external network connection. The deployment command's exit 1 is
retained as an unrelated existing contract result, not counted as evidence for
either retracted finding.

After removing only the external Redis mapping, the required affected static
contract was rerun:

```text
bash tests/deployment/deploy-contract.test.sh
PASS — deployment contracts passed
```

No workflow was restarted. The passing retest confirms the `0020` baseline,
explicit `0022` rejection, continuous migration invocation, readiness ordering,
and the retained prohibition on externally mapped Redis 6379.

## Evidence index

| Evidence | Meaning |
|---|---|
| `QA/evidence/operations-execution.md:57,280-300` | Original migration red result, retained unchanged and retracted here. |
| `QA/evidence/operations-execution.md:62,259-266` | Original deployment-contract red result, retained unchanged and retracted here. |
| `tests/migration-start-version-regression.test.mjs` | Passing exact-filename and numeric-family semantics/order guardrail. |
| `tests/deployment/deploy-contract.test.sh` | Updated `0020` baseline, `0022` rejection, migration-continuity, and readiness-order guardrails reached before the unrelated pre-existing stop. |
| `.replit` | Confirmed and fixed the only external Redis mapping; local developer Redis 6379 remains internal. |
| `500b4fe` | Intentional incident baseline establishing the `0020` post-merge start boundary. |