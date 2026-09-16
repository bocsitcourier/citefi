# QA_REMEDIATION_PLAN

## Document control and evidence boundary

This is the documentation-only remediation plan for the attached QA plan. It does not
implement feature code, change old evidence, rerun providers, send email, publish
externally, write to the database, add a dependency, or create a new grade.

- **Source attachment:** `attached_assets/citefi_qa_remediation_plan_1789565275462.docx`
- **Raw attachment SHA-256:** `c78791c02408e0da9b6e6c01f58f5f68a57fcf5d49270e4d92dda5e1943631fb`
- **Verbatim companion:** [`source-plan-numbered.md`](source-plan-numbered.md)
- **Architect review:** [`architect-line-review.md`](architect-line-review.md)
- **Inventory authority:** `reports/live-generation/masterinventory.json`
- **Source extraction coverage:** 84 body paragraphs (77 non-empty, 7 empty positions),
  2 tables, 15 rows, and 45 cells. The companion maps architect `P1`–`P84` exactly to
  extraction `P1`–`P84`; no paragraph was silently renumbered.
- **Historical audit snapshot:** `$0.517071` recorded across 99 ledger events, plus
  2 missing/unreconciled calls. This is a recorded snapshot, not a statement that
  historical spend has been verified.

The source companion is the authority for exact paragraph/table text. This plan adds
the corrected disposition and rationale beside every source ID and expands the
numbered prompt instructions into independently reviewable clauses.

## Controlling constraints

These constraints correct or bound the source plan and apply to every scope:

1. **No fabricated cost.** Use only observed provider usage records and the recorded
   `$0.517071` snapshot. Never estimate an unknown call as zero or invent a model,
   limit, unit, cost, or ledger row. The two missing calls remain explicitly
   unreconciled/UNKNOWN until evidence resolves them. Never say
   “historical spend verified.”
2. **Shared paid gate.** The shared cap is **$50**. The **$6 reserve is
   unconfirmed** coverage, not available proof of budget. No paid reruns or new
   provider calls are authorized in this documentation handoff. A future retest
   requires lead approval and current cap reconciliation (observed ledger/cap
   deltas, including the two missing calls), not merely an increased cap.
3. **No side effects in this continuation.** No new paid calls, emails, external
   publishing, database writes, customer-data operations, or dependencies. Existing
   evidence and diagnostics are read-only inputs.
4. **Preserve failure evidence.** Failed outputs remain diagnostic drafts and may
   not be represented as finished, exportable, or passing artifacts. Preserve failed
   diagnostics, failure numbers, ledger identities, and the original attempts.
5. **Immutable exports.** Finalized exports and historical artifacts are immutable.
   Hash exactly the bytes written, retain canonical-manifest and raw-ZIP hashes as
   separate values, and do not rewrite an old artifact to make its hash pass.
6. **Queue identity preservation.** A stricter project convention of
   `[a-z0-9_-]` is allowed, but it is not a claim that BullMQ has a universal
   maximum or that the convention is a BullMQ fact. Preserve queue names and
   legacy/current lookup, cancel, recovery, settlement, and idempotency identities.
   Do not add a package.
7. **No payload logs.** P64's request to log an exact failing provider payload is
   rejected. Do not log exact provider payloads or provider text. Persist only
   hashes, IDs, schema errors, and redacted metadata; preserve enough diagnostic
   identity to reproduce the failure without exposing payload content.
8. **Executable duration contract.** Advertised duration ranges are hard bounds, not
   a permission to land outside the range by ±15%. Calibrate measured words-per-minute
   per voice/locale, enforce the requested range before TTS, measure after rendering,
   and fail or deterministically recut/regenerate when a hard bound is not met.
9. **Claims and trimming.** Claims require identified evidence and a citation policy.
   “Trim while preserving meaning” requires deterministic rules; otherwise fail for
   user edit rather than asserting an unverifiable transformation.
10. **Status discipline.** Remediation statuses are only `OPEN`,
    `IN_PROGRESS`, `FIXED_UNVERIFIED`, `VERIFIED_PASS`, and `BLOCKED_HUMAN`.
    Historical `PASS`, `PARTIAL`, `FAIL`, `BLOCKED`, `NOT_RUN`, and
    `NOT_TESTABLE` values are recorded in a separate historical-grade field.
    No new `VERIFIED_PASS` is created by this handoff.
