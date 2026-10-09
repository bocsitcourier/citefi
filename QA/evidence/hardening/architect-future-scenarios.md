# Architect review: publishing, scheduling, and role-driven future scenarios

## Scope and evidence standard

This is a source-level review of the current uncommitted publishing, scheduling,
callback, and network-safety diff, plus the identity and billing hardening
reports. It is not a production QA-dashboard run and does not claim runtime,
database-concurrency, external-provider, or deployment verification. No app
code was changed and no tests were run for this review.

“Confirmed” below means the behavior is directly visible in the reviewed source.
Impact may still depend on a product decision (for example, whether any team
member is allowed to publish). “Conditional” means the failure requires a
specific timing or provider behavior and is called out as such.

The identity report records fixes for concurrent last-owner/admin removal and
cross-channel password-reset invalidation. The cost report records the locked
credit-adjustment invariant. Those are material improvements, but neither makes
the publishing side effect, schedule-run lifecycle, or provider-outcome
reconciliation atomic.

## Role and scenario matrix

| Actor / boundary | Current control and observed behavior | Hostile or future scenario | Minimum platinum-standard control |
| --- | --- | --- | --- |
| Anonymous caller | User-facing publishing/schedule routes use `withAuthenticatedTeamContext`; the callback route instead authenticates an HMAC with a connection key and a five-minute header timestamp (`app/api/publishing/callbacks/route.ts`). | Unauthenticated large callback bodies are read before HMAC verification; replaying an identical parsed payload is deduplicated, but there is no stable receiver event ID. | Apply a strict streaming/body-size limit before parsing; rate-limit failed HMACs; use a durable callback event ID with a unique `(job,eventId)` constraint. |
| Team member / author | `withAuthenticatedTeamContext` accepts owner, admin, or member roles (`lib/api/auth.ts:56–62,486–520`). Job creation, connection create/delete, schedules, and social scheduling use this member-level wrapper (`app/api/publishing/jobs/route.ts:73–134`, connections routes, schedule routes, social-post routes). | A member can create a destination, enqueue publication, delete a connection, create recurring schedules, or schedule social content. Whether this exceeds the member role is policy-dependent; it is not an admin-only path today. | Define capabilities separately (manage destination, publish, schedule, approve auto-publish). Require the chosen capability at both API entry and worker dispatch. Require explicit confirmation of destination and spend for auto-publish. |
| Team owner / admin | Same publishing authorization path as members. The identity report says the team membership-removal transaction now locks and recounts both `admin` and `owner` before removal (`QA/evidence/hardening/role-scenarios.md:12–23`). | An owner/admin can remove a member or delete a destination while publication work is queued or in flight. Deleting the connection does not currently fence every already-queued publishing job (see P1 below). | Keep the last-owner/admin invariant, and define revocation semantics: block new dispatch after revocation, retain in-flight/callback correlation, and expose an auditable “already dispatched” outcome. |
| Agency admin acting in a client team | `requireTeamMember` maps qualifying parent-agency owner/admin membership into the client-team context (`lib/api/auth.ts:494–520`). | An agency administrator can act on client destinations and publication workloads. Agency membership alone does not express which client destinations, channels, or spend limits the person may control. | Make delegated capabilities and client-level destination grants explicit; log the effective actor, agency, client, and policy decision on every external dispatch. |
| Client reviewer / viewer | The team-member helper’s accepted direct roles are owner/admin/member; the identity report records reviewer-specific write rejection (`QA/evidence/hardening/role-scenarios.md:46–53`). | A future route that uses generic session/team context instead of the content-editor/capability guard could accidentally widen reviewer access. | Centralize route capabilities and retain RLS as defense in depth; add reviewer denial coverage for each new publishing/scheduling mutation. |
| Platform administrator / support operator | The identity report records a shared platform-admin lifecycle lock and recent-MFA checks on sensitive reset actions. The billing report records a balance-row lock and a guard against removing used, debt, or reserved credits. | An administrator may still make a valid but broad adjustment or alter a destination/tenant while work is in flight. A control-plane change cannot retract a provider request already dispatched. | Preserve MFA, actor/reason audit, and locked invariants. Add scoped confirmation/approval for unusually large grants, destination changes, and destructive reconciliation; never treat admin action as a way to bypass the same job state machine. |
| Scheduler / publishing worker | The schedule poller now uses a transaction, due-row lock, and `SKIP LOCKED` claim; the website adapter uses pinned public-address fetches and HTTPS for publishing. | Multiple pollers claiming one row is addressed, but process death, stale schedule configuration, and connection revocation after queueing are separate lifecycle cases. A network timeout can leave provider outcome ambiguous. | Use durable run/job identities, lease/recovery records, status compare-and-set transitions, active-connection fencing, and idempotency keys at the receiver boundary. |
| Website receiver / callback sender | Callback HMAC binds the raw body; bundled receiver retries an event in-process. The publishing request includes a job ID. | Receiver process exit can lose an in-memory callback retry; a POST timeout may occur after the receiver committed the content; a different body for the same logical event bypasses JSON-equality deduplication. | Persist receiver callback events in an outbox; include a stable callback event ID; make receiver writes idempotent on stable publishing job ID; reconcile unknown outcomes rather than blindly replaying. |

