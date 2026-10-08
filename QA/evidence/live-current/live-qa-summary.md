# Current live QA continuation

**Overall certification: NOT CERTIFIED.** Four genuine Gemini article
submissions were made in the architect-assisted run. All four provider requests
returned HTTP 200 and have durable, settled receipts in
`budget-ledger.json`; all four end-to-end cases failed. This report is the
current concise view. Raw case artifacts and original exports remain unchanged.

## Thinking-control continuation — offline ready, live blocked

The four failures below are still failures. **No new paid request was made in
this continuation, and no live article pass is claimed.** Completion of the
requested new live QA remains blocked on architect approval before spending.

- Verified the official model-specific GenerateContent documentation, retained
  in `thinking-controls-source.md`: Gemini 3.5 Flash supports `MINIMAL`,
  `LOW`, `MEDIUM`, and `HIGH`. `MINIMAL` is an effort setting, not a guarantee
  of zero thought tokens. Numeric `thinkingBudget` is not used or combined
  with `thinkingLevel`.
- The opt-in real article request now serializes
  `generationConfig.thinkingConfig.thinkingLevel: "MINIMAL"` while retaining
  the 16,384 reasoning-inclusive total-output cap. Production safe receipt
  metadata and independent request/receipt evidence retain the same setting.
  The strict guard rejects missing, altered, or extra thinking controls.
  Ordinary callers without an opt-in request limit retain their defaults.
- Installed SDK declarations predate `thinkingLevel`, but an intercepted
  real SDK request proved the serializer retains the field. The narrow typed
  extension is verified without a package upgrade or provider submission:
  `thinking-serialized-smoke.txt`.
- Offline request, receipt, replay, approval, settlement and native COGS checks
  passed **34/34** in `thinking-configuration-offline.tap`. The final targeted
  run after a test response-type correction passed **5/5** in
  `thinking-configuration-targeted.tap`; do not add those totals together.
  `thinking-configuration-typecheck.txt` is empty: whole-project TypeScript
  passed. These are **offline checks, not live certification**.
- Preflight maximum remains $0.3662976 for one article plus one genuine final
  judge, with the existing $2 subcap/reservation and USD30 total ledger.
  Historical HOLD stays $6, known prior valuation stays $0.517071, and all
  four settled cases stay $0.474870. Availability is still **$23.008059**.
- New live execution requires a unique explicit case ID and an architect
  approval record bound to that case, configuration digest, historical
  baseline digest, and requested word maximum. No default/reused case ID or
  paid replay is authorized. `architect-approval-pending.json` proposes
  `live-article-minimal-thinking-2000` but explicitly does **not** approve it.
- The requested pre-spend architect review was refused by this environment
  because review is restricted to task completion. No architect verdict was
  obtained. Do not treat that refusal, passing offline checks, or this report
  as approval. Obtain architect approval before submitting the proposed case.

When approved, the harness still requires `COMPLETE`, a nonempty exact
HTTP/persisted artifact match, authenticated wrong-tenant `404`, mandatory
Guardian, a genuine final judge receipt, a single settled debit with zero
remaining reservation, and native candidate **plus reasoning** quantities
priced against the immutable official rate snapshot. Receipt status alone
is insufficient: mismatched quantities/rates/COGS now fail acceptance.

## Live article cases

| Case | Provider/output observation | End-to-end result | Conservative usage estimate |
|---|---|---|---:|
| `first-article-v1` | Gemini 3.5 Flash hit `MAX_TOKENS` at an 8,192 total output-token cap: 6,369 thinking + 1,808 candidate tokens. | **FAIL**; unusable/incomplete output. Authenticated retrieval endpoint 200; other tenant 404. | $0.083604 |
| `live-article-output16384` | Gemini returned valid JSON with `STOP`; generated article failed Guardian quality because it had 0 links. Five FAQ answers were separate metadata, not part of the rendered article body. | **FAIL**; Guardian rejected it; final judge was never called. Authenticated retrieval endpoint 200; other tenant 404. | $0.113511 |
| `live-article-faq-assembly` | After the production FAQ-assembly fix, the provider returned `STOP` and FAQ answers were assembled. The article measured 1,556 words against the requested 700–1,400 range. | **FAIL**; output exceeded the requested 1,400-word maximum. Authenticated retrieval endpoint 200; other tenant 404. | $0.120432 |
| `live-article-faq-assembly-max2000` | `MAX_TOKENS` at a 16,384 total output-token cap: 15,004 thinking + 1,364 candidate tokens (16,368/16,384). | **FAIL**; output truncated/incomplete. Authenticated retrieval endpoint 200; other tenant 404. | $0.157323 |