11. **Scope 0 is a guardrail, not a live pass.** Scope 0 regression locks for the
    seven retained baseline passes are `IN_PROGRESS`, are pending because the
    separate worker is running, and require independent review. Scope 0 tests are
    isolated regression guardrails only; they are not real-provider passes and do
    not upgrade any historical grade.
12. **External ownership.** Active isolated task **179** owns RC-7 receipt changes.
    This plan records that ownership and does not duplicate or claim those changes.
13. **Wave/approval gate.** Lead approval is required for each scope before the next
    scope begins. No Wave 2 work starts until every prior-wave item has full
    independent verification and is `VERIFIED_PASS`; the current paid gate therefore
    remains stopped.

## Inventory scope and dispositions

The master inventory contains exactly 40 features:

| Historical grade (kept separate) | Count | Remediation disposition |
|---|---:|---|
| `FAIL` | 5 | Addressable; current remediation status is recorded in the state file, initially `OPEN`. |
| `PARTIAL` | 7 | Addressable; current remediation status is recorded separately, initially `OPEN`. |
| `BLOCKED` | 3 | Addressable; remain unproven until an authorized, independently reviewed run; initially `OPEN`. |
| `NOT_RUN` | 12 | Addressable; no grade is inferred before an authorized run; initially `OPEN`. |
| `PASS` | 7 | Retained baseline evidence; Scope 0 regression locks are `IN_PROGRESS`, not new passes. |
| `NOT_TESTABLE` | 6 | Unsupported/out of scope; human product-scope decision only, not remediation. |

The 27 addressable feature names, the seven retained baseline names, and the six
unsupported names are enumerated exactly in `QA_REMEDIATION_STATE.md`.

## Source-matched paragraph disposition matrix

**Disposition legend:** `A` = accept the source requirement as bounded below;
`C` = correct the executable interpretation as stated below; `D` = human
decision/defer. Empty paragraphs are retained as `EMPTY` and are not treated as
requirements. The exact source text for each anchor is in the companion.

