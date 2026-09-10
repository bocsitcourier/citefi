# CiteFi AI generation audit — 2026-09-10

## Executive summary

**Final review: FAIL. Production remains NO-GO.** This patch contains verified
repairs, but it is not an accepted generation-system hardening release.
The final review found additional introduced state, concurrency and settlement
regressions that passing targeted tests do not cover. Implementation iteration
has stopped; see the final verification addendum for the unresolved blockers.

**Release verdict: NO-GO for whole-platform generation certification.**

This pass repaired the demonstrated batch credit-reservation failure, restored
disabled row-level security on five policy-protected tables, hardened
batch submission/retry behavior, repaired duplicate debit settlement, and added
paid-media failure guards. It also mapped the generation system and exercised
development database/queue contracts with simulated providers.

It did **not** finish the attachment's complete live-generation acceptance
criteria. In particular, no new paid image, video or podcast was generated,
played and downloaded end-to-end, and no external post or ad was published.
Hard-crash media recovery and active cancellation remain material gaps.

**Overall health score (0–100): not assigned.** A whole-platform number would
suggest measured coverage that this audit does not have. Passing test counts
below measure specific controls, not the probability that every generator works.

## 1. What is evidenced to work

- The development database now accepts the exact conflict target used to reserve
  credits. The guard also rejects absent and unsuitable partial uniqueness.
- The screenshot's numerical case—28 articles × 10 credits, 280 required,
  10,000,000 available—passes an isolated database reservation/compensation test.
  Repeated reservation delivery creates one hold and one reserve ledger entry.
- Batch ownership and concurrent claim tests permit one submitting request and
  deny another tenant without disclosing resource existence.
- A successful debit can be replayed with an explicit amount without debiting
  again, including eight concurrent same-job attempts and a partial debit whose
  original amount exceeds the now-smaller remainder.
- Article resume, post-delivery settlement, worker error policy, budget stops,
  bounded quota retries and circuit-breaker contracts have development tests.
- Simulated paid boundaries return terminal errors after ambiguous submission,
  accounting failure or failed persistence rather than requesting automatic
  regeneration. Image/video/audio fake submission counts are tested separately.

These are bounded claims. They do not establish final asset quality, live
provider availability, successful publication or production reliability.

## 2. What was broken and what changed

The changes below are implemented, not uniformly accepted as safe. The final
review findings override any narrower passing evidence in this table.

