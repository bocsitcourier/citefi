# Live generation execution summary

**Final execution state: BLOCKED / NOT CERTIFIED. This record is not complete success and is not certified.**

Rendered: 2026-09-15T00:43:53.970Z
Fixture: LIVE GENERATION QA 2026-09-10

## Matrix counts

PASS 7 · PARTIAL 7 · FAIL 5 · BLOCKED 3 · NOT_RUN 12 · RUNNING 0 · NOT_TESTABLE 6
Total inventory rows: 40 (the 40th row is standalone Brand Intelligence).
The dashboard matrix renders an explicit status beside each row's UI, API, Provider, Generation, Output, Storage, DB, Export, and Billing evidence; dimension status never upgrades an overall result.

## Accounting and budget

- Shared approved cap: $50.000000 (authorization ceiling only; not a provider invoice or a claim of available spend).
- Additional unreconciled reserve: $6.000000 (unrecorded reserve; excluded from provider-ledger actuals and not treated as spend).
- Shared-cap observer scope: 2535 (primary, cap $50.000000); 2567 (agency, cap $5.000000); 2568 (client, cap NOT REPORTED). The $50 cap applies to recorded provider usage across all listed teams plus the separate unresolved reserve; it is not a primary-only remaining calculation.
- Unique provider ledger events rendered: 99.
- Actual recorded provider cost across observer scopes: $0.517071 from unique provider-ledger IDs in accounting.json; overlapping report totals are not added.
- Actual remaining before unresolved reserve: $49.482929 (= shared cap − all-team recorded cost).
- Conservative exposure remaining after unresolved reserve: $43.482929 (= $50 − all-team recorded cost − $6.000000 reserve). The reserve is not a fabricated ledger event.
- Reserve coverage: UNRESOLVED_BOUND_NOT_CONFIRMED_PAUSE_REQUIRED; single-call stress bound $2.785280, conditional two-call stress upper bound $5.570560, status: UNRESOLVED — only the original article model is confirmed; the first QA audio verification model/limits are not recorded by the harness.
- Existing unresolved calls are identified separately (original article generation and first QA audio verification); the $6.000000 reserve is the only coverage treatment, with no ledger event or expense estimate fabricated. The priced verification-v2 ledger row is counted once and not added again.
- QA observer gate: PAUSED — pause new paid submissions when all-team recorded cost plus the unresolved reserve reaches the shared cap, whenever usage is unpriced, or until both unresolved-call model limits are confirmed by the harness.
- Cost coverage: PARTIAL — unique provider-ledger valuation, not a provider invoice; unsupported, delayed, missing, or unpriced usage is not free.

### Unresolved call identities

- **original-article-generation:** Original article generation call reported at 2026-09-10T16:23:00Z; exact usage and provider request ID were lost. Model-limit confirmation: true; ledger rows: 0.
- **first-qa-audio-verification:** First QA audio/transcription verification attempt failed provider accounting before a ledger row; physical call outcome remains unreconciled/unknown. Model-limit confirmation: false; ledger rows: 0.

## Final blockers and certification boundary

- **Paid-call gate:** PAUSED. The separate $6.000000 reserve covers two identified unresolved physical calls without fabricating either expense; the conditional two-call stress bound is $5.570560, but the first QA audio verification model/limits are not harness-confirmed.
- **Pending paid retests:** article quality/terminal settlement, social constraint/cap settlement/UI, podcast duration/transcription recovery, video queue/Veo proof, and other provider-backed rows remain pending or failed; no paid retest was authorized or made in this continuation.
- **Source-proven non-execution classifications:** 6 inventory rows are product-unsupported/NOT_TESTABLE absent contracts, and 1 separate row is NO_PUBLISH_AUTHORIZATION/NOT_RUN despite explicit source routes (7 source-proven boundary statuses total); none is a failed execution.
- **Non-paid blockers:** title selection remains hidden by the RUNNING batch UI despite five persisted API titles; the existing podcast play/download passes but its duration failure remains; the immutable ad export's independent canonical hash FAIL remains preserved; agency report concurrency failed even though deterministic HTML generation/download passed.
- **Source-fix boundary:** migration 0033 and the canonical-date, queue-id, report-config, and related fixes are unit-verified/source-reviewed only, not live-certified. Migration 0033 was verified on the actual app database; an additive application was also observed on a separately configured Neon DSN without the QA team. No DSNs/secrets are rendered, no rows/data were deleted, and QA recurring automation remains disabled.
- **Certification decision:** BLOCKED / NOT CERTIFIED. The exact retained accounting is 99 unique provider events and $0.517071 recorded provider-ledger cost across all three observer teams; the incorporated retests initiated zero provider calls.

## Current evidence decisions

