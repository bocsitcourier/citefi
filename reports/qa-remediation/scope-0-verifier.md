# Scope 0 verifier report — unpaid regression locks

## Decision

**PASS — deterministic unpaid regression-lock guardrail passed (39/39).**

This verification run inspected and ran only the five revised suites, each in
its own direct Node process as directed by the repository's documented runner
guidance. The five changed suites passed **32/32**. The two unchanged suites
retain their previously verified **7/7** results, for a current targeted total
of **39 tests: 39 pass, 0 fail**.

The prior aggregate-run failure is retained, not hidden: the earlier
content-audit invocation reported `tests 2`, `pass 1`, `fail 1`, `exit 1`, with
Node's `Unable to deserialize cloned data due to invalid or unsupported
version` test-runner/IPC error. Its isolated rerun passed 4/4. The repository's
`GENERATION_TESTING.md` documents running each file in a separate direct
process to avoid this known Node/tsx IPC problem; the revised direct-process
verification passed without that failure. This PASS applies only to these
unpaid deterministic test locks. It does not approve Scope 0, certify live
behavior, or convert mocked checks into production-readiness evidence.
Principal approval is required before any follow-up.

## Commands and observed results

The revised suites were inspected before execution and run one at a time in
separate direct Node processes. This follows `GENERATION_TESTING.md`, which
documents separate processes to avoid the known Node/tsx test-runner IPC issue
and provider-mock leakage. Commands below are reproduced without secrets or
untrusted environment values. Normal experimental-loader/module-mocking
warnings are omitted from the count summaries.

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-seo-routes.test.ts
```

```text
tests 14
pass 14
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-content-audit.test.ts
```

```text
tests 5
pass 5
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

The content-audit process emitted only fixture-labelled progress (article 41,
fixture title, and fixture user 801) plus its five passing test names.

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-campaign-confirm-route.test.ts
```

```text
tests 5
pass 5
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-campaign-confirm-service.test.ts
```

```text
tests 3
pass 3
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-brand-intelligence-route.test.ts
```