## Prioritized findings

### P1 — callback success can still be overwritten by the POST worker (confirmed in the reviewed snapshot)

The callback handler now serializes receipt lookup/insertion and its job-state
change with a `FOR UPDATE` lock (`app/api/publishing/callbacks/route.ts:142–194`).
However, the publishing worker's HTTP-response path updates the same job outside
that lock and without a status predicate (`lib/publishing/index.ts:501–564`);
the catch helper likewise writes `failed` by ID alone (`:585–594`).

The bundled receiver sends its callback immediately after responding to the
publish request. If the callback reaches the app first, it can set `delivered`;
the original POST worker can then write `sent` (or a failure/retry state) and
regress the terminal result. The receiver has already received a successful
callback response and need not retry. This is a timing-dependent but
demonstrable state-machine race, previously reported early to the parent.

**Minimum fix:** claim processing with compare-and-set; make all response,
failure, retry, and callback transitions conditional on allowed prior states;
never allow a late POST result to move `delivered` backward. Add the planned
owned regression for callback-before-POST-result and its inverse. The reviewed
snapshot still contains the unguarded worker writes; treat the parent’s planned
fix as pending until the updated source and regression are present.

### P1 — connection revocation does not fence already-queued dispatches (confirmed)

The connection DELETE route calls the soft-delete helper (`app/api/publishing/
connections/[id]/route.ts:46–65`). New job creation checks the team connection
exists and has an adapter, but does not require active status
(`lib/publishing/index.ts:259–266`). The public job endpoint rejects only
`status === "error"` (`app/api/publishing/jobs/route.ts:90–100`), while
`processPublishingJob` subsequently loads the connection by ID and does not
recheck status/deletion before calling the adapter (`lib/publishing/index.ts`,
worker path around `:405–500`). Thus a pending/disabled connection can be
accepted by the direct API, and a job queued before soft deletion can still
dispatch after the user believes the connection was removed. Auto-publish
filters selected connections to active/pending (`lib/worker.ts:6729–6748`), but
that does not protect a connection revoked after job creation.

**Minimum fix:** require the intended active/verified state at job creation and
at worker claim; fence a queued job against a deleted/disabled connection before
network dispatch. Preserve a tombstone and accept a late authenticated callback
as reconciliation if a request was already dispatched. Explicitly document that
revocation cannot undo a request already on the wire.

### P1 — schedule-run claim is not a durable run/outbox transaction (confirmed crash window)

The worker advances `nextRunAt` while claiming a due schedule in a transaction
(`lib/scheduled-content-worker.ts:12–48`), but creates the `scheduleRuns` row
after that transaction and only later submits the generation batch/queue work
(`:57–190`). A process crash after the claim but before recording the run loses
the claimed occurrence; a crash after recording `started` but before queue
submission can leave a permanent started run. A later cron occurrence may run
without reconciling that incomplete one.

