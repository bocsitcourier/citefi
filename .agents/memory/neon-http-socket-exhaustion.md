---
name: Neon HTTP socket exhaustion
description: fire-and-forget Neon HTTP DB tasks accumulate concurrent connections and exhaust Node.js's per-host socket limit, hanging subsequent requests
---

## The Rule
Never use `db` (Neon HTTP driver) for any DB call that may run concurrently with another — this includes fire-and-forget tasks (`promise.catch(...)` with no await), background notification dispatchers, and any code that fans out to multiple DB calls in parallel.

**Why:** Node.js's default HTTP agent limits sockets to 5 per hostname. The Neon serverless HTTP driver opens one socket per query. If 5+ fire-and-forget tasks are inflight simultaneously (each doing a Neon HTTP query), the 6th query in the main request handler queues behind them and hangs indefinitely — no timeout, no error.

**How to apply:** Use `getTxDb()` (TCP pooled pg, no per-request socket) for any DB operation that:
- runs outside the synchronous request→response path (fire-and-forget)
- fans out concurrently (`Promise.all`, `map`, background scheduler)
- is called from a notification or event emitter that may fire multiple times quickly

Corollary: the Neon HTTP driver also serializes JS `null` as `""` (empty string) for integer columns, causing `invalid input syntax for type integer: ""` errors. `getTxDb()` (node-postgres) serializes `null` correctly as SQL NULL.

## Affected Files (at time of discovery)
- `lib/notification-service.ts` — all `db.` calls migrated to `getTxDb()`
- `app/api/auth/signup/route.ts` — all `db.select()` migrated to `txDb` (getTxDb() instance)

## Symptoms
- A sequential stress test (e.g., 5+ signups in a loop) hangs on the 6th request
- Server log shows the previous responses completing normally but the next request never resolves
- No timeout error — just an infinite await on `fetch` to Neon HTTPS endpoint
- "Duplicate email" check was 3× slower than expected (prior socket contention even for 1-2 concurrent notifications)