| Severity | Defect and reproduction | Repair | Evidence boundary |
|---|---|---|---|
| Critical | Screenshot submission failed with PostgreSQL `42P10`: no unique/exclusion constraint matching `(team_id, run_id)` in the reservation INSERT. Catalog inspection confirmed it was missing; duplicate groups were zero. | Additive `0030_reservation_run_arbiter.sql` restores uniqueness without deleting rows. ORM uses the same unique-constraint shape as SQL; partial request-key predicate is preserved. Migration runner plans the actual INSERT with EXPLAIN. | Applied and checked in **development only**. Not a production migration claim. |
| Critical | A real cross-tenant ledger query returned another team's test event. Five tables retained policies and FORCE but had RLS disabled: provider usage, rates, rate versions, campaign ads and ad approvals. | Additive `0031` restores ENABLE/FORCE, all five ORM declarations retain ENABLE, and migration verification rejects disabled/unforced public policy tables. | Two schema tests and a real isolated ordinary-user cross-tenant ledger denial. This demonstrates development drift, not a proven production exposure. |
| High | React pending state alone does not synchronously prevent same-render clicks. Retry identity and enqueue compensation could allow unsafe resubmission. | Shared synchronous latch and validated request keys in both batch UIs; tenant-scoped atomic claim; retry remains blocked if credit cleanup fails. | Unit/DB tests; browser evidence recorded below. |
| High | Explicit duplicate debit checked remaining capacity before the already-recorded job, throwing after a successful debit consumed the hold. | Under the existing run lock, recognize settled jobs before validating remaining capacity; continue rejecting malformed explicit amounts. | Six billing concurrency tests, including full and partial replay. |
| Critical | Accepted batches remained `SUBMITTING`, which the worker did not claim; installed BullMQ also rejected the old two-part colon job ID before enqueue. | Worker/state handoff repaired; legal stable batch/article/image IDs and compatible recovery lookups; real queue acceptance tested. | Actual isolated Redis Queue.add test, plus production processor with 28 rows/child jobs. No paid article generation. |
| High | A partial child enqueue failure left an unrecoverable parent and stranded PENDING article rows. | Retryable parent stays QUEUED; stable child identities dedupe accepted jobs and fill missing jobs. Terminal FAILED/CANCELLED state is not resurrected by retained queue objects. | Six DB/processor tests, including partial failure then 28 unique child accepts. |
| High | Ambiguous queue writes could be refunded despite a job having been accepted. | Batch/podcast distinguish known local rejection from uncertain writes; unknown outcomes preserve state, credit and cap holds. Podcast uses durable queueing, visible reconciliation status and logged terminal failures. | Real isolated batch/article/image and podcast queue tests; podcast accepted-but-lost-response lookup. |
| High | Nested media retry/fallback paths could repeat paid work after accepted/successful provider calls, partial clip/scene completion, download/storage failure or accounting failure. | Non-replayable errors survive media catches; shared worker preserves reconciliation holds. Podcast TTS uses the paid boundary. Removed Bottleneck's extra retry owner; OpenAI explicitly retries 429 at most three physical calls. | Eleven simulated/fault tests including actual image and OpenAI production functions with fake SDK/storage. No universal exactly-once guarantee. |
| High | Three direct-image API routes could regenerate paid bytes after upload/DB/debit failure, with no complete reservation/durability boundary. | Canonical regeneration pricing, tenant-scoped resource access, caps/reservation, atomic provider-entry claim and reconciliation marker before SDK, final DB link/debit protection. Confirmed pre-accept failures allow a serialized new attempt. | Nine injected-dependency orchestration tests, including one physical call under concurrent requests. Post-delivery/debit HTTP response replay remains a NO-GO gap. |
| High | Podcast segment work was not bounded at a sufficiently explicit aggregate input boundary. | Reject more than 40 segments or 30,000 total characters; stop replay after partial paid completion. | Guard/fault evidence, not a listening-quality test. |
| High | Operational incident AI called the provider outside centralized ownership/accounting. | Route through `callOpenAI` with explicit accounting ownership; fail closed without a valid owner and preserve accounting errors. | Nine provider-accounting contract tests. No paid incident analysis performed. |

Reconciliation-hold columns are added by migration `0032`; their worker/recovery
behavior is assessed in the final verification addendum. Files are documented
in the root architecture/cost/recovery guides. Existing
applied migrations were not modified. No schema was replaced, no customer rows
were removed, and the ongoing storage/SSH work was not changed.

## 3. Expensive-media leakage: requested scenarios

| Scenario | Tested/fixed in this pass | Still unresolved |
|---|---|---|
| Duplicate image/video/audio jobs | Shared terminal policy and fake paid boundaries count one submission per tested attempt; article durable-replay tests cover existing article controls | Duplicate simultaneously active media processors after lease/lock loss are not globally fenced by durable provider-entry records |
| Retry after provider success | Post-success storage/accounting failures do not trigger the tested inner/queue retries; partial scene/clip/segment success is not blindly regenerated | A hard process kill cannot execute an error guard; not every direct SDK caller uses the new paid boundary |
| Rapid Generate clicks | Batch latch, stable request identity, tenant claim and exact credit fixture tested | Not a universal browser/server test of all image, video, audio and synchronous regeneration entry points |
| Abandoned background work | Article recovery/drain and protected settlement tests; surviving Veo errors include the operation name | Veo operation name is not durably saved before polling. Cancellation updates DB status but does not prove active provider work stopped. Orphan recovery requires further implementation |