**Minimum fix:** transactionally create an immutable run record keyed by
`(scheduleId, scheduledFor)` and an outbox/queue intent when claiming. Workers
should use a lease and idempotent run ID; a reconciler should retry or explicitly
mark abandoned work. Do not rely on an in-memory catch block for crash recovery.

### P1 — recurring schedule provider work precedes usage/credit reservation (confirmed ordering; exposure is budget-policy dependent)

`executeScheduledRun` performs research/title-pool generation before the later
usage-cap check and credit reservation (the provider work is in
`lib/scheduled-content-worker.ts` before the `checkUsageCap`/`reserveCredits`
block). A member can create recurring schedules through the team-member route;
the schema permits up to 25 articles per run and does not impose a visible
per-team schedule-count or minimum-frequency quota. The schedule schema defaults
`autoPublishEnabled` to true, though actual auto-publishing also requires
non-empty selected connection IDs (`lib/worker.ts:6708–6715`).

This is not evidence of an unbounded bill—the later cap and credit reservation
still exist—but it means a rejected run can already have incurred provider
work, and a large set of frequent schedules can amplify that work.

**Minimum fix:** preflight/reserve an upper bound before provider calls, reconcile
actual usage afterward, and release reservations on every failed path. Add
team-level limits for active schedules, minimum cadence, articles per interval,
and authorized monthly spend. Make auto-publish opt-in with explicit
destination(s), spend limit, and actor audit.

### P2 — callback equality deduplication is not a durable event identity/state machine (confirmed)

The callback route uses equality of the parsed JSON payload for duplicate
detection, serialized under the job-row lock. This protects exact retries of
the same body. It does not identify a logical event if a receiver reconstructs
it with a changed body/timestamp. There is no stable event ID/unique event
constraint in the reviewed schema. Also, every non-success status is treated as
a retryable failure and increments attempts; `failed` or `cancelled` can be
revived, while a late `success` can mark even a locally cancelled job delivered.
That may be necessary to record a real remote side effect, but it should not
silently erase cancellation semantics.

**Minimum fix:** define an allowed transition table, distinguish definitive
failure from partial/unknown/retryable outcomes, correlate callback to the
specific attempt, and preserve a separate “remote outcome after cancellation”
state. Give callbacks a stable event ID and a durable receiver outbox. Validate
success payload requirements (including `pageUrl`) before marking delivered.

### P2 — job creation and ambiguous provider outcomes need idempotency (confirmed API behavior; duplicate side effect is receiver-dependent)

`POST /api/publishing/jobs` validates team ownership of the content but has no
client idempotency key (`app/api/publishing/jobs/route.ts:73–134`); each
accepted retry creates a new job. A timeout after remote commit is also
ambiguous: the adapter can report a network failure and the worker can retry,
while the receiver may already have committed the article. The request includes
a stable ID per job, but the external receiver contract does not establish that
all configured receivers deduplicate on it.

**Minimum fix:** accept a caller idempotency key scoped to team/connection/
content revision; enforce uniqueness and return the original job on retries.
Pass a stable `Idempotency-Key` to the receiver and require durable receiver
deduplication. Represent timeout-after-dispatch as `unknown` until callback or
reconciliation rather than assuming failure.

### P2 — users can delete dispatched jobs and sever callback reconciliation (confirmed)

The jobs DELETE route allows deletion of any team job except those whose
observed status is exactly `processing` (`app/api/publishing/jobs/route.ts:
143–180`). A `sent` or otherwise dispatched job can therefore be deleted even
though a receiver may still be publishing or may send a callback. The callback
then has no durable job row to correlate to. This also removes the audit trail
for a side effect that may already have occurred.

**Minimum fix:** use cancellation/tombstones rather than deleting job history;
only hard-delete jobs that are provably never dispatched and have no callback
receipts. Make cancellation conditional on state and expose “in flight / outcome
unknown” rather than presenting deletion as revocation.

### P2 — schedule configuration can be overwritten by a stale run; malformed legacy schedules can resist pause (confirmed)

