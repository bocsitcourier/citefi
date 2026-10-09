#!/usr/bin/env bash
# Never deploy, source remote environment files, or print credentials.
set -euo pipefail
: "${DO_HOST:?DO_HOST is required}"
: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY is required}"
: "${DO_SSH_HOST_FINGERPRINT:?DO_SSH_HOST_FINGERPRINT is required}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
export INSPECTION_KEY_PATH="$work/key"
python3 - <<'PY'
import os, re
raw = os.environ["DO_SSH_PRIVATE_KEY"]
raw = re.sub(r"-----BEGIN ([^-]+)-----\s*", r"-----BEGIN \1-----\n", raw)
raw = re.sub(r"\s*-----END ([^-]+)-----", r"\n-----END \1-----\n", raw)
lines = []
for line in raw.splitlines():
    lines.extend([line] if "-----" in line else line.split())
fd = os.open(os.environ["INSPECTION_KEY_PATH"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as key:
    key.write("\n".join(lines) + "\n")
PY
unset DO_SSH_PRIVATE_KEY INSPECTION_KEY_PATH
KNOWN_HOSTS_FILE="$work/known_hosts" bash "$SCRIPT_DIR/verify-ssh-host-key.sh"
# No TTY, forwarding, agent, upload, arbitrary command input, or app execution.
ssh -i "$work/key" -p "${DO_PORT:-22}" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile="$work/known_hosts" -o ConnectTimeout=15 \
  -o ForwardAgent=no -o ClearAllForwardings=yes -T \
  "${DO_USER:-citefi}@${DO_HOST}" 'node -' < "$SCRIPT_DIR/inspect-do-config.cjs"
