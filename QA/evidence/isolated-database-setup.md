# Isolated PostgreSQL QA harness

This is the runbook and evidence contract for the disposable database used by
the integration-test suites. It is intentionally **not** a claim that any
application test has passed. A live `PASS: isolated schema catalog verified`
line is meaningful only when emitted by the harness in the same invocation.

## Safety boundary

`QA/support/with-isolated-database.sh`:

* refuses an already-listening TCP `127.0.0.1:55481`; it never probes,
  connects to, or stops another PostgreSQL process;
* creates a private `initdb` cluster and database `citefi_qa` as `qa_owner`,
  with no password in the fixture URL;
* binds PostgreSQL to `127.0.0.1` on port `55481` and uses a fixture-owned
  Unix-socket directory;
* discards incoming `DATABASE_URL`, `NEON_DATABASE_URL`, libpq defaults, and
  known provider/email/cloud credentials before every child command;
* never loads `.env`/`.env.local`, installs packages, runs `db:push`, or runs an
  application migration command against a caller-supplied database;
* uses only the checked-in `shared/schema.ts`, checked-in migrations, the local
  installed `drizzle-kit`, and `pg`/PostgreSQL tools;
* sets `WORKER_PROCESS=true` and preloads `QA/support/offline-guard.mjs` for
  children. Children can reach only local port `55481`; external fetches and
  sockets are rejected;
* has an `EXIT` trap that stops the cluster in its own data directory and
  removes only its own temporary fixture directory. Cleanup emits an explicit
  `active fixture connections=0` receipt after the owned postmaster stops.

The harness seeds only two deterministic `.invalid` tenant users/teams. They
have no password, token, provider credential, customer data, or outbound
integration. The rows exist solely so the tenant-RLS suite can exercise two
active memberships instead of skipping that branch.

## Baseline composition

The setup order is:

1. `drizzle-kit export --dialect postgresql --schema shared/schema.ts --sql`
   into the private fixture directory, after enabling local `pgcrypto`. The
   harness stages one prerequisite composite key in that private SQL stream:
   the current declarative source does not express the key required by the
   agency-report and campaign migrations' composite child foreign keys, so
    PostgreSQL would otherwise reject the export before those migrations can
    install them. No source schema or migration/checksum is edited. The same
    private stream also preserves the migration-required descending
    `telemetry_ai_requests(admin_user_id, incident_id, created_at DESC)` index:
    the current declarative source emits that index ascending, and `CREATE
    INDEX IF NOT EXISTS` would otherwise retain the wrong shape;
2. canonical tenant-RLS bootstrap (`scripts/apply-tenant-rls.ts`);
3. canonical campaigns bootstrap (`scripts/migrate-t151-campaigns.ts`);
4. checked-in Ads Lab security migration `0016_campaign_ads.sql`;
5. checked-in provider-ledger security migration `0017_provider_usage_ledger.sql`;
6. canonical agency-report bootstrap
   (`scripts/migrate-t154-agency-reports.ts`);
7. the checked-in versioned runner from `0020` onward, with its unchanged
   migration bytes and SHA-256 ledger;
8. a schema and provider-attempt-receipt RLS catalog gate.

The early security files are run after the source export because source export
provides the complete current table shape, while those migrations provide the
runtime role, grants, helper functions, triggers, and policies. The tracked
runner remains responsible for its own catalog verification and immutable
checksums. If a migration prerequisite is missing, the harness stops at that
file and reports it; it does not fall back to an application database.

## Schema-only evidence command

Run from the repository root:

```sh
QA/support/with-isolated-database.sh
```

The command must emit the catalog line below only after live assertions verify
the database identity, required auth/billing/email tables, migration ledger,
tenant role/grants, and `provider_attempt_receipts` `ENABLE + FORCE ROW LEVEL
SECURITY` with its three policies:

```text
PASS: isolated schema catalog verified (database=citefi_qa host=127.0.0.1 port=55481; no app DB touched)
```

The cluster is removed immediately after that line. No persistent database
password or customer data is produced.

## One shared test batch

Pass all owned test files after one `--` separator so the schema is composed
once:

```sh
QA/support/with-isolated-database.sh -- \
  tests/billing/billing-concurrency.test.ts \
  tests/billing/generation-rls-schema.test.ts \
  tests/billing/reservation-schema.test.ts \
  tests/security/tenant-rls.test.ts
```

The child command receives only the fixture
`DATABASE_URL`/`NEON_DATABASE_URL`, `WORKER_PROCESS=true`,
`QA_TEST_ALLOWED_PORTS=55481`, deterministic non-production token secrets, and
test-mode safety flags. The harness passes `--test-concurrency=1`, so files run
serially while intentional in-file concurrency tests still exercise their own
`Promise.all` paths. It also passes Node's `--test-force-exit` after the test
runner completes so suites that leave a pooled client handle cannot outlive
fixture cleanup. It receives no actual database credentials. Provider,
email, publishing, and external-network tests are deliberately not claimed by
this harness. Tests that require a separately running HTTP server (for example,
the auth API suite on port 5000) are intentionally not included: the offline
guard allows only the fixture port.

## Current evidence status

This checked-in file records the procedure and acceptance criteria, not a
fabricated run. A reviewer should retain the complete terminal output from the
schema-only or shared-batch command as the live receipt. A missing prerequisite
or catalog failure is a failure of baseline composition and must be reported
with its exact migration; substituting the app database is prohibited.