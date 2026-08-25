#!/bin/bash
set -e

npm install

# Push declarative schema changes first. Security policies, grants, triggers,
# and compatibility backfills are then installed by the idempotent task
# migrations below because db:push cannot represent those controls.
npm run db:push -- --force

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
