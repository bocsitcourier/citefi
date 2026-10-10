---
name: Redis exposure recurrence
description: Runtime loopback binding and persistent managed port configuration require independent verification.
---
A private Redis startup command does not prove that an existing daemon is private, and loopback binding does not prove that an explicit proxy mapping is absent.

**Why:** An older daemon remained wildcard-bound. Both removing the Redis mapping and declaring it internal-only were reversed after workflow restart by automatic port forwarding. An intermediate passing release gate was not durable.

Managed forwarding also reappeared after a validated replacement while the
development service was running, leaving `.replit` dirty during source sync.
Never commit a newly exposed Redis mapping merely to satisfy a clean-tree check.

**Why:** Repeated source submissions were refused because platform metadata
changed independently of the reviewed application source.

**How to apply:** Prepare GitHub source submission from an isolated checkout of
the exact reviewed commit when managed metadata keeps changing. This preserves
release source integrity; it does not secure the running development Redis or
prove production readiness. Continue treating actual forwarding separately.

**How to apply:** Check actual bind/protected-mode and external forwarding after restart. An internal-only declaration must have no external port and explicit localhost exposure false; reject ambiguous/duplicate entries. Use Replit's schema-validated configuration replacement rather than unsupported direct file edits before declaring a user preference change mandatory. This route passed a restart verification, but one successful restart does not prove permanent immunity to automatic forwarding. If exposure keeps returning, User Settings → Automatic port forwarding → Never remains a documented option, not the only possible remedy. Secure the opted-in local service without clearing its queue and keep deployment blocked until the actual forwarding is private.
