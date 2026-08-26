#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="$ROOT/scripts/host-release.sh"

bash -n "$HOST"
bash -n "$ROOT/scripts/deploy-to-do.sh"
bash -n "$ROOT/scripts/deploy-to-staging.sh"

# Source contract: loading the runner must expose functions without deploying.
export HOST_RELEASE_SOURCE_ONLY=1
source "$HOST"
declare -F write_status validate_deploy_ownership stop_release_processes install_and_build health_check rollback validate_staging_isolation >/dev/null

# Exercise status atomicity and staging fail-closed checks without performing a release.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
DO_RELEASE_STATE_DIR="$tmp/state"
OLD_SHA=old123
NEW_SHA=new456
KNOWN_GOOD_SHA=old123
PHASE=test
export PHASE
write_status testing "contract"
test -s "$DO_RELEASE_STATE_DIR/release-status.json"
test ! -e "$DO_RELEASE_STATE_DIR/release-status.json.tmp.$$"
grep -q '"oldSha": "old123"' "$DO_RELEASE_STATE_DIR/release-status.json"
grep -q '"newSha": "new456"' "$DO_RELEASE_STATE_DIR/release-status.json"

(
  cd "$tmp"
  cat > .env.local <<'ENV'
DATABASE_URL=postgresql://staging@localhost:5432/citefi_staging
REDIS_URL=redis://localhost:6379/9
STORAGE_PREFIX=staging/
ENV
  DEPLOY_ENVIRONMENT=staging
  DO_APP_DIR=/var/www/citefi-staging
  DO_PM2_CONFIG=ecosystem.staging.config.cjs
  DO_WEB_PROCESS=citefi-staging-web
  DO_WORKER_PROCESS=citefi-staging-worker
  DO_HEALTHCHECK_URL='http://127.0.0.1:5100/api/health?full=1'
  STAGING_DATABASE_NAME=citefi_staging
  STAGING_REDIS_DB=9
  STAGING_STORAGE_PREFIX='staging/'
  SYNTHETIC_DATA_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_STAGING_SYNTHETIC_DATA_ONLY
  export DEPLOY_ENVIRONMENT DO_APP_DIR DO_PM2_CONFIG DO_WEB_PROCESS DO_WORKER_PROCESS
  export DO_HEALTHCHECK_URL STAGING_DATABASE_NAME STAGING_REDIS_DB
  export STAGING_STORAGE_PREFIX SYNTHETIC_DATA_ACKNOWLEDGEMENT
  validate_staging_isolation
  DO_APP_DIR=/var/www/citefi
  ! validate_staging_isolation >/dev/null 2>&1
)

assert_has() {
  grep -Eq "$2" "$1" || { echo "missing deployment contract '$2' in $1"; exit 1; }
}
assert_has "$HOST" 'git reset --hard'
if grep -Eq '^[[:space:]]*git[[:space:]]+clean' "$HOST"; then
  echo "unsafe git clean command found"; exit 1
fi
assert_has "$HOST" 'package-firewall\.replit\.local'
assert_has "$HOST" 'pm2 stop all'
assert_has "$HOST" 'fallocate -l 2G'
assert_has "$HOST" '\.next/BUILD_ID'
assert_has "$HOST" 'safe\.directory'
assert_has "$HOST" 'DO_VALIDATION_COMMAND'
assert_has "$HOST" 'node --env-file=\.env\.local node_modules/drizzle-kit/bin\.cjs push --force'
assert_has "$HOST" 'apply-tenant-rls'
assert_has "$HOST" 'migrate-t151-campaigns'
assert_has "$HOST" 'migrate-t152-campaign-ads'
assert_has "$HOST" 'migrate-t153-provider-usage-ledger'
assert_has "$HOST" 'migrate-t154-agency-reports'
assert_has "$HOST" 'mixed ownership'
assert_has "$HOST" 'api/health\?full=1'
assert_has "$HOST" 'database'
assert_has "$HOST" 'redis'
assert_has "$HOST" 'DO_WORKER_PROCESS'
assert_has "$HOST" 'known-good'
assert_has "$HOST" 'no automatic database rollback'

assert_has "$ROOT/.github/workflows/deploy.yml" 'needs: validate'
assert_has "$ROOT/.github/workflows/deploy.yml" 'scripts/deploy-to-do.sh'
assert_has "$ROOT/.github/workflows/deploy.yml" 'workflow_dispatch'
assert_has "$ROOT/.github/workflows/deploy.yml" 'DO_USER: citefi'
if grep -Eq '^[[:space:]]*push:' "$ROOT/.github/workflows/deploy.yml"; then
  echo "DigitalOcean deployment must not run automatically on every push"; exit 1
fi
assert_has "$ROOT/scripts/deploy-to-do.sh" 'host-release.sh'
assert_has "$ROOT/scripts/deploy-to-staging.sh" '/var/www/citefi-staging'
assert_has "$ROOT/scripts/deploy-to-staging.sh" 'ecosystem.staging.config.cjs'
assert_has "$HOST" 'STAGING_DATABASE_NAME'
assert_has "$HOST" 'STAGING_REDIS_DB'
assert_has "$HOST" 'STAGING_STORAGE_PREFIX'
assert_has "$HOST" 'I_ACKNOWLEDGE_STAGING_SYNTHETIC_DATA_ONLY'
assert_has "$HOST" 'pm2 stop "\$DO_WEB_PROCESS" "\$DO_WORKER_PROCESS"'
assert_has "$ROOT/lib/storage.ts" 'STORAGE_PREFIX'
echo "deployment contracts passed"