| ID | Architect | Source anchor | Disposition and rationale |
|---|:---:|---|---|
| P1 | A | Citefi — QA Remediation Plan & Agent Prompts | Accept as the source document title; this handoff is a companion/disposition, not a replacement source. |
| P2 | C | Input: audit of 40 features… | Retain the historical counts and recorded `$0.517071`/99-event snapshot, but correct the execution boundary to 99 events plus 2 missing/unreconciled calls and never call spend verified. |
| P3 | — | *(empty)* | `EMPTY`; retain the paragraph position so later IDs cannot shift. |
| P4 | A | 0. Scope reality check… | Accept the scope warning; “all A+” is not promised. |
| P5 | A | “Every feature passes A+”… | Accept the explicit rejection of an impossible blanket outcome; evidence gates remain feature-specific. |
| P6 | A | Addressable now: 27 features… | Accept the 27/6 split and the listed unsupported categories; unsupported work is not silently invented. |
| P7 | A | external publishing and email… | Accept; no certification without an explicit authorization decision and test accounts, and this continuation has neither. |
| P8 | — | *(empty)* | `EMPTY`; retain the source position. |
| P9 | C | 1. Root-cause map… | Retain the root-cause map structure, but correct its approximate defect framing with the explicit seven RC records and evidence-gated status model in the state file. |
| P10 | C | Fix these… | Treat this as a dependency hypothesis only; a root-cause change never automatically passes every feature, and each feature still needs independent evidence. |
| P11 | A | RC-1 — Queue job-ID contract… | Accept the RC-1 identity and diagnosis heading. |
| P12 | C | Symptoms… canonical makeJobId… | Correct the queue claim: `[a-z0-9_-]` is a project convention, not a universal BullMQ maximum; preserve queue identities and every lookup/cancel/recovery/settlement/idempotency identity, add no package, and validate at enqueue. |
| P13 | A | RC-2 — No platform-spec… | Accept the RC-2 heading. |
| P14 | C | Symptoms: X post 403… | Accept a single specs map and pre-persistence validation, but require deterministic trim/re-render rules and fail loudly when the rule cannot preserve meaning; do not use a paid rerun in this handoff. |
| P15 | A | RC-3 — Output quality gates… | Accept the RC-3 heading. |
| P16 | C | Symptoms: article with prompt/debug… | Make gates blocking and retain the failed diagnostic; a failure may be a diagnostic draft only, never “finished” or exportable. Claims need evidence/citation policy, and no paid regeneration is authorized now. |
| P17 | A | RC-4 — Duration/metadata… | Accept the RC-4 heading. |
| P18 | C | Symptoms: podcast requested… | Correct ±15% into hard advertised bounds; calibrate measured WPM per voice/locale, enforce before TTS, use measured file metadata, and never display an estimate. |
| P19 | A | RC-5 — Export integrity… | Accept the RC-5 identity and export/concurrency scope. |
| P20 | C | Symptoms: ZIP… manifest hash… | Hash the exact immutable bytes written and keep canonical manifest and raw ZIP hashes separate; preserve the historical failed export and do not create DB writes or rewrite old output here. |
| P21 | A | RC-6 — Compilation defect… | Accept the “already fixed, unverified” historical description; it is not a new pass or a license to rerun during this handoff. |
| P22 | A | Symptoms: Journey… compilation… | Accept that source fixes still require evidence; the current blocked historical diagnostic remains preserved and no runtime rerun is authorized. |
| P23 | A | RC-7 (financial)… | Accept the financial root-cause identity and the need for complete usage rows. |
| P24 | C | Symptoms: 2 of 99… | Correct to `$0.517071` recorded, 99 events plus 2 missing/unreconciled, `$6` reserve unconfirmed, no fabricated rows, and explicit UNKNOWN where needed. Isolated task 179 owns receipt changes; do not duplicate it. |
| P25 | — | *(empty)* | `EMPTY`; retain the source position. |
| P26 | C | 2. Definition of “A+”… | Retain the evidence-gate heading, but correct its execution boundary: historical grades stay separate, Scope 0 is guardrail-only, and no paid live evidence is authorized here. |
| P27 | C | An agent may only mark… | Replace historical “PASS” language with the controlled `VERIFIED_PASS` remediation status; all required evidence must be independently reviewed and no new status is granted here. |
| P28 | C | A real run against real providers… | Keep as the eventual live-evidence requirement, but Scope 0 guardrail tests are not real-provider passes and no paid run is authorized now. |
| P29 | C | A persisted artifact… | Keep as an evidence requirement for a future authorized run; in this continuation preserve existing artifact IDs/bytes/durations without writing a new artifact. |
| P30 | A | Persistence proven… | Accept refresh and logout/login evidence as a required future criterion wherever persistence exists; do not infer it from an in-session response. |
| P31 | C | Spec compliance proven… | Accept hard spec checks, adding hard duration bounds, deterministic trim rules, claim evidence/citation policy, and no out-of-spec persistence. |
| P32 | C | Ledger proven… | Accept complete provider usage and credit lifecycle evidence, but reconcile current cap first and never fabricate or infer missing cost. |
| P33 | A | A regression test committed… | Accept the exact-failure regression requirement; Scope 0 tests remain isolated guardrails and not live-provider passes. |
| P34 | A | “TypeScript compiles”… | Accept; type checks and targeted checks cannot upgrade a live feature grade. |
| P35 | — | *(empty)* | `EMPTY`; retain the source position. |
| P36 | A | 3. Fix order… | Accept the dependency-aware wave heading. |
| P37 | C | Do not parallelize… | Require Wave 1 completion plus full independent verification and lead approval before later waves; current gate is stopped. |
| P38 | C | Wave 1 — Foundations… | Keep RC-1, RC-7, and RC-3 as foundations, but respect task 179 ownership of RC-7 receipt changes and do not duplicate work. |
| P39 | D | Wave 2 — Content correctness… | Defer until lead approval, current cap reconciliation, and full prior-wave verification; no paid content reruns now. |
| P40 | D | Wave 3 — Video… | Defer; video requires a separately approved budget within the `$50` shared cap and a real render, which is not authorized. |
| P41 | C | Wave 4 — Export/reporting… | Keep hash/concurrency review; agency PDF is an unsupported/new build gap, not a silent remediation fix, and historical exports stay immutable. |
| P42 | D | Wave 5 — Rerun blocked… | Defer both blocked and never-run procedures until all prior waves are independently `VERIFIED_PASS`, authorized, and cap-reconciled. |
| P43 | D | Wave 6 — Scope decision… | Defer to a human product decision; unsupported features are not converted into fabricated implementations. |
| P44 | — | *(empty)* | `EMPTY`; retain the source position. |
| P45 | A | 4. Sub-agent orchestration… | Accept the orchestration heading and separate lead/worker/verifier model. |
| P46 | C | Replit’s agent will not… | Correct the shared-state location/reference to the checked-in state handoff and require append-only evidence; this document does not start workers or feature work. |
| P47 | D | The shared state file… | Defer the deployment-path decision (`/QA_REMEDIATION_STATE.md` versus the checked-in report path) to the lead; the checked-in state file is the documented source for this handoff. |
| P48 | C | Every agent reads it… | Accept the single-source principle, with append-only history and separate historical grades/current statuses. |
| P49 | C | # QA REMEDIATION STATE… | Replace the illustrative `FAIL` rows with exact master-inventory names and allowed remediation statuses; split the schema requirements below and preserve handoff/blocker history. |
| P50 | C | Rules enforced… | Accept the five allowed statuses and no-silent-skip rule; require `BLOCKED_HUMAN` for an exact human question, independent verifier evidence for `VERIFIED_PASS`, and append-only handoffs. |
| P51 | A | The agent roles | Accept the role-section heading. |
| P52 | C | VERIFIER must be a different pass… | Require independent review; the fixer never grades its own work, and Scope 0 is pending independent review. |
| P53 | — | *(empty)* | `EMPTY`; retain the source position. |
| P54 | A | 5. Copy-paste prompts | Accept the prompt-section heading as source structure only. |
| P55 | C | 5.1 LEAD… | Keep a lead session opener, corrected to documentation-only operation, no code/paid calls/side effects, current cap reconciliation, and the state-file status rules. |
| P56 | C | You are LEAD agent… | Correct every numbered instruction in the clause matrix: the lead coordinates only, uses exact inventory/state counts, honors wave/approval gates, and cannot self-grade or create a new pass. |
| P57 | A | 5.2 INFRA — RC-1… | Accept the INFRA prompt heading; its clauses are expanded and corrected under P58. |
| P58 | C | You are INFRA agent… | Correct every numbered instruction in the clause matrix: preserve queue identities, treat the charset as a project convention, add no package, and use tests as evidence only. |
| P59 | A | 5.3 QUALITY — RC-3… | Accept the QUALITY prompt heading; its clauses are expanded and corrected under P60. |
| P60 | C | You are QUALITY agent… | Correct every numbered instruction in the clause matrix: blocking pre-persistence gates, deterministic claims/URLs/trimming, diagnostic preservation, and no paid regeneration now. |
| P61 | A | 5.4 PLATFORM — RC-2… | Accept the PLATFORM prompt heading; its clauses are expanded and corrected under P62. |
| P62 | C | You are PLATFORM agent… | Correct every numbered instruction in the clause matrix: typed specs, deterministic validators, hero reuse when eligible, and no out-of-spec persistence. |
| P63 | A | 5.5 MEDIA — RC-4… | Accept the MEDIA prompt heading; its clauses are expanded and corrected under P64. |
| P64 | C | You are MEDIA agent… | Correct every numbered instruction in the clause matrix: hard duration bounds, measured WPM and ffprobe evidence, no exact-payload logs, redacted diagnostics, and no live video pass. |
| P65 | A | 5.6 LEDGER — RC-7… | Accept the LEDGER prompt heading; RC-7 receipt implementation remains externally owned by isolated task 179. |
| P66 | D | You are LEDGER agent… | Defer all five numbered instructions to task 179's active ownership; preserve the 99-plus-2 accounting diagnostic and `$6` uncertainty, and do not duplicate receipt changes. |
| P67 | A | 5.7 VERIFIER… | Accept the independent verifier heading; no live verification can run under the current paid gate. |
| P68 | C | You are VERIFIER agent… | Split into run, evidence, grading, and budget clauses; correct budget handling to current cap reconciliation, no paid calls, and no status upgrade from Scope 0 checks. |
| P69 | A | 5.8 persistence wrapper… | Accept the wrapper heading; the corrected constraints below govern its execution. |
| P70 | C | PERSISTENCE RULES… | Split all six bullets; preserve retry/evidence/blocker/test-integrity rules, but prohibit paid reruns and exact payload logging in this continuation. |
| P71 | — | *(empty)* | `EMPTY`; retain the source position. |
| P72 | A | 6. Retest protocol | Accept the retest heading, subject to the paid gate and independent review. |
| P73 | C | Lock the passes… | Scope 0 locks are isolated regression guardrails only, `IN_PROGRESS`, pending the separate worker and independent review; they are not new live passes. |
| P74 | A | Fix by wave… | Accept wave-based work rather than feature-by-feature drift, with the stronger prior-wave verification gate. |
| P75 | C | Verify with a separate agent… | Accept independent verification; no fixer self-grade and no current live run. |
| P76 | C | Rerun the 3 blocked… | Preserve the historical blocked diagnostics, but do not pay for a rerun or call the defects fixed until authorized evidence exists. |
| P77 | D | Run the 12 never-run… | Defer; never infer a grade, and do not run paid procedures under the stopped gate. |
| P78 | C | Budget the verification run… | Replace the approximate budget direction with the shared `$50` cap, `$0.517071` recorded snapshot, 99 events plus 2 missing, `$6` reserve unconfirmed, and current reconciliation requirement. |
| P79 | D | Re-audit all 27… | Defer to lead approval after each prior wave is fully independently verified; no new paid final pass now. |
| P80 | A | 7. Human decisions… | Accept the human-decision heading. |
| P81 | D | Authorize (or formally defer)… | Human decision required; external publishing and email remain unauthorized and untested. |
| P82 | C | Set the verification spend cap… | Apply the already-set shared `$50` cap, with current reconciliation required before any future retest and no cap-only approval. |
| P83 | D | Decide the 6 unsupported… | Human product-scope decision: build, defer, or remove claim; no remediation agent may invent these features. |
| P84 | D | Confirm the agency-report PDF gap… | Human/product scope decision; PDF is a new build/unsupported gap, not a silent bug fix. |

