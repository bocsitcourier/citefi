#!/usr/bin/env bash
# Only local runner files are created. The remote payload performs bounded reads.
set -euo pipefail
: "${DO_HOST:?Missing production host}"
: "${DO_SSH_HOST_FINGERPRINT:?Missing approved host pin}"
: "${DO_SSH_PRIVATE_KEY:?Missing SSH authentication key}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export KNOWN_HOSTS_FILE="$work/known_hosts"
# Verify before loading a private key; never use accept-new or bypass checking.
bash "$ROOT/scripts/verify-ssh-host-key.sh"
KEY_FILE="$work/key" python3 - <<'PY'
import os, re
raw = os.environ["DO_SSH_PRIVATE_KEY"]
raw = re.sub(r"-----BEGIN ([^-]+)-----\s*", r"-----BEGIN \1-----\n", raw)
raw = re.sub(r"\s*-----END ([^-]+)-----", r"\n-----END \1-----\n", raw)
lines = []
for line in raw.splitlines():
    lines.extend([line] if "-----" in line else line.split())
with open(os.environ["KEY_FILE"], "w") as f:
    f.write("\n".join(lines) + "\n")
PY
chmod 600 "$work/key"
unset DO_SSH_PRIVATE_KEY
ssh -i "$work/key" -p 22 -o BatchMode=yes -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS_FILE" \
  -o ConnectTimeout=15 -o LogLevel=ERROR "citefi@${DO_HOST}" \
  'python3 -' < "$ROOT/scripts/production-diagnostics.py"
