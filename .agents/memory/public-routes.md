---
name: Public routes config
description: How unauthenticated page access is controlled client-side in the app shell
---

## Rule
`PUBLIC_ROUTES` in `components/navigation/nav-config.ts` is the single source of truth for which pages render without redirecting to login.

**Why:** The `AppShell` component (components/navigation/app-shell.tsx) reads `PUBLIC_ROUTES` and skips the auth redirect for those paths. The Next.js server always returns 200 for these routes — the redirect is client-side JS only. A missing entry means the page renders 200 on the server but immediately redirects to `/login` in the browser.

**How to apply:** Whenever adding a public-facing page (marketing, pricing, invite acceptance, embeds), add its path prefix to `PUBLIC_ROUTES`. The check uses `pathname.startsWith(route)` so `/pricing` covers `/pricing/anything` too.

## Current public routes (as of this session)
- `/login`, `/signup`, `/register`, `/forgot-password`
- `/verify-2fa`, `/accept-invite`
- `/embed`, `/pricing`, `/`
