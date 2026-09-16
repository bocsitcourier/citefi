#!/usr/bin/env bash
# Isolated PostgreSQL fixture: never uses the application's DATABASE_URL.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d)"
cleanup() {
  pg_ctl -D "$fixture/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$fixture"
}
trap cleanup EXIT
initdb -D "$fixture/data" -A trust -U receipt_test >/dev/null
pg_ctl -D "$fixture/data" -l "$fixture/postgres.log" \
  -o "-k $fixture -p 55479 -c listen_addresses=''" -w start >/dev/null
psql=(psql -X -v ON_ERROR_STOP=1 -h "$fixture" -p 55479 -U receipt_test postgres)
"${psql[@]}" >/dev/null <<'SQL'
CREATE ROLE citefi_tenant;
CREATE SCHEMA citefi_rls;
GRANT USAGE ON SCHEMA citefi_rls TO citefi_tenant;
CREATE FUNCTION citefi_rls.tenant_can_access(t integer) RETURNS boolean LANGUAGE sql AS
  $$ SELECT t = current_setting('citefi.team_id', true)::integer $$;
CREATE FUNCTION citefi_rls.is_client_viewer() RETURNS boolean LANGUAGE sql AS
  $$ SELECT current_setting('citefi.member_role', true) = 'client_viewer' $$;
CREATE TABLE teams(id integer PRIMARY KEY);
CREATE TABLE users(id integer PRIMARY KEY);
CREATE TABLE campaigns(team_id integer, id integer, UNIQUE(team_id,id));
INSERT INTO teams VALUES(1),(2);
INSERT INTO campaigns VALUES(1,11),(2,22);
SQL
"${psql[@]}" -f "$root/migrations/0034_provider_attempt_receipts.sql" >/dev/null
"${psql[@]}" -f "$root/migrations/0034_provider_attempt_receipts.sql" >/dev/null
"${psql[@]}" >/dev/null <<'SQL'
SET ROLE citefi_tenant;
SET citefi.team_id = '1';
SET citefi.member_role = 'admin';
INSERT INTO provider_attempt_receipts(source_event_id,team_id,campaign_id,operation_type,provider,model,request_metadata)
VALUES('receipt-fixture',1,11,'article_generation','gemini','fixture-model','{}');
DO $$
BEGIN
  BEGIN
    INSERT INTO provider_attempt_receipts(source_event_id,team_id,operation_type,provider,model,request_metadata)
    VALUES('cross-team',2,'article_generation','gemini','fixture-model','{}');
    RAISE EXCEPTION 'Cross-team receipt unexpectedly admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO provider_attempt_receipts(source_event_id,team_id,campaign_id,operation_type,provider,model,request_metadata)
    VALUES('wrong-campaign',1,22,'article_generation','gemini','fixture-model','{}');
    RAISE EXCEPTION 'Cross-team campaign unexpectedly admitted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
SET citefi.team_id = '2';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM provider_attempt_receipts) THEN
    RAISE EXCEPTION 'Receipt exposed across tenant boundary';
  END IF;
END $$;
SET citefi.team_id = '1';
SET citefi.member_role = 'client_viewer';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM provider_attempt_receipts) THEN
    RAISE EXCEPTION 'Financial receipt exposed to client viewer';
  END IF;
END $$;
SQL
echo "PASS: receipt migration is repeatable, tenant-isolated, and client-viewer restricted"