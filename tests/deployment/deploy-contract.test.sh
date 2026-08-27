#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="$ROOT/scripts/host-release.sh"
TRANSPORT="$ROOT/scripts/deploy-to-do.sh"

bash -n "$HOST"
bash -n "$TRANSPORT"
bash -n "$ROOT/scripts/deploy-to-staging.sh"

assert_has() {
  grep -Eq "$2" "$1" || { echo "missing deployment contract '$2' in $1"; exit 1; }
}
assert_lacks() {
  if grep -Eq "$2" "$1"; then
    echo "forbidden deployment contract '$2' found in $1"; exit 1
  fi
}

# Accidental production execution must die at the local confirmation gate,
# before secrets, key material, keyscan, or SSH are touched.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if HOME="$tmp/home" env -u DEPLOY_ENVIRONMENT -u DO_SSH_PRIVATE_KEY -u DO_HOST -u PRODUCTION_DEPLOY_CONFIRMATION \
  "$TRANSPORT" >"$tmp/no-confirm.out" 2>&1; then
  echo "production transport ran without typed confirmation"; exit 1
fi
grep -q 'PRODUCTION_DEPLOY_CONFIRMATION' "$tmp/no-confirm.out"
test ! -e "$tmp/home/.ssh"

expired="DEPLOY_CITEFI_PRODUCTION_UNTIL_$(($(date +%s) - 1))"
if env -u DEPLOY_ENVIRONMENT HOME="$tmp/home-expired" PRODUCTION_DEPLOY_CONFIRMATION="$expired" \
  "$TRANSPORT" >"$tmp/expired.out" 2>&1; then
  echo "expired production confirmation was accepted"; exit 1
fi
grep -q 'expire in the next 10 minutes' "$tmp/expired.out"
test ! -e "$tmp/home-expired/.ssh"

valid="DEPLOY_CITEFI_PRODUCTION_UNTIL_$(($(date +%s) + 300))"
if HOME="$tmp/home-valid" PRODUCTION_DEPLOY_CONFIRMATION="$valid" \
  env -u DEPLOY_ENVIRONMENT -u DO_SSH_PRIVATE_KEY -u DO_HOST "$TRANSPORT" >"$tmp/valid.out" 2>&1; then
  echo "transport unexpectedly passed missing-secret preflight"; exit 1
fi
grep -q 'DO_SSH_PRIVATE_KEY secret is missing' "$tmp/valid.out"
test ! -e "$tmp/home-valid/.ssh"

# Source contract: loading the runner exposes controls without deploying.
export HOST_RELEASE_SOURCE_ONLY=1
source "$HOST"
declare -F write_status acquire_release_lock validate_layout validate_deploy_ownership \
  prepare_candidate run_migrations switch_current reload_processes health_check \
  rollback validate_staging_isolation public_listener_check failure_diagnostics \
  process_uses_bootstrap reload_one_process >/dev/null

# Status writes are atomic and identify artifacts, not only mutable SHAs.
DO_RELEASE_STATE_DIR="$tmp/state"
OLD_SHA=old123
NEW_SHA=new456
KNOWN_GOOD_SHA=old123
ACTIVE_RELEASE=/srv/releases/old123
KNOWN_GOOD_RELEASE=/srv/releases/old123
CANDIDATE_RELEASE=/srv/releases/new456
PHASE=test
export PHASE
write_status testing "contract"
test -s "$DO_RELEASE_STATE_DIR/release-status.json"
test ! -e "$DO_RELEASE_STATE_DIR/release-status.json.tmp.$$"
grep -q '"knownGoodRelease": "/srv/releases/old123"' "$DO_RELEASE_STATE_DIR/release-status.json"
grep -q '"candidateRelease": "/srv/releases/new456"' "$DO_RELEASE_STATE_DIR/release-status.json"

# Atomic symlink switching only accepts built artifacts under releases.
DO_APP_DIR="$tmp/app"
DO_RELEASES_DIR="$DO_APP_DIR/releases"
DO_CURRENT_LINK="$DO_APP_DIR/current"
mkdir -p "$DO_RELEASES_DIR/old/.next" "$DO_RELEASES_DIR/new/.next"
printf 'old\n' > "$DO_RELEASES_DIR/old/.next/BUILD_ID"
printf 'new\n' > "$DO_RELEASES_DIR/new/.next/BUILD_ID"
ln -s "$DO_RELEASES_DIR/old" "$DO_CURRENT_LINK"
switch_current "$DO_RELEASES_DIR/new"
test "$(readlink -f "$DO_CURRENT_LINK")" = "$DO_RELEASES_DIR/new"
! switch_current "$tmp/outside" >/dev/null 2>&1