## Table-row and cell disposition matrix

The table IDs below match the verbatim companion exactly.

| ID | Architect | Disposition and rationale |
|---|:---:|---|
| T1.R1 | A | Accept the scope table header; it distinguishes historical bucket, count, and reachability. |
| T1.R2 | C | Preserve historical `Passed: 7`, but correct its operational meaning to retained baseline evidence with Scope 0 `IN_PROGRESS` locks, not seven new passes. |
| T1.R3 | A | Accept `Failed: 5` as the historical bucket; remediation remains evidence-gated and initially `OPEN`. |
| T1.R4 | A | Accept `Partial: 7` as the historical bucket; close only the documented gap and retest under authorization. |
| T1.R5 | C | Accept the count and addressability, but retain `BLOCKED` as historical grade and require end-to-end evidence before any current status changes. |
| T1.R6 | A | Accept `Not run: 12`; no grade may be inferred before execution. |
| T1.R7 | A | Accept `Unsupported: 6`; these are product-scope decisions, not fabricated remediation targets. |
| T2.R1 | A | Accept the role-table header. |
| T2.R2 | C | Lead may read/assign/verify evidence but may not write feature code or self-grade; lead approval gates each scope. |
| T2.R3 | C | Infra owns RC-1/RC-6/concurrency/schema review but must preserve queue identities and not change prompt/content logic or add packages. |
| T2.R4 | C | Quality owns blocking gates and checks but must not weaken thresholds; claims need evidence/citation policy. |
| T2.R5 | C | Platform owns specs/aspects/hero reuse but must use deterministic trim/re-render rules and not change models. |
| T2.R6 | C | Media owns duration/video evidence but may not skip real-render requirements; exact payload logging is replaced by redacted diagnostics. |
| T2.R7 | D | Ledger receipt/cost changes belong to active isolated task 179; no duplicate implementation, no cost estimates, and the two missing calls remain explicit. |
| T2.R8 | C | Verifier runs a separate evidence pass and hands code back; in this continuation it records no live pass and cannot exceed the reconciled cap. |

