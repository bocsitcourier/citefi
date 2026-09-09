#!/usr/bin/env bash
# Restore a selected (or latest) backup into an existing, empty, disposable DB.
# This script never creates, drops, truncates, or overwrites a database.
set -euo pipefail
umask 077

ENV_FILE="${BACKUP_ENV_FILE:-/var/www/citefi/.env.local}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/citefi-db}"
SPACES_PREFIX="${BACKUP_SPACES_PREFIX:-db-backups}"
STATUS_FILE="${RESTORE_VERIFICATION_STATUS_FILE:-${BACKUP_DIR}/restore-verification-status.json}"
TARGET_MARKER="_restore_verify"
WORK_DIR=""
STATUS_TMP=""

cleanup() {
  [[ -z "$WORK_DIR" ]] || rm -rf "$WORK_DIR"
  [[ -z "$STATUS_TMP" ]] || rm -f "$STATUS_TMP"
}
trap cleanup EXIT

fail() {
  printf 'Restore verification refused or failed: %s\n' "$1" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "environment file is missing"

_load_var() {
  local var="$1"
  grep -E "^${var}=" "$ENV_FILE" | head -1 \
    | sed "s/^${var}=//" \
    | sed 's/[[:space:]]*#.*//' \
    | tr -d "'\""
}

SOURCE_DATABASE_URL="${DATABASE_URL:-$(_load_var DATABASE_URL)}"
TARGET_DATABASE_URL="${RESTORE_VERIFY_DATABASE_URL:-$(_load_var RESTORE_VERIFY_DATABASE_URL)}"
DO_SPACES_KEY="${DO_SPACES_KEY:-$(_load_var DO_SPACES_KEY)}"
DO_SPACES_SECRET="${DO_SPACES_SECRET:-$(_load_var DO_SPACES_SECRET)}"
DO_SPACES_ENDPOINT="${DO_SPACES_ENDPOINT:-$(_load_var DO_SPACES_ENDPOINT)}"
DO_SPACES_BUCKET="${DO_SPACES_BUCKET:-$(_load_var DO_SPACES_BUCKET)}"

: "${SOURCE_DATABASE_URL:?DATABASE_URL is required}"
: "${TARGET_DATABASE_URL:?RESTORE_VERIFY_DATABASE_URL is required}"
: "${DO_SPACES_KEY:?DO_SPACES_KEY is required}"
: "${DO_SPACES_SECRET:?DO_SPACES_SECRET is required}"
: "${DO_SPACES_ENDPOINT:?DO_SPACES_ENDPOINT is required}"
: "${DO_SPACES_BUCKET:?DO_SPACES_BUCKET is required}"
[[ -n "$TARGET_MARKER" ]] || fail "target naming marker must not be empty"
[[ "$SPACES_PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9/_-]*[A-Za-z0-9_-]$ ]] ||
  fail "backup prefix contains unsafe characters"
[[ "$SOURCE_DATABASE_URL" != "$TARGET_DATABASE_URL" ]] || fail "source and target URLs are identical"

export AWS_ACCESS_KEY_ID="$DO_SPACES_KEY"
export AWS_SECRET_ACCESS_KEY="$DO_SPACES_SECRET"
export AWS_DEFAULT_REGION="us-east-1"

# Ask PostgreSQL itself for identity; URI string differences must not bypass safety.
SOURCE_ID="$(psql "$SOURCE_DATABASE_URL" -XAtqc \
  "SELECT COALESCE(inet_server_addr()::text,'local') || ':' || inet_server_port() || '/' || current_database()")"
TARGET_ID="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT COALESCE(inet_server_addr()::text,'local') || ':' || inet_server_port() || '/' || current_database()")"
SOURCE_SERVER="$(psql "$SOURCE_DATABASE_URL" -XAtqc \
  "SELECT COALESCE(inet_server_addr()::text,'local') || ':' || inet_server_port()")"
TARGET_SERVER="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT COALESCE(inet_server_addr()::text,'local') || ':' || inet_server_port()")"
TARGET_NAME="$(psql "$TARGET_DATABASE_URL" -XAtqc "SELECT current_database()")"
[[ -n "$SOURCE_ID" && -n "$TARGET_ID" ]] || fail "could not establish database identities"
[[ "$SOURCE_ID" != "$TARGET_ID" ]] || fail "target resolves to the source database"
[[ "$SOURCE_SERVER" != "$TARGET_SERVER" ]] ||
  fail "target must be isolated on a different PostgreSQL server"
[[ "$TARGET_NAME" == *"$TARGET_MARKER"* ]] ||
  fail "target database name does not contain required safety marker"

# Never overwrite a prior restore. Operators must provision a fresh empty target.
PREEXISTING_TABLES="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
[[ "$PREEXISTING_TABLES" == "0" ]] ||
  fail "target contains user tables; provision a fresh disposable target"
ROLE_BOOTSTRAP_READY="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT CASE
     WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant')
       THEN NOT EXISTS (
         SELECT 1 FROM pg_roles
          WHERE rolname = 'citefi_tenant'
            AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolcanlogin)
       )
     ELSE (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user)
   END")"
[[ "$ROLE_BOOTSTRAP_READY" == "t" ]] ||
  fail "target connection cannot safely create or reuse citefi_tenant"

if [[ -n "${RESTORE_VERIFY_BACKUP_KEY:-}" ]]; then
  BACKUP_KEY="$RESTORE_VERIFY_BACKUP_KEY"
  BACKUP_NAME="${BACKUP_KEY#"${SPACES_PREFIX}/"}"
  [[ "$BACKUP_KEY" == "${SPACES_PREFIX}/${BACKUP_NAME}" &&
    "$BACKUP_NAME" =~ ^citefi_[0-9]{8}_[0-9]{6}\.sql\.gz$ ]] ||
    fail "selected backup key is outside the expected prefix or filename pattern"
