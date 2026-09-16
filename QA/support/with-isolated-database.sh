#!/usr/bin/env bash
#
# Start a disposable PostgreSQL fixture, compose the application schema from
# the checked-in Drizzle source plus the checked-in security migrations, run the
# catalog gate, and optionally run one batch of Node tests against that fixture.
#
# Safety properties:
#   * DATABASE_URL/NEON_DATABASE_URL from the caller are discarded.
#   * The server is owned by this process, binds only to 127.0.0.1:55481, and
#     uses a fixture-local Unix socket directory.
#   * No .env file is loaded and no password is put in the fixture URL.
#   * The EXIT trap stops only this cluster and removes only its temp directory.
#
# Usage:
#   QA/support/with-isolated-database.sh
#   QA/support/with-isolated-database.sh --with-redis -- tests/pipeline/restart-crash-boundaries.test.ts
#   QA/support/with-isolated-database.sh --receipt-migration-fixture -- tests/qa/provider-receipt-durability.integration.test.ts
#   QA/support/with-isolated-database.sh -- tests/auth/auth-api.test.ts \
#     tests/security/tenant-rls.test.ts
#
# Arguments after `--` are one shared `node --test` invocation. Keeping the
# files in one invocation avoids rebuilding the database once per suite.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PORT=55481
REDIS_PORT=16389
DB_USER="qa_owner"
DB_NAME="citefi_qa"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/citefi-isolated-qa.XXXXXX")"
PGDATA="$FIXTURE_ROOT/data"
SOCKET_DIR="$FIXTURE_ROOT/socket"
PGLOG="$FIXTURE_ROOT/postgres.log"
FIXTURE_URL="postgresql://${DB_USER}@127.0.0.1:${PORT}/${DB_NAME}"
PG_STARTED=0
REDIS_STARTED=0
REDIS_PID=""
WITH_REDIS=0
WITH_RECEIPT_MIGRATION_FIXTURE=0

# Do not allow client-side libpq defaults, NODE_OPTIONS, proxies, or an
# application's credentials to influence any command in this script. These
# unsets affect this child shell only; the parent shell is unchanged.
unset \
  DATABASE_URL NEON_DATABASE_URL \
  PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGSSLMODE \
  NODE_OPTIONS HTTP_PROXY HTTPS_PROXY ALL_PROXY \
  OPENAI_API_KEY GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_GENERATIVE_AI_API_KEY \
  BRAVE_API_KEY BRAVE_SEARCH_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
  RESEND_API_KEY SENDGRID_API_KEY SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD \
  SMTP_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN \
  AWS_PROFILE AWS_DEFAULT_PROFILE GOOGLE_APPLICATION_CREDENTIALS \
  2>/dev/null || true

cleanup() {
  local status=$?
  if [[ "$PG_STARTED" == "1" ]]; then
    # This path was created by this invocation; never discover or stop a
    # process outside it.
    pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
    echo "isolated PostgreSQL: cleanup complete (owned cluster stopped; active fixture connections=0)"
  fi
  if [[ "$REDIS_STARTED" == "1" ]]; then
    kill "$REDIS_PID" >/dev/null 2>&1 || true
    wait "$REDIS_PID" >/dev/null 2>&1 || true
    echo "isolated Redis: cleanup complete (owned process stopped; port=${REDIS_PORT})"
  fi
  rm -rf -- "$FIXTURE_ROOT"
  exit "$status"
}
trap cleanup EXIT

die() {
  echo "isolated PostgreSQL QA harness: $*" >&2
  exit 1
}

usage() {
  sed -n '1,35p' "$0"
}

need_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "required local tool is missing: $1 (nothing was installed)"
}

for command_name in initdb pg_ctl psql node; do
  need_command "$command_name"
done
[[ -x "$ROOT/node_modules/.bin/drizzle-kit" ]] ||
  die "local node_modules/.bin/drizzle-kit is missing; refusing a network install"

test_args=()
while (($#)); do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --with-redis)
      WITH_REDIS=1
      shift
      ;;
    --receipt-migration-fixture)
      WITH_RECEIPT_MIGRATION_FIXTURE=1
      shift
      ;;
    --)
      shift
      test_args=("$@")
      break
      ;;
    *)
      die "unknown harness option '$1'; put test files after --"
      ;;
  esac
