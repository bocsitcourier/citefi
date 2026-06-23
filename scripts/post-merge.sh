#!/bin/bash
set -e

npm install

# Push schema changes to the database.
# All column/table additions are tracked in shared/schema.ts and applied here.
# Individual migration scripts (migrate-t*.ts) are intentionally NOT called here —
# the columns they add are already declared in schema.ts so db:push is the
# single source of truth. Running separate scripts risks Neon cold-start failures.
npm run db:push -- --force