else
  LATEST_NAME="$(aws s3 ls "s3://${DO_SPACES_BUCKET}/${SPACES_PREFIX}/" \
    --endpoint-url "$DO_SPACES_ENDPOINT" \
    | awk '{print $4}' \
    | grep -E '^citefi_[0-9]{8}_[0-9]{6}\.sql\.gz$' \
    | sort -r \
    | head -1)"
  [[ -n "$LATEST_NAME" ]] || fail "no eligible backup object was found"
  BACKUP_KEY="${SPACES_PREFIX}/${LATEST_NAME}"
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/citefi-restore-verify.XXXXXX")"
chmod 0700 "$WORK_DIR"
DUMP_PATH="${WORK_DIR}/restore.sql.gz"
aws s3 cp "s3://${DO_SPACES_BUCKET}/${BACKUP_KEY}" "$DUMP_PATH" \
  --endpoint-url "$DO_SPACES_ENDPOINT" --no-progress >/dev/null
gzip -t "$DUMP_PATH" || fail "downloaded object is not a valid gzip stream"

gzip -dc "$DUMP_PATH" | psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 >/dev/null

TABLE_COUNT="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
[[ "$TABLE_COUNT" =~ ^[0-9]+$ && "$TABLE_COUNT" -gt 0 ]] ||
  fail "restored database contains no user tables"
USERS_TABLE="$(psql "$TARGET_DATABASE_URL" -XAtqc "SELECT to_regclass('public.users') IS NOT NULL")"
[[ "$USERS_TABLE" == "t" ]] || fail "required public.users table is absent"
USER_COUNT="$(psql "$TARGET_DATABASE_URL" -XAtqc "SELECT count(*) FROM public.users")"
[[ "$USER_COUNT" =~ ^[0-9]+$ ]] || fail "users data check did not return a row count"
TENANT_ROLE_SAFE="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT EXISTS (
     SELECT 1 FROM pg_roles
      WHERE rolname = 'citefi_tenant'
        AND NOT rolsuper
        AND NOT rolbypassrls
        AND NOT rolcreaterole
   )")"
[[ "$TENANT_ROLE_SAFE" == "t" ]] ||
  fail "citefi_tenant role is missing or has privileged attributes"
TENANT_ROLE_MEMBERSHIP="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT pg_has_role(current_user, 'citefi_tenant', 'MEMBER')")"
[[ "$TENANT_ROLE_MEMBERSHIP" == "t" ]] ||
  fail "restore owner is not a member of citefi_tenant"
RLS_TABLE_COUNT="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity")"
[[ "$RLS_TABLE_COUNT" =~ ^[0-9]+$ && "$RLS_TABLE_COUNT" -gt 0 ]] ||
  fail "restored schema has no RLS-enabled public tables"
TENANT_POLICY_COUNT="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND 'citefi_tenant' = ANY(roles)")"
[[ "$TENANT_POLICY_COUNT" =~ ^[0-9]+$ && "$TENANT_POLICY_COUNT" -gt 0 ]] ||
  fail "restored schema has no citefi_tenant row policies"
TENANT_GRANTS_OK="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT bool_and(has_table_privilege('citefi_tenant', 'public.' || table_name, 'SELECT'))
     FROM (VALUES ('teams'), ('team_members'), ('articles')) AS required(table_name)")"
[[ "$TENANT_GRANTS_OK" == "t" ]] ||
  fail "citefi_tenant is missing required restored table grants"
TENANT_SCHEMA_GRANTS_OK="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT has_schema_privilege('citefi_tenant', 'public', 'USAGE')
      AND has_schema_privilege('citefi_tenant', 'citefi_rls', 'USAGE')")"
[[ "$TENANT_SCHEMA_GRANTS_OK" == "t" ]] ||
  fail "citefi_tenant is missing required schema grants"
TENANT_SEQUENCE_GRANTS_OK="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT bool_and(
       has_sequence_privilege('citefi_tenant', quote_ident(n.nspname) || '.' || quote_ident(c.relname), 'USAGE,SELECT')
     )
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'")"
[[ "$TENANT_SEQUENCE_GRANTS_OK" == "t" ]] ||
  fail "citefi_tenant is missing restored sequence grants"
TENANT_FUNCTION_GRANTS_OK="$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "SELECT bool_and(has_function_privilege('citefi_tenant', p.oid, 'EXECUTE'))
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'citefi_rls'")"
[[ "$TENANT_FUNCTION_GRANTS_OK" == "t" ]] ||
  fail "citefi_tenant is missing restored RLS helper grants"

# Publish only successful, credential-free evidence, and never expose partial JSON.
mkdir -p "$(dirname "$STATUS_FILE")"
STATUS_TMP="${STATUS_FILE}.tmp.$$"
printf '{"state":"success","completedAt":"%s","backupObject":"%s","targetDatabase":"%s","schemaTableCount":%s,"userRowCount":%s,"rlsTableCount":%s,"tenantPolicyCount":%s,"tenantRoleSafe":true,"tenantRoleMembership":true,"tenantGrantsVerified":true}\n' \
  "$(date -u +%FT%TZ)" "$BACKUP_KEY" "$TARGET_NAME" "$TABLE_COUNT" "$USER_COUNT" \
  "$RLS_TABLE_COUNT" "$TENANT_POLICY_COUNT" > "$STATUS_TMP"
chmod 0644 "$STATUS_TMP"
mv -f "$STATUS_TMP" "$STATUS_FILE"
STATUS_TMP=""
printf 'Restore verification succeeded for %s using %s\n' "$TARGET_NAME" "$BACKUP_KEY"