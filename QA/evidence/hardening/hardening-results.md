# Architect-led hardening results

## Scope and disposition

Implemented focused source hardening with an architectural lead and two
specialists reviewing identity/role and financial/concurrency scenarios.
Regular users, team admins/owners, client reviewers, and platform administrators
are represented in the scenario reports. This is not a promise that every
possible future failure has been eliminated.

Changes are in the workspace, not published to production. No production
deployment, database migration, public post, or paid generation QA was performed.
The app workflow was restarted and its public landing page rendered successfully.
Anonymous authentication requests returned expected 401 responses.

## Implemented safeguards

1. Website ping, signed publishing POST, and verification use DNS-pinned,
   public-address-only, bounded transport. Signed POST never follows redirects.
   Receiver publishing requires HTTPS. HEAD verification correctly ignores
   entity size while retaining network checks.
2. Unsupported social channels are rejected before connection/job creation.
   Existing Facebook/LinkedIn/TikTok source is not advertised as integrated
   automatic publishing. These channels remain unavailable in the central
   dispatcher; enabling and destination-testing them is separate work.
3. Publishing requires an active, undeleted, team-matching connection, rechecked
   under a connection lock at the dispatch claim. A committed revocation fences
   later claims; it cannot undo an already-claimed external operation.
4. Publishing claims are conditional and atomic, with per-attempt timestamp
   fencing on success, rejection, and exception updates. POST response and failure
   updates cannot overwrite callback-driven delivered/retry states. Dispatched
   job records cannot be deleted in a concurrent claim race.
5. Callback receipt insertion and state changes share a transaction with a job
   lock. Identical parsed events are deduplicated, every accepted status has a
   bounded transition, and delivered jobs cannot regress. Provider event-ID
   contracts and true database-backed concurrent callback tests remain future
   coverage; identical-payload deduplication is not universal event identity.
6. Schedule claiming uses the persisted cron and timezone, and creates the
   interrupted-run record in the same transaction. The installed parser API is
   exercised directly. Invalid configuration is rejected rather than replaced
   with an unrelated 24-hour schedule; invalid legacy initialization does not
   prevent valid schedules from starting.
7. Both social scheduling endpoints share future-date and terminal-state
   validation, with tenant/status/time predicates repeated at the final write.
8. Scheduled research/title work now follows spending-cap and credit
   reservations. Short title pools shrink holds idempotently; uncertain
   provider/accounting/queue outcomes retain reconciliation holds.
9. Pending cap holds are not excluded merely because they are two hours old.
   Explicit cancellation or settlement is required. This intentionally can
   block new spending longer when an old operation is unresolved.
10. Team admin/owner removals serialize their last-admin check. Recovery
    issuance invalidates competing credential channels under the user lock.
11. Negative admin credit adjustments cannot consume used, indebted, or
    reserved credits, nor over-remove a bucket and misstate the ledger delta.
12. Article requests use model-family-appropriate thinking controls, verified
    through the installed SDK's actual mocked HTTP serialization. Word-count
    instructions cover the complete article and FAQs, and require real target
    hyperlinks. Thinking level is retained in attempt metadata. Terminal
    provider outcomes are preserved rather than triggering critique fallback.
    No successful real article is claimed from these changes.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Hardening sandbox regressions | 43 distinct cases pass; no skips | Original 42 in `sandbox-regressions.tap`; changed 14-case publishing/scheduling suite rerun in `dispatch-fence-regressions.tap`, including one added dispatch-fencing case |
| Provider accounting boundaries | 10/10 pass | `accounting-boundary.tap` |
| Isolated HTTP authentication/MFA | 35/35 pass | `auth-regressions.log`; owned PostgreSQL/Redis cleaned up |
| Article route/queue/worker fixture | 5/5 pass | Second phase of `full-sandbox-run.log` |
| Media route/worker fixture | 5/5 pass | `media-fixture.log` |
| TypeScript | Exit 0 | `typecheck.log` |
| CLI Live/Auto without configured live runner | Explicit BLOCKED, exit 2, no sandbox fallback | `runner-live-blocked.json`, `runner-auto-blocked.json` |
| App startup/public preview | Running; landing rendered | Workflow and screenshot check |

**98 passing tests across distinct delivered suites, zero skipped.** Coverage
includes runtime policy/transport checks, source contracts, isolated auth HTTP
fixtures, and injected-provider generation fixtures. Do not represent source
assertions as database concurrency proof, or fake media as real-provider output.

The first combined CLI run correctly failed when the media phase had the wrong
owned-port allowlist. Its log is retained, not rewritten. The corrected media
phase subsequently passed using the same clean environment and guard now
configured in the CLI. Earlier SDK/cron test failures were fixed before the
passing checks listed above.

`npm run test:e2e` now runs offline hardening checks and the owned article/media
fixtures. `--mode=live` and `--mode=auto` fail explicitly until a live runner is
configured. The CLI is **not** the requested full signed-in QA dashboard.

## Remaining release blockers and coverage limits

- A real usable article, final production judge, real image/video/podcast
  retrieval/playback, and external publication are not newly certified.
- Authenticated deployed QA still requires a named dedicated workspace/account,
  configured in-app credit budget, and destination-specific public-post approval.
  The existing $30 external ceiling remains authorized.
- The app startup reports missing publishing encryption configuration and a
  missing canary accounting owner; worker readiness remains false. Do not create
  a replacement encryption key blindly: existing ciphertext must remain usable.
- Production logs separately show recurring database/worker timeouts. The
  workspace restart and passing fixtures do not establish production recovery.
- Durable interrupted-run evidence is implemented, but autonomous recovery of
  ambiguous provider/queue outcomes is not. Reconcile before replaying.
- A full integrated QA dashboard and destination-certified social dispatcher
  remain unimplemented.
- Database-backed concurrent membership/callback/scheduler/credit mutation tests
  and a signed-in browser pass over every role remain missing coverage.

Overall: materially hardened source with passing targeted verification, but
**not yet “platinum” production certification**.

## Supporting scenario reports

- `architect-future-scenarios.md` — architect's reviewed snapshot, priorities,
  role/scenario matrix, and invariants. Some findings were fixed after this
  snapshot; use this results document for the final disposition.
- `role-scenarios.md` — identity and admin lifecycle review.
- `cost-scenarios.md` — credit reservations, adjustments, and queue ambiguity.
  Its noted cap-age expiry and terminal critique fallback were subsequently fixed.