# Exclusive host lock rejects a concurrent runner.
DO_RELEASE_STATE_DIR="$tmp/lock-state"
mkdir -p "$DO_RELEASE_STATE_DIR"
( flock -x 8; touch "$tmp/lock-ready"; sleep 2 ) 8>"$DO_RELEASE_STATE_DIR/release.lock" &
lock_pid=$!
for _ in $(seq 1 20); do test -e "$tmp/lock-ready" && break; sleep 0.05; done
if ( acquire_release_lock ) >/dev/null 2>&1; then
  echo "concurrent host release lock was accepted"; kill "$lock_pid" 2>/dev/null || true; exit 1
fi
wait "$lock_pid"

# Staging remains isolated in names, port, data stores, and release root.
(
  cd "$tmp"
  cat > staging.env <<'ENV'
DATABASE_URL=postgresql://staging@localhost:5432/citefi_staging
REDIS_URL=redis://localhost:6379/9
STORAGE_PREFIX=staging/
ENV
  DEPLOY_ENVIRONMENT=staging
  DO_APP_DIR=/var/www/citefi-staging
  DO_SHARED_ENV_FILE="$tmp/staging.env"
  DO_PM2_CONFIG=ecosystem.staging.config.cjs
  DO_WEB_PROCESS=citefi-staging-web
  DO_WORKER_PROCESS=citefi-staging-worker
  DO_HEALTHCHECK_URL='http://127.0.0.1:5100/api/health?full=1'
  STAGING_DATABASE_NAME=citefi_staging
  STAGING_REDIS_DB=9
  STAGING_PORT=5100
  STAGING_STORAGE_PREFIX='staging/'
  SYNTHETIC_DATA_ACKNOWLEDGEMENT=I_ACKNOWLEDGE_STAGING_SYNTHETIC_DATA_ONLY
  export DEPLOY_ENVIRONMENT DO_APP_DIR DO_SHARED_ENV_FILE DO_PM2_CONFIG
  export DO_WEB_PROCESS DO_WORKER_PROCESS DO_HEALTHCHECK_URL
  export STAGING_DATABASE_NAME STAGING_REDIS_DB STAGING_STORAGE_PREFIX
  export STAGING_PORT
  export SYNTHETIC_DATA_ACKNOWLEDGEMENT
  validate_staging_isolation
  DO_APP_DIR=/var/www/citefi
  ! validate_staging_isolation >/dev/null 2>&1
)

# Permanent production invariants: no global stop, in-place checkout/build, or
# rollback rebuild. Candidate verification precedes atomic process cutover.
assert_has "$HOST" 'flock -n 9'
assert_has "$TRANSPORT" 'git -C "\$ROOT" archive "\$sha"'
assert_has "$TRANSPORT" 'npm ci --registry'
assert_has "$TRANSPORT" 'npm run build'
assert_has "$TRANSPORT" 'sha256sum "\$artifact"'
assert_has "$TRANSPORT" 'scp '
assert_lacks "$HOST" 'npm ci'
assert_lacks "$HOST" 'npm run build'
assert_has "$HOST" 'CANDIDATE_RELEASE="\$DO_RELEASES_DIR/'
assert_has "$HOST" 'cd "\$CANDIDATE_RELEASE"'
assert_has "$HOST" 'test -s "\$unpack_dir/\.next/BUILD_ID"'
assert_has "$HOST" 'mv -Tf "\$next_link" "\$DO_CURRENT_LINK"'
assert_has "$HOST" 'switch_current "\$KNOWN_GOOD_RELEASE"'
assert_has "$HOST" 'without rebuilding'
rollback_body="$(sed -n '/^rollback()/,/^}/p' "$HOST")"
grep -q 'health_check "\$web_before" "\$worker_before"' <<<"$rollback_body"
grep -q 'public_listener_check' <<<"$rollback_body"
rollback_health_line="$(grep -n 'health_check "\$web_before" "\$worker_before"' <<<"$rollback_body" | head -1 | cut -d: -f1)"
rollback_public_line="$(grep -n 'public_listener_check' <<<"$rollback_body" | head -1 | cut -d: -f1)"
rollback_success_line="$(grep -n 'write_status rolled_back' <<<"$rollback_body" | head -1 | cut -d: -f1)"
(( rollback_health_line < rollback_public_line && rollback_public_line < rollback_success_line ))
assert_has "$HOST" 'known-good release passed local health but failed public listener health'
assert_has "$HOST" 'pm2 startOrReload "\$config" --only "\$name"'
assert_has "$HOST" 'Migrating named PM2 executable'
assert_has "$HOST" 'pm2 delete "\$name"'
assert_has "$HOST" 'pm2 start "\$config" --only "\$name"'
assert_lacks "$HOST" 'pm2[[:space:]]+stop[[:space:]]+all'
assert_lacks "$HOST" 'pm2[[:space:]]+stop'
assert_lacks "$HOST" 'git reset --hard'
assert_lacks "$HOST" 'git[[:space:]]+clean'
assert_has "$HOST" 'artifact checksum mismatch'
assert_has "$HOST" 'run-versioned-migrations'
assert_lacks "$HOST" 'drizzle-kit.*push'
assert_lacks "$HOST" 'push --force'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'pg_advisory_xact_lock'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'citefi_schema_migrations'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" '0020_incident_intelligence.sql'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" '0021_incident_intelligence_hardening.sql'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'telemetry_events_append_only'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'assignee_column_shape'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'assignee_users_fk'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'telemetry_ai_requests_pkey'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'notification_evidence_uniqueness'
assert_has "$ROOT/scripts/run-versioned-migrations.ts" 'all_append_only_triggers'
assert_has "$HOST" 'api/health\?full=1'
assert_has "$HOST" 'known-good release'
assert_has "$HOST" 'no automatic database rollback'

