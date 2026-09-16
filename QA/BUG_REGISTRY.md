# CiteFi QA Bug Registry

**Registry state: MAINTENANCE UPDATED — no current feature is certified.**
**Overall certification: NOT CERTIFIED.**

This registry separates historical report observations, source observations,
test candidates, and confirmed runtime defects. A stale explorer statement or
source assertion is not a confirmed runtime bug. No fix is called verified
without reproduction and a current retest report.

Latest maintenance evidence retracts four prior false findings, retains the
Redis exposure fix, and records final retests for the provider, security,
speed-mode, receipt-convergence, and schema fixes. These dispositions supersede
the initial pending classifications where stated below; historical red records
remain unchanged.

## Status vocabulary

| Registry state | Meaning |
|---|---|
| `HISTORICAL_REPORTED_UNVERIFIED` | A prior artifact reports an outcome; it is preserved but not re-certified now. |
| `SOURCE_OBSERVATION_UNVERIFIED` | Static discovery identifies a behavior or risk; runtime reproduction is pending. |
| `PENDING_ACTUAL_TEST` | A test is required but no report is attached. |
| `BLOCKED` | The procedure cannot proceed under the current gate or authorization. |
| `NOT_APPLICABLE` | The source inventory has no executable product contract. |
| `VERIFIED` | Reserved for an evidence-bearing reproduction and successful regression retest. None is assigned by this initialization. |

## Historical observations retained, not re-certified

| ID | Exact feature/surface | Historical observation | Current registry state | Required evidence |
|---|---|---|---|---|
| QA-H-001 | Batch article generation | Historical live record reports failed terminal quality/output behavior. | `HISTORICAL_REPORTED_UNVERIFIED` | Fresh fixture execution with output, retrieval, export, receipt, and settlement evidence. |
| QA-H-002 | Single article regeneration | Historical record reports terminal quality/policy defects and released reservation. | `HISTORICAL_REPORTED_UNVERIFIED` | Fresh authorized fixture run and accounting/retrieval report. |
| QA-H-003 | Social text generation | Historical record reports a platform constraint/validation failure. | `HISTORICAL_REPORTED_UNVERIFIED` | Five-platform validation and current accounting report. |
| QA-H-004 | Social image generation | Historical record reports aspect/constraint defects and no observed hero reuse. | `HISTORICAL_REPORTED_UNVERIFIED` | Per-platform dimensions, linkage, reuse/generated path, and receipt report. |
| QA-H-005 | Idea video | Historical record reports queue/script failure before a final video asset. | `HISTORICAL_REPORTED_UNVERIFIED` | Queue identity, provider operation, playable output, and settlement report. |
| QA-H-006 | Podcast generation | Historical record reports a duration contract failure and incomplete transcription evidence. | `HISTORICAL_REPORTED_UNVERIFIED` | Authorized duration/transcription procedure and accounting report. |
| QA-H-007 | Campaign ad copy generation | Historical record retains a canonical-hash failure in an immutable artifact. | `HISTORICAL_REPORTED_UNVERIFIED` | Fresh export round trip without rewriting historical evidence. |
| QA-H-008 | Agency report rendering and delivery | Historical record reports deterministic report download but a separate concurrency failure; email was not run. | `HISTORICAL_REPORTED_UNVERIFIED` | Current schema/concurrency report and separately authorized email test. |

These observations are sourced from `E-006` and `E-007`; they do not change
the current all-features `UNVERIFIED`/`BLOCKED` decision.

## Source observations requiring actual tests

| ID | Surface | Discovery observation | Current state | Boundary |
|---|---|---|---|---|
| QA-S-001 | Development admin page navigation | Discovery records a development-mode page-navigation auth fallback; API handler authorization remains a separate boundary. | `SOURCE_OBSERVATION_UNVERIFIED` | Reproduce only in an isolated environment and verify API privilege boundaries. |
| QA-S-002 | Queue/replay and worker state | Discovery identifies replay, cancellation, and restart state transitions that require runtime proof. | `SOURCE_OBSERVATION_UNVERIFIED` | Operations specialist fault/concurrency report. |
| QA-S-003 | Direct media operations | Discovery identifies concurrent preflight and post-commit response-loss risk. | `SOURCE_OBSERVATION_UNVERIFIED` | Deterministic fault injection followed by receipt and duplicate-submission checks. |
| QA-S-004 | Podcast settlement | Discovery identifies post-debit/checkpoint and worker reservation boundaries. | `SOURCE_OBSERVATION_UNVERIFIED` | Local integration failure/restart report; no paid retry. |
| QA-S-005 | Video operation identity/cancellation | Discovery identifies operation identity and cancellation boundaries before live proof. | `SOURCE_OBSERVATION_UNVERIFIED` | Mock/local operation lifecycle and explicitly authorized live test only if gates clear. |
| QA-S-006 | Journey and learning orchestration | Discovery records runtime compilation blockers in historical evidence. | `BLOCKED` | Operations must attach a post-restart source/runtime report before execution. |