The worker retains a snapshot of the claimed schedule and later writes
`nextRunAt` based on that snapshot. If an admin edits cron/timezone while the
run is in flight, the later completion/failure path can replace the new
`nextRunAt` with a date computed from the old configuration
(`lib/scheduled-content-worker.ts`, claim and completion/failure paths;
`app/api/schedules/[id]/route.ts:100–123`). Use a configuration version or
compare-and-set and never overwrite a newer administrator edit.

The PATCH route also calls `calculateNextRun` unconditionally, even when only
pausing or changing the schedule name. A malformed legacy cron/timezone can
therefore prevent an admin from pausing that schedule. Validate/recalculate
only when the cron/timezone changes; allow pause/delete as a repair path even
when legacy configuration is invalid.

### P2 — social schedule concurrency is only status-versioned, and audit writes are separate (confirmed)

The shared helper validates future time and updates only if the row still has
the previously observed status (`lib/social-scheduling.ts`). This is a useful
cross-route guard against competing status changes. Two concurrent reschedules
of an already-`SCHEDULED` post both satisfy that same status predicate, however;
last writer wins without a conflict response. The route writes the social-post
log after the update, so a log failure can return an error after the schedule
already changed.

**Minimum fix:** use an `updatedAt`/version or expected prior `scheduleAt`
compare-and-set for reschedule operations and write the audit event in the same
transaction. Keep the explicit terminal-status rule and test scheduled-vs-posted
and cancel-vs-reschedule interleavings.

### P3 — connection readiness and outbound size limits are weaker than the publish boundary

`testConnection` marks a connection active when an unauthenticated status ping
returns HTTP success (`lib/publishing/index.ts:203–230`); this proves reachability,
not that the receiver recognizes the stored API key or supports publishing.
Also, the safe-fetch limits bound response bytes, not the POST request-body
size. These are lower priority than dispatch fencing and idempotency.

**Minimum fix:** use an authenticated signed capability challenge before
marking a connection publish-ready; impose an explicit maximum serialized
request-body size before POST; validate callback/result URLs as HTTP(S) URLs
under the intended receiver/public-host policy before storing or presenting
them.

## Cross-cutting design invariants

1. **Monotonic truth:** a late response cannot regress `delivered`; terminal
   cancellation and external delivery must be represented without hiding either
   fact.
2. **One logical side effect, one durable identity:** job retries, caller
   retries, receiver callback retries, and scheduler retries all carry stable
   IDs with uniqueness enforced at the database boundary.
3. **Revoke-before-dispatch:** a disabled/deleted connection, removed
   authorization, paused schedule, or revoked credential prevents new dispatch.
   Work already sent is explicitly “in flight/unknown” and remains correlatable.
4. **Budget-before-provider:** reserve the maximum authorized spend before
   expensive generation or publishing; settle/release idempotently and retain
   ambiguous charges until reconciled.
5. **Recoverable scheduler:** a due occurrence is either durably queued, durably
   failed, or owned by a time-bounded lease; no process crash can silently eat
   the occurrence.
6. **Actor-aware authorization:** user-facing operations record the actual user,
   effective team/client, delegated role, destination, and spend decision.
   Workers revalidate state at dispatch rather than inheriting stale UI
   authorization.
7. **Public network boundary:** resolve and pin every outbound destination,
   reject redirects for signed/mutating POSTs, cap request and response sizes,
   and never treat a URL supplied by a receiver as trusted.

## Review disposition

The URL pinning/HTTPS change, unsupported-channel rejection, schedule row claim,
shared social schedule validator, callback transaction, team admin-membership
lock, password-reset invalidation, and credit-adjustment lock are directionally
sound. The callback transaction fixes duplicate receipt races for identical
payloads, but it does not alone serialize against the worker’s unguarded state
writes. The top release gates from this snapshot are the callback/POST
monotonic-state race, revocation fencing, and durable/idempotent scheduler and
provider outcomes. The planned parent CAS/claim work should be verified with
its targeted regressions; this review intentionally does not rerun tests or
claim that CLI sandbox results equal the requested production QA dashboard.
