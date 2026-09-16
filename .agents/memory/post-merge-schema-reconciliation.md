---
name: Post-merge schema reconciliation
description: Durable rules for safe, non-interactive Drizzle and versioned-migration reconciliation.
---

Applied versioned migration files are immutable. Put every later schema delta in
a new migration, even when the change appears to be a small extension of an
existing table.

**Why:** The migration ledger verifies source checksums. Editing an applied file
blocks every later reconciliation and makes environments disagree about what a
recorded version actually did.

**How to apply:** Compare the rejected file with the ledger’s recorded digest,
restore the exact applied source, and append a new idempotent migration.

Drizzle push can print a non-TTY prompt error and still exit with status zero.
Post-merge automation must inspect its output and reject that false success.
Database-only bookkeeping tables must be excluded from rename inference.

**Why:** Otherwise a merge can report success even though declarative schema
changes were skipped. Automatically answering a truncation prompt risks data
loss.

**How to apply:** Capture push output under `pipefail`, fail on the interactive
prompt marker, and resolve drift with data-preserving migrations that rename or
attach existing unique constraints instead of truncating rows.

Security controls that Drizzle can represent, such as enabling RLS and check
constraints, must also be declared in the source schema. Database-only policies,
grants, triggers, and forced RLS remain in idempotent post-push migrations.

**Why:** A declarative push can otherwise disable a control installed by a
previously applied migration, while the checksum runner skips that migration as
already recorded.

**How to apply:** Run schema push first, then reassert and verify database-only
controls. Keep catalog verification in the same reconciliation path. Verify
both ENABLE and FORCE for every intended policy table: PostgreSQL can retain
policies and FORCE while ENABLE is false, and those policies then provide no
row filtering. Include a real cross-tenant query with an ordinary isolated actor;
catalog or scanner success alone is not authorization evidence.

`CREATE TABLE IF NOT EXISTS` does not install missing constraints on an
already-existing table.

**Why:** A source-built QA database followed by successful migration execution
still lacked an intended receipt-evidence constraint. This concealed one
recovery failure while exposing a different inconsistent terminal state.

**How to apply:** Test both declarative-first and migration-first schema paths.
Verify critical constraints in the catalog and with rejected writes; use a new
additive migration to repair existing tables rather than editing old migrations.

Represent SQL UNIQUE constraints as ORM unique constraints, not same-named
standalone unique indexes; preserve predicates on partial indexes.

**Why:** A push can remove the constraint while skipping creation of its
same-named replacement index. The migration ledger can still look healthy
while every reservation INSERT fails its ON CONFLICT arbitration.

**How to apply:** Verify critical billing arbitration with EXPLAIN (never
EXPLAIN ANALYZE) of the real INSERT target, not just table/index-name checks.
Restore missing uniqueness additively and fail on duplicates rather than
deleting financial history.

An authentication-only fixture does not prove that tenant generation writes
have the correct grants. Disposable pipeline databases need the canonical
security bootstrap, not just exported table definitions.

**Why:** Authentication can pass through privileged system queries while the
first authenticated batch submission fails under the ordinary tenant role.
This repeatedly concealed missing fixture grants during full-chain testing.

**How to apply:** Verify tenant DML grants and forced RLS before starting workers.
Keep export-only SQL corrections inside the disposable fixture; do not alter
applied migrations or bypass tenant roles to make an integration test pass.