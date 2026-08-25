#!/usr/bin/env bash
# Transactional host-side release runner. Both SSH entry points pipe this file
# to the host; keep host-specific policy here rather than duplicating it.
set -Eeuo pipefail

DO_APP_DIR="${DO_APP_DIR:-/var/www/citefi}"
DO_BRANCH="${DO_BRANCH:-main}"
DO_PM2_CONFIG="${DO_PM2_CONFIG:-ecosystem.config.cjs}"
DO_HEALTHCHECK_URL="${DO_HEALTHCHECK_URL:-http://127.0.0.1:5000/api/health?full=1}"
DO_VALIDATION_COMMAND="${DO_VALIDATION_COMMAND:-npm run validate:release}"
DO_WEB_PROCESS="${DO_WEB_PROCESS:-citefi-web}"
DO_WORKER_PROCESS="${DO_WORKER_PROCESS:-citefi-worker}"
DO_RELEASE_STATE_DIR="${DO_RELEASE_STATE_DIR:-$DO_APP_DIR/.deploy}"

OLD_SHA=unknown
NEW_SHA=unknown
KNOWN_GOOD_SHA=
PHASE=preflight
RUNTIME_TOUCHED=false
ROLLING_BACK=false

write_status() {
  local status="$1" detail="${2:-}"
  mkdir -p "$DO_RELEASE_STATE_DIR"
  STATUS="$status" DETAIL="$detail" OLD="$OLD_SHA" NEW="$NEW_SHA" GOOD="$KNOWN_GOOD_SHA" \
    python3 - "$DO_RELEASE_STATE_DIR/release-status.json.tmp.$$" <<'PY'
import json, os, sys
from datetime import datetime, timezone
with open(sys.argv[1], "w") as f:
    json.dump({
        "status": os.environ["STATUS"], "phase": os.environ.get("PHASE", ""),
        "oldSha": os.environ["OLD"], "newSha": os.environ["NEW"],
        "knownGoodSha": os.environ["GOOD"], "detail": os.environ["DETAIL"],
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }, f, indent=2)
    f.write("\n")
PY
  mv -f "$DO_RELEASE_STATE_DIR/release-status.json.tmp.$$" "$DO_RELEASE_STATE_DIR/release-status.json"
}

patch_lockfile() {
  if grep -q "package-firewall.replit.local" package-lock.json 2>/dev/null; then
    sed -i 's|http://package-firewall\.replit\.local/npm|https://registry.npmjs.org|g' package-lock.json
  fi
}

ensure_swap() {
  if [[ ! -f /swapfile2 ]]; then
    fallocate -l 2G /swapfile2
    chmod 600 /swapfile2
    mkswap /swapfile2 >/dev/null
    swapon /swapfile2
  elif ! swapon --show | grep -q /swapfile2; then
    swapon /swapfile2
  fi
}

stop_release_processes() {
  if [[ "${DEPLOY_ENVIRONMENT:-production}" == staging ]]; then
    # A staging release may share a host with production. Never stop unrelated
    # PM2 applications while exercising staging deploy/rollback drills.
    pm2 stop "$DO_WEB_PROCESS" "$DO_WORKER_PROCESS" 2>/dev/null || true
  else
    # The 2 GB production droplet needs the full PM2 memory margin for npm ci.
    pm2 stop all 2>/dev/null || true
  fi
}

install_and_build() {
  # Root owns the production PM2 daemon. Stop it before npm ci: this RAM margin
  # and the second 2G swap file are required on the 2 GB droplet.
  RUNTIME_TOUCHED=true
  stop_release_processes
  ensure_swap
  patch_lockfile
  npm ci --registry https://registry.npmjs.org || {
    rm -rf node_modules
    npm ci --registry https://registry.npmjs.org
  }
  git checkout -- package-lock.json 2>/dev/null || true
  [[ -n "$DO_VALIDATION_COMMAND" ]] || {
    echo "ERROR: DO_VALIDATION_COMMAND must not be empty"; return 1;
  }
  echo "Running required validation: $DO_VALIDATION_COMMAND"
  bash -o pipefail -c "$DO_VALIDATION_COMMAND"
  NODE_OPTIONS="--max-old-space-size=1700" npm run build
  test -s .next/BUILD_ID
}

reload_processes() {
  pm2 startOrReload "$DO_PM2_CONFIG" --update-env
}