build_line="$(grep -n 'npm run build' "$TRANSPORT" | head -1 | cut -d: -f1)"
verify_line="$(grep -n 'test -s \.next/BUILD_ID' "$TRANSPORT" | head -1 | cut -d: -f1)"
validation_line="$(grep -n 'bash -o pipefail -c "\$DO_VALIDATION_COMMAND"' "$TRANSPORT" | head -1 | cut -d: -f1)"
migration_line="$(grep -n 'run_migrations$' "$HOST" | tail -1 | cut -d: -f1)"
cutover_line="$(grep -n 'switch_current "\$CANDIDATE_RELEASE"' "$HOST" | tail -1 | cut -d: -f1)"
(( validation_line < build_line && build_line < verify_line ))
(( migration_line < cutover_line ))

assert_has "$ROOT/.github/workflows/deploy.yml" 'needs: validate'
assert_has "$ROOT/.github/workflows/deploy.yml" 'PRODUCTION_DEPLOY_CONFIRMATION'
assert_has "$ROOT/.github/workflows/deploy.yml" 'DEPLOY_CITEFI_PRODUCTION_UNTIL_'
assert_has "$ROOT/.github/workflows/deploy.yml" 'workflow_dispatch'
assert_lacks "$ROOT/.github/workflows/deploy.yml" '^[[:space:]]*push:'
assert_has "$TRANSPORT" 'host-release.sh'
assert_has "$TRANSPORT" 'expiry > now \+ 600'
assert_has "$ROOT/scripts/deploy-to-staging.sh" '/var/www/citefi-staging'
assert_has "$ROOT/scripts/deploy-to-staging.sh" 'ecosystem.staging.config.cjs'
assert_has "$ROOT/scripts/deploy-to-staging.sh" 'STAGING_PORT.*5100'
assert_has "$ROOT/ecosystem.config.cjs" '/var/www/citefi/current'
assert_has "$ROOT/ecosystem.config.cjs" 'DO_CURRENT_DIR'
assert_has "$ROOT/ecosystem.config.cjs" 'process-bootstrap.ts'
assert_has "$ROOT/ecosystem.config.cjs" 'max_restarts: 5'
assert_has "$ROOT/ecosystem.config.cjs" 'PROCESS_DIAGNOSTIC_SPOOL'
assert_has "$HOST" 'public endpoint has no reachable listener'
assert_has "$ROOT/ecosystem.staging.config.cjs" '/var/www/citefi-staging/current'
# Integration contract: staging's configured 5100 reaches the bootstrap PORT
# consumed by the exact Next `-p` argument and listener diagnostic.
ROOT="$ROOT" node <<'JS'
const path = require("node:path");
delete process.env.STAGING_PORT;
const config = require(path.join(process.env.ROOT, "ecosystem.staging.config.cjs"));
const web = config.apps.find((app) => app.name === "citefi-staging-web");
if (!web || web.env.PORT !== "5100" || web.args !== "--web") {
  throw new Error("staging PM2 web port was not propagated as PORT=5100 to bootstrap");
}
JS
assert_has "$ROOT/scripts/process-bootstrap.ts" 'next", "start", "-p", webPort'
assert_has "$ROOT/scripts/process-bootstrap.ts" 'spawn\("ss", \["-ltn".*webPort'
assert_lacks "$ROOT/.replit" '^\[deployment\]'
assert_lacks "$ROOT/.replit" 'localPort[[:space:]]*=[[:space:]]*6379'
assert_has "$ROOT/.replit" 'localPort[[:space:]]*=[[:space:]]*5000'
assert_has "$ROOT/.replit" 'localPort[[:space:]]*=[[:space:]]*5904'
assert_has "$ROOT/lib/storage.ts" 'STORAGE_PREFIX'
echo "deployment contracts passed"