## Clause-level corrections for long prompts

The following split is mandatory so no numbered instruction is hidden inside a
long paragraph. `A`, `C`, and `D` retain the architect meaning; corrections here
also apply to any future prompt copy.

### P49 — state-file schema (split)

1. **Header and root-cause section — C:** retain the state-file purpose, but list
   all seven RCs exactly and use only the five remediation statuses.
2. **Feature section — C:** replace illustrative `F-01`/`F-02` and historical
   `FAIL` values with all 27 exact master-inventory feature names, a separate
   historical-grade field, and a valid current remediation status.
3. **Append-only handoff log — A:** retain timestamp/agent/action/result/next
   evidence, never delete or rewrite an earlier entry.
4. **Human blocker section — A:** retain precise questions and use
   `BLOCKED_HUMAN`; never guess or silently skip.

### P50 — state rules (split)

1. **Allowed statuses — A:** only `OPEN`, `IN_PROGRESS`, `FIXED_UNVERIFIED`,
   `VERIFIED_PASS`, `BLOCKED_HUMAN`.
2. **Evidence gate — C:** `VERIFIED_PASS` requires independent evidence meeting
   the corrected Definition of A+ and is not created by this handoff.
3. **Unfinished work — A:** exact question plus `BLOCKED_HUMAN`; no workaround,
   fabricated evidence, or silent omission.
