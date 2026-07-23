---
name: Auth token storage
description: Auth is cookie-only after P0 hardening — no sessionStorage, no Bearer headers from client
---

## Rule
Auth is **cookie-only**. The server sets an `auth_token` HttpOnly cookie on login (sameSite:none, secure, 24h). Every client fetch must use `credentials: "include"` — no Bearer headers, no sessionStorage reads.

**The `token` field is no longer returned in login/verify-2fa JSON responses.**

## 2FA challenge token (intentional exception)
`auth_2fa_challenge` is stored in sessionStorage temporarily during the login → 2FA flow only. It is a short-lived (5 min) binding token, not a secret auth token. It is cleared immediately after `verify-2fa` completes.

## Server-side fallback
`lib/api/auth.ts` still accepts `Authorization: Bearer` as a secondary fallback for backward compatibility (tests that send tokens directly). The client never sends it.

## queryClient.ts defaults
The default TanStack Query `queryFn` in `lib/queryClient.ts` uses `credentials: "include"` and no Authorization header. `apiRequest()` likewise.

**Why:** sessionStorage tokens were visible to JS and could be exfiltrated by XSS. HttpOnly cookies are not accessible from JS. The old rationale ("SameSite=None blocked in iframes") no longer applies since the app serves frontend and backend on the same port.

**How to apply:** Any new fetch or mutation in a client component must use `credentials: "include"` only. Never read `sessionStorage.getItem("auth_token")`. Never construct Authorization: Bearer headers from client code.
