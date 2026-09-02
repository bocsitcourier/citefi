#!/usr/bin/env bash
# Fetch a host key only to compare it with an independently supplied pin.
# Nothing is trusted or written until at least one key matches the pin.
set -euo pipefail

: "${DO_HOST:?DO_HOST env var is missing}"
: "${DO_SSH_HOST_FINGERPRINT:?DO_SSH_HOST_FINGERPRINT pin is missing (expected SHA256:...)}"
DO_PORT="${DO_PORT:-22}"
KNOWN_HOSTS_FILE="${KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
SSH_KEYSCAN_BIN="${SSH_KEYSCAN_BIN:-ssh-keyscan}"
SSH_KEYGEN_BIN="${SSH_KEYGEN_BIN:-ssh-keygen}"

[[ "$DO_SSH_HOST_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]{20,}={0,2}$ ]] || {
  echo "ERROR: DO_SSH_HOST_FINGERPRINT must be an SHA256 fingerprint." >&2
  exit 64
}

tmp="$(mktemp)"
verified="$(mktemp)"
trap 'rm -f "$tmp" "$verified"' EXIT
"$SSH_KEYSCAN_BIN" -p "$DO_PORT" -H "$DO_HOST" >"$tmp" 2>/dev/null
[[ -s "$tmp" ]] || { echo "ERROR: no SSH host keys were returned." >&2; exit 1; }

matched=false
while IFS= read -r line; do
  fingerprint="$(printf '%s\n' "$line" | "$SSH_KEYGEN_BIN" -lf - -E sha256 2>/dev/null | awk '{print $2}')" || true
  if [[ "$fingerprint" == "$DO_SSH_HOST_FINGERPRINT" ]]; then
    matched=true
    printf '%s\n' "$line" >>"$verified"
  fi
done <"$tmp"
[[ "$matched" == true ]] || {
  echo "ERROR: SSH host fingerprint mismatch for $DO_HOST; refusing connection." >&2
  exit 1
}

mkdir -p "$(dirname "$KNOWN_HOSTS_FILE")"
chmod 700 "$(dirname "$KNOWN_HOSTS_FILE")"
install -m 600 "$verified" "$KNOWN_HOSTS_FILE"