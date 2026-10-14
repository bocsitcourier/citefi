#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/ssh-session.sh"
: "${CANDIDATE_ID:?Missing validated staged release}"
[[ "$CANDIDATE_ID" =~ ^[a-f0-9]{40}-[a-f0-9]{16}$ ]]
[[ "${PROTECT_LEGACY_HOLD:-}" == true ]]
"${SSH[@]}" 'umask 077; mkdir -p /var/www/citefi/.deploy/recovery-tools; tar -xf - -C /var/www/citefi/.deploy/recovery-tools' < <(
 tar -C "$RECOVERY_ROOT" -cf - scripts/recovery scripts/host-release.sh
)
"${SSH[@]}" "env CANDIDATE_ID=$CANDIDATE_ID PROTECT_LEGACY_HOLD=true bash -s" < "$RECOVERY_ROOT/scripts/recovery/host-activate.sh"
