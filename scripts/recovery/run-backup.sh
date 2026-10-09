#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT=/var/www/citefi/ops-recovery
export PATH="$ROOT/bin:$PATH"
export BACKUP_DIR="$ROOT/backups"
export BACKUP_STATUS_FILE="$ROOT/backups/status.json"
export BACKUP_PRESERVE_ALL=true
bash "$ROOT/db-backup.sh"
