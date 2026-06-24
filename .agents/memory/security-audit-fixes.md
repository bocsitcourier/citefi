---
name: Security audit fixes T001-T005
description: Patterns and rules from the 5 security fix groups applied in the launch-readiness audit.
---

## Rules

### 2FA challenge token: always consume atomically
Use a single conditional UPDATE instead of SELECT → UPDATE:
```typescript
const [consumed] = await db.update(emailVerificationCodes)
  .set({ isUsed: 1 })
  .where(and(
    eq(emailVerificationCodes.userId, userId),
    eq(emailVerificationCodes.code, token),
    eq(emailVerificationCodes.purpose, purpose),
    eq(emailVerificationCodes.isUsed, 0),
    gt(emailVerificationCodes.expiresAt, new Date())
  ))
  .returning({ id: emailVerificationCodes.id });
if (!consumed) return 401;
```
A two-step SELECT→UPDATE allows two concurrent requests to both read isUsed=0 before either writes.

**Why:** PostgreSQL UPDATE takes a row-level write lock; the first writer wins, the second sees isUsed=1 in WHERE and gets 0 rows — atomic without serializable isolation.

### Credit grant reversals: preserve idempotencyKey
When revoking a grant in `revokeGrantCredits()`, do NOT clear `idempotencyKey`:
```typescript
.set({ reversedAt: new Date() })  // NOT idempotencyKey: null
```
`grantCredits()` checks for an existing row by idempotencyKey before granting. If the key is preserved on the reversed row, Stripe webhook retries with the same invoice ID short-circuit harmlessly.

**Why:** Clearing the key after reversal allows a delayed/retried `invoice.paid` webhook to re-grant the refunded credits.

### Concurrent cap bypass: pending-reservation-first
`checkUsageCap` inserts a PENDING reservation BEFORE reading the total spend. Concurrent submissions see each other's reservations in the SUM, preventing double-booking at READ COMMITTED.

Safety net: only count pending events < 2 hours old in enforcement queries — stale reservations auto-expire and can't permanently block the cap.

Cancel the reservation on ALL pre-enqueue failure paths, not just queue errors.

### TOCTOU for ownership checks: repeat predicate in UPDATE WHERE
For content approval and any "read-then-mutate" pattern, repeat the ownership/tenancy predicate in the UPDATE WHERE clause. Check `returning()` row count; return 404 if 0 rows to distinguish "not found" from "forbidden".

### Transaction wrapping: delete cascades
All multi-step sequential deletes (account delete, admin user delete) must be wrapped in `getTxDb().transaction()`. Stripe API calls stay outside — they are not reversible and should be best-effort.