done

if [[ "$WITH_REDIS" == "1" ]]; then
  need_command redis-server
fi

# A listener check is deliberately done before initdb/pg_ctl. If ss is not
# available, a local TCP connect is used only as a non-destructive probe.
port_in_use() {
  local check_port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :${check_port}" 2>/dev/null | grep -q .
    return $?
  fi

  node - "$check_port" <<'NODE'
const net = require("node:net");
const port = Number(process.argv[2]);
let finished = false;
const socket = net.createConnection({ host: "127.0.0.1", port });
const finish = (code) => {
  if (finished) return;
  finished = true;
  socket.destroy();
  process.exit(code);
};
socket.once("connect", () => finish(0));
socket.once("error", () => finish(1));
setTimeout(() => finish(1), 500);
NODE
}

if port_in_use "$PORT"; then
  die "TCP port ${PORT} is already in use; refusing to connect to or stop it"
fi
if [[ "$WITH_REDIS" == "1" ]] && port_in_use "$REDIS_PORT"; then
  die "TCP port ${REDIS_PORT} is already in use; refusing to connect to or stop it"
fi

mkdir -p "$SOCKET_DIR"
initdb -D "$PGDATA" -A trust -U "$DB_USER" --no-locale --encoding=UTF8 \
  >"$FIXTURE_ROOT/initdb.log" 2>&1 ||
  die "initdb failed; see $FIXTURE_ROOT/initdb.log"

PG_STARTED=1
pg_ctl -D "$PGDATA" -l "$PGLOG" \
  -o "-h 127.0.0.1 -k $SOCKET_DIR -p $PORT -c listen_addresses=127.0.0.1" \
  -w start >/dev/null ||
  die "pg_ctl could not start the owned fixture; see $PGLOG"

if [[ "$WITH_REDIS" == "1" ]]; then
  redis-server \
    --bind 127.0.0.1 \
    --port "$REDIS_PORT" \
    --save "" \
    --appendonly no \
    --daemonize no \
    >"$FIXTURE_ROOT/redis.log" 2>&1 &
  REDIS_PID=$!
  REDIS_STARTED=1
  for _ in {1..40}; do
    if port_in_use "$REDIS_PORT"; then
      break
    fi
    if ! kill -0 "$REDIS_PID" >/dev/null 2>&1; then
      die "owned Redis fixture exited; see $FIXTURE_ROOT/redis.log"
    fi
    sleep 0.05
  done
  port_in_use "$REDIS_PORT" ||
    die "owned Redis fixture did not listen on 127.0.0.1:${REDIS_PORT}"
  echo "isolated Redis: owned fixture ready on 127.0.0.1:${REDIS_PORT}"
fi

PSQL=(psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$DB_USER")
"${PSQL[@]}" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}" >/dev/null

SAFE_ENV=(
  env
  -i
  "PATH=${PATH:-/usr/bin:/bin}"
  "HOME=${HOME:-$FIXTURE_ROOT/home}"
  "DATABASE_URL=${FIXTURE_URL}"
  "NEON_DATABASE_URL=${FIXTURE_URL}"
  # Some provider-backed modules construct SDK clients at import time even
  # when the child test injects a deterministic provider seam.  This is an
  # intentionally unusable QA sentinel, not a credential; the offline guard
  # still rejects every provider/network request.
  "OPENAI_API_KEY=qa-isolated-disabled-openai"
  "GEMINI_API_KEY=qa-isolated-disabled-gemini"
)
if [[ "$WITH_REDIS" == "1" ]]; then
  SAFE_ENV+=("REDIS_URL=redis://127.0.0.1:${REDIS_PORT}/0")
fi

echo "isolated PostgreSQL: composing source schema on 127.0.0.1:${PORT}"
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

DDL_FILE="$FIXTURE_ROOT/source-schema.sql"
if ! "${SAFE_ENV[@]}" "$ROOT/node_modules/.bin/drizzle-kit" export \
  --dialect postgresql --schema "$ROOT/shared/schema.ts" --sql >"$DDL_FILE"; then
  die "Drizzle source-schema export failed; no application database was contacted"
fi
[[ -s "$DDL_FILE" ]] || die "Drizzle source-schema export was empty"

