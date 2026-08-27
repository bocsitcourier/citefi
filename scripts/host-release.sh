#!/usr/bin/env bash
# Host-side release runner. It only verifies and unpacks a prebuilt artifact.
set -Eeuo pipefail

DO_APP_DIR="${DO_APP_DIR:-/var/www/citefi}"
DO_BRANCH="${DO_BRANCH:-main}"
DO_PM2_CONFIG="${DO_PM2_CONFIG:-ecosystem.config.cjs}"
DO_HEALTHCHECK_URL="${DO_HEALTHCHECK_URL:-http://127.0.0.1:5000/api/health?full=1}"
DO_PUBLIC_HEALTHCHECK_URL="${DO_PUBLIC_HEALTHCHECK_URL:-}"
DO_WEB_PROCESS="${DO_WEB_PROCESS:-citefi-web}"
DO_WORKER_PROCESS="${DO_WORKER_PROCESS:-citefi-worker}"
DO_RELEASE_STATE_DIR="${DO_RELEASE_STATE_DIR:-$DO_APP_DIR/.deploy}"
DO_RELEASES_DIR="${DO_RELEASES_DIR:-$DO_APP_DIR/releases}"
DO_CURRENT_LINK="${DO_CURRENT_LINK:-$DO_APP_DIR/current}"
DO_SHARED_ENV_FILE="${DO_SHARED_ENV_FILE:-$DO_APP_DIR/.env.local}"
DO_ARTIFACT_PATH="${DO_ARTIFACT_PATH:-}"
DO_ARTIFACT_SHA256="${DO_ARTIFACT_SHA256:-}"
DO_ARTIFACT_SIZE="${DO_ARTIFACT_SIZE:-}"
DO_RELEASE_SHA="${DO_RELEASE_SHA:-}"
STAGING_PORT="${STAGING_PORT:-5100}"

OLD_SHA=unknown
NEW_SHA=unknown
KNOWN_GOOD_SHA=
ACTIVE_RELEASE=
KNOWN_GOOD_RELEASE=
CANDIDATE_RELEASE=
PHASE=preflight
CUTOVER_DONE=false
ROLLING_BACK=false

write_status() {
  local status="$1" detail="${2:-}"
  mkdir -p "$DO_RELEASE_STATE_DIR"
  STATUS="$status" DETAIL="$detail" OLD="$OLD_SHA" NEW="$NEW_SHA" GOOD="$KNOWN_GOOD_SHA" \
    ACTIVE="$ACTIVE_RELEASE" GOOD_RELEASE="$KNOWN_GOOD_RELEASE" CANDIDATE="$CANDIDATE_RELEASE" \
    python3 - "$DO_RELEASE_STATE_DIR/release-status.json.tmp.$$" <<'PY'
import json, os, sys
from datetime import datetime, timezone
with open(sys.argv[1], "w") as f:
    json.dump({
        "status": os.environ["STATUS"], "phase": os.environ.get("PHASE", ""),
        "oldSha": os.environ["OLD"], "newSha": os.environ["NEW"],
        "knownGoodSha": os.environ["GOOD"], "activeRelease": os.environ["ACTIVE"],
        "knownGoodRelease": os.environ["GOOD_RELEASE"],
        "candidateRelease": os.environ["CANDIDATE"], "detail": os.environ["DETAIL"],
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }, f, indent=2)
    f.write("\n")
PY
  mv -f "$DO_RELEASE_STATE_DIR/release-status.json.tmp.$$" "$DO_RELEASE_STATE_DIR/release-status.json"
}

acquire_release_lock() {
  command -v flock >/dev/null || {
    echo "ERROR: util-linux flock is required on the deployment host."; return 1;
  }
  mkdir -p "$DO_RELEASE_STATE_DIR"
  exec 9>"$DO_RELEASE_STATE_DIR/release.lock"
  flock -n 9 || {
    echo "ERROR: another release holds the exclusive host deployment lock."; return 1;
  }
}

