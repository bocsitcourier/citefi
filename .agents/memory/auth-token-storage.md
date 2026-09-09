---
name: Auth token storage
description: Production uses HttpOnly cookies; development adds a scoped bearer fallback for Replit preview iframe compatibility
---

## Rule
Auth is **cookie-first**. The server sets an `auth_token` HttpOnly cookie on login (sameSite:none, secure, 24h), and every client fetch uses `credentials: "include"`.

Production is cookie-only. In development, login and 2FA responses also return `previewToken`; the client stores it as `auth_preview_token` in sessionStorage and `csrfFetch()` sends it as a bearer token. This is required when a browser blocks the HttpOnly cookie in Replit's cross-site preview iframe.

## 2FA challenge token (intentional exception)
`auth_2fa_challenge` is stored in sessionStorage temporarily during the login → 2FA flow only. It is a short-lived (5 min) binding token, not a secret auth token. It is cleared immediately after `verify-2fa` completes.

## Server-side fallback
`lib/api/auth.ts` accepts `Authorization: Bearer` for tests, API clients, and the development preview fallback.

## queryClient.ts defaults
The default TanStack Query `queryFn` uses `credentials: "include"`. `csrfFetch()` also attaches the development preview token when one exists.

**Why:** HttpOnly cookies reduce XSS token exposure and remain mandatory in production. Replit preview is embedded cross-site, so browsers may reject even `SameSite=None` cookies; without a development-only fallback, login succeeds server-side but the preview immediately appears signed out.

**How to apply:** Route authenticated client requests through `csrfFetch()`/`apiRequest()` and keep `credentials: "include"`. Never return a bearer token in production, never use the old `auth_token` sessionStorage key, and clear `auth_preview_token` on logout.