# The current declarative source does not express the composite keys required
# by the checked-in agency-report and campaign migrations' child FKs.
# PostgreSQL rejects the otherwise-valid export before those migrations can
# install their keys. Add the prerequisites only to this ephemeral DDL stream;
# do not alter shared/schema.ts or any versioned migration/checksum.
PATCHED_DDL_FILE="$FIXTURE_ROOT/source-schema-with-prerequisites.sql"
if ! awk '
  !inserted && /^ALTER TABLE .* ADD CONSTRAINT/ {
    print "DO $fixture_schema$"
    print "BEGIN"
    print "  IF NOT EXISTS ("
    print "    SELECT 1 FROM pg_constraint"
    print "    WHERE conname = '\''qa_agency_client_reports_fk_key'\''"
    print "      AND conrelid = '\''public.agency_client_reports'\''::regclass"
    print "  ) THEN"
    print "    ALTER TABLE agency_client_reports"
    print "      ADD CONSTRAINT qa_agency_client_reports_fk_key"
    print "      UNIQUE (id, agency_team_id, client_team_id);"
    print "  END IF;"
    print "END"
    print "$fixture_schema$;"
    print "DO $fixture_schema$"
    print "BEGIN"
    print "  IF NOT EXISTS ("
    print "    SELECT 1 FROM pg_constraint"
    print "    WHERE conname = '\''qa_campaigns_fk_key'\''"
    print "      AND conrelid = '\''public.campaigns'\''::regclass"
    print "  ) THEN"
    print "    ALTER TABLE campaigns"
    print "      ADD CONSTRAINT qa_campaigns_fk_key"
    print "      UNIQUE (team_id, id);"
    print "  END IF;"
    print "END"
    print "$fixture_schema$;"
    print "DO $fixture_schema$"
    print "BEGIN"
    print "  IF NOT EXISTS ("
    print "    SELECT 1 FROM pg_constraint"
    print "    WHERE conname = '\''qa_campaign_ads_fk_key'\''"
    print "      AND conrelid = '\''public.campaign_ads'\''::regclass"
    print "  ) THEN"
    print "    ALTER TABLE campaign_ads"
    print "      ADD CONSTRAINT qa_campaign_ads_fk_key"
    print "      UNIQUE (team_id, id);"
    print "  END IF;"
    print "END"
    print "$fixture_schema$;"
    inserted = 1
  }
  /^CREATE INDEX "telemetry_ai_requests_admin_incident_created_idx"/ {
    print "CREATE INDEX \"telemetry_ai_requests_admin_incident_created_idx\" ON \"telemetry_ai_requests\" USING btree (\"admin_user_id\",\"incident_id\",\"created_at\" DESC);"
    next
  }
  { print }
  END {
    if (!inserted) exit 1
  }
' "$DDL_FILE" >"$PATCHED_DDL_FILE"; then
  die "source-schema export has no FK section where the agency-report prerequisite can be staged"
fi
if ! "${PSQL[@]}" -d "$DB_NAME" -f "$PATCHED_DDL_FILE" >/dev/null; then
  die "source-schema DDL could not apply; no application database was contacted"
fi

apply_sql_file() {
  local migration="$1"
  echo "isolated PostgreSQL: applying ${migration}"
  if ! "${PSQL[@]}" -d "$DB_NAME" -f "$ROOT/migrations/$migration"; then
    die "baseline composition stopped at ${migration}; inspect that migration's exact prerequisite above (no app DB workaround)"
  fi
}

run_migration_script() {
  local script="$1"
  echo "isolated PostgreSQL: running canonical ${script}"
  if ! "${SAFE_ENV[@]}" WORKER_PROCESS=true node --import tsx/esm "$ROOT/scripts/$script"; then
    die "baseline composition stopped in ${script}; inspect the exact migration prerequisite above (no app DB workaround)"
  fi
}

# These are the same ordered security/bootstrap migrations used by the release
# setup.  0016/0017 have no separate TypeScript wrapper, so their checked-in
# SQL is applied directly.  The source export already contains their current
# table shapes; these files add the canonical roles, grants, triggers, and RLS.
run_migration_script "apply-tenant-rls.ts"
run_migration_script "migrate-t151-campaigns.ts"
apply_sql_file "0016_campaign_ads.sql"
apply_sql_file "0017_provider_usage_ledger.sql"
run_migration_script "migrate-t154-agency-reports.ts"

