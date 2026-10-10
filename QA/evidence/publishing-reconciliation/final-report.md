# Publishing reconciliation verification

Date: 2026-10-09. Scope: delivery evidence/adjudication only.

## Implemented

- Private owner/admin operator dialog and bounded evidence API.
- Exact signed native proof bound to original public job ID, submission attempt,
  formatted-content hash, receiver origin and original key fingerprint.
- Locked live membership checks and status/attempt/update-time CAS decisions.
  Concurrent identical decisions succeed idempotently; competing decisions fail.
- Accepted resolves Delivered. Irrevocably fenced non-acceptance resolves
  not-accepted without resetting/enqueuing the original. Separately confirmed
  replacement creates one linked operation with fresh approval and unchanged
  payload/destination checks. Repeated proven rejections retain the entire chain.
- Contradictory evidence remains retained, is visibly flagged for investigation
  (including client-safe summaries), and prevents pending replacement submission.
- Missing/negative/ambiguous receiver responses and legacy jobs never grant retry
  permission, including legacy records with missing attempt timestamps.
- Bundled receiver atomic private claim/receipt ledger and authenticated read-only
  receipt lookup. Negative proof and native read capability require explicit
  durable shared-volume attestation; default installations cannot assert a fence.
- Attempt and replacement history protected from publishing deletion APIs.
  Clients get an assigned-content-only safe projection, not raw publishing rows.

## Results

- Owned disposable PostgreSQL/Redis: **21 reconciliation checks + 14 original
  publishing safety checks passed**. Receiver/paid calls: **0**.
- Offline native receipt, policy/scheduling and DNS-pinned transport suites:
  **40 checks passed after combining the latest exact-approval work** (42 before
  duplicate source-only assertions were removed during the merge).
  DNS/HTTPS receiver success/redirect/not-found cases use
  stubbed transport; no external socket was opened.
- Application and receiver strict TypeScript checks passed. A malformed generated
  Next route/validator cache appeared after application restart; regenerating the
  generated declaration set restored checks without changing source typing rules.
- Browser pass used only disposable synthetic sessions/data with external/paid
  network denied and workers disabled. Accepted and not-accepted import/decisions,
  preserved attempt/audit display, unavailable-live-read copy, member UI evidence
  hiding, member GET/POST denial and client-safe summary/API denial passed.
- Browser exposed missing import controls, now fixed. It also exposed a fixture
  callback-URL mismatch: replacement correctly returned 409, because the original
  hash included the separate auth-fixture URL. The fixture now seeds the UI
  server's exact callback URL. A local request against that corrected fixture
  confirmed two concurrent authorizations return **one successor**, while the
  original remains not-accepted with its original attempt and one replacement
  authorization audit event. No additional full browser pass was run.
- Confirmation errors now render inside the confirmation dialog, successful
  confirmations close, and the invalid paragraph/badge nesting was corrected.
- Public signed-out screenshot of the owned private publishing route rendered
  the login page normally. Protected screen verification used the browser pass.
- Existing application workflow restarted and serves requests. Pre-existing
  warnings remain: publishing encryption secret absent and development worker
  readiness false because the canary accounting owner is not configured. These
  were not changed or bypassed by this task.

## Unchanged boundaries / rollout

No live receiver authorization or customer receiver deployment was performed.
The combined publishing admission/dispatch retains the main project's exact
destination/asset review and current publisher/reviewer membership validation.
Replacement attempts carry that same review identity and never bypass it.
Platform administrators need a real owning-workspace membership for publishing;
global authority alone is not a substitute for that membership or client consent.
The client summary follows explicit assignment, including agency-owned articles,
and becomes unavailable immediately when that assignment is removed.
No real post was sent. No paid-generation records were adjudicated, settled, or
released by the publishing workflow; generation/credit/cap settlement is outside
this task. Native fixtures and all replacement requests stayed on owned isolated
data/queues with no publishing workers.

Apply the additive registered client-summary migration through the existing
versioned post-merge path. Deploy the bundled receiver source through its normal,
separately authorized release process, preserve its private receipt/claim volume,
and only opt in to fence-ready capability after verifying that durable storage.
Old receivers and unbound historical jobs remain non-retryable, not retrofitted.

See `docs/publishing-reconciliation-runbook.md` for the native wire contract,
storage assumptions, operator procedure and reproducible offline commands.
