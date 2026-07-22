---
name: Neon null rows shim
description: @neondatabase/serverless v0.10.x returns rows:null (not []) for zero-row results, crashing the driver. Fix via neonConfig.fetchFunction in lib/db.ts.
---

## Rule
Always apply the `_neonFetch` shim in `lib/db.ts` via `neonConfig.fetchFunction`. The shim normalises `rows: null → []` and `fields: null → []` in every Neon HTTP response before the driver processes it.

**Why:** @neondatabase/serverless v0.10.x (used on Replit) returns `{"rows": null, "rowCount": 0}` instead of `{"rows": [], "rowCount": 0}` when a SELECT query matches zero rows. The driver then crashes with `TypeError: Cannot read properties of null (reading 'map')` inside `processQueryResult`. This caused every learning-dashboard endpoint, notification list, and batch-submit intelligence-gate query to return 500 whenever a table was empty — silently blocking generation and hiding all failure data.

**How to apply:** The shim is set once globally at module load in `lib/db.ts` via `neonConfig.fetchFunction = _neonFetch`. It intercepts only JSON responses and is a no-op for non-JSON and for already-correct responses. Do NOT remove it; the Neon serverless driver version on Replit will not be upgraded to fix this automatically.

## Worker error logging rule
All `db.insert(errorLogs)` direct calls in `lib/worker.ts` have been replaced with `logError()` from `lib/error-logger.ts`. Never go back to direct inserts — `logError()` is the canonical path: it writes to `error_logs` AND fires Slack webhook. ErrorType must be one of the enum members in `lib/error-logger.ts` (GEMINI, GPT4, DALLE, SCHEMA, UPLOAD, QUEUE, HERO_IMAGE, PODCAST, VIDEO, PUBLISHING, SOCIAL, NETWORK, AUTH, SYSTEM).

## Batch-submit outer catch
`app/api/jobs/batch-submit/route.ts` hoists `let _batchId: number | null = null` before the outer try so the outer catch can reset `status → PENDING`. Without this, any unexpected throw between the SUBMITTING update and pg-boss enqueue leaves the batch stuck in SUBMITTING forever.
