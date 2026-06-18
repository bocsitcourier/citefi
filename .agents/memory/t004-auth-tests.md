---
name: T004 auth test patterns
description: How to run auth integration tests; pitfalls found writing them.
---

## Running auth tests

```
node --env-file=.env.local --import tsx/esm --test tests/auth/auth-api.test.ts
```

- `--env-file=.env.local` — loads env vars BEFORE any module is evaluated (Node 20+), needed because `lib/auth.ts` throws at module load if JWT_SECRET is absent.
- `--import tsx/esm` — TypeScript ESM pre-loader; honours tsconfig paths (`@/`).

## Key findings

**JWT tokenHash uniqueness** — two logins issued within the same second produce identical JWTs (same payload + iat resolution is 1s) → same SHA-256 tokenHash → unique-constraint violation on the sessions table → 500. Fix: add `jti: crypto.randomBytes(16).toString("hex")` inside `generateAccessToken` and `generateRefreshToken` so every token is unique regardless of timing.

**Concurrent same-user tests** — node:test runs tests inside a `describe` block concurrently by default. Use `{ concurrency: 1 }` on describe blocks that log the same user multiple times to avoid the tokenHash collision above (even after the jti fix, keep sequential for determinism).

**Rate-limit IP bleed** — if the rate-limit test and regular login tests use the same XFF IP range the rate-limit exhaust bleeds into normal tests (admin login → 429 → undefined cookie → assert fail). Solution: rate-limit probes use TEST-NET-1 (192.0.2.x); normal test traffic uses TEST-NET-2 (198.51.100.x).

**Suspended accounts → 403 not 401** — the login route deliberately returns 403 for non-active accounts (credentials valid, account forbidden); assertions must expect 403.

**`/api/auth/me` response shape** — user data is nested under `body.user`, not flat. Assert `body.user?.email`.

**`loginAndGetCookie` return format** — already returns `"auth_token=value"` (name=value pair). Don't prefix `COOKIE_NAME=` again; that creates `auth_token=auth_token=value` which is rejected.

**Set-Cookie parsing** — `res.headers.get("set-cookie")` comma-joins all cookies. Splitting on `,` breaks when Expires= contains a weekday date. Instead: find the `name=` position, then scan forward to the next `;`.

**`waitForServer()` required for cold-start** — auth-tests and the app workflow start simultaneously in Replit validation runs. Without a polling loop on `/api/health` (500ms interval, 60s timeout) inside `before()`, all 17 tests fail with ECONNREFUSED.
