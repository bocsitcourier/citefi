#!/usr/bin/env bash
# Source on a GitHub runner only; pin verification precedes key material.
set -euo pipefail
umask 077
: "${DO_HOST:?Missing production host}"
: "${DO_SSH_HOST_FINGERPRINT:?Missing approved host pin}"
: "${DO_SSH_PRIVATE_KEY:?Missing SSH authentication key}"
RECOVERY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RECOVERY_TMP="$(mktemp -d)"
trap 'rm -rf "$RECOVERY_TMP"' EXIT
export KNOWN_HOSTS_FILE="$RECOVERY_TMP/known_hosts"
bash "$RECOVERY_ROOT/scripts/verify-ssh-host-key.sh"
KEY_FILE="$RECOVERY_TMP/key" python3 - <<'PY'
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
chmod 600 "$RECOVERY_TMP/key"
unset DO_SSH_PRIVATE_KEY
SSH=(ssh -i "$RECOVERY_TMP/key" -p 22 -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=15 -o LogLevel=ERROR "citefi@${DO_HOST}")