# Keep versioned migration bytes/checksums untouched. The production ordering
# records the tracked post-bootstrap migrations in the checksum ledger starting
# at 0020; 0014/0015/0019 are represented by their canonical bootstrap scripts.
echo "isolated PostgreSQL: applying tracked migrations from 0020"
if ! "${SAFE_ENV[@]}" WORKER_PROCESS=true MIGRATION_START_VERSION=0020 \
  node --import tsx/esm "$ROOT/scripts/run-versioned-migrations.ts"; then
  die "versioned migration baseline could not compose; report the exact missing migration prerequisite above (no app DB workaround)"
fi

# Minimal deterministic tenant rows let the RLS suite exercise two active
# memberships. They contain no passwords, tokens, provider credentials, or
# customer data; all email addresses are reserved .invalid addresses.
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
\set ON_ERROR_STOP on
INSERT INTO users (email, role, account_status, email_verified, full_name)
VALUES ('qa-baseline-a@citefi.invalid', 'team_member', 'active', 1, 'QA Tenant A')
RETURNING id AS id \gset qa_user_a_
INSERT INTO teams (name, created_by, client_status)
VALUES ('QA Isolated Tenant A', :qa_user_a_id, 'active')
RETURNING id AS id \gset qa_team_a_
UPDATE users SET default_team_id = :qa_team_a_id WHERE id = :qa_user_a_id;
INSERT INTO team_members (team_id, user_id, role)
VALUES (:qa_team_a_id, :qa_user_a_id, 'admin');

INSERT INTO users (email, role, account_status, email_verified, full_name)
VALUES ('qa-baseline-b@citefi.invalid', 'team_member', 'active', 1, 'QA Tenant B')
RETURNING id AS id \gset qa_user_b_
INSERT INTO teams (name, created_by, client_status)
VALUES ('QA Isolated Tenant B', :qa_user_b_id, 'active')
RETURNING id AS id \gset qa_team_b_
UPDATE users SET default_team_id = :qa_team_b_id WHERE id = :qa_user_b_id;
INSERT INTO team_members (team_id, user_id, role)
VALUES (:qa_team_b_id, :qa_user_b_id, 'admin');
SQL

# This is the only readiness claim emitted by the harness, and it follows
# catalog assertions against the live fixture. It intentionally does not run
# application tests or claim provider/email/publishing coverage.
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
\set ON_ERROR_STOP on
DO $$
DECLARE
  table_name text;
  policy_count integer;
  migration_count integer;
  required_tables text[] := ARRAY[
    'users', 'teams', 'team_members', 'sessions', 'password_resets',
    'email_verification_codes', 'login_challenges', 'totp_secrets',
    'credit_balances', 'credit_ledger', 'credit_reservations',
    'campaigns', 'campaign_ads', 'campaign_ad_approvals',
    'provider_rates', 'provider_rate_versions', 'provider_usage_ledger',
    'provider_attempt_receipts', 'agency_client_reports',
    'agency_report_configs', 'agency_report_deliveries',
    'agency_report_financial_snapshots'
  ];
  tracked_versions text[] := ARRAY[
    '0020_incident_intelligence.sql',
    '0021_incident_intelligence_hardening.sql',
    '0022_billing_integrity.sql',
    '0023_auth_login_challenges.sql',
    '0024_pipeline_delivery_settlement.sql',
    '0025_credit_reservation_tenant_access.sql',
    '0026_totp_setup_login_challenges.sql',
    '0027_campaign_public_id_constraints.sql',
    '0028_legacy_unique_constraint_names.sql',
    '0029_incident_schema_constraints.sql',
    '0030_reservation_run_arbiter.sql',
    '0031_generation_rls_drift_repair.sql',
    '0032_reservation_reconciliation_hold.sql',
    '0033_video_idea_billing.sql',
    '0034_agency_report_period_unique.sql',
    '0034_provider_attempt_receipts.sql',
    '0035_provider_attempt_receipt_state_hardening.sql'
  ];