These rows are deliberately not labeled confirmed runtime defects until actual
tests reproduce them. Predicted 10x/100x risks remain predictions.

## Deliberate non-bugs and classification controls

| ID | Item | Disposition |
|---|---|---|
| QA-C-001 | Task #179 receipt-accounting change | Confirmed merged at git `0067e734`; not an unmerged task. Final isolated tests are attached, while live/provider tests remain required. This is a verification dependency, not a bug claim. |
| QA-C-002 | `0034_agency_report_period_unique.sql` and `0034_provider_attempt_receipts.sql` | Both filenames are intentional and the full filenames are the ordering keys. This is a source feature/ordering consideration, **not a confirmed duplicate-filename bug**. Any start-version behavior requires a controlled migration report. |
| QA-C-003 | Six `NOT_TESTABLE` inventory rows | `NOT_APPLICABLE`, not failed execution. No replacement implementation or test target is invented. |
| QA-C-004 | Seven historical `PASS` rows | Historical only; not a new pass and not `VERIFIED`. |

## Pending regression ownership

The accounting, generation, security, and operations specialists each add
reproduction IDs, root cause, fix reference, retest mode, and evidence ID. Until
those reports exist, every pending row remains `PENDING_ACTUAL_TEST`. No made-up
test count or pass count is entered here.

The evidence index and append-only current-view/log are in
`QA/CERTIFICATION_STATUS.md` (`E-001` through `E-011` at initialization).

## Latest maintenance dispositions

### Retracted findings — not current bugs

| ID | Earlier claim | Current disposition | Evidence |
|---|---|---|---|
| QA-R-001 | Public branding mismatch | **RETRACTED — intentional branding change.** Governance expectation was stale; the current local marketing campaign engine positioning is intentional and the deferred one-URL-completes-all claim remains absent. | E-013, E-014 |
| QA-R-002 | Batch enqueue count of four required | **RETRACTED — intentional legacy compatibility.** The `6939f8d` legacy-ID preflight adds an ordered lookup; finding an existing legacy ID correctly avoids enqueue. | E-013 |
| QA-R-003 | Exact `0034_provider_attempt_receipts.sql` start skipped agency migration | **RETRACTED — false premise.** Full filenames are intentional selection/order keys; numeric `0034` is the family-level selection. | E-014 |
| QA-R-004 | Deployment required `MIGRATION_START_VERSION=0022` | **RETRACTED — stale expectation.** The intentional `500b4fe` baseline uses `0020` so incident-intelligence migrations are included. | E-014 |

### Confirmed configuration fix retained

| ID | Finding | Current disposition |
|---|---|---|
| QA-F-001 | `.replit` exposed developer Redis `localPort=6379` through `externalPort=3001`. | **CONFIRMED CONFIGURATION DEFECT — minimal mapping fix applied.** The external mapping was removed; internal Redis 6379 remains. The affected deployment static contract then passed. No deployment, restart, migration, or test relaxation is claimed. |

### New concrete security residual

| ID | Finding | Affected sinks | Current disposition |
|---|---|---|---|
| QA-S-007 | `safeFetchWithRedirects` initially started DNS resolution before the request/transport timeout; a held DNS lookup could remain pending beyond the caller deadline. | Media URL import, site crawler, video style analyzer | **FIXED AND INDEPENDENTLY RETESTED WITH LIMITATION.** The whole-operation deadline now covers DNS, redirect hops, transport, and body consumption; 13/13 helper/three-sink plus 1/1 original SSRF regression pass. Live/deployed behavior remains unverified. |

The three security fixes (SEC-P2-001 password policy, SEC-P2-002 SSRF
validation, SEC-P2-003 CSRF origin authority) were independently exercised in
the separate suites below. SEC-P2-002's DNS residual is now fixed/retested but
remains limited to offline/helper evidence by QA-S-007.

## Independent security suite record — do not combine counts