validate_deploy_ownership() {
  local current_user app_owner foreign_path
  current_user="$(id -un)"
  app_owner="$(stat -c '%U' "$DO_APP_DIR")"
  [[ "$current_user" == "$app_owner" ]] || {
    echo "ERROR: deploy user $current_user does not own $DO_APP_DIR (owner: $app_owner)."
    return 1
  }
  foreign_path="$(find "$DO_RELEASES_DIR" "$DO_RELEASE_STATE_DIR" "$DO_SHARED_ENV_FILE" \
    -xdev ! -user "$(id -u)" -print -quit 2>/dev/null || true)"
  [[ -z "$foreign_path" ]] || {
    echo "ERROR: deployment files have mixed ownership (first mismatch: $foreign_path)."
    return 1
  }
}

validate_layout() {
  [[ -f "$DO_SHARED_ENV_FILE" ]] || {
    echo "ERROR: shared environment file is missing: $DO_SHARED_ENV_FILE"; return 1;
  }
  grep -q '^DATABASE_URL=' "$DO_SHARED_ENV_FILE"
  grep -q '^JWT_SECRET=' "$DO_SHARED_ENV_FILE"
  mkdir -p "$DO_RELEASES_DIR"
  [[ -L "$DO_CURRENT_LINK" ]] || {
    echo "ERROR: $DO_CURRENT_LINK must be a symlink to the known-good release."
    echo "Complete the one-time immutable-release migration in the production runbook."
    return 1
  }
  ACTIVE_RELEASE="$(readlink -f "$DO_CURRENT_LINK")"
  [[ "$ACTIVE_RELEASE" == "$DO_RELEASES_DIR/"* && -d "$ACTIVE_RELEASE" && -s "$ACTIVE_RELEASE/.next/BUILD_ID" ]] || {
    echo "ERROR: current must resolve to a built immutable release under $DO_RELEASES_DIR."; return 1;
  }
  OLD_SHA="$(cat "$ACTIVE_RELEASE/.release-sha" 2>/dev/null || git -C "$DO_APP_DIR" rev-parse HEAD)"
  KNOWN_GOOD_SHA="$OLD_SHA"
  KNOWN_GOOD_RELEASE="$ACTIVE_RELEASE"
}

