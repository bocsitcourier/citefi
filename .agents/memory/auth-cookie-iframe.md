---
name: Auth cookie iframe + Next.js 16 proxy migration
description: SameSite=Lax blocks HttpOnly cookies inside cross-site iframes; Next.js 16 renames middleware.ts to proxy.ts with a renamed export.
---

## Rule
All `auth_token` cookies must use `sameSite: "none"` (never `"lax"`) because the Replit dev preview pane embeds the app in a cross-site iframe. `sameSite: "lax"` causes the browser to silently drop the cookie on every request inside the iframe, producing an infinite `/login` redirect loop even though login succeeded.

**Why:** `SameSite=Lax` cookies are sent on same-site top-level navigations but NOT on cross-site subframe requests. Replit's preview pane loads `your-app.riker.replit.dev` inside an iframe on `replit.com`, making every request cross-site. The cookie exists in the jar but is never forwarded, so the auth gate always fires.

**How to apply:** In every route that sets `auth_token` (login, verify-2fa, logout), always use:
```ts
response.cookies.set(AUTH_COOKIE_NAME, token, {
  httpOnly: true,
  secure: true,       // mandatory when sameSite is "none"
  sameSite: "none",   // required for iframe/cross-site delivery
  path: "/",
  maxAge: 24 * 60 * 60,
});
```
This also works correctly in production (deployed app) since `secure:true` is already required there.

## Next.js 16 proxy migration
Next.js 16 renames edge middleware:
- File: `middleware.ts` → `proxy.ts`
- Export: `export function middleware()` → `export function proxy()`
- Config export stays the same: `export const config = { matcher: [...] }`
- **Do NOT have both `middleware.ts` and `proxy.ts`** — having both causes unstable/double-execution behavior.

## Page pre-warmer hygiene
Never include auth mutation endpoints (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`) or protected pages that just redirect (`/admin`) in the page pre-warmer list. Warm only read-only public pages.
