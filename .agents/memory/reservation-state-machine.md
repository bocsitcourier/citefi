---
name: Reservation state machine
description: credit_ledger reserve rows enforce RESERVED→DEBITED|RELEASED; CAS rules, delivered-content settlement, and safe stale sweeping.
---

# Reservation State Machine

## Core rule
`credit_ledger` rows with `event_type='reserve'` carry `reservation_status VARCHAR(20)`:
- `RESERVED` — written on insert by `reserveCredits()`
- `DEBITED` — CAS transition by `debitReservation()` for **full** debits only
- `RELEASED` — CAS transition by `releaseReservation()` for **full** releases only
- `null` — legacy rows (pre-migration); handled by fallback paths

## Critical invariant: throw on balance-guard failure after CAS
After the CAS claim (RESERVED→DEBITED or RESERVED→RELEASED), if the `credit_balances` WHERE guard returns no rows, **throw — do not return**. The throw rolls back the entire transaction, restoring RESERVED status. A silent `return` would commit the terminal status with no balance update, permanently stranding the reservation.

## Full vs partial dispatch

| Operation | condition | CAS? | Idempotency |
|---|---|---|---|
| debitReservation | amount >= reservation.amount | RESERVED→DEBITED | status check + UNIQUE index |
| debitReservation | amount < reservation.amount | none | pre-lock SELECT + post-lock re-check |
| releaseReservation | amount >= reservation.amount | RESERVED→RELEASED | status check |
| releaseReservation | amount < reservation.amount | none | DB-unique hashed release claim |

## Partial-release concurrency
Keyed partial releases must claim a deterministic `credit_ledger.idempotency_key` inside the same transaction **before** decrementing `reservedCredits`. A reason-text lookup is retained only for legacy compatibility; it is not a concurrency guard. If the balance guard fails after the claim, throw so the transaction rolls back both the claim and any partial work.

**Why:** Concurrent duplicate final deliveries can both pass a read-before-write reason check. Without a unique atomic claim, each can decrement the shared batch reservation and consume credits reserved for sibling articles.

**How to apply:** Every multi-unit release must supply a stable unit-scoped `releaseKey`. Derive a bounded deterministic idempotency key from team, run, and release identity, rely on the database uniqueness constraint to choose one winner, and treat the loser as an idempotent no-op.

## Sweeper
Every 6h on `reservation-sweeper` queue. For each RESERVED row older than 24h:
0. Protect reservations linked to delivered content that is still awaiting debit settlement.
1. Compute `remaining = reservation.amount − sum(|debits|) − sum(prior_releases)` from the ledger (never from team-wide `reservedCredits` aggregate — that would over-release)
2. If remaining ≤ 0: directly flip status to RELEASED (no balance change)
3. If remaining > 0: call `releaseReservation(amount=remaining)`, then directly flip status to RELEASED

**Why:** Team-wide `reservedCredits` aggregate must not drive per-reservation sweeping.

## Delivered-content settlement
Once content is durably delivered, a failed debit is a settlement problem, not a generation failure. Persist the original billing identity before delivery, preserve the reservation, and let an independent reconciler retry the idempotent debit. Recovery must include both explicit billing-pending state and expired processing state whose content is already complete.

Image delivery follows the same rule: tag uploaded assets with the durable run identity, reuse them after a crash, and commit the user-visible image reference plus stage checkpoint atomically.

**Why:** Worker retry exhaustion must never produce either free delivered content or a duplicate provider generation.

**How to apply:** Any new content pipeline needs a durable run record, stable settlement key, delivered-content sweeper exclusion, independent settlement reconciliation, and an atomic checkpoint around externally created assets. Promote expired processing state into settlement only when the complete billing identity was persisted; legacy complete rows without that identity must remain untouched.

## Durable worker ownership
A queue delivery token is not proof that the previous processor has stopped. Never transfer a live durable lease merely because a stalled redelivery has a new queue token. Defer the redelivery until lease expiry, then resume the same run identity and checkpoints. Provider entry and user-visible writes must both require the matching, unexpired durable lease.

Legacy watchdogs must not fork any article that already has a durable run. Fresh-run recovery is safe only for pre-durable, content-empty work; terminal, checkpointed, or payload-less rows require explicit manual recovery.

**Why:** Queue lock loss and process death are not equivalent. An old processor can continue running after a queue declares it stalled, so immediate ownership transfer permits duplicate provider calls and stale content overwrites.

**How to apply:** Use a lease-aware transaction for every post-claim content mutation and external-stage checkpoint. Keep redeliveries delayed without consuming attempts or releasing reservations. Recovery must reuse the persisted run ID and original payload, and externally generated assets need the same unexpired-lease fence.

## DB indexes
- `credit_ledger_reservation_status_idx`: partial WHERE `reservation_status='RESERVED'`
- `credit_ledger_debit_jobid_unique_idx`: UNIQUE on `(team_id, run_id, job_id) WHERE event_type='debit' AND job_id IS NOT NULL` — backstop for concurrent batch-article duplicate debits
- `credit_ledger_idempotency_idx`: global UNIQUE index used by hashed partial-release claims and other ledger idempotency identities
