# Scheduled media storage inventory audit

The dedicated worker starts this monitor automatically alongside job monitoring.
It checks the shared schedule on startup and every five minutes, and runs one
inventory per 24 hours. No additional cron or queue worker is required.

## Scope and safety

- Reads database media owners and paginated object **listings only**. It does
  not read object bodies, copy, repair, delete, or change database owners.
- Missing owned objects means absent from **primary** storage, even if legacy
  fallback would still serve them. Duplicate database references count once.
- Every legacy object absent from primary is flagged, including objects without
  database owners. A new legacy-only object cannot be silently accepted into a
  new baseline.
- Orphans are **unreferenced candidates**, not proven garbage. Backups, temporary
  uploads and owners outside the inventoried fields can contribute to totals.
  They are counted for observation only. Never delete based on this audit.
- This is not byte parity certification. It cannot detect corrupted contents or
  a replacement at the same key that exists in both buckets. The historical
  migration evidence remains separate and untouched.

## Coverage and configuration

The worker uses its existing database and Redis configuration, plus the same
`DO_SPACES_ENDPOINT`, `DO_SPACES_BUCKET`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`,
`STORAGE_PREFIX`, and `DEFAULT_OBJECT_STORAGE_BUCKET_ID` as migration/storage.
Do not paste credentials or signed URLs into reports or logs.

The legacy bucket requires the Replit credential sidecar. A DigitalOcean host
without it can check primary ownership but **cannot** detect unowned legacy-only
writes. It reports `INCOMPLETE`, leaves unavailable counts `null`, and notifies
admins about the coverage gap. It never substitutes an empty legacy bucket.
For full ongoing coverage, run a worker in an environment that can list both
buckets and uses the database/Redis for the audited environment. A primary-only
production report is not proof that legacy writes have stopped.

`npm run storage:audit` performs a one-shot diagnostic inventory using
`.env.local`. On hosts with injected environment configuration, use
`node --import tsx/esm scripts/audit-media-storage.ts` instead. This command
prints one bounded JSON report and exits 0 (PASS), 1 (DRIFT), or 2 (INCOMPLETE).
It does not send notifications or update the worker schedule/history.

## Alerts and history

Missing owned objects, legacy-only objects, invalid owner references, or
unavailable inventories generate private in-app system notifications to active,
non-deleted platform admins. Notifications contain counts and coverage, never
keys or URLs. The existing notification bell displays these alerts.

Operator Redis inspection (use the normal secured Redis access method):

```text
GET media-storage-audit:last-run
LRANGE media-storage-audit:history 0 89
GET media-storage-audit:retry-after
```

History retains the latest 90 bounded reports, newest first. Use `finishedAt`
with `counts.orphanedPrimaryObjects` / `counts.orphanedLegacyObjects` to trend
growth; compare only matching non-null `scopeId` and known counts. Alert messages
also include orphan deltas against the latest report in that scope. The scope
is a SHA-256 identity fingerprint, not a bucket name. Changes in bucket/prefix or
legacy coverage do not silently mix trend baselines.

History shares Redis's existing persistence/backup policy. Redis loss or
eviction loses this history and causes a fresh audit; it is not an independent
long-term archive. Logs emit sanitized structured `media_storage_audit` counts.

Inventory reports and samples have fixed bounds (20 hashed identifiers per
category). No provider error text, credentials, owner URLs, or signed URLs are
included. To investigate a sample, an authorized operator can hash an exact
object key with SHA-256 and compare it; don't publish raw media URLs.

Alert or persistence failure logs a fixed error and retries after one hour.
Successful `INCOMPLETE` reports are recorded and alerted daily like drift.
Redis locking prevents concurrent workers from running the same audit.
Provider listings have deadlines; failed or partial listings never become a
passing report. If notifications are absent, check worker logs and last-run
freshness before assuming storage is healthy.

## Response

1. Check coverage first. Restore inventory credentials/connectivity if unknown.
2. For missing owned objects, investigate the database reference and both
   providers; use the separate migration process if a copy is needed.
3. For legacy-only objects, identify the writer still using the old provider.
4. Observe orphan growth over successive runs. Review ownership separately;
   this monitor never authorizes cleanup.

Offline regression checks: `npm run test:storage-audit`.