#!/bin/bash
set -euo pipefail

npm install

# Push declarative schema changes first. Security policies, grants, triggers,
# and compatibility backfills are then installed by the idempotent task
# migrations below because db:push cannot represent those controls.
schema_push_log="$(mktemp)"
trap 'rm -f "$schema_push_log"' EXIT
npm run db:push -- --force 2>&1 | tee "$schema_push_log"
if grep -Fq "Interactive prompts require a TTY terminal" "$schema_push_log"; then
  echo "db:push required an interactive schema decision; refusing a false-success setup" >&2
  exit 1
fi

# Apply the tenant Row-Level-Security migration (Task #150) AFTER the schema is
# in place, so every table the policies target already exists. The migration is
# idempotent (IF EXISTS / CREATE OR REPLACE guards), so re-running on every merge
# is safe.
node --env-file=.env.local --import tsx/esm scripts/apply-tenant-rls.ts

# Apply the campaigns aggregate migration (Task #151) AFTER tenant RLS, so the
# citefi_rls helper schema + citefi_tenant role already exist and the campaigns /
# campaign_exports RLS policies can be created. This migration adds the two new
# tables, the campaign_id columns + same-team composite FKs on the content roots,
# their RLS/grants, and the idempotent campaign backfill. Fully idempotent
# (IF EXISTS / IF NOT EXISTS / DO-guards), so re-running on every merge is safe.
node --env-file=.env.local --import tsx/esm scripts/migrate-t151-campaigns.ts

# Apply the agency client report migration AFTER tenant RLS. Besides creating
# the report tables idempotently, this installs the client/financial separation,
# direct-child RLS, immutable snapshot triggers, and append-only delivery audit.
node --env-file=.env.local --import tsx/esm scripts/migrate-t154-agency-reports.ts

# Apply the tracked post-schema migrations. Starting at 0020 includes the
# incident-intelligence objects that db:push cannot fully represent, while
# retaining the checksum ledger and advisory lock used by immutable releases.
# These migrations tolerate objects already created by db:push and keep
# backfills conflict-safe, so merged/fresh development environments converge.
MIGRATION_START_VERSION=0020 \
  node --env-file=.env.local --import tsx/esm scripts/run-versioned-migrations.ts
