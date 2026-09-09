---
name: Canonical asset identity
description: Why generated-media reads reconcile legacy sources without immediately replacing them.
---

Treat a generated asset as a team-scoped durable object key, not as the primary key of whichever legacy table happens to reference it. Keep the authoritative source type separately so mutations can reach the correct handler.

**Why:** Images, videos, and podcasts can be referenced simultaneously by article fields, article assets, social fields, variants, and social assets. A destructive one-step schema migration would risk losing source links and generation metadata. Team scoping also prevents a shared-looking object path from merging ownership across tenants.

**How to apply:** New library and action work should preserve the stable canonical identity while reconciling all same-team references. Migrate generation writers to a future registry incrementally; do not remove legacy reads until parity is verified.