| Suite | Result | Scope |
|---|---|---|
| SSRF helper and three sinks | 13/13 | Address classes, public/DNS answers, redirect pinning, downgrade, limits, and caller bounds. |
| Auth/CSRF plus API boundaries | 11/11 | Both CSRF layers, forwarded-host rejection, configured preview origins, signed proofs, bearer delegation, and reset capability path. |
| Reset route boundaries | 3/3 | Weak/malformed rejection before hash/mutation and strong-policy transaction reachability. |
| Existing auth/recovery/preview/browser-CSRF | 6/6 | Existing security contracts. |
| Original password regression | 1/1 | Independent retest of the historical policy regression. |
| Original mapped-loopback SSRF regression | 1/1 | Independent retest of the historical SSRF regression. |

These are separate evidence suites, not a combined total; overlapping
regression scopes must not be double-counted.

## Database and scan findings

The disposable database execution is **65 total / 48 pass / 17 fail**. The
MFA-enrollment fixture and Drizzle error-wrapper assertion are now being fixed;
the administrator MFA policy was not weakened. A separate receipt migration,
grants, forced-RLS, tenant-isolation, and client-viewer check passed. Dependency
audit and SAST returned zero findings; HoundDog returned four privacy findings
(one medium, three low), triaged in the independent security report. Concrete
triage covers `lib/article-critique.ts`, `lib/gemini.ts`,
`lib/gemini-social.ts`, and the test-only
`scripts/setup-live-generation-fixture.ts`: article critique's budget-like content is intended workflow data and
must not be logged; aggregate `medianIncome` should remain coarsened and never
become person-level; free-form social `location` should be constrained to
city/region/ZIP rather than a street address; and the `.invalid` fixture email
is test-only. These results are not full feature certification.

Current evidence additions are `E-012` through `E-030` in
`QA/CERTIFICATION_STATUS.md`.

## Final fix and retest register

These are current maintenance dispositions, not full feature certification.
Each result remains bounded by its evidence mode.

| Fix/surface | Current disposition | Evidence |
|---|---|---|
| SEC-P2-001 password policy | Fixed and independently retested in reset-policy and route-boundary suites; weak/malformed passwords are rejected before hash or mutation. | E-025 |
| SEC-P2-003 CSRF origin authority | Fixed and independently retested across both CSRF layers; architect approval covers the tested auth/SSRF origin handling. | E-025 |
| QA-S-007 / SEC-P2-002 DNS deadline | Fixed and independently retested: 13/13 helper/three-sink plus 1/1 original SSRF. No live/deployed claim. | E-025 |
| QA-F-001 external Redis exposure | `.replit` external `localPort=6379` → `externalPort=3001` mapping removed; internal developer/test Redis 6379 remains. | E-014, E-026 |
| QA-F-002 / Provider accounting retry order | Typed accounting terminals are checked before 429/transient classification; ordinary retries remain bounded. | E-022, E-023 |
| QA-F-003 / SPEED MODE Markdown-to-HTML rendering | Latest restart handoff reports 8/8 after the actual renderer correction, not merely a fixture adjustment. A standalone `speed-mode-renderer-fix.md` is not present, so no extra 3/3 is counted. | E-026 |
| QA-F-004 / Receipt DB/spool convergence | `finalizeAccounted` converges primary and independent spool after DB/ledger faults without provider replay; isolated production receipt path is 3/3. | E-027 |
| QA-F-005 / Receipt schema 0035 hardening | Null/malformed aggregate predicate corrected; seven historical scenarios, three constraints, and receipt suite 3/3 pass in disposable local PostgreSQL. | E-028 |

The earlier 65/48/17 database batch, 1/3 receipt red result, pre-fix DNS
deadline reproduction, and pre-correction restart/speed-mode red receipts are
retained as historical evidence. They are superseded only by the named final
results above; no other bug or feature is silently upgraded.

## Final browser observations

Evidence `E-030` is the targeted follow-up in
`QA/evidence/public-auth-browser.md`. Public forms render. The temporary
cold/HMR navigation delay was not reproduced after a hard load, a 20-second
wait, and warmed pages; no code fix was made. Forgot-password navigation to
the hydrated reset page, Back to login, Sign up to the hydrated signup page,
and Back to login all pass. The 390x844 mobile check passes with no horizontal
overflow. Earlier toggle, remember-checkbox, required-empty, and invalid-email
native validation remain passed.

No sign-in, MFA, reset submission, or signup submission was performed. The
non-GET/HEAD safety interception caused no actual mutation, and expected
anonymous `/api/auth/me` 401s are not defects. These are public
unauthenticated observations and do not alter the supported inventory
dispositions; there is no current forgot-password browser blocker.
