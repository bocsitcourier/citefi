#!/bin/bash
set -e

npm install

# Push schema changes to the database.
# All column/table additions are tracked in shared/schema.ts and applied here.
# Individual migration scripts (migrate-t*.ts) are intentionally NOT called here —
# the columns they add are already declared in schema.ts so db:push is the
# single source of truth. Running separate scripts risks Neon cold-start failures.
npm run db:push -- --force

# Apply the tenant Row-Level-Security migration (Task #150) AFTER the schema is
# in place, so every table the policies target already exists. The migration is
# idempotent (IF EXISTS / CREATE OR REPLACE guards), so re-running on every merge
# is safe.
node --env-file=.env.local --import tsx/esm scripts/apply-tenant-rls.ts
