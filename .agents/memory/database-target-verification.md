---
name: Database target verification
description: Confirm the active database and its authorized scope before migration writes.
---

Do not infer a database's role or environment from a variable name, including
one named after a provider. Verify runtime connection selection and the expected
fixture or environment marker before any migration.

**Why:** This workspace has separate configured database connections; an
additive migration was applied to a connection that did not contain the active
QA workspace. Availability of a connection did not establish its intended scope.

**How to apply:** Trace the application's effective connection precedence, then
verify the authorized target read-only. Never bypass baseline checks merely to
make a migration succeed on a different database.