prepare_candidate() {
  local release_id actual size unpack_dir
  [[ "$DO_ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ && "$DO_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
    echo "ERROR: invalid artifact metadata"; return 1;
  }
  [[ -f "$DO_ARTIFACT_PATH" && ! -L "$DO_ARTIFACT_PATH" ]] || {
    echo "ERROR: uploaded artifact is missing or is a symlink"; return 1;
  }
  size="$(stat -c '%s' "$DO_ARTIFACT_PATH")"
  [[ "$size" == "$DO_ARTIFACT_SIZE" ]] || { echo "ERROR: artifact size mismatch"; return 1; }
  actual="$(sha256sum "$DO_ARTIFACT_PATH" | awk '{print $1}')"
  [[ "$actual" == "$DO_ARTIFACT_SHA256" ]] || { echo "ERROR: artifact checksum mismatch"; return 1; }
  python3 - "$DO_ARTIFACT_PATH" <<'PY'
import os, sys, tarfile
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        name = member.name
        normalized = os.path.normpath("/" + name).lstrip("/")
        if name.startswith("/") or normalized == ".." or normalized.startswith("../"):
            raise SystemExit(f"ERROR: unsafe artifact member: {name}")
        if member.isdev() or member.isfifo():
            raise SystemExit(f"ERROR: special files are forbidden in artifact: {name}")
        if member.issym() or member.islnk():
            target = os.path.normpath(os.path.join(os.path.dirname(normalized), member.linkname))
            if os.path.isabs(member.linkname) or target == ".." or target.startswith("../"):
                raise SystemExit(f"ERROR: escaping artifact link: {name} -> {member.linkname}")
PY
  release_id="${DO_RELEASE_SHA}-${DO_ARTIFACT_SHA256:0:16}"
  CANDIDATE_RELEASE="$DO_RELEASES_DIR/$release_id"
  if [[ -d "$CANDIDATE_RELEASE" ]]; then
    [[ "$(cat "$CANDIDATE_RELEASE/.release-sha" 2>/dev/null)" == "$DO_RELEASE_SHA" &&
        -s "$CANDIDATE_RELEASE/.next/BUILD_ID" ]] || {
      echo "ERROR: existing immutable release fails identity checks"; return 1;
    }
    rm -f "$DO_ARTIFACT_PATH"
    return 0
  fi
  unpack_dir="$DO_RELEASES_DIR/.unpack-${release_id}-$$"
  mkdir -m 700 "$unpack_dir"
  tar --no-same-owner --no-same-permissions -xzf "$DO_ARTIFACT_PATH" -C "$unpack_dir"
  ln -s "$DO_SHARED_ENV_FILE" "$unpack_dir/.env.local"
  [[ "$(cat "$unpack_dir/.release-sha")" == "$DO_RELEASE_SHA" ]] || {
    echo "ERROR: embedded release SHA mismatch"; return 1;
  }
  test -s "$unpack_dir/.next/BUILD_ID"
  test -x "$unpack_dir/node_modules/.bin/next"
  chmod -R a-w "$unpack_dir"
  mv "$unpack_dir" "$CANDIDATE_RELEASE"
  rm -f "$DO_ARTIFACT_PATH"
}

run_migrations() {
  (
    cd "$CANDIDATE_RELEASE"
    node --env-file=.env.local --import tsx/esm scripts/run-versioned-migrations.ts
  )
}

switch_current() {
  local release="$1" next_link="$DO_CURRENT_LINK.next.$$"
  [[ "$release" == "$DO_RELEASES_DIR/"* && -s "$release/.next/BUILD_ID" ]] || {
    echo "ERROR: refusing cutover to an invalid release: $release"; return 1;
  }
  ln -s "$release" "$next_link"
  mv -Tf "$next_link" "$DO_CURRENT_LINK"
  ACTIVE_RELEASE="$release"
}

process_uses_bootstrap() {
  local name="$1"
  pm2 jlist 2>/dev/null | PROCESS_NAME="$name" node -e '
let source="";
process.stdin.on("data", chunk => source += chunk);
process.stdin.on("end", () => {
  const process = JSON.parse(source).find(item => item.name === process.env.PROCESS_NAME);
  const executable = process?.pm2_env?.pm_exec_path ?? "";
  process.exit(executable.endsWith("/scripts/process-bootstrap.ts") ? 0 : 1);
});
'
}

reload_one_process() {
  local name="$1" config="$DO_CURRENT_LINK/$DO_PM2_CONFIG"
  local desired_bootstrap=false current_bootstrap=false
  grep -q 'process-bootstrap\.ts' "$config" && desired_bootstrap=true
  process_uses_bootstrap "$name" && current_bootstrap=true
  if [[ "$desired_bootstrap" != "$current_bootstrap" ]]; then
    echo "Migrating named PM2 executable for $name."
    pm2 delete "$name" >/dev/null 2>&1 || true
    pm2 start "$config" --only "$name" --update-env
  else
    pm2 startOrReload "$config" --only "$name" --update-env
  fi
}

reload_processes() {
  export DO_CURRENT_DIR="$DO_CURRENT_LINK"
  reload_one_process "$DO_WEB_PROCESS"
  reload_one_process "$DO_WORKER_PROCESS"
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
  local web_before="$1" worker_before="$2" response web_now worker_now
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
      echo "Health passed: web, dependencies, canary, and worker are healthy."
      return 0
    fi
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

failure_diagnostics() {
  echo "--- release failure diagnostics ---" >&2
  echo "build-id=$(cat "$DO_CURRENT_LINK/.next/BUILD_ID" 2>/dev/null || echo missing)" >&2
  pm2 describe "$DO_WEB_PROCESS" >&2 || true
  pm2 describe "$DO_WORKER_PROCESS" >&2 || true
  ss -ltnp 2>/dev/null | grep -E ':(5000|5100)[[:space:]]' >&2 || echo "NO_LISTENER on expected web ports" >&2
  [[ -z "$DO_PUBLIC_HEALTHCHECK_URL" ]] || curl -sSvk --max-time 8 "$DO_PUBLIC_HEALTHCHECK_URL" -o /dev/null >&2 || true
  tail -n 80 "/var/log/citefi/web-error.log" >&2 2>/dev/null || true
  tail -n 80 "/var/log/citefi/worker-error.log" >&2 2>/dev/null || true
}

public_listener_check() {
  [[ -n "$DO_PUBLIC_HEALTHCHECK_URL" ]] || {
    echo "ERROR: DO_PUBLIC_HEALTHCHECK_URL is required for a direct public listener gate"; return 1;
  }
  local code
  code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$DO_PUBLIC_HEALTHCHECK_URL")" || {
    echo "ERROR: public endpoint has no reachable listener: $DO_PUBLIC_HEALTHCHECK_URL"
    failure_diagnostics
    return 1
  }
  [[ "$code" =~ ^2 ]] || {
    echo "ERROR: public listener returned HTTP $code"; failure_diagnostics; return 1;
  }
}

rollback() {
  local cause="$1" web_before worker_before
  [[ "$ROLLING_BACK" == false ]] || return 1
  ROLLING_BACK=true
  trap - ERR
  echo "Release failed during $PHASE: $cause"
  failure_diagnostics
  write_status failed "$cause"
  if [[ "$CUTOVER_DONE" != true ]]; then
    echo "Candidate failed before cutover; the known-good release remains active."
    return 0
  fi
  [[ -n "$KNOWN_GOOD_RELEASE" && -d "$KNOWN_GOOD_RELEASE" && -s "$KNOWN_GOOD_RELEASE/.next/BUILD_ID" ]] || {
    echo "ERROR: known-good release artifact is unavailable; manual recovery is required."; return 1;
  }
  echo "Atomically restoring known-good release $KNOWN_GOOD_RELEASE without rebuilding."
  echo "Database changes are forward-only; no automatic database rollback will be attempted."
  write_status rolling_back "$cause"
  switch_current "$KNOWN_GOOD_RELEASE"
  web_before="$(restart_count "$DO_WEB_PROCESS")"
  worker_before="$(restart_count "$DO_WORKER_PROCESS")"
  reload_processes
  if ! health_check "$web_before" "$worker_before"; then
    write_status rollback_failed "$cause; known-good release failed health against the current schema"
    return 1
  fi
  PHASE=rollback_public_listener
  if ! public_listener_check; then
    write_status rollback_failed "$cause; known-good release passed local health but failed public listener health"
    return 1
  fi
  write_status rolled_back "$cause; application artifact restored; database rollback intentionally not attempted"
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
  [[ "$STAGING_PORT" =~ ^[0-9]+$ && "$STAGING_PORT" -ge 1 && "$STAGING_PORT" -le 65535 ]] ||
    { echo "ERROR: staging port must be a valid TCP port"; return 1; }
  [[ "$DO_HEALTHCHECK_URL" == *":${STAGING_PORT}/"* ]] ||
    { echo "ERROR: staging health URL and PM2 port do not match"; return 1; }
  [[ "${SYNTHETIC_DATA_ACKNOWLEDGEMENT:-}" == "I_ACKNOWLEDGE_STAGING_SYNTHETIC_DATA_ONLY" ]] ||
    { echo "ERROR: explicit staging synthetic-data acknowledgement is required"; return 1; }
  env -u DATABASE_URL -u REDIS_URL -u STORAGE_PREFIX \
    node --env-file="$DO_SHARED_ENV_FILE" - <<'JS'
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
  : "${DO_ARTIFACT_PATH:?verified artifact path is required}"
  : "${DO_ARTIFACT_SHA256:?artifact checksum is required}"
  : "${DO_ARTIFACT_SIZE:?artifact byte size is required}"
  : "${DO_RELEASE_SHA:?release SHA is required}"
  acquire_release_lock
  validate_deploy_ownership
  validate_staging_isolation
  validate_layout

  NEW_SHA="$DO_RELEASE_SHA"
  export PHASE
  write_status deploying
  trap 'on_error "$?" "$LINENO"' ERR

  PHASE=verify_unpack_artifact
  prepare_candidate
  PHASE=migrations
  run_migrations

  PHASE=cutover
  local web_before worker_before
  web_before="$(restart_count "$DO_WEB_PROCESS")"
  worker_before="$(restart_count "$DO_WORKER_PROCESS")"
  switch_current "$CANDIDATE_RELEASE"
  CUTOVER_DONE=true
  PHASE=reload
  reload_processes
  PHASE=health
  health_check "$web_before" "$worker_before"
  PHASE=public_listener
  public_listener_check

  PHASE=complete
  KNOWN_GOOD_SHA="$NEW_SHA"
  KNOWN_GOOD_RELEASE="$CANDIDATE_RELEASE"
  write_status succeeded
  trap - ERR
  echo "Deployed $OLD_SHA -> $NEW_SHA successfully as immutable release $CANDIDATE_RELEASE."
}

if [[ "${HOST_RELEASE_SOURCE_ONLY:-0}" != 1 ]]; then
  main "$@"
fi