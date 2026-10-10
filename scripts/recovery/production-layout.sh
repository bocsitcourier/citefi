#!/usr/bin/env bash
set -euo pipefail
case "${PRODUCTION_LAYOUT_OPERATION:-}" in
  inspect|prepare|finalize) operation="$PRODUCTION_LAYOUT_OPERATION" ;;
  *) echo "Only fixed production layout operations are allowed" >&2; exit 64 ;;
esac
source "$(dirname "$0")/ssh-session.sh"
case "$operation" in
  inspect) "${SSH[@]}" 'python3 - inspect' < "$RECOVERY_ROOT/scripts/recovery/production-layout.py" ;;
  prepare) "${SSH[@]}" 'python3 - prepare' < "$RECOVERY_ROOT/scripts/recovery/production-layout.py" ;;
  finalize) "${SSH[@]}" 'python3 - finalize' < "$RECOVERY_ROOT/scripts/recovery/production-layout.py" ;;
esac