**Do not confuse customer refunds with zero provider cost.** Ambiguous accepted
work must retain its hold for explicit reconciliation. Provider COGS must remain
recorded even when a later approved decision refunds the user. Manually
recovering a retained asset after a refund needs an explicit settlement path;
do not attach it silently to a completed/refunded run.

## 4. Tests and verification

### Newly added or extended regression coverage

| Suite | Checks |
|---|---:|
| Reservation schema arbitration | 2 |
| Generation RLS schema preservation/enforcement | 2 |
| Batch validation/latch/retry/compensation | 11 |
| Batch tenant/concurrent claim, production processor and partial recovery | 6 |
| Real isolated batch/article/image Redis queue acceptance | 1 |
| Real isolated podcast Redis acceptance/lost-response recovery | 1 |
| Paid-media error/fake SDK/storage boundaries | 11 |
| Direct-image operation fault/concurrency boundaries | 9 |
| Billing concurrency, including two added replay cases | 6 |
| Reservation state machine, including reconciliation hold/sweeper | 14 |
| Provider-ledger integration with ordinary-actor tenant isolation | 5 |
| Provider accounting boundaries | 9 |
| Campaign ads/auth contracts | 8 |
| Shared pipeline worker | 14 |
| Budget-stop cleanup | 3 |
| Restart safety / crash boundaries | 11 / 8 |
| Execution / delivery-settlement contracts | 11 / 2 |
| Video quota retry | 6 |
| Provider circuit breaker / usage units | 4 / 8 |

The initial broad run exposed the duplicate-debit bug above and three additional
contract failures (provider accounting, provider-ledger tenant fixture, and
readiness scheduler expectations). Their final disposition is recorded in the
verification addendum below; an initial failure is not silently counted as a
passing test.

The provider-ledger test was first corrected to use an isolated ordinary
non-admin actor, which still reproduced the leak. After migration `0031`,
the suite passed **5/5**. New synthetic accounting events use dedicated test
workspaces, not arbitrary customer teams. Their append-only accounting fixture
is intentionally retained; transient authorization actors are cleaned up.

The readiness fixture was missing the required Stripe credit-reconciliation
scheduler. Its correction preserves the all-schedulers readiness requirement
and verifies that omitting each required scheduler prevents readiness.

### Browser evidence

The batch-select page was exercised with 28 fixture titles and a 280-credit
estimate against 10,000,000 available credits. With the response held unresolved,
two synchronous DOM clicks sent **one** request with one idempotency key.
The button became disabled while in flight; after releasing a mocked failure,
the error was visible and the form became reusable. Desktop and 375px mobile
views showed no horizontal overflow.

An earlier pair of Playwright locator actions appeared to produce duplicates
but did not prove overlapping requests. The controlled same-JavaScript-turn,
held-response recheck resolved that test-method ambiguity. The dashboard
variant was not separately browser-tested; it shares the tested latch.
All batch submission responses in the browser were intercepted: **zero live
submissions reached a queue or provider**. Test user/team/batch fixtures were
removed.

The repeatable commands, evidence levels and required live scenarios are in
[`GENERATION_TESTING.md`](../GENERATION_TESTING.md).

### Security scan

- Dependency audit: **0 findings**.
- Static security scan: **0 findings**.
- Privacy/dataflow scan: **1 medium, 2 low warnings**:
  - Income-related article content sent to Gemini (`lib/gemini.ts`).
  - Address data sent to Gemini (`lib/gemini-social.ts`).
  - Budget-related content sent to Gemini (`lib/article-critique.ts`).

These warnings require data minimization, privacy-notice and provider-DPA review.
They are not dismissed as safe merely because sending content is intentional.
Automated scans do not replace adversarial authorization, prompt-injection or
live data-handling tests.

### Existing failures outside this pass

Initial workflow logs showed failures in the older admin-notification and
approval-link suites, principally administrator MFA prerequisites. Those
workflows were not repaired or rerun in this generation pass. The prior focused
auth report and its historical 35 passing tests are not counted as fresh
generation-audit results.

## 5. Providers, models, APIs and supported capabilities