restart_count() {
  local name="$1"
  pm2 jlist 2>/dev/null | PROCESS_NAME="$name" python3 -c '
import json, os, sys
try: ps=json.load(sys.stdin)
except Exception: ps=[]
print(next((p.get("pm2_env",{}).get("restart_time",0) for p in ps if p.get("name")==os.environ["PROCESS_NAME"]), 0))
' 2>/dev/null || echo 0
}

process_online() {
  local name="$1"
  pm2 jlist 2>/dev/null | PROCESS_NAME="$name" python3 -c '
import json, os, sys
ps=json.load(sys.stdin)
ok=any(p.get("name")==os.environ["PROCESS_NAME"] and p.get("pm2_env",{}).get("status")=="online" for p in ps)
raise SystemExit(0 if ok else 1)
'
}

health_check() {
  local web_before="$1" worker_before="$2" response
  for i in $(seq 1 15); do
    sleep 3
    response="$(curl -fsS --max-time 5 "$DO_HEALTHCHECK_URL" 2>/dev/null || true)"
    if [[ -n "$response" ]] && RESPONSE="$response" python3 -c '
import json, os
r=json.loads(os.environ["RESPONSE"]); s=r.get("services", {})
assert s.get("database", {}).get("ok") is True
assert s.get("redis", {}).get("ok") is True
assert s.get("canary", {}).get("ok") is True
assert s.get("worker", {}).get("ok") is True
assert s.get("queues", {}).get("ok") is True
assert s.get("providerCircuits", {}).get("ok") is True
assert s.get("storage", {}).get("status") != "fail"
assert s.get("backup", {}).get("status") != "fail"
' && process_online "$DO_WEB_PROCESS" && process_online "$DO_WORKER_PROCESS"; then
      echo "Health passed: web, database, Redis, and worker are healthy."
      return 0
    fi
    local web_now worker_now
    web_now="$(restart_count "$DO_WEB_PROCESS")"
    worker_now="$(restart_count "$DO_WORKER_PROCESS")"
    if (( web_now > web_before + 1 || worker_now > worker_before + 1 )); then
      echo "ERROR: crash loop detected (web ${web_before}->${web_now}, worker ${worker_before}->${worker_now})"
      return 1
    fi
    echo "Waiting for full health (${i}/15)..."
  done
  echo "ERROR: full health check failed: $DO_HEALTHCHECK_URL"
  return 1
}

rollback() {
  local cause="$1"
  [[ "$ROLLING_BACK" == false ]] || return 1
  ROLLING_BACK=true
  trap - ERR
  echo "Release failed during $PHASE: $cause"
  write_status failed "$cause"
  if [[ -z "$KNOWN_GOOD_SHA" ]] || ! git cat-file -e "${KNOWN_GOOD_SHA}^{commit}" 2>/dev/null; then
    echo "ERROR: no known-good commit is available; refusing an unsafe guess."
    return 1
  fi
  echo "Restoring known-good code and processes at $KNOWN_GOOD_SHA."
  echo "Database changes are forward-only; no automatic database rollback will be attempted."
  stop_release_processes
  write_status rolling_back "$cause"
  git reset --hard "$KNOWN_GOOD_SHA"
  patch_lockfile
  npm ci --registry https://registry.npmjs.org || {
    rm -rf node_modules
    npm ci --registry https://registry.npmjs.org
  }
  git checkout -- package-lock.json 2>/dev/null || true
  NODE_OPTIONS="--max-old-space-size=1700" npm run build
  test -s .next/BUILD_ID
  local web_before worker_before
  web_before="$(restart_count "$DO_WEB_PROCESS")"
  worker_before="$(restart_count "$DO_WORKER_PROCESS")"
  reload_processes
  if ! health_check "$web_before" "$worker_before"; then
    write_status rollback_failed "$cause; known-good application did not pass health against the current schema"
    echo "ERROR: known-good application failed post-rollback health; manual incident recovery is required."
    return 1
  fi
  write_status rolled_back "$cause; database rollback intentionally not attempted"
}

on_error() {
  local rc="$1" line="$2"
  rollback "exit $rc at line $line" || true
  exit "$rc"
}