- Standalone Brand Intelligence: PASS for the public HomeWorks Energy source. The separate controlled-runtime fixture failure remains preserved and is not overwritten.
- Article quality: FAIL for the latest terminal run; CHATGPT_REVIEWED ended failed and the 10-credit reservation was RELEASED. The historical retry with missing billing data remains a separate historical failure, not proof of a missing debit.
- Title pool: five persisted API titles are proven by authenticated readback; the already-RUNNING UI hides selection and remains UI-limited.
- Social: five physical provider-generated images and five READY variants are preserved; zero hero reuses were observed. X length/aspect/cap settlement defects keep the feature FAIL. Recorded actual social provider spend is $0.211397.
- Podcast: existing-media playback/download pass, but the real 204.384-second MP3 still fails the requested 1–2 minute contract; transcription output is incomplete and its $0.001730 metered cost is not zero.
- Video: two failed attempts have queue/Gemini evidence but no Veo operation or asset; the latest script fix is not live-proven, so the row remains FAIL.
- SEO schema UI retest: four valid deterministic UI schemas (FAQPage, Article, HowTo, LocalBusiness), with no provider calls; this narrow schema UI row is PASS.
- Ad export: downloaded export and internal hashes pass, while independent canonical round-trip verification FAIL remains preserved; the future Date fix was unit-tested and the historical artifact was not rewritten.
- Agency report: deterministic HTML report generated/approved/downloaded with no provider call; the concurrent report suite failed and is retained as a blocker.
- Human-authored fixture article 2238 is input only and never counts as an AI article pass.
- Public-report credential audit: password, preview-token, credential-path, and auth-payload fields were removed from saved report artifacts; only non-secret auth outcome metadata remains, and private fixture credentials stay outside reports.

## Retained pending evidence (not a generic next-run plan)

The rows and blockers above are the complete boundary for this finalized record. No new paid operation, external publication, email, recurring QA job, source-data deletion, or placeholder output is authorized by this record. Unsupported source findings, no-publish authorization, and pending paid retests remain distinct classifications.

## Exact NOT_RUN allocation list (12 retained, no finalization authorization)

These rows are an exact allocation of missing evidence, not instructions to spend budget or publish. Each remains NOT_RUN because this finalization did not authorize its operation.

1. **Batch title regeneration** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Run on one synthetic batch, verify every intended title update and provider accounting without touching non-fixture records.
2. **Article metadata regeneration** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Run each variant once on the fixture article, validate schema/persistence/retrieval, and attribute each provider event.
3. **Article reformatting** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Capture before/after HTML, provider events and durable retrieval while validating no content loss.
4. **Article and batch hyperlink transforms** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Exercise each important route on synthetic HTML, validate links and persistence, and distinguish deterministic from provider-backed work.
5. **Batch image and caption repair** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Use the smallest eligible fixture batch and verify each child result, object retrieval, partial failure behavior and cost.
6. **Identity-based social/media image regeneration** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Test explicit platform and omitted-platform variants, validate dimensions/bytes/linkage, and reconcile usage.
7. **Social variant regeneration** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Regenerate one fixture variant, verify platform constraints, durable update and cost attribution.
8. **Social slideshow video** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Run one minimum-duration fixture video after budget approval, validate every component and final playback, then test cancellation separately.
9. **Like-this video** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Use a rights-cleared synthetic/public-domain URL, capture analyze and generate separately, then validate cost and output.
10. **Admin incident AI analysis** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Create/use a synthetic incident only, invoke once, validate schema and ledger attribution, then remove fixture if authorized.
11. **Admin SEO report generation** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Run the corrected GET route with synthetic admin inputs, validate report output/storage and determine actual provider/cost path.
12. **Content publication adapters** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: Keep NOT_RUN; never infer remote publication from queue acceptance, and do not create a connection or publish without a separate authorization.

## Run artifacts

- article-quality-retest-run.json: FAIL
- article-retry-run.json: OUTCOME_RECORDED
- article-run.json: failed
- brand-public-source-run.json: PASS
- brand-retry-run.json: FAIL
- brand-run.json: complete-with-output-gaps
- database-migration-verification-run.json: VERIFIED_WITH_SCOPE_WARNING
- existing-media-ui-run.json: PASS_WITH_KNOWN_AUDIO_DURATION_FAILURE
- export-live-run.json: COMPLETE
- negative-api-run.json: OUTCOME_RECORDED
- podcast-live-run.json: DURATION_FAIL_WITH_VERIFICATION_INCOMPLETE
- remaining-live-run.json: OUTCOME_RECORDED
- remaining-nonpaid-retest-run.json: OUTCOME_RECORDED
- schema-ui-retest-run.json: PASS_WITH_NOTES
- seo-live-run.json: COMPLETE
- seo-ui-run.json: PASS_WITH_RECORDED_LIMITATIONS
- social-live-run.json: COMPLETED_WITH_VALIDATION_FAILURES
- title-pool-readback-run.json: PASS_WITH_UI_LIMITATION
- video-live-run.json: OUTCOME_RECORDED
