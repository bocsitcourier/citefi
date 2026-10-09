---
name: Mixed TypeScript module loaders
description: Choosing tsx preloads when root ESM code imports a CommonJS TypeScript package.
---

Use the full `--import tsx` preload for a process that crosses ESM and CommonJS
TypeScript package boundaries. The ESM-only preload is insufficient for that
mixed graph.

**Why:** An ESM test importing the CommonJS receiver TypeScript package failed
with `ERR_REQUIRE_CYCLE_MODULE` despite no genuine runtime import cycle. The
full loader supplied the missing CommonJS hook and the same checks passed.

**How to apply:** Preserve the ESM-only loader for established ESM-only suites;
use the full loader for receiver wrappers and receiver integration tests. Do
not rewrite package module types or remove imports to fix a loader mismatch.
