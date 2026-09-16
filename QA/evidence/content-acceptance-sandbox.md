# Content acceptance sandbox evidence

**Evidence ID:** E-QA-CA-001  
**Execution mode:** mock / isolated service-boundary acceptance  
**Fixture ownership:** synthetic team `1701`, user `7101`, article `91`, batch `81`, campaign `77`, and social variant `301`  
**Date:** current workspace execution  

This evidence is a current sandbox result, not a live-provider certification. The
route suite imports the production route handlers and schema/validation paths.
The service suite imports the production SEO/social services and output
validators. Provider submission/accounting, queue, billing, and application DB
are explicit deterministic boundaries:

- **Provider mock:** Gemini and OpenAI SDK/submission adapters return fixture
  payloads, malformed payloads, and empty payloads. No paid provider call is
  made.
- **Database mock:** `fixtureDb` queues production `select` results and retains
  production `insert`/`update` payloads in memory. No PostgreSQL/customer DB is
  opened.
- **Queue mock:** production route queue functions return fixture job IDs or a
  deterministic queue error. No worker is started.
- **Billing/cap mock:** reserve/debit/release/cap functions record calls and
  return deterministic results. No credit account is charged.
- **External effects:** offline guard remains enabled; no email, publishing,
  ad-platform spend, or customer data is used.

## Commands executed

```text
NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs --import ./QA/support/offline-guard.mjs --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test tests/qa/content-acceptance-services.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs --import ./QA/support/offline-guard.mjs --experimental-loader ./tests/qa/content-acceptance-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test tests/qa/content-acceptance-routes.test.ts
```

## Raw TAP

### Service suite

```text
TAP version 13
# Subtest: rows 19, 20, 22, 23: real SEO services accept valid provider JSON and preserve request context
ok 1 - rows 19, 20, 22, 23: real SEO services accept valid provider JSON and preserve request context
# Subtest: rows 19, 20, 22, 23: malformed and empty provider output fails closed without fabricated results
ok 2 - rows 19, 20, 22, 23: malformed and empty provider output fails closed without fabricated results
# Subtest: rows 21 and 40: schema and Brand Intelligence validators reject malformed output and preserve safe round trips
ok 3 - rows 21 and 40: schema and Brand Intelligence validators reject malformed output and preserve safe round trips
# Subtest: row 11: real Gemini social service returns a provider-stubbed caption and rejects empty output
ok 4 - row 11: real Gemini social service returns a provider-stubbed caption and rejects empty output
# Subtest: row 11: social enhancement provider output is validated by the production final caption validator
ok 5 - row 11: social enhancement provider output is validated by the production final caption validator
1..5
# tests 5
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Route suite

```text
TAP version 13
# Subtest: rows 1 and 4: title-pool and batch-title routes persist title output and fail malformed input before provider work
ok 1 - rows 1 and 4: title-pool and batch-title routes persist title output and fail malformed input before provider work
# Subtest: rows 2 and 3: batch submit and article regeneration reserve once, enqueue once, and release on queue failure
ok 2 - rows 2 and 3: batch submit and article regeneration reserve once, enqueue once, and release on queue failure
# Subtest: rows 5, 6 and 7: all metadata variants plus article/batch hyperlink and reformat routes update fixture state
ok 3 - rows 5, 6 and 7: all metadata variants plus article/batch hyperlink and reformat routes update fixture state
# Subtest: rows 11 and 12: social creation canonicalizes aliases, persists a queue identity, and regenerates one variant
ok 4 - rows 11 and 12: social creation canonicalizes aliases, persists a queue identity, and regenerates one variant
# Subtest: rows 18–24: every SEO route returns typed fixture output, schema rejects malformed rows, and create-articles persists intent
ok 5 - rows 18–24: every SEO route returns typed fixture output, schema rejects malformed rows, and create-articles persists intent
# Subtest: rows 26, 27 and 40: campaign ad export pack, brand confirmation, and standalone intelligence enqueue are tenant-scoped
ok 6 - rows 26, 27 and 40: campaign ad export pack, brand confirmation, and standalone intelligence enqueue are tenant-scoped
1..6
# tests 6
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

## Complete requested-row coverage

`PASS (sandbox)` means the named deterministic route/service contract passed
under the explicit mocks above. It does **not** change the inventory
disposition to live `VERIFIED`.

