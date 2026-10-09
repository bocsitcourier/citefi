#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/ssh-session.sh"
: "${CANDIDATE_ID:?Select the validated staged candidate}"
[[ "$CANDIDATE_ID" =~ ^[a-f0-9]{40}-[a-f0-9]{16}$ ]]
"${SSH[@]}" 'umask 077; mkdir -p /var/www/citefi/.deploy/recovery-tools; tar -xf - -C /var/www/citefi/.deploy/recovery-tools' < <(
  tar -C "$RECOVERY_ROOT" -cf - scripts/recovery scripts/host-release.sh
)
"${SSH[@]}" "env CANDIDATE_ID=$CANDIDATE_ID bash -s" <<'SH'
set -euo pipefail
root=/var/www/citefi
candidate="$root/releases/$CANDIDATE_ID"
plan="$root/.deploy/recovery-plans/$CANDIDATE_ID"
test -s "$candidate/.next/BUILD_ID"
test "$(cat "$candidate/.release-sha")" = "${CANDIDATE_ID%-*}"
umask 077
mkdir -p "$plan"
cd "$candidate"
node --env-file=.env.local --import tsx/esm scripts/recovery/schema-diff.ts > "$plan/schema.json"
node "$root/.deploy/recovery-tools/scripts/recovery/plan-additions.mjs" .recovery-schema.sql "$plan/schema.json" "$plan/additions.sql"
cat "$plan/additions.sql"
SH
