#!/usr/bin/env bash
set -euo pipefail
case "${STAGING_OPERATION:-inspect}" in
  inspect|inspect-root|setup|verify) operation="${STAGING_OPERATION:-inspect}" ;;
  *) echo "Unrecognized staging operation" >&2; exit 64 ;;
esac
: "${DO_HOST:?DO_HOST is required}"
: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY is required}"
: "${DO_SSH_HOST_FINGERPRINT:?DO_SSH_HOST_FINGERPRINT is required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
export QA_SSH_KEY_PATH="$work/key"
python3 - <<'PY'
import os, re
raw = os.environ["DO_SSH_PRIVATE_KEY"]
raw = re.sub(r"-----BEGIN ([^-]+)-----\s*", r"-----BEGIN \1-----\n", raw)
raw = re.sub(r"\s*-----END ([^-]+)-----", r"\n-----END \1-----\n", raw)
lines = []
for line in raw.splitlines():
    lines.extend([line] if "-----" in line else line.split())
fd = os.open(os.environ["QA_SSH_KEY_PATH"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as key:
    key.write("\n".join(lines) + "\n")
PY
unset DO_SSH_PRIVATE_KEY QA_SSH_KEY_PATH
KNOWN_HOSTS_FILE="$work/known_hosts" bash "$SCRIPT_DIR/verify-ssh-host-key.sh"
remote_user="${DO_USER:-citefi}"
if [[ "$operation" == inspect-root ]]; then
  remote_user=root
  operation=inspect
elif [[ "$operation" == setup || "$operation" == verify ]]; then
  remote_user=root
fi
if [[ "$operation" == setup ]]; then
  : "${STAGING_SOURCE_BLOB:?reviewed immutable staging source blob is required}"
  : "${STAGING_SOURCE_SHA256:?reviewed staging source digest is required}"
  [[ "$STAGING_SOURCE_BLOB" =~ ^[a-f0-9]{40}$ && "$STAGING_SOURCE_SHA256" =~ ^[a-f0-9]{64}$ ]] ||
    { echo "Invalid pinned staging source identifiers" >&2; exit 64; }
  gh api "repos/${GITHUB_REPOSITORY}/git/blobs/${STAGING_SOURCE_BLOB}" --jq .content |
    base64 --decode > "$work/source.tar.gz"
  printf '%s  %s\n' "$STAGING_SOURCE_SHA256" "$work/source.tar.gz" | sha256sum --check --status
  ssh -i "$work/key" -p "${DO_PORT:-22}" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts" \
    -o ForwardAgent=no -o ClearAllForwardings=yes -T \
    "$remote_user@${DO_HOST}" "node - prepare" < "$SCRIPT_DIR/staging-publishing-server.cjs"
  scp -q -i "$work/key" -P "${DO_PORT:-22}" -o BatchMode=yes -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts" \
    -o ForwardAgent=no -o ClearAllForwardings=yes \
    "$work/source.tar.gz" "$remote_user@${DO_HOST}:/var/www/citefi-staging/publishing-qa/incoming/source.tar.gz"
fi
ssh -i "$work/key" -p "${DO_PORT:-22}" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$work/known_hosts" -o ConnectTimeout=15 \
  -o ForwardAgent=no -o ClearAllForwardings=yes -T \
  "$remote_user@${DO_HOST}" "node - $operation ${STAGING_SOURCE_SHA256:-}" < "$SCRIPT_DIR/staging-publishing-server.cjs"
