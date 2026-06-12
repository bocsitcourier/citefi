---
name: Neon HTTP driver has no interactive transactions
description: Why this app keeps a second pooled pg client just for atomic multi-step writes
---

# Neon HTTP driver cannot do interactive transactions

The default `db` in `lib/db.ts` uses the Neon **serverless HTTP** driver. HTTP is
stateless, so `db.transaction(async (tx) => ...)` is NOT supported — multi-step
writes are non-atomic.

**Rule:** For any multi-statement write that must be atomic (e.g. signup =
user + activity log, article delete cascade), use `getTxDb()` — a lazily-created,
bounded (`max:5`) **pooled** `pg` client (`DATABASE_POOLED_URL ?? DATABASE_URL`)
wrapped by drizzle. Use `txDb.transaction(...)`. Keep everyday single-statement
reads/writes on the HTTP `db`.

**Why:** Opening one small extra pool in the long-running Next process is cheap
and the only way to get real BEGIN/COMMIT semantics alongside the HTTP driver.
Leave headroom (pg-boss housekeeping needs connections too).
