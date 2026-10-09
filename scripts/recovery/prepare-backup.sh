#!/usr/bin/env bash
# Approved system team + user-owned nondeleting backup tooling, not deployment.
set -euo pipefail
source "$(dirname "$0")/ssh-session.sh"
"${SSH[@]}" 'set -eu; test "$(id -un)" = citefi; pg_dump --version; psql --version; test -r /var/www/citefi/.env.local; mkdir -p /var/www/citefi/ops-recovery/bin'
tar -C "$RECOVERY_ROOT" -czf "$RECOVERY_TMP/backup-tooling.tgz" \
  scripts/db-backup.sh scripts/recovery/spaces-cli.mjs scripts/recovery/provision.mjs \
  scripts/recovery/run-backup.sh scripts/recovery/aws scripts/recovery/backup-metadata.mjs
"${SSH[@]}" 'umask 077; mkdir -p /var/www/citefi/ops-recovery/tooling; tar -xzf - -C /var/www/citefi/ops-recovery/tooling' < "$RECOVERY_TMP/backup-tooling.tgz"
"${SSH[@]}" 'set -eu; umask 077
root=/var/www/citefi/ops-recovery
install -m 600 "$root/tooling/scripts/recovery/spaces-cli.mjs" "$root/spaces-cli.mjs"
install -m 600 "$root/tooling/scripts/recovery/provision.mjs" "$root/provision.mjs"
install -m 600 "$root/tooling/scripts/recovery/backup-metadata.mjs" "$root/backup-metadata.mjs"
install -m 700 "$root/tooling/scripts/recovery/aws" "$root/bin/aws"
install -m 700 "$root/tooling/scripts/recovery/run-backup.sh" "$root/run-backup.sh"
install -m 700 "$root/tooling/scripts/db-backup.sh" "$root/db-backup.sh"
cd /var/www/citefi
node --env-file=.env.local "$root/provision.mjs"
if ! flock -n "$root/backup.lock" bash "$root/run-backup.sh" > "$root/backup.log" 2>&1; then
  echo "Backup failed; private host log retained without exposing data." >&2
  exit 1
fi
node "$root/backup-metadata.mjs"'
