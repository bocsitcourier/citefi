#!/usr/bin/env bash
set -euo pipefail
case "${STAGING_OPERATION:-inspect}" in
  inspect|setup|verify) operation="${STAGING_OPERATION:-inspect}" ;;
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
ssh -i "$work/key" -p "${DO_PORT:-22}" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$work/known_hosts" -o ConnectTimeout=15 \
  -o ForwardAgent=no -o ClearAllForwardings=yes -T \
  "${DO_USER:-citefi}@${DO_HOST}" "node - $operation" < "$SCRIPT_DIR/staging-publishing-server.cjs"
