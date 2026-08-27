#!/usr/bin/env bash
# Build/validate an immutable artifact locally, then transport it to the host.
set -euo pipefail

# Production transport is deliberately fail-closed. The typed value includes
# an expiry so copied confirmations cannot become permanent CI/local bypasses.
if [[ "${DEPLOY_ENVIRONMENT:-production}" != staging ]]; then
  confirmation="${PRODUCTION_DEPLOY_CONFIRMATION:-}"
  if [[ ! "$confirmation" =~ ^DEPLOY_CITEFI_PRODUCTION_UNTIL_([0-9]{10})$ ]]; then
    echo "ERROR: production deployment requires PRODUCTION_DEPLOY_CONFIRMATION=DEPLOY_CITEFI_PRODUCTION_UNTIL_<unix-expiry>." >&2
    exit 64
  fi
  now="$(date +%s)"
  expiry="${BASH_REMATCH[1]}"
  if (( expiry <= now || expiry > now + 600 )); then
    echo "ERROR: production confirmation must expire in the next 10 minutes." >&2
    exit 64
  fi
  unset confirmation now expiry PRODUCTION_DEPLOY_CONFIRMATION
fi

: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY secret is missing}"
: "${DO_HOST:?DO_HOST env var is missing}"

DO_USER="${DO_USER:-citefi}"
DO_PORT="${DO_PORT:-22}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DO_VALIDATION_COMMAND="${DO_VALIDATION_COMMAND:-npm run validate:release}"
[[ -n "$DO_VALIDATION_COMMAND" ]] || { echo "ERROR: DO_VALIDATION_COMMAND cannot be empty" >&2; exit 64; }

# The host never installs dependencies or builds.  Work in an isolated export so
# local untracked files and credentials cannot enter the release.
work="$(mktemp -d "${TMPDIR:-/tmp}/citefi-release.XXXXXX")"
trap 'rm -rf "$work"' EXIT
sha="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" diff --quiet && git -C "$ROOT" diff --cached --quiet || {
  echo "ERROR: refusing to build a deployment artifact from a dirty checkout." >&2; exit 65;
}
git -C "$ROOT" archive "$sha" | tar -x -C "$work"
(
  cd "$work"
  sed -i 's|http://package-firewall\.replit\.local/npm|https://registry.npmjs.org|g' package-lock.json
  npm ci --registry https://registry.npmjs.org
  bash -o pipefail -c "$DO_VALIDATION_COMMAND"
  npm run build
  test -s .next/BUILD_ID
  printf '%s\n' "$sha" > .release-sha
  printf '%s\n' "$(cat .next/BUILD_ID)" > .release-build-id
)
artifact="$work/citefi-${sha}.tar.gz"
tar -C "$work" --exclude="./$(basename "$artifact")" --exclude='./.env*' \
  --sort=name --mtime="@$(git -C "$ROOT" show -s --format=%ct "$sha")" \
  --owner=0 --group=0 --numeric-owner -czf "$artifact" .
artifact_sha256="$(sha256sum "$artifact" | awk '{print $1}')"
artifact_size="$(stat -c '%s' "$artifact")"
upload_name="artifact-${sha}-${artifact_sha256:0:16}-${work##*.}.tar.gz"
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
  DO_APP_DIR DO_PM2_CONFIG DO_HEALTHCHECK_URL DO_PUBLIC_HEALTHCHECK_URL
  DO_WEB_PROCESS DO_WORKER_PROCESS DO_RELEASE_STATE_DIR DEPLOY_ENVIRONMENT
  DO_RELEASES_DIR DO_CURRENT_LINK DO_SHARED_ENV_FILE
  DO_ARTIFACT_PATH DO_ARTIFACT_SHA256 DO_ARTIFACT_SIZE DO_RELEASE_SHA
  STAGING_DATABASE_NAME STAGING_REDIS_DB STAGING_STORAGE_PREFIX
  STAGING_PORT STAGING_LOG_DIR SYNTHETIC_DATA_ACKNOWLEDGEMENT
)
DO_ARTIFACT_PATH="${DO_RELEASE_STATE_DIR:-${DO_APP_DIR:-/var/www/citefi}/.deploy}/incoming/$upload_name"
DO_ARTIFACT_SHA256="$artifact_sha256"
DO_ARTIFACT_SIZE="$artifact_size"
DO_RELEASE_SHA="$sha"
remote_command="env"
for name in "${remote_env[@]}"; do
  if [[ -n "${!name-}" ]]; then printf -v quoted '%q' "${!name}"; remote_command+=" ${name}=${quoted}"; fi
done
remote_command+=" bash -s"

ssh_opts=(-i "$KEY" -p "$DO_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
scp_opts=(-i "$KEY" -P "$DO_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
ssh "${ssh_opts[@]}" "${DO_USER}@${DO_HOST}" \
  "mkdir -p $(printf %q "$(dirname "$DO_ARTIFACT_PATH")") && chmod 700 $(printf %q "$(dirname "$DO_ARTIFACT_PATH")")"
scp "${scp_opts[@]}" "$artifact" "${DO_USER}@${DO_HOST}:$(printf %q "$DO_ARTIFACT_PATH.part")"
ssh "${ssh_opts[@]}" "${DO_USER}@${DO_HOST}" \
  "chmod 600 $(printf %q "$DO_ARTIFACT_PATH.part") && mv $(printf %q "$DO_ARTIFACT_PATH.part") $(printf %q "$DO_ARTIFACT_PATH")"
ssh "${ssh_opts[@]}" \
  -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
  "${DO_USER}@${DO_HOST}" "$remote_command" < "$SCRIPT_DIR/host-release.sh"