#!/bin/bash
set -e

npm install

# Run any custom migration scripts that have been added by task agents
# These are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) so safe to re-run
if [ -f "scripts/migrate-t025-competitive-intel.ts" ]; then
  echo "Running T025 competitive intelligence migration..."
  node --env-file=.env.local --import tsx/esm scripts/migrate-t025-competitive-intel.ts
fi

# Push schema changes to the database.
# Note: drizzle-kit push can prompt interactively when adding constraints
# to tables with data. Schema/DB are kept in sync via custom migrations above
# so this should be a no-op or only apply non-destructive changes.
npm run db:push
