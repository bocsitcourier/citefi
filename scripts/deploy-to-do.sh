#!/usr/bin/env bash
# SSH transport for the shared host release runner.
set -euo pipefail
: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY secret is missing}"
: "${DO_HOST:?DO_HOST env var is missing}"

DO_USER="${DO_USER:-root}"
DO_PORT="${DO_PORT:-22}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
KEY="$HOME/.ssh/id_do_deploy"
python3 - <<'PY' > "$KEY"
import os, re, sys
raw=os.environ["DO_SSH_PRIVATE_KEY"]
raw=re.sub(r"-----BEGIN ([^-]+)-----\s*",r"-----BEGIN \1-----\n",raw)
raw=re.sub(r"\s*-----END ([^-]+)-----",r"\n-----END \1-----\n",raw)
lines=raw.splitlines(); out=[]
for line in lines:
    out.append(line) if "-----" in line else out.extend(line.split())
sys.stdout.write("\n".join(out)+"\n")
PY
chmod 600 "$KEY"
ssh-keyscan -p "$DO_PORT" -H "$DO_HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null || true

remote_env=(
  DO_APP_DIR DO_BRANCH DO_PM2_CONFIG DO_HEALTHCHECK_URL DO_VALIDATION_COMMAND
  DO_WEB_PROCESS DO_WORKER_PROCESS DO_RELEASE_STATE_DIR DEPLOY_ENVIRONMENT
  STAGING_DATABASE_NAME STAGING_REDIS_DB STAGING_STORAGE_PREFIX
  STAGING_PORT STAGING_LOG_DIR SYNTHETIC_DATA_ACKNOWLEDGEMENT
)
remote_command="env"
for name in "${remote_env[@]}"; do
  if [[ -n "${!name-}" ]]; then printf -v quoted '%q' "${!name}"; remote_command+=" ${name}=${quoted}"; fi
done
remote_command+=" bash -s"

ssh -i "$KEY" -p "$DO_PORT" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
  "${DO_USER}@${DO_HOST}" "$remote_command" < "$SCRIPT_DIR/host-release.sh"