validate_staging_isolation() {
  [[ "${DEPLOY_ENVIRONMENT:-production}" == staging ]] || return 0
  [[ "$DO_APP_DIR" != "/var/www/citefi" ]] ||
    { echo "ERROR: staging cannot use the production app directory"; return 1; }
  [[ "$DO_PM2_CONFIG" != "ecosystem.config.cjs" ]] ||
    { echo "ERROR: staging cannot use the production PM2 config"; return 1; }
  [[ "$DO_WEB_PROCESS" != "citefi-web" && "$DO_WORKER_PROCESS" != "citefi-worker" ]] ||
    { echo "ERROR: staging cannot use production PM2 process names"; return 1; }
  [[ "$DO_HEALTHCHECK_URL" != *":5000/"* ]] ||
    { echo "ERROR: staging cannot use the production web port"; return 1; }
  [[ "${SYNTHETIC_DATA_ACKNOWLEDGEMENT:-}" == "I_ACKNOWLEDGE_STAGING_SYNTHETIC_DATA_ONLY" ]] ||
    { echo "ERROR: explicit staging synthetic-data acknowledgement is required"; return 1; }
  env -u DATABASE_URL -u REDIS_URL -u STORAGE_PREFIX \
    node --env-file=.env.local - <<'JS'
const env=process.env;
const db=new URL(env.DATABASE_URL || "");
const dbName=db.pathname.replace(/^\//,"");
if (!process.env.STAGING_DATABASE_NAME || dbName !== process.env.STAGING_DATABASE_NAME) throw Error("staging DATABASE_URL database-name check failed");
const redis=new URL(env.REDIS_URL || "");
const redisDb=redis.pathname.replace(/^\//,"") || "0";
if (!process.env.STAGING_REDIS_DB || process.env.STAGING_REDIS_DB === "0" || redisDb !== process.env.STAGING_REDIS_DB) throw Error("staging Redis DB check failed");
if (!env.STORAGE_PREFIX || env.STORAGE_PREFIX !== process.env.STAGING_STORAGE_PREFIX) throw Error("staging storage prefix check failed");
JS
}

main() {
  [[ -n "$DO_VALIDATION_COMMAND" ]] || { echo "ERROR: a green validation command is required"; exit 1; }
  git config --global --add safe.directory "$DO_APP_DIR" 2>/dev/null || true
  cd "$DO_APP_DIR"
  test -d .git
  test -f .env.local
  grep -q '^DATABASE_URL=' .env.local
  grep -q '^JWT_SECRET=' .env.local
  validate_staging_isolation

  OLD_SHA="$(git rev-parse HEAD)"
  KNOWN_GOOD_SHA="$(python3 - "$DO_RELEASE_STATE_DIR/release-status.json" <<'PY' 2>/dev/null || true
import json, sys
print(json.load(open(sys.argv[1])).get("knownGoodSha",""))
PY
)"
  [[ -n "$KNOWN_GOOD_SHA" ]] || KNOWN_GOOD_SHA="$OLD_SHA"
  git fetch origin "$DO_BRANCH"
  NEW_SHA="$(git rev-parse "origin/$DO_BRANCH")"
  export PHASE
  write_status deploying
  trap 'on_error "$?" "$LINENO"' ERR

  PHASE=checkout
  git reset --hard "$NEW_SHA" # Deliberately never git clean: env/build artifacts are untracked.
  PHASE=build
  if [[ "$OLD_SHA" != "$NEW_SHA" || ! -d node_modules || ! -s .next/BUILD_ID ]]; then
    install_and_build
  else
    bash -o pipefail -c "$DO_VALIDATION_COMMAND"
  fi

  # All forward-only schema work completes before any new process starts.
  PHASE=migrations
  npm run db:push -- --force
  node --env-file=.env.local --import tsx/esm scripts/apply-tenant-rls.ts
  node --env-file=.env.local --import tsx/esm scripts/migrate-t151-campaigns.ts
  node --env-file=.env.local --import tsx/esm scripts/migrate-t154-agency-reports.ts

  PHASE=reload
  local web_before worker_before
  web_before="$(restart_count "$DO_WEB_PROCESS")"
  worker_before="$(restart_count "$DO_WORKER_PROCESS")"
  reload_processes
  RUNTIME_TOUCHED=true
  PHASE=health
  health_check "$web_before" "$worker_before"

  PHASE=complete
  KNOWN_GOOD_SHA="$NEW_SHA"
  write_status succeeded
  trap - ERR
  echo "Deployed $OLD_SHA -> $NEW_SHA successfully."
}

if [[ "${HOST_RELEASE_SOURCE_ONLY:-0}" != 1 ]]; then
  main "$@"
fi