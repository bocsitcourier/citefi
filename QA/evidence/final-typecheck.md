# Final typecheck evidence

This follow-up addressed the seven newly reported TypeScript errors in the
four affected QA test files only. No production implementation files were
changed for this type-fix pass.

## Typecheck

Command:

```text
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

Result after the edits: exit `0`, no diagnostics.

Corrections:

- `tests/auth/password-reset-token-route.test.ts` now uses a real
  `NextRequest` fixture, matching the route handler contract.
- Both provider-accounting AST walkers annotate `parent` as
  `ts.Node | undefined`.
- `tests/security/url-validation-independent.test.ts` uses the existing
  extensionless loader-resolved import.
- Its hanging DNS fixture is typed as the exact `lookup` all-address seam;
  the documented `unknown` cast is limited to replacing that specific
  overload on Node's overloaded dependency method. No `ts-ignore`,
  tsconfig relaxation, or broad untyped seam was added.

## Affected offline test checks

All commands used `QA/support/offline-guard.mjs`; no provider network,
external socket, workflow restart, or real database operation was used.

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test tests/auth/password-reset-token-route.test.ts
```

Result: `3` passed, `0` failed.

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/security/url-validation-independent.test.ts
```

Result: `13` passed, `0` failed.

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/provider-accounting-regressions.test.ts
```

Result: `4` passed, `0` failed.

The combined provider-accounting check also executed
`tests/provider-accounting-boundary.test.ts` and reported `12` passes and one
runtime source-contract assertion at
`lib/brief/generate-daily-brief.ts:203`:
`throttledGeminiRequest outer boundary can retry or fall back without
preserving ProviderAccountingError`. That current-source behavior is from
concurrent provider-accounting work, not from either AST type annotation.
This subtask made no production change to alter it.

The typecheck is green. Independent review remains responsible for deciding
how to handle that concurrent runtime assertion.