| Source row | Feature | Current sandbox coverage | Evidence |
|---:|---|---|---|
| 1 | Article title pool and topic research | `PASS (sandbox)` — POST route, synthetic research seams, title response and inserted batch fields; missing required input returns 400 before provider work | Route test 1 |
| 2 | Batch article generation | `PASS (sandbox)` — submit route reserves once, enqueues once, records accepted state; queue failure releases reservation and returns retryable failure | Route test 2 |
| 3 | Single article regeneration | `PASS (sandbox)` — tenant article/batch lookup, claim update, event/queue payload and pending response; shared queue failure recovery exercised through batch path | Route test 2 |
| 4 | Batch title regeneration | `PASS (sandbox)` — production route updates title pool and returns all fixture titles | Route test 1 |
| 5 | Article metadata regeneration | `PASS (sandbox)` — SEO title, meta description, keywords, slug, FAQ and hashtags routes each return output and issue a DB update | Route test 3 |
| 6 | Article reformatting | `PASS (sandbox)` — tenant lookup and reformat queue acceptance with job identity | Route test 3 |
| 7 | Article and batch hyperlink transforms | `PASS (sandbox)` — article apply, batch keyword apply, and batch fix routes run deterministic hyperlink/hashtag updates and retain update payloads | Route test 3 |
| 11 | Social text generation | `PASS (sandbox)` — real Gemini social service output/empty-output gate plus social POST route alias canonicalization and queue identity | Service tests 4–5; route test 4 |
| 12 | Social variant regeneration | `PASS (sandbox)` — production variant route runs mocked Gemini/GPT boundaries, final compliance gate, READY update and log insert | Route test 4 |
| 18 | SEO content audit | `PASS (sandbox)` — production route returns audit result for synthetic article | Route test 5 |
| 19 | SEO local research | `PASS (sandbox)` — real service valid JSON and malformed/empty rejection; production route response | Service tests 1–2; route test 5 |
| 20 | SEO competitor analysis | `PASS (sandbox)` — real service OpenAI JSON boundary and malformed rejection; production route response | Service tests 1–2; route test 5 |
| 21 | SEO schema markup | `PASS (sandbox)` — production deterministic builder validates/normalizes FAQ data; malformed data rejected in service and route suites | Service test 3; route test 5 |
| 22 | SEO content structure | `PASS (sandbox)` — real service valid JSON and malformed/empty rejection; production route response | Service tests 1–2; route test 5 |
| 23 | SEO pillar and cluster planning | `PASS (sandbox)` — real service OpenAI JSON boundary and malformed rejection; production route response | Service tests 1–2; route test 5 |
| 24 | SEO create articles | `PASS (sandbox)` — production create-articles route converts local-research output into a persisted synthetic batch intent | Route test 5 |
| 26 | Campaign ad copy generation | `PASS (sandbox)` — production campaign ad route generates synthetic export-only pack, settles mocked reservation, and GET retrieves list/readiness | Route test 6 |
| 27 | Campaign brand confirmation and intelligence context | `PASS (sandbox)` — production confirmation route freezes synthetic campaign snapshot; campaign detail is returned | Route test 6 |
| 40 | Standalone Brand Intelligence | `PASS (sandbox)` — production run route persists/upserts synthetic profile and enqueues once; running-state idempotency returns without a second queue call | Service test 3; route test 6 |

## Remaining real gaps

1. PostgreSQL persistence/retrieval is not certified by this evidence. The
   fixture DB is an in-memory mock retained only for route read/write assertions.
2. Queue workers are not started. Batch/article/social/reformat/intelligence
   outputs after enqueue, worker retries, restart durability, cancellation, and
   queue/database reconciliation remain untested here.
3. No paid provider call, provider usage receipt, cost ledger, or real credit
   settlement is claimed. Provider call counts are boundary assertions only.
4. Object storage, image bytes/dimensions, exports, browser UI, and retrieval
   through deployed HTTP are outside this sandbox.
5. Article text generation quality/terminal review is not claimed; this suite
   covers the submit/regeneration boundary and HTML transformation routes.
6. Campaign ads are proven as export-only fixture output. External Google/Meta
   publishing and spend remain intentionally blocked.
