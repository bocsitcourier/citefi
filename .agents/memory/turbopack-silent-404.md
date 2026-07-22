---
name: Turbopack silent 404 from module-scope throw
description: Turbopack silently caches 404 when any module in a route's import chain throws at load time; symptoms and fix.
---

## The Rule
Never throw at module scope in any file that is part of a Next.js route's import chain. Use lazy getters/functions instead.

**Why:** Turbopack (Next.js dev mode) compiles routes on first request. If any module in the import graph throws during evaluation, Turbopack silently caches a 404 for that route. Every subsequent request also returns 404. No error appears in the server log — the route looks completely missing.

**How to apply:**
- Any `if (!ENV_VAR) throw new Error(...)` at module scope must become a lazy function called at request time.
- Pattern: replace `const SECRET = process.env.FOO; if (!SECRET) throw ...` with `function getSecret() { const s = process.env.FOO; if (!s) throw ...; return s; }`.
- After fixing a module-scope throw, also **delete `.next/`** — Turbopack caches the 404 state and won't recover until the cache is cleared and the server restarted.
- Add all affected routes to `PAGES_TO_WARM` in `server/index.ts` so compilation failures surface immediately in startup logs rather than silently at the user's first login attempt. GET requests to POST-only routes return 405 but still trigger compilation.

**Affected file in this project:** `lib/auth.ts` — had `if (!JWT_SECRET) throw` at module scope. Fixed to `getJwtSecret()` called lazily inside `generateAccessToken`, `generateRefreshToken`, `verifyToken`.

**Recovery checklist when auth routes return 404:**
1. Check if any transitive import throws at module scope.
2. Fix the throw to be lazy.
3. `rm -rf .next` then restart the server.
4. Verify pre-warmer shows 4xx (not 404) for each auth route on startup.