```text
tests 5
pass 5
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

The five changed suites total **32 tests: 32 pass, 0 fail**. The two unchanged
suites were not rerun in this revision; their prior direct results remain valid:
`scope-0-pass-features.test.ts` **5/5** and
`scope-0-pure-pass-features.test.ts` **2/2**. Combined current evidence is
**39 tests: 39 pass, 0 fail**. The prior aggregate-run content-audit failure
(`tests 2`, `pass 1`, `fail 1`, `exit 1`, cloned-data deserialization/IPC
error), and its prior isolated 4/4 rerun, remain recorded above in the
decision and below under limitations; they were not suppressed or recounted as
a clean aggregate run.

## Seven-feature coverage review

The seven inventory rows named by the worker are represented:

1. **SEO content audit** — the real `auditArticle` executes against fixture
   reads and a fake OpenAI callback; the assertions require all six criteria,
   an internal-link opportunity, compiled article/link-target SQL predicates,
   tenant/missing-article rejection, and zero insert/update/delete calls. The
   real route also asserts an exact serialized authenticated audit result,
   missing-input 400, and auth-denial 401.
2. **SEO local research** — the real `researchLocalSEO` parses a deterministic
   fake Gemini response, and assertions cover request location/business,
   JSON response format, parsed fields, and telemetry. The route success case
   deep-compares the complete canonical service input, while required-input
   400 and auth-denial 401 verify downstream short-circuiting.
3. **SEO schema markup** — the real deterministic validator/generator covers
   Article, FAQPage, HowTo, and LocalBusiness plus unusable-FAQ rejection.
   Route success, required-input 400, unsupported-type 400 before validation,
   validation-error 400 before generation, and auth-denial 401 are covered,
   with the route service itself mocked.
4. **SEO content structure** — the real service parses a fake Gemini outline
   and assertions cover headings, FAQ, takeaways, audience prompt content,
   and route success/400/401 behavior.
5. **SEO pillar and cluster planning** — the real service parses fake OpenAI
   JSON and assertions cover semantic output, model, JSON response format,
   malformed JSON, empty JSON, and route success/400/401 behavior.
6. **Campaign brand confirmation and intelligence context** — the actual
   route is exercised for tenant/public-ID threading, confirm-before-detail
   ordering, flattening, incomplete 409, absent 404, auth denial, and invalid
   UUID 400 before lookup. The real `confirmBrandSnapshot` is exercised with
   a read/update recorder for immutable snapshot, timestamps, incomplete
   state, and cross-tenant not-found behavior. Compiled SQL assertions require
   campaign ID, team ID, and non-deleted predicates on both campaign read and
   update, plus the profile team predicate and exact parameter arrays. Pure
   URL/status helpers are also covered.
7. **Standalone Brand Intelligence** — the actual route asserts exact
   tenant/source/campaign arguments, ordered upsert→enqueue→sync events,
   unowned-campaign `campaignId: null` with no sync, already-running
   no-event behavior, invalid-input 400, and auth-denial short-circuiting.
   Pure source-claim, override, immutability, and critical-profile validation
   are covered separately.

These are executable behavior assertions, not report/source-string tests:
the service tests import production functions, the route tests import and
invoke production `POST` handlers, and assertions inspect parsed return
values, request payloads, status codes, call order, tenant IDs, and mutation
recorders.

## Boundary review

The inspected mocks provide the following effective boundaries for the
exercised branches:

- Gemini `generateContent` is replaced by a deterministic class that records
  requests and shifts fixture JSON. Cost telemetry is replaced by an in-memory
  capture with no accounting write.
- OpenAI's package is replaced, and the higher-level `callOpenAI` boundary
  invokes the production callback with a fake completion client. Content Audit
  uses the same fake callback.
- Content Audit's database `select` returns fixture rows; insert/update/delete
  throw if reached. Campaign confirmation's update records its payload and
  resolves without a driver. The Brand Intelligence route uses a read-only
  select mock and mocks the profile repository, queue, and campaign-sync
  service.
- Auth and route service boundaries are deterministic callback doubles.
  Denied-auth branches assert that downstream calls remain at zero.

No real provider request, paid call, queue operation, DB-driver method,
database write, or network request was observed in these runs. The route tests
do invoke fake queue methods to verify arguments and ordering; those doubles
only record calls. The pure-function suite does import production modules with
the real DB module and SDK constructor available; its output included the
normal DB initialization line. No DB method or provider method was invoked
there. The tests do not install a process-wide fail-fast guard for `fetch`,
DNS, HTTP, or HTTPS, so the no-network conclusion is branch/mocking based
rather than an independent syscall-level proof. No secret or real
customer/provider payload appeared in captured output.

## Limitations and stop condition

- The prior aggregate invocation is not erased: it had one content-audit
  failure caused by Node/tsx test-runner cloned-data deserialization/IPC, while
  the prior isolated rerun passed. Current per-suite direct-process execution
  passed; no aggregate multi-file invocation was used to manufacture a green
  result.
- SEO route tests mock their underlying service; campaign route tests mock
  campaign services; the Brand Intelligence route mocks repository, queue,
  campaign lookup, and sync; Content Audit and campaign confirmation mock the
  DB driver. These assertions prove route parsing/auth/status/threading and
  service predicate construction, not a live provider/database integration.
- Campaign SQL checks assert the required compiled tenant/id/deleted predicates
  and exact parameter arrays. They do not claim byte-for-byte equality for
  every other SQL formatting detail.
- The Brand Intelligence route suite does not execute the real research worker
  or its website-fetch/provider path. The unchanged pure suite only tests pure
  validation/merge behavior, and its prior 2/2 result is retained rather than
  rerun in this revision.
- No live provider, paid call, network, database, queue, browser, workflow,
  dependency installation, restart, or production-code change was used. All
  revised boundary tests remain mocked and unpaid.
- Historical feature statuses are unchanged, and this report is not a live
  certification.

Stop for principal approval. Do not upgrade historical statuses or certify
live behavior based on this report.