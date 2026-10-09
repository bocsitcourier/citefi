---
name: Auth database context scoping
description: Authentication bootstrap and request database authority must use bounded AsyncLocalStorage callbacks.
---

Authentication and authorization database authority must be established with callback-scoped `runWith*Context` helpers. Do not use `enterWith` before an awaited identity or session lookup.

**Why:** An ambient system context established before asynchronous authorization can remain available to later request work, giving an authenticated route platform-wide database authority by inheritance.

**How to apply:** Keep session lookup in a bounded system callback. Run tenant route database work in a bounded authenticated-team callback and admin route database work in a bounded, explicitly audited admin callback. Test restoration to the caller context after awaits and retain PostgreSQL RLS as an independent backstop.