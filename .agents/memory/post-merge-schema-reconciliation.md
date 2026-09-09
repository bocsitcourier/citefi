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

Security controls that Drizzle can represent, such as enabling RLS, must also be
declared in the source schema. Database-only policies, grants, triggers, forced
RLS, and validation checks remain in idempotent post-push migrations.

**Why:** A declarative push can otherwise disable a control installed by a
previously applied migration, while the checksum runner skips that migration as
already recorded.

**How to apply:** Run schema push first, then reassert and verify database-only
controls. Keep catalog verification in the same reconciliation path.