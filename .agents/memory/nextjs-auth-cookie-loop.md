---
name: Next.js App Router auth cookie redirect loop
description: Why router.replace() after login causes an infinite /admin → /login loop and how to fix it.
---

## The Rule
After a successful login in Next.js App Router, navigate with `window.location.href = dest` (full-page reload), NOT `router.replace(dest)` (soft navigation).

**Why:** Next.js App Router's client-side router cache stores middleware redirect responses. If the user visited `/admin` before logging in, the middleware cached a redirect to `/login`. After login, `router.replace()` reuses the cached redirect — the middleware never re-runs with the fresh cookie. `window.location.href` forces a full HTTP request, clears the cache, and guarantees the browser sends the new `Set-Cookie` on the next navigation.

**How to apply:** In any login page / post-auth redirect, replace:
```js
router.replace("/admin"); // BAD — uses stale router cache
```
with:
```js
window.location.href = "/admin"; // GOOD — fresh HTTP request, cookie sent
```

## Companion fix
Cookies must be `secure: true` unconditionally in Replit because Replit always serves HTTPS even in NODE_ENV=development. `secure: process.env.NODE_ENV === "production"` evaluates to `false` in dev and browsers may silently drop the cookie.

## Also: useSearchParams + Suspense
`useSearchParams()` in Next.js 16 requires the component to be wrapped in `<Suspense>`. Extract the form into a child component and export a default wrapper:
```tsx
function LoginForm() { /* uses useSearchParams */ }
export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
```
