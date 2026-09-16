# Restart crash-boundary fixture maintenance

This receipt records the fixture-only maintenance for
`tests/pipeline/restart-crash-boundaries.test.ts`. No application database,
service, provider, production code, migration, immutable guard, or external
network was used or changed.

## Historical red evidence

The exploratory Redis-enabled isolated run is retained at
[`extended-database-execution.redis.log`](extended-database-execution.redis.log).
Its two failures were:

* `a pre-stage claim crash is retried and completed under the same run ID`
  reached the production article-output gate because the stub returned
  five plain-text words without a Markdown heading. Its `finally` cleanup then
  failed deleting the article because the worker's own `error_logs` child row
  remained.
* `stalled BullMQ redelivery waits for lease expiry and fences the real article
  processor` reached the same gate because the stub returned four plain-text
  words without a Markdown heading. Its `finally` cleanup hit the same
  dependent-row failure.

The retained receipt reports `8` cases, `6` passed, `2` failed, `0` skipped,
and `HARNESS_EXIT=1`. These are fixture incompatibilities, not a production
defect or provider call.

## Fixture maintenance

* Both existing stub-provider paths now return the same deterministic,
  structured Markdown article with headings, terminal punctuation, a
  canonical `https://example.test` Markdown destination, and an explicit
  `120`–`160` requested word range. The fixture's visible count is `154`.
* The seed batch persists that requested range so the fixture exercises the
  persisted contract rather than relying on mutable defaults.
* Cleanup deletes only the fixture's article- and batch-scoped `error_logs`
  children before deleting its `article_runs`, article, batch, team
  membership, team, and user; no table truncation or immutable-guard bypass is
  used.

## New isolated QA result

The owning QA run must record the exact command and final TAP/harness receipt
here after execution:

```text
QA/support/with-isolated-database.sh --with-redis -- \
  tests/pipeline/restart-crash-boundaries.test.ts

# result: pending isolated QA execution
```
