#!/usr/bin/env bash
# Exercise the real fingerprint parser with disposable public-key fixtures.
# No production access, credentials, or SSH connection is needed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
ssh-keygen -q -t ed25519 -N '' -f "$tmp/host"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/other"
pin="$(ssh-keygen -lf "$tmp/host.pub" -E sha256 | awk '{print $2}')"
wrong="$(ssh-keygen -lf "$tmp/other.pub" -E sha256 | awk '{print $2}')"
# Only the public fixture is used by the verifier.
rm "$tmp/host" "$tmp/other"
printf 'example %s\n' "$(cat "$tmp/host.pub")" > "$tmp/scan"
cat > "$tmp/keyscan" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$SCAN_ARGS"
cat "$SCAN_OUTPUT"
exit "${SCAN_STATUS:-0}"
SH
chmod +x "$tmp/keyscan"
# Any accidental connection or key loading is a failure, not a real command.
mkdir -p "$tmp/bin"
for command in ssh scp sftp ssh-add; do
  cat > "$tmp/bin/$command" <<'SH'
#!/usr/bin/env bash
echo "forbidden transport/key command: $0" >> "$FORBIDDEN_COMMANDS"
exit 99
SH
  chmod +x "$tmp/bin/$command"
done
export PATH="$tmp/bin:$PATH" FORBIDDEN_COMMANDS="$tmp/forbidden"
export DO_HOST=example SSH_KEYSCAN_BIN="$tmp/keyscan"
export SCAN_OUTPUT="$tmp/scan" SCAN_ARGS="$tmp/args"
export KNOWN_HOSTS_FILE="$tmp/ssh/known_hosts"
verify() { bash "$ROOT/scripts/verify-ssh-host-key.sh"; }
DO_SSH_HOST_FINGERPRINT="$pin" verify
cmp "$tmp/scan" "$KNOWN_HOSTS_FILE"
test "$(stat -c %a "$KNOWN_HOSTS_FILE")" = 600
test "$(stat -c %a "$(dirname "$KNOWN_HOSTS_FILE")")" = 700
grep -q -- '-T 10 -t ed25519 -p 22 -H example' "$tmp/args"

reject() {
  local expected="$1"
  if verify >"$tmp/out" 2>"$tmp/err"; then
    echo "ERROR: invalid host verification succeeded" >&2; exit 1
  fi
  grep -q "$expected" "$tmp/err"
}
export DO_SSH_HOST_FINGERPRINT="$wrong"
reject 'SSH host fingerprint mismatch'
# A failed re-verification must not replace an existing trusted file.
cmp "$tmp/scan" "$KNOWN_HOSTS_FILE"
export KNOWN_HOSTS_FILE="$tmp/rejected/known_hosts"
reject 'SSH host fingerprint mismatch'
test ! -e "$KNOWN_HOSTS_FILE"
export DO_SSH_HOST_FINGERPRINT=''
rm -f "$SCAN_ARGS"
reject 'pin is missing'
test ! -e "$SCAN_ARGS"
test ! -e "$KNOWN_HOSTS_FILE"
export DO_SSH_HOST_FINGERPRINT='invalid'
reject 'must be an SHA256 fingerprint'
test ! -e "$SCAN_ARGS"
export DO_SSH_HOST_FINGERPRINT="$pin" SCAN_STATUS=1
reject 'host-key scan failed'
unset SCAN_STATUS
: > "$tmp/scan"
reject 'no SSH host keys'
printf 'example ssh-rsa invalid\n' > "$tmp/scan"
reject 'SSH host fingerprint mismatch'
test ! -e "$KNOWN_HOSTS_FILE"
test ! -e "$FORBIDDEN_COMMANDS"
echo 'SSH host-key success and fail-closed checks passed'