# Daily-brief safe-flow integration evidence

## Scope

`tests/qa/daily-brief-flow.test.ts` exercises the exported production
`generateDailyBrief` service with its injected persistence and provider seams.
The injected provider is still the production `submitGeminiRequest` /
`submitGeminiWithReceipt` adapter, `runWithProviderAttempt` receipt state
machine, usage capture, and reconciliation path. Only the provider SDK call,
operational telemetry, and persistence are replaced with deterministic
in-memory fixtures.

The fixture proves:

- a valid provider response is validated, settled to `accounted`, and then
  retrieved from the generated-row short circuit without another provider call;
- a post-provider immutable-ledger failure is terminal and a forced redelivery
  cannot physically resubmit the provider request;
- cancellation during pre-provider admission leaves zero receipt, provider
  call, usage attempt, and ledger event;
- malformed provider output is rejected, while the already-paid response stays
  accounted and no malformed sections are persisted.

The fixture is explicitly non-durable: `MemoryProviderAttemptReceiptStore`,
`MemoryProviderAttemptReceiptSpool`, and the brief-row map do not represent the
production database, object spool, process restart, or queue redelivery
runtime.

## Exact commands and results

### Targeted offline flow

```sh
node --import tsx/esm --test tests/qa/daily-brief-flow.test.ts
```

Result (exit `0`):

```text
1..4
# tests 4
# pass 4
# fail 0
# cancelled 0
# skipped 0
```

The test also installs an offline `fetch` guard and uses
`postgres://offline:offline@127.0.0.1:1/offline` only to satisfy module
initialization. No database method, provider URL, email, Redis, browser, or
application database is used.

### Diff whitespace check

```sh
git diff --check
```

Result: exit `0`.

### Repository typecheck (diagnostic context)

```sh
npx tsc --noEmit --pretty false
```

Result: exit `2` from pre-existing diagnostics in unrelated files:

- `tests/auth/password-reset-token-route.test.ts` (`Request` vs `NextRequest`);
- `tests/provider-accounting-boundary.test.ts` and
  `tests/provider-accounting-regressions.test.ts` (`parent` implicit `any`);
- `tests/security/url-validation-independent.test.ts` (`.ts` import extension
  and `dns.lookup` fixture typing).

There were no diagnostics for
`lib/brief/generate-daily-brief.ts` or
`tests/qa/daily-brief-flow.test.ts` after the fixture cast was corrected.

## Explicit limits

This is not a claim of full worker/queue/database certification. The daily
brief worker calls `generateDailyBrief` in `lib/worker.ts` and was source
inspected, but was not started because that would require Redis/queue runtime
and could contact application infrastructure. The route enqueue path,
durable database restart behavior, email delivery, and process/browser
boundaries remain outside this offline evidence. Existing 100-redelivery
receipt fanout coverage was not duplicated.

## Follow-up TypeScript resolution

After the retry-hardening boundary and AST guard changes, the previously
recorded diagnostic context was rechecked with:

```sh
npx tsc --noEmit --pretty false
```

The follow-up completed with exit `0` and no diagnostics. This resolves the
TypeScript note for the current safe-flow fixture and provider-boundary
changes; the earlier diagnostic context above is retained as historical
evidence.