See the complete repository inventories:

- [`AI_ARCHITECTURE.md`](../AI_ARCHITECTURE.md)
- [`GENERATION_PIPELINES.md`](../GENERATION_PIPELINES.md)
- [`AI_PROVIDER_MATRIX.md`](../AI_PROVIDER_MATRIX.md)

Generation uses Google Gemini/Veo and OpenAI text/TTS, with Brave for research;
storage, media processing, publishing and email have separate dependencies.
The matrix lists the configured model tiers and fallbacks—not independently
proven live model availability. Veo lacks the same startup availability
validation as the text tiers.

The capability matrix distinguishes articles/titles/metadata, images, social
variants, article repurposing, idea/reference/slideshow/Veo video, podcasts,
briefs, campaigns, learning and reporting from implied or unsupported features.
Agency reports are not automatically AI generation. Ads Lab is deliberately
**export-only**; no Google/Meta campaign was launched.

## 6. Remaining risk and technical debt

### Critical/high

- Direct-image response loss **after** both final DB linkage and successful
  debit can still be interpreted as a fresh regeneration. A durable response
  replay record/client intent contract is still needed.
- Podcast enqueue/provider crash windows can occur before the reconciliation
  marker is written. Direct-image entry is pre-marked, but this is not a
  universal operation journal for social/video/audio generation.

1. Persist/fence paid media attempts before submission, with stable tenant,
   run, stage and unit identity. Preserve unknown outcomes rather than
   resubmitting automatically.
2. Persist accepted provider operation IDs and stable object keys. Prove recovery
   through real hard kills, partial output and post-upload/database crash windows.
3. Make cancellation truthful across UI, queue and accepted provider operations.
   Stopping a database status does not stop provider spend.
4. Complete bounded live end-to-end tests: actual final media validation,
   playback, authorized retrieval, download/export and credit/COGS settlement.
5. Confirm every direct provider boundary—including operational AI—not just
   customer generators, has valid ownership and immutable accounting.
6. Resolve live operational prerequisites from the prior release review:
   delivery/SMTP proof, isolated restore proof, production security/schema
   rollout, worker reliability, canary/rollback/drain/monitoring and privacy/DPA
   approval. Their status was not recertified here.

### Performance/scaling

- No measured p95/p99, throughput, saturation point or 24-hour soak is claimed.
- Concurrent video rendering, ffmpeg/Sharp memory, queues and polling need
  workload-specific limits and bounded stress tests.
- Redis job IDs are not permanent business deduplication once jobs are removed.
- A surviving error guard is not a substitute for a durable cross-worker lease.
- Recovery scans, reservation cleanup and retained deliverables must agree on
  which work is still billable before releasing holds.

### Obsolescence/dependency risk

- Preview model IDs, mutable aliases and hardcoded retirement comments require
  an evidence-backed model lifecycle process; comments are not availability
  proof.
- No dependency CVE finding does not mean every dependency/API is future-proof.
  Legacy queue terminology/dependency footprint and provider-specific calls
  remain maintenance debt.
- Google SDK-internal retry amplification has not been certified absent.
- Keep the current queue stack and improve durable contracts first. Temporal or
  Trigger.dev would add operational/control-plane costs and still require
  idempotent paid activities.

## 7. Recovery, cost control and long-term recommendations

- [`FAILURE_RECOVERY.md`](../FAILURE_RECOVERY.md): terminal vs retryable errors,
  settlement-only recovery, ambiguous outcomes and crash/cancel gaps.
- [`AI_COST_CONTROL.md`](../AI_COST_CONTROL.md): credits vs real COGS,
  reservations, cap cleanup, repeated requests and paid-boundary safeguards.
- [`FUTURE_PROOFING.md`](../FUTURE_PROOFING.md): provider replacement contracts,
  current-source lifecycle review, queue alternatives and staged resilience work.

No design can guarantee unchanged functionality for ten years. The practical
goal is observable, versioned, replaceable providers, bounded failure behavior,
and repeatable compatibility/financial tests.

