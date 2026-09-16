# Scope 0 worker report — unpaid regression locks

This worker added only tests, a test-only alias resolver, and this report. No
production code, schema, database row, queue, workflow, provider call, network
request, or package was added or changed. All provider, auth, repository, queue,
and database boundaries below are deterministic in-process doubles. These are
unpaid regression locks; they do **not** approve Scope 0 or make a
production-readiness claim.

## Inventory rows covered

The seven rows are the PASS rows named in
`reports/live-generation/masterinventory.json`: SEO content audit, SEO local
research, SEO schema markup, SEO content structure, SEO pillar and cluster
planning, campaign brand confirmation and intelligence context, and standalone
Brand Intelligence.

| Inventory feature | Executable coverage | Result and boundary |
| --- | --- | --- |
| SEO content audit | `tests/scope-0-content-audit.test.ts` imports the real `auditArticle`. Mocked read queries provide one same-team article and one target; a fake `callOpenAI` invokes the callback with a fake client and captures both request bodies and telemetry. The assertions require all six criteria, one internal-link opportunity, compiled same-team internal-link SQL, same-team/missing pre-provider rejection, exact authenticated route output, and zero insert/update/delete calls. The actual route is also exercised for missing `articleId` (400) and denied auth (401). | No real DB or network operation occurred. The service's first telemetry object intentionally has operation/model only; the second additionally carries team/article attribution as implemented. |
| SEO local research | `tests/scope-0-pass-features.test.ts` calls real `researchLocalSEO` with a fake Gemini SDK and fake accounting hook. It captures the request, JSON response format, prompt location/business, and telemetry. `tests/scope-0-seo-routes.test.ts` deep-compares the entire canonical service input and runs the actual route for success, missing required input (400), and denied auth with zero service calls in the latter two branches. | No Gemini request or accounting write occurred. |
| SEO schema markup | The pass-feature suite calls real deterministic `validateSchemaMarkupData`/`generateSchemaMarkup` for Article, FAQPage, HowTo, and LocalBusiness, including unusable-FAQ rejection. The route suite runs the actual handler for authenticated success, required-input 400, unsupported type 400 before validation/generation, `SchemaMarkupValidationError` 400 before generation, and auth denial with zero downstream service calls. | **Pure and route locks passed.** No provider, database, or network operation occurred. |
| SEO content structure | The pass-feature suite calls real `optimizeContentStructure` through a fake Gemini/accounting boundary and checks parsed headings, FAQ, takeaways, and audience. The actual route receives authenticated success, required-input 400, and denied-auth cases. | **Service and route locks passed.** No Gemini request or accounting write occurred. |
| SEO pillar and cluster planning | The real `generatePillarClusterStrategy` is exercised with a fake `callOpenAI` that invokes the callback with a fake client. Tests capture model/input/JSON format, assert semantic pillar/cluster/calendar output, and reject malformed and empty JSON. The actual route also covers success, required-input 400, and denied auth with zero service calls. | No OpenAI request or accounting write occurred. |
| Campaign brand confirmation and intelligence context | `tests/scope-0-campaign-confirm-route.test.ts` runs the actual handler with auth/service mocks and asserts team/public-ID threading, confirm-before-detail ordering, flattened frozen response, 409 incomplete, 404 absent, auth denial, and invalid UUID rejection. `tests/scope-0-campaign-confirm-service.test.ts` calls real `confirmBrandSnapshot` against read/update-recording DB doubles, checking immutable snapshot, confirmed/updated timestamps, and no update for incomplete or cross-tenant fixtures. It compiles and asserts the campaign ID/team ID/not-deleted predicates on both campaign read and update, plus the profile team predicate. | The fake update records payloads but does not execute a write. URL/status pure helpers remain covered by `tests/scope-0-pure-pass-features.test.ts`. |
| Standalone Brand Intelligence | `tests/scope-0-brand-intelligence-route.test.ts` runs the actual route with repository, campaign lookup, queue, campaign-sync, and auth doubles. It asserts exact team/URL/company/campaign arguments, one ordered upsert→enqueue→sync event stream, an unowned campaign becoming `campaignId: null` with no sync, already-running no-event behavior, invalid-input 400, and denied-auth zero downstream calls. The pure suite retains source-grounded claims, manual overrides, immutability, and critical-profile rejection assertions. | No repository write, queue enqueue, provider, or network operation occurred. |

