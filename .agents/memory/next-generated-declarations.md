---
name: Next generated declarations
description: Generated route declaration corruption can masquerade as application TypeScript errors after startup.
---

Treat malformed framework-generated route declarations as cache output, not
as evidence that the application source has invalid types. Invalid suffixes
have appeared in multiple generated declaration files together after restarting
this development environment.

**Why:** A source check passed before startup and failed on generated declarations
afterward; regenerating only the first reported file left another malformed
generated validator. Disabling TypeScript checks would hide real source errors.

**How to apply:** Regenerate the whole generated declaration set when diagnosing
this specific failure, keep strict source checks, and avoid committing unrelated
generated type-import changes. Do not manually patch generated declarations.
