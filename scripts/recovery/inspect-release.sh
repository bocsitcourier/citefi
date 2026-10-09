#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/ssh-session.sh"
"${SSH[@]}" 'cd /var/www/citefi; node --env-file=.env.local --input-type=module -' \
  < "$RECOVERY_ROOT/scripts/recovery/inspect-release.mjs"
