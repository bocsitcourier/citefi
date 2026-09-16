# Historical provider reconciliation

**Status: UNKNOWN / UNRECONCILED; paid reruns remain paused**

This handoff preserves the historical evidence gaps. It does not retry either
call, infer a provider outcome, convert unknown cost to zero, or attribute a
later verification-v2 call to the earlier v1 attempt. The reconciliation
specialist must append evidence rather than overwrite these records.

## Call 1 — original article generation

| Required field | Retained evidence | State |
|---|---|---|
| Call ID | Not retained | **UNKNOWN** |
| Time | `2026-09-10T16:23:00Z` in `reports/live-generation/accounting.json` | **RECORDED / NOT RECONCILED** |
| User/project | Fixture team `2535` is observer scope; exact user/project identity is not retained in the unresolved-call record | **PARTIAL / UNKNOWN** |
| Provider | Not retained in unresolved-call record | **UNKNOWN** |
| Model | `gemini-3.5-flash` appears in the incident record; this does not prove receipt by the provider | **RECORDED, insufficient** |
| Request/response | Not retained | **UNKNOWN** |
| Tokens/units | Not retained | **UNKNOWN** |
| Cost | Not retained; no zero may be assigned | **UNKNOWN / UNRECONCILED** |
| Receipt | No recoverable historical receipt | **UNKNOWN** |
| Ledger record | `0` rows in the unresolved incident record | **RECORDED, not reconciliation** |
| Job/retry chain | Surrounding article/batch context exists, but exact call binding is not retained | **UNKNOWN** |
| Physical provider outcome | Cannot be determined | **UNKNOWN** |
| Billing representation | No ledger representation for this unresolved call | **UNRECONCILED** |

The model and timestamp are evidence fields only. The historical single-call
stress bound is a coverage treatment, not a measured expense.

## Call 2 — first QA audio/transcription verification

| Required field | Retained evidence | State |
|---|---|---|
| Call ID | Not retained; provider request ID is null | **UNKNOWN** |
| Time | Not retained | **UNKNOWN** |
| User/project | Team `2535`, article `2238` | **RECORDED / PARTIAL** |
| Provider/model | Not retained | **UNKNOWN** |
| Request/response | Not retained | **UNKNOWN** |
| Tokens/units | Not retained | **UNKNOWN** |
| Cost | Not retained; no zero may be assigned | **UNKNOWN / UNRECONCILED** |
| Receipt | `PROVIDER_ACCOUNTING_FAILED`; no durable receipt identity recovered | **UNRECONCILED** |
| Ledger record | `0` rows | **RECORDED, not reconciliation** |
| Job/retry chain | Forensics artifact exists; exact original job/retry chain is not retained | **PARTIAL / UNKNOWN** |
| Physical provider outcome | Explicitly `unreconciled/unknown` | **UNKNOWN** |
| Billing representation | Accounting failed before a durable usage row | **UNRECONCILED** |

The retained forensics artifact records zero provider calls *during the
forensics recovery itself*, no metadata lookup, no ledger backfill, and no
generation retry. That is not evidence that the original historical call did
not occur. The later v2 verification call has a separate provider request ID,
model, ledger ID `395`, and source event, and is not evidence for v1.

## Historical aggregate and amount handling

`reports/live-generation/accounting.json` is retained as the accounting
snapshot:

- 99 unique provider events;
- `recordedProviderCostUsd: 0.517071`;
- two distinct unresolved incidents;
- a separate unresolved reserve of `$6.000000`;
- single-call stress bound `$2.785280` and conditional two-call upper bound
  `$5.570560`, with model limits not confirmed for the audio call; and
- paid-call gate `PAUSED`.

The reconciliation request also requires preserving the historical snapshot
reference **`$0.51707199`**. The repository snapshot stores **`$0.517071`**
(six decimal places), so the eight-decimal reference and stored artifact do not
match. This precision discrepancy is retained as unresolved evidence; neither
number is treated as fresh spend, an invoice, or a newly measured amount.

The `$6` reserve is not a fabricated provider-ledger event. It remains a
coverage treatment for the two unresolved calls, and cannot be released or
reclassified until both historical physical outcomes and model-limit evidence
are recovered.

## Evidence sources and required resolution

Primary sources:

- `QA/PROVIDER_RECONCILIATION.md`;
- `reports/live-generation/accounting.json`;
- `reports/live-generation/assets/podcast-2238-transcription-v1-forensics.json`;
- `reports/live-generation/execution-summary.md`; and
- the receipt contract and offline execution logs under
  `QA/evidence/accounting-execution/`.

To close either call, append the original harness/request identity or a
provider-side record; provider/model/request/response/usage facts with
redacted payload handling; receipt status and immutable ledger source event;
team/project/resource/job/retry identity; reservation/credit/cap treatment;
and proof that reconciliation made no second provider request.

If any required field remains unavailable, the call remains
**UNKNOWN / UNRECONCILED**. No historical evidence was deleted or rewritten by
this audit.

## Append-only precision correction

The `$0.51707199` wording above was an agent spelling/precision typo, not an
observed repository value. The canonical retained snapshot is **$0.517071
across 99 unique provider events**, as recorded in
`reports/live-generation/accounting.json`. The original wording remains above
for audit history; this correction does not turn the historical snapshot into
an invoice or reconcile either unresolved call.
