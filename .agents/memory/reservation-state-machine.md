---
name: Reservation state machine
description: credit_ledger reserve rows enforce RESERVED→DEBITED|RELEASED; CAS rules, throw-on-guard-failure invariant, sweeper per-reservation remaining calc.
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
| releaseReservation | amount < reservation.amount | none | releaseKey in reason LIKE |

## Sweeper
Every 6h on `reservation-sweeper` queue. For each RESERVED row older than 24h:
1. Compute `remaining = reservation.amount − sum(|debits|) − sum(prior_releases)` from the ledger (never from team-wide `reservedCredits` aggregate — that would over-release)
2. If remaining ≤ 0: directly flip status to RELEASED (no balance change)
3. If remaining > 0: call `releaseReservation(amount=remaining)`, then directly flip status to RELEASED

**Why:** Team-wide `reservedCredits` aggregate must not drive per-reservation sweeping.

## DB indexes
- `credit_ledger_reservation_status_idx`: partial WHERE `reservation_status='RESERVED'`
- `credit_ledger_debit_jobid_unique_idx`: UNIQUE on `(team_id, run_id, job_id) WHERE event_type='debit' AND job_id IS NOT NULL` — backstop for concurrent batch-article duplicate debits
