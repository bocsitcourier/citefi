---
name: Large SDK compiler graphs
description: Preserve strict typing while avoiding unrelated SDK declarations and misleading incremental-cache hangs.
---
Prefer the installed SDK's scoped API factory when a root registry exposes hundreds of unrelated APIs. Verify its actual exports and constructor behavior rather than substituting an untyped shim.

**Why:** A Google API root registry pulled unrelated declarations from an API directory roughly 190 MB in size. Narrowing the import alone did not immediately make an older incremental cache cheap; a fresh-cache comparison isolated that effect.

**How to apply:** For apparent compiler hangs after changing a large SDK dependency edge, compare a fresh build-info path with the existing cache and inspect compiler traces before weakening types, replacing libraries or reporting application errors.
