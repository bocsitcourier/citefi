---
name: Auth token storage
description: JWT lives in sessionStorage, sent as Authorization Bearer header on every request
---

The JWT auth token is saved to `sessionStorage` (key: `auth_token`) after login — NOT localStorage.

**Why:** HttpOnly cookies are silently blocked in cross-site iframes (Replit preview pane = SameSite=None blocked). sessionStorage survives full-page reloads within the same tab, so `window.location.href` navigation keeps the session alive without relying on cookies.

**How to apply:**
- Any component that manually fetches an API must read: `sessionStorage.getItem("auth_token")`
- The default queryFn in `lib/queryClient.ts` and `apiRequest()` already inject the Bearer header automatically — prefer using those over raw fetch.
- `lib/auth-context.tsx` `clearToken()` wipes both sessionStorage and localStorage (legacy cleanup).
- When adding new polling/fetch components, use the queryClient default queryFn or apiRequest — never roll your own token read from localStorage.
