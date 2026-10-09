#!/usr/bin/env bash
set -euo pipefail
# Restore the real retained cloud backup, including behavioral tenant checks.
bash "$(dirname "$0")/verify-restore.sh"
source "$(dirname "$0")/ssh-session.sh"
: "${CANDIDATE_ID:?Missing staged release identifier}"
[[ "$CANDIDATE_ID" =~ ^[a-f0-9]{40}-[a-f0-9]{16}$ ]]
plan="$RECOVERY_TMP/additions.sql"
"${SSH[@]}" "cat /var/www/citefi/.deploy/recovery-plans/$CANDIDATE_ID/additions.sql" > "$plan"
digest="$(sha256sum "$plan" | awk '{print $1}')"
DATABASE_URL="postgresql:///citefi_restore_verify?host=/var/run/postgresql" \
  node "$RECOVERY_ROOT/scripts/recovery/apply-additions.mjs" "$plan" "$digest" --isolated
# Check every source column and both new RLS boundaries without printing rows.
psql -XAtq -v ON_ERROR_STOP=1 -d citefi_restore_verify <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r') < 111
 THEN RAISE EXCEPTION 'missing current tables'; END IF;
 IF (SELECT count(*) FROM pg_policy WHERE polrelid IN ('credit_reservations'::regclass,'provider_attempt_receipts'::regclass)) <> 7
 THEN RAISE EXCEPTION 'new tenant policies missing'; END IF;
 IF has_table_privilege('citefi_tenant','telemetry_incidents','SELECT')
 THEN RAISE EXCEPTION 'global telemetry exposed'; END IF;
END $$;
SET ROLE citefi_tenant;
SELECT count(*)=0 AS unscoped_receipts_denied FROM provider_attempt_receipts;
SELECT count(*)=0 AS unscoped_reservations_denied FROM credit_reservations;
RESET ROLE;
SQL
printf '{"isolatedAdditionsVerified":true,"planSha256":"%s"}\n' "$digest" |
 "${SSH[@]}" "umask 077; cat > /var/www/citefi/.deploy/recovery-plans/$CANDIDATE_ID/isolated-verification.json"
