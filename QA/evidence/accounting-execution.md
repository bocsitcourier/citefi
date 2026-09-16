# Accounting/provider QA execution evidence

**Phase:** offline red-test audit, before implementation edits  
**Execution boundary:** no provider calls, no env-file loading, no application
DB/Redis services, no migration execution, no workflow restart, and no
application-port traffic. The offline guard was preloaded for every command:

```text
node --import ./QA/support/offline-guard.mjs --import tsx/esm --test <file>
```

The raw TAP output is retained under
`QA/evidence/accounting-execution/`. These results are mocked, in-memory, or
source/static evidence; they are not paid-provider or live certification.

## Executed existing candidate matrix

| Test file | Tests | Passed | Failed | Exit |
|---|---:|---:|---:|---:|
| `tests/brave-attempt-receipt.test.ts` | 5 | 5 | 0 | 0 |
| `tests/gemini-attempt-receipt.test.ts` | 9 | 9 | 0 | 0 |
| `tests/gemini-throttled-invocation.test.ts` | 2 | 2 | 0 | 0 |
| `tests/intent-hyperlink-receipt.test.ts` | 1 | 1 | 0 | 0 |
| `tests/media-provider-receipt-boundary.test.ts` | 3 | 3 | 0 | 0 |
| `tests/media-provider-replay-safety.test.ts` | 13 | 13 | 0 | 0 |
| `tests/openai-attempt-receipt.test.ts` | 8 | 8 | 0 | 0 |
| `tests/provider-accounting-boundary.test.ts` | 9 | 8 | 1 | 1 |
| `tests/provider-attempt-object-spool.test.ts` | 4 | 4 | 0 | 0 |
| `tests/provider-attempt-receipts.test.ts` | 14 | 14 | 0 | 0 |
| `tests/provider-http-invocation.test.ts` | 3 | 3 | 0 | 0 |
| `tests/provider-invocation-identity.test.ts` | 4 | 4 | 0 | 0 |
| `tests/provider-receipt-error-policy.test.ts` | 6 | 6 | 0 | 0 |
| `tests/provider-usage-ledger.test.ts` | 8 | 8 | 0 | 0 |
| `tests/provider-usage-ledger-ownership.test.ts` | 5 | 5 | 0 | 0 |
| `tests/provider-usage-ledger-production-contract.test.ts` | 2 | 2 | 0 | 0 |
| **Existing-candidate total** | **96** | **95** | **1** | **1** |

The existing-candidate total is the sum of the retained TAP logs. It supersedes
any earlier informal count that omitted one or more candidate files.

## Newly added regression coverage

`tests/provider-accounting-regressions.test.ts` was added without changing
production code. It covers:

- one hundred concurrent same-invocation redeliveries and the one-submit/one
  ledger-event invariant;
- a paid response followed by an immutable-ledger failure, then explicit
  reconciliation with no provider replay; and
- object-spool readiness save/read/delete failures, including shared-storage
  fault propagation.

Its retained run is
`QA/evidence/accounting-execution/provider-accounting-regressions.new.tap`.

| New regression result | Tests | Passed | Failed | Exit |
|---|---:|---:|---:|---:|
| `provider-accounting-regressions.test.ts` | 4 | 3 | 1 | 1 |

The failing regression is deliberately retained before implementation edits:

```text
lib/social-worker.ts:822: provider retry call has no lexical accounting guard
lib/social-worker.ts:885: provider retry call has no lexical accounting guard
```

The same two call sites are independently reported by the existing
`provider-accounting-boundary` source test. The affected boundaries are
`generateSocialPostWithGemini` and `enhanceSocialPostWithGPT`. Under the
accounting QA contract these are red until the provider-accounting terminal
guard is proven at the retry/fallback boundary. This is source/static evidence;
the offline run intentionally did not invoke the social worker or a provider.

## Result and implementation gate

Across all retained runs there are **100 tests, 98 passes, and 2 failures**
(the duplicate static boundary finding appears in the existing and new
regression suites). The receipt, adapter, identity, HTTP, media, ledger-pure,
and object-spool behavior covered by the passing suites did not produce a
second physical submission in their injected scenarios.

This phase therefore does **not** certify the provider feature and does not
authorize paid retests. Production fixes remain out of scope until the red
regression report is accepted. The migration shell test was not run because it
requires application DB/service writes and is SRE-owned; no application DB
integration was substituted for it.
