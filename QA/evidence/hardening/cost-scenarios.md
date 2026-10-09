# Billing and provider-cost scenario review

Scope: reservation settlement, manual credit adjustments, shared worker failure
policy, and scheduled-run admission/queue ownership. Provider submission
implementations and publishing paths were intentionally not modified.

## Confirmed issue fixed

`adminAdjust()` previously reduced the selected credit bucket without considering
credits already consumed or held by queued/in-flight work. For example, with
100 allowance credits and 80 reserved, an admin correction of `-100` could
reduce the allowance bucket to zero while leaving the 80-credit hold in place.
When the job later settled, debit allocation could increment `allowanceUsed`
past `allowanceCredits` (or book the charge to a different depleted bucket).

The adjustment now locks the team's balance row and rejects negative changes
that would reduce a bucket below its recorded used/debt amount or make aggregate
available credits fall below outstanding reservations. Positive grants and
negative corrections strictly within free balance remain supported. Regression
coverage is in `tests/security/cost-hardening.admin-adjustment.test.ts`.

## Scheduled-run admission and cleanup

Scheduled smart research and title generation now run only after the paywall,
maximum-output spending-cap hold, and credit reservation succeed; the hold is
bounded by the title generator's 50-title maximum. The stable credit identity
remains `scheduled:<scheduleId>:<scheduleRunId>`. If fewer titles are returned,
unused credits are released with a deterministic run-scoped partial-release key
and the pending cap estimate is reduced before batch creation.

Provider accounting/submission uncertainty marks the credit reservation for
reconciliation and keeps the cap hold. `AmbiguousBatchEnqueueError` uses the
same hold-preserving path; a successfully accepted queue job owns both holds,
so later scheduler bookkeeping errors do not cancel them. Uncertain identities
are recorded with the schedule run for operator correlation. Regressions are
covered offline by `tests/security/cost-hardening.scheduled.test.ts`.

The scheduler claim remains a `systemDb` transaction with `FOR UPDATE
SKIP LOCKED`, preserving single ownership of each due run.

## Inspected invariants

- Reserve ownership is unique per `(team_id, run_id)`; debit/release lock the
  authoritative row and preserve transaction rollback on balance-guard failure.
- Keyed partial releases claim a unique ledger identity before releasing funds.
- Delivered-content settlement errors and ambiguous provider/accounting errors
  are excluded from generic reservation release in the pipeline worker policy.
- Worker shutdown requests a graceful drain before force close; cancellation of
  an already-submitted provider request cannot be inferred from worker closure.
- Batch enqueue confirmation uses the existing deterministic batch job ID and
  bounded post-error lookup; an unresolved write is explicitly typed as
  `BATCH_ENQUEUE_UNKNOWN` and is not treated as a proven rejection. Lookup
  failures thrown before that typed error is constructed are conservatively
  treated as uncertain once queue submission has started.

## Risks not represented as confirmed defects

- If a reconciliation marker write itself fails after an ambiguous provider
  outcome, the wrapper logs the failure. A later stale-reservation sweep could
  potentially release an unmarked hold if the underlying database recovers.
  This scenario needs a durable independent receipt/recovery mechanism; this
  review did not change provider submission or create evidence that this failure
  is reachable in normal database operation.
- Team/user suspension does not prove that a provider request already in flight
  was cancelled. Whether that work should continue or be billed is a product
  policy question, not evidence of a billing-state-machine defect by itself.
- Existing spending-cap enforcement counts pending holds only while they are
  recent (two hours). Uncertain scheduled enqueues are not explicitly canceled,
  but enforcement may stop counting a still-pending hold after that existing
  age window; extending durable cap-hold reconciliation would require changing
  the cap policy outside this worker-only task.