BEGIN
  IF current_database() <> 'citefi_qa'
     OR inet_server_addr() <> '127.0.0.1'::inet
     OR current_setting('port') <> '55481' THEN
    RAISE EXCEPTION 'fixture identity mismatch: db %, address %, port %',
      current_database(), inet_server_addr(), current_setting('port');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant') THEN
    RAISE EXCEPTION 'missing citefi_tenant role';
  END IF;
  IF NOT has_schema_privilege('citefi_tenant', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'citefi_tenant lacks public schema usage';
  END IF;

  FOREACH table_name IN ARRAY required_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'missing required source/migration table: %', table_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'one or more policy tables are not ENABLE + FORCE RLS';
  END IF;

  SELECT count(*) INTO policy_count
  FROM pg_policy
  WHERE polrelid = 'public.provider_attempt_receipts'::regclass;
  IF policy_count <> 3 THEN
    RAISE EXCEPTION 'provider_attempt_receipts catalog has % policies, expected 3', policy_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.provider_attempt_receipts'::regclass
      AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'provider_attempt_receipts is not ENABLE + FORCE RLS';
  END IF;
  IF NOT has_table_privilege('citefi_tenant', 'public.provider_attempt_receipts', 'SELECT') THEN
    RAISE EXCEPTION 'citefi_tenant lacks provider_attempt_receipts SELECT grant';
  END IF;
  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.provider_attempt_receipts'::regclass
      AND conname IN (
        'provider_attempt_receipts_attempt_check',
        'provider_attempt_receipts_status_check',
        'provider_attempt_receipts_usage_status_check'
      )
      AND contype = 'c' AND convalidated
  ) <> 3 THEN
    RAISE EXCEPTION 'provider_attempt_receipts state checks are incomplete';
  END IF;

  SELECT count(*) INTO migration_count
  FROM citefi_schema_migrations
  WHERE version = ANY (tracked_versions);
  IF migration_count <> cardinality(tracked_versions) THEN
    RAISE EXCEPTION 'tracked migration ledger has %, expected % entries',
      migration_count, cardinality(tracked_versions);
  END IF;

  IF EXISTS (
    SELECT 1 FROM users
    WHERE email NOT LIKE '%@citefi.invalid'
  ) THEN
    RAISE EXCEPTION 'fixture contains a non-QA user email';
  END IF;
END
$$;
SQL

echo "PASS: isolated schema catalog verified (database=${DB_NAME} host=127.0.0.1 port=${PORT}; no app DB touched)"

if [[ "$WITH_RECEIPT_MIGRATION_FIXTURE" == "1" ]]; then
  echo "isolated PostgreSQL: running historical provider receipt migration fixture"
  if ! "${SAFE_ENV[@]}" \
    QA_USE_OWNED_55481_FIXTURE=1 \
    bash "$ROOT/tests/provider-attempt-migration.test.sh"; then
    die "provider receipt migration fixture failed; the isolated cluster will be removed"
  fi
fi

if ((${#test_args[@]})); then
  echo "isolated PostgreSQL: running one child test batch (${#test_args[@]} files)"
  QA_ALLOWED_PORTS="$PORT"
  if [[ "$WITH_REDIS" == "1" ]]; then
    QA_ALLOWED_PORTS+=",${REDIS_PORT}"
  fi
  # offline-guard is a preload for children only. It permits the fixture TCP
  # ports and rejects every external socket/fetch, while the env below removes
  # provider/email/publishing credentials and worker execution.
  if ! "${SAFE_ENV[@]}" \
    WORKER_PROCESS=true \
    NODE_ENV=test \
    QA_ISOLATED_DATABASE=true \
    QA_TEST_ALLOWED_PORTS="$QA_ALLOWED_PORTS" \
    CITEFI_DISABLE_PROVIDERS=true \
    CITEFI_DISABLE_EMAIL=true \
    CITEFI_DISABLE_PUBLISHING=true \
    JWT_SECRET=qa-isolated-only-jwt-secret \
    SESSION_SECRET=qa-isolated-only-session-secret \
    APPROVAL_TOKEN_SECRET=qa-isolated-only-approval-secret \
    CSRF_SECRET=qa-isolated-only-csrf-secret \
    node --import "$ROOT/QA/support/offline-guard.mjs" \
      --import tsx/esm --test-concurrency=1 --test-force-exit --test "${test_args[@]}"; then
    die "child test batch failed; the isolated cluster will be removed"
  fi
else
  echo "isolated PostgreSQL: schema-only mode (no child tests requested)"
fi