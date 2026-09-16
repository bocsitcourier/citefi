# Gemini provider retry hardening evidence

## Scope

The Gemini Bottleneck `failed` handler now checks the typed provider-accounting
terminal invariant before inspecting 429 or transient-network messages/codes.
Accounting terminals therefore complete exactly one callback attempt and are
re-thrown unchanged. Ordinary 429 and transient network failures retain the
existing three-retry bound.

The behavioral test uses the production `throttledGeminiRequest` boundary and
typed `ProviderAccountingError` plus `ProviderAttemptAccountingError` values
whose messages contain both `429` and `network`, then verifies ordinary 429 and
`ECONNRESET` failures still execute four total callback attempts. The test
replaces only timer scheduling inside the test so the bounded retry behavior is
deterministic and fast; no provider, database, Redis, queue, or workflow is
contacted.

The Daily Brief structural guard now inspects the actual `geminiRateLimiter.on`
failed handler, the default `runProvider ??` closure's
`throttledGeminiRequest`/`submitGeminiRequest` path, and the production
`runProvider` catch's accounting-preserving first branch.

## RED reproduction

Exact offline command, run before the limiter guard was added:

```sh
NODE_ENV=test node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/provider-accounting-boundary.test.ts
```

Result: exit `1`.

```text
1..10
# tests 10
# pass 8
# fail 2
# cancelled 0
# skipped 0
```

The typed terminal was retried four times instead of once, and the AST guard
reported that the Bottleneck failed handler classified messages before the
accounting check. Full TAP output is retained in
`QA/evidence/provider-retry-hardening.red.tap`.

## GREEN verification

Exact offline command after the production limiter fix:

```sh
NODE_ENV=test node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/provider-accounting-boundary.test.ts
```

Result: exit `0`.

```text
1..10
# tests 10
# pass 10
# fail 0
# cancelled 0
# skipped 0
```

The four Daily Brief dependency-injection tests also pass:

```sh
NODE_ENV=test node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/qa/daily-brief-flow.test.ts
```

Result: exit `0`, with `4` tests passed and `0` failed. Full output is retained
in `QA/evidence/provider-retry-hardening.daily-brief.tap`.

## TypeScript and diff checks

```sh
npx tsc --noEmit --pretty false
```

Result: exit `0`; no diagnostics. The command output is retained in
`QA/evidence/provider-retry-hardening.tsc.txt`.

```sh
git diff --check
```

Result: exit `0`.