## Simulated boundaries

- **Gemini:** a fake `GoogleGenAI.models.generateContent` captures the real
  request object; the fixture response is deterministic JSON. The mocked
  `logCostTelemetry` captures operation/provider/team attribution and performs
  no accounting write.
- **OpenAI:** fake `callOpenAI` invokes each real operation callback with a
  fake client whose `chat.completions.create` captures model, messages, and
  response format. Content Audit also captures its real telemetry objects.
  Malformed and empty pillar responses are returned by the fake client and
  rejected by the real parser.
- **Database:** mocked `select` chains return fixture rows; campaign
  confirmation's mocked `update(...).set(...).where(...)` records the payload
  and never reaches a driver. Content Audit records insert/update/delete calls
  and asserts all remain zero.
- **Auth and route services:** mocked authenticated callbacks provide fixed
  fixture team/user claims or return a 401 response without invoking callbacks.
  SEO route service doubles, campaign route service doubles, Brand Intelligence
  repository/queue/campaign-sync doubles, and campaign ownership lookup doubles
  record calls and return only fixture values.

## Per-suite results

Counts below are test-file counts, not per-feature claims. Every listed suite
completed with zero failures:

| Test suite | Tests | Passed | Failed |
| --- | ---: | ---: | ---: |
| `scope-0-pass-features.test.ts` | 5 | 5 | 0 |
| `scope-0-pure-pass-features.test.ts` | 2 | 2 | 0 |
| `scope-0-seo-routes.test.ts` | 14 | 14 | 0 |
| `scope-0-content-audit.test.ts` | 5 | 5 | 0 |
| `scope-0-campaign-confirm-route.test.ts` | 5 | 5 | 0 |
| `scope-0-campaign-confirm-service.test.ts` | 3 | 3 | 0 |
| `scope-0-brand-intelligence-route.test.ts` | 5 | 5 | 0 |
| **Total** | **39** | **39** | **0** |

## Test commands and sanitized results

Commands were run with the repository's installed Node/tsx runner. Route tests
also use the test-only `tests/scope-0-alias-loader.mjs` so Node's experimental
module mocks resolve the repository's existing `@/` imports without changing
source files. The warnings below are normal Node experimental-feature warnings.

```text
node --env-file=.env.local --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-pass-features.test.ts
ExperimentalWarning: Module mocking is an experimental feature ...
tests 5
pass 5
fail 0
```

```text
node --env-file=.env.local --import tsx/esm --test --test-concurrency=1 tests/scope-0-pure-pass-features.test.ts
tests 2
pass 2
fail 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-seo-routes.test.ts
tests 14
pass 14
fail 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-content-audit.test.ts
tests 5
pass 5
fail 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-campaign-confirm-route.test.ts
tests 5
pass 5
fail 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-campaign-confirm-service.test.ts
tests 3
pass 3
fail 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-brand-intelligence-route.test.ts
tests 5
pass 5
fail 0
```

The content-audit test emits only fixture-labelled progress lines for article
41. The pure suite emits the normal database-client initialization line while
importing production modules. No test invokes a real DB method, provider SDK,
queue, or network. No URL beyond fixture data, token, provider response,
customer data, or secret appeared in the captured output.

```text
npx tsc --noEmit --pretty false
exit 0
no output
```

## Changed files

- `tests/scope-0-pass-features.test.ts`
- `tests/scope-0-pure-pass-features.test.ts`
- `tests/scope-0-alias-loader.mjs`
- `tests/scope-0-seo-routes.test.ts`
- `tests/scope-0-content-audit.test.ts`
- `tests/scope-0-campaign-confirm-route.test.ts`
- `tests/scope-0-campaign-confirm-service.test.ts`
- `tests/scope-0-brand-intelligence-route.test.ts`
- `reports/qa-remediation/scope-0-worker.md`

The pre-existing untracked files
`attached_assets/citefi_qa_remediation_plan_1789565275462.docx` and
`reports/qa-remediation/architect-line-review.md` were preserved and not
modified. Active task179 provider-receipts files were not inspected or changed.