4. **Handoff history — A:** append-only; never delete another agent's entry.

### P56 — LEAD numbered instructions (split)

1. **P56.1 — C:** Read the checked-in state and plan; if absent, document the
   blocker rather than silently creating an incomplete state. The state must list
   all seven RCs and all 27 addressable names with valid statuses, while the
   seven baseline locks are separate.
2. **P56.2 — A:** Print counts for all five allowed remediation statuses. Keep
   historical grades in a separate column/count and include pending Scope 0 locks.
3. **P56.3 — C:** Follow Wave 1 → Wave 2 → Wave 3 → Wave 4 → Wave 5 ordering,
   with full independent verification and lead approval before advancing. Wave 6
   remains a human scope decision.
4. **P56.4 — C:** The worker prompt must identify root cause, relevant evidence
   paths, and acceptance evidence, while adding the no-paid/no-side-effect,
   immutable-export, redacted-diagnostic, cap-reconciliation, and ownership rules.
5. **P56.5 — C:** Lead cannot self-mark `VERIFIED_PASS`; missing evidence leaves
   the item `FIXED_UNVERIFIED` or returns it to `OPEN`/`BLOCKED_HUMAN` as
   appropriate. Scope 0 tests do not qualify as a live pass.

### P58 — INFRA/RC-1 numbered instructions (split)

1. **P58.1 — A:** Find and inventory every queue-name/job-ID construction and call
   site before any change.
2. **P58.2 — C:** One canonical helper may enforce project charset `[a-z0-9_-]`,
   but do not claim a universal BullMQ maximum. Preserve legacy/current queue
   names and lookup/cancel/recovery/settlement/idempotency identities; do not add
   a package.
3. **P58.3 — C:** Migrate every ad-hoc construction without changing identity
   semantics or silently breaking existing records.
4. **P58.4 — C:** Validate at enqueue and return a clear typed error; retain
   diagnostics as IDs, hashes, and redacted metadata rather than payload logs.
5. **P58.5 — C:** Tests cover every job type and colon input, but tests/typecheck
   are not a live provider pass; no paid rerun is authorized.

### P60 — QUALITY/RC-3 numbered instructions (split)

1. **P60.1 — A:** Map article/social generation through persistence and identify
   exactly where an artifact would be written.
2. **P60.2 — C:** Implement/assess blocking pre-persistence checks for target word
   count, prompt/debug residue, URL shape, claim evidence/citation policy, and
   brand policy. A missing/errored policy check fails; no unsupported claim is
   silently accepted.
3. **P60.3 — C:** Permit at most one deterministic regeneration in an authorized
   future procedure; then hard-fail with structured reasons. Failed outputs remain
   diagnostic and never finished/exportable. No paid regeneration in this handoff.
4. **P60.4 — C:** Preserve credit release and incurred provider cost as separate
   concepts; a failed customer charge does not erase provider usage. Reconcile
   ledger evidence without fabricated rows and without a DB write here.
5. **P60.5 — C:** The historical failing article is a preserved diagnostic fixture;
   an isolated test may assert rejection, but that guardrail cannot create a
   `VERIFIED_PASS` or authorize a paid rerun.

### P62 — PLATFORM/RC-2 numbered instructions (split)

1. **P62.1 — C:** One typed specs source covers all generated platforms, hard
   character/aspect/dimension/hashtag limits, and deterministic claim/URL rules.
2. **P62.2 — C:** Validate before persistence. A text trim must have deterministic
   meaning/hashtag rules and fail for user edit when those rules cannot be met;
   image crop/re-render must be revalidated. Never persist out-of-spec output.
3. **P62.3 — C:** Reuse an eligible article hero and crop per platform; do not
   claim reuse where no eligible hero exists, and do not generate a replacement
   during this handoff.
4. **P62.4 — A:** Retain the 403-character fixture and exact dimension assertions
   as evidence criteria; they are not live-provider passes here.

### P64 — MEDIA/RC-4 numbered instructions (split)

1. **P64.1 — D:** Duration contract requires a human-approved hard bound and
   measured WPM per voice/locale before any future paid procedure. Current
   continuation does not run TTS/video.
2. **P64.2 — C:** Measure with ffprobe and enforce the requested hard range;
   deterministic recut/regenerate once only in an authorized future run, otherwise
   fail with a reason. Do not treat ±15% outside the advertised range as valid.
3. **P64.3 — A:** Store measured duration and render that stored value; remove
   estimates from the display. Preserve the 204.384-second/4:20 diagnostic.
4. **P64.4 — C:** Do not log the exact failing payload. Validate the JSON contract,
   retain schema-error IDs/hashes and redacted metadata, and make parse failures
   explicit without payload exposure.
5. **P64.5 — C:** A playable MP4 with byte size and measured duration remains the
   eventual evidence requirement; no MP4 means no video pass, and no current
   status is upgraded.

### P66 — LEDGER/RC-7 numbered instructions (split; task 179 owner)

1. **P66.1 — D/task179:** Audit all provider paths and required usage fields under
   task 179 ownership; this handoff does not duplicate receipt changes or write
   rows.
2. **P66.2 — D/task179:** Reconcile the two missing calls or explicitly retain
   UNKNOWN model/limits; never fabricate a value, and keep `$6` unconfirmed.
3. **P66.3 — D/task179:** Preserve the distinction between released customer
   credits and incurred provider cost; no silent leak and no “zero” inference.
4. **P66.4 — D/task179:** The no-provider-call-without-a-ledger-row assertion is
   an eventual evidence requirement, not a new paid test here.
5. **P66.5 — D/task179:** Cost-per-feature reporting must use observed ledger data
   only; no fabricated verification-run cost and no phrase “historical spend
   verified.”

### P68 — VERIFIER clauses (split)

1. **Run — C:** The verifier is a different agent/session and does not fix code;
   real-provider end-to-end execution is the eventual rule, but no paid run is
   authorized in this continuation.
2. **Evidence — A:** Retain the required artifact ID/bytes, measured media
   metadata, persistence, spec numbers, provider usage row, and credit behavior;
   diagnostics are preserved without exact payload logs.
3. **Grading — C:** Only independent evidence can move an item to
   `VERIFIED_PASS`; missing/wrong evidence returns it to `OPEN` or creates an
   exact `BLOCKED_HUMAN`. Scope 0 guardrails are not grading evidence.
4. **Budget — C:** Stop before a future procedure if current cap reconciliation
   would exceed the shared `$50`; an increased cap alone is insufficient, and the
   `$6` reserve remains unconfirmed.

### P70 — persistence wrapper bullets (split)

1. **P70.1 — C:** Preserve up to five diagnose/fix/re-run cycles only for an
   authorized, non-paid or later approved procedure; no paid reruns now.
2. **P70.2 — C:** Record changed files/commands/actual output when a permitted
   test occurs; documentation-only work records evidence without claiming a run.
3. **P70.3 — C:** Never report success without evidence; never turn a typecheck,
   mock, or guardrail into a live pass.
4. **P70.4 — A:** Missing credential/unclear requirement/spend limit produces an
   exact `BLOCKED_HUMAN` question and stops; no invented workaround or disabled
   test.
5. **P70.5 — A:** Never delete, skip, or weaken a test to obtain a pass.
6. **P70.6 — A:** Re-read acceptance evidence line by line before any handoff;
   preserve failed diagnostics, immutable exports, queue identities, and append-only
   history.

## Operational gate and handoff

The current honest boundary is stopped under the paid gate:

- Scope 0's seven regression locks are `IN_PROGRESS` and pending a separate
  worker plus independent review. They are guardrails, not real-provider passes.
- RC-7 receipt changes are owned by isolated task 179; no duplicate worker is
  started here.
- The shared cap is `$50`; the recorded snapshot is `$0.517071` over 99 events
  plus 2 missing; `$6` reserve coverage is unconfirmed.
- No new paid call, email, publication, database write, customer-data operation,
  dependency, or exact provider-payload log is permitted.
- A lead must approve each scope, and no Wave 2 begins before every prior-wave
  item is independently verified as `VERIFIED_PASS`. This handoff creates no new
  `VERIFIED_PASS`.