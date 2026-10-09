---
name: Owned production-build IPC
description: Certify offline builds without permitting arbitrary localhost access.
---
Allow dynamic build IPC only for a nonce-marked scratch build's verified generated evaluator, matching working directory and explicit argv port, before loading the unchanged offline network guard.

**Why:** Turbopack's error stack named an imported implementation chunk, not the Node entry point. Inferring process identity from that stack repeatedly rejected legitimate IPC. Safe runtime argv diagnostics identified the actual evaluator; a narrowly scoped capability then allowed the real production build to finish.

**How to apply:** Capture actual runtime contracts rather than guessing from stack frames. Maintain negative ownership, malformed-entry, unrelated-port and external-host tests. Treat future launcher changes as fail-closed fixture incompatibilities; never allow arbitrary localhost or disable the base guard to get a build PASS.

An owned Turbopack root must contain its real dependencies. Preserve existing staging dependency links when determining ordinary build roots, but keep QA dependencies inside the owned tree.

**Why:** Turbopack rejects node_modules symlinks pointing outside its filesystem root. An inferred ancestor root can instead move evaluator identity outside the nonce-owned scope. Blindly pinning cwd also breaks staging trees that intentionally retain earlier dependencies.

**How to apply:** Use contained dependency copies or validated hardlinks in owned builds without modifying originals. For staging, include the canonical dependency target in the build root; never delete retained source trees to remove a dependency link.