## 8. Rollout boundary

This is a **development code/database repair and partial audit**, not a
production deployment or sign-off. No rollout is approved while the final
review blockers remain. After they are fixed, use the established approved
deployment procedure for additive migrations and code together, verify the
reservation/authorization controls, and complete live acceptance evidence.
No publish action was taken or recommended by this audit.

## 9. Final verification addendum — review rejected the patch

The final review accepted the reservation arbiter, five-table RLS repair,
reconciliation columns/locked-release/sweeper protection, legal BullMQ IDs,
and partial-child recovery. It **did not accept the overall patch**:

1. **Batch replay race:** after inspecting a retained queue job, ambiguous
   replay can update the DB without a conditional status predicate. A worker
   transition to RUNNING or a cancellation between the read and write can be
   overwritten. Terminal-state prechecks alone do not prevent this.
2. **Direct-image cross-version race:** the provider-entry claim is atomic per
   run, not per resource. Two callers observing different resource versions
   can both pass the unresolved-run preflight before either claim and submit
   paid work. The passing concurrency test covers the same-run case only.
3. **Podcast post-debit failure:** failure persisting the billing-settled
   checkpoint after a successful debit can enter destructive generic cleanup,
   deleting a delivered asset and allowing regeneration of already-charged
   work. The READY settlement branch has the same issue.
4. **Podcast recovery/compensation:** the sweeper's old two-part job lookup
   does not match the new hashed ID. Known enqueue-rejection cleanup can also
   swallow a credit-release failure and permit a fresh run beside an old hold.
5. **Spending-cap accounting:** podcast's cap reservation is not handed to its
   worker, leaving pending and completed usage double-counted temporarily.
   Direct-image success can cancel pending usage even if recording completed
   usage failed, permitting an undercount.

These are **release-blocking implementation defects**, not just missing live
canaries. They remain unfixed at delivery. Required next regressions are
replay-versus-cancellation, simultaneous cross-version image entry,
post-debit checkpoint failure, hashed-job sweeper recovery, failed-release
retry protection, and atomic pending-to-completed cap settlement.

### Verification that did finish

- Final focused batch, real-Redis, podcast queue, direct-image, media-fault,
  restart and crash suites passed. The broader passing counts are listed in
  section 4. Tests do not cover the races above.
- Full TypeScript and whitespace checks passed.
- Additive migrations 0030–0032 were applied only to the configured development
  database. A repeat migration run reported them already applied and verified
  schema controls. Existing applied migration files were not changed.
- The main workflow was restarted and is running on port 5000. The login page
  rendered in `reports/screenshots/generation-audit-login.jpg`.
- Startup recognized the configured Gemini model IDs, registered workers and
  passed FFmpeg/ffprobe checks. It also reported publishing disabled because
  its encryption secret is unset and a telemetry spool with 75 pending entries.
  Those operational warnings were not resolved.
- The screenshot console reported anonymous-session 401s, a 404 resource and
  a smooth-scrolling warning. No all-console-clean or media-playback claim is
  made. Separately collected deployment logs showed historical Neon HTTP
  connection/recovery errors; production was not modified or certified.

### Security incident in test logging

A failed queue-test invocation inherited the configured Redis endpoint, and
credential-bearing connection details appeared in saved/durable tool logs.
The two isolated queue tests now construct localhost-only connections using
the non-secret `LOCAL_TEST_REDIS_PORT`; they no longer accept application or
provider URLs, and both tests passed after this containment change.

**Treat the affected Redis credential as exposed.** Rotate it with its provider,
then update the `REDIS_URL` value using Replit Secrets. No credential value is
included here. Existing durable history cannot be made safe by changing a test
default; credential rotation remains necessary.

### Delivery decision

Do not publish this patch or treat it as an end-to-end generation certification.
Review checkpoints before further financial-path changes. A full rollback can
also undo the verified database/security repairs, so checkpoint selection needs
care rather than a blind restore. No paid canary generation was submitted as
part of this audit.
