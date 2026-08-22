---
name: Node test-runner IPC
description: Environment-specific guidance for TypeScript integration suites that intermittently fail in Node 20 test isolation.
---

Node 20's built-in test isolation can intermittently fail before assertions finish with a V8 deserialization error when a TypeScript suite loaded through tsx uses real service clients.

**Why:** The failure occurs in the parent/child test-runner IPC serializer, can stop at different passing-test counts, and is not fixed by test concurrency or force-exit flags available in this runtime.

**How to apply:** When the same suite's assertions are stable but isolated execution fails nondeterministically, run the checks sequentially in a direct Node+tsx process. Ensure the harness reports each check, closes clients in `finally`, and sets a nonzero exit code on any failure.