Case artifacts: `first-article-v1/`, `live-article-output16384/`,
`live-article-faq-assembly/`, and `live-article-faq-assembly-max2000/`.
Each `outcome.json` records `endToEndPass: false`. No usable/published
`COMPLETE` artifact was established. Across these cases there was one Guardian
call and **zero final-judge physical calls**. The authenticated retrieval
response and cross-tenant 404 establish those access observations only, not
content acceptance or publication.

## Cost and authorization boundary

`budget-ledger.json` is the latest settled ledger: four physical Gemini calls,
**$0.474870 conservative usage estimate**, not an invoice. It records the prior
known valuation as $0.517071 and the separate historical $6 coverage HOLD
(not actual spend); both historical calls remain `UNKNOWN / UNRECONCILED`.
Current ledger availability under the existing $30 total ceiling is
**$23.008059**, after these settlements and the separate hold. The per-case
`outcome.json.totalBudget` fields are pre-settlement snapshots; use the final
ledger for current availability. Official provider pricing captures are
retained in `google-pricing-source.md` and `openai-gpt41mini-pricing-source.md`.

Paid QA was stopped after four failed article cases as agreed with the
architect. This was not a provider payment/billing failure. No additional paid
calls occurred after these four in this phase.

## Defects fixed and regressions

- Production speed mode omitted structured FAQ metadata from the rendered
  article body. FAQ assembly is now applied before Guardian while preserving
  existing FAQ sections and safely rendering normalized text. The retained
  regression `speedmode-faq-regression.tap` is **3/3**.
- Native Gemini billed-token accounting omitted thinking tokens from COGS.
  `lib/gemini-attempt-receipt.ts` and `lib/cost-telemetry.ts` were corrected.
  The latest `thinking-accounting-final.tap` is **16/16**, superseding the
  earlier retained `thinking-accounting-regression.tap` (12/12) for current
  status. Do not add these runs together. Native valid prompt and total token
  counts are authoritative, with output derived as total minus prompt; a
  complete valid split is required otherwise, and inconsistent/missing pricing
  splits fail closed as `UNKNOWN`. Image-unit accounting remains independent.
  In the original case ledger, 22,287 micro-USD had been charged versus
  157,323 micro-USD after correct accounting. Original raw exports were not
  rewritten; no historical or application-database rebilling was performed.
- Whole-project TypeScript passed with no diagnostics; see
  `final-typecheck.txt`. These fixes/regressions do not turn any live article
  case into an end-to-end pass.

## Other media and next steps

- Image harness: `scripts/qa-live-image.mjs` has a bounded preflight. The
  initial attempt failed on the presentation mismatch `2,520` versus official
  `2520` (same numeric value); section-whitespace and optional-comma
  normalization corrected this. The subsequent bounded preflight passed with a
  $0.1592 maximum estimate and $0.16 reserve. **No paid image request was
  submitted and no image E2E pass is claimed.**
  The harness uses filesystem storage, not cloud storage, and its targeted
  Gemini 3.1 image model is not the application's Gemini 2.5 default.
- Audio/video: no live calls and no completed live QA.
- Main login screenshot `application-login.jpg` passed static visual review
  only. Anonymous API `401` is expected; this is not generation or authenticated
  login certification.
- Before considering another live article attempt, investigate a strict
  thinking/output-token limit or a lower-thinking model/configuration, ensure
  output budgets include thinking tokens, and make the prompt/assembly respect
  the requested word maximum. Require separate preflight/authorization before
  any further paid request.

Historical E-031–E-042 evidence and red artifacts remain retained. This
continuation adds E-043 (live article cases), E-044 (production defects and
regressions), E-045 (bounded image preflight boundary), and E-046 (static main
login screenshot observation); none changes the overall **NOT CERTIFIED**
decision. A separate final-approval source is still pending collection by the
main agent and is not claimed by this report.
