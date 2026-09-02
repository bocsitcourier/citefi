import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "0014_tenant_rls.sql",
  "0015_campaigns.sql",
  "0016_campaign_ads.sql",
  "0017_provider_usage_ledger.sql",
  "0018_provider_monetary_bigint.sql",
  "0019_agency_client_reports.sql",
  "0020_incident_intelligence.sql",
  "0021_incident_intelligence_hardening.sql",
  "0022_billing_integrity.sql",
  "0023_auth_login_challenges.sql",
  "0024_pipeline_delivery_settlement.sql",
  "0025_credit_reservation_tenant_access.sql",
];
const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for versioned migrations");
const client = new Client({
  connectionString: url,
  connectionTimeoutMillis: 30_000,
  statement_timeout: 300_000,
});

async function main() {
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [0x43495445]);
    await client.query(`CREATE TABLE IF NOT EXISTS citefi_schema_migrations (
      version varchar(128) PRIMARY KEY, sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const startVersion = process.env.MIGRATION_START_VERSION;
    const selectedFiles = startVersion
      ? files.filter((file) => file.localeCompare(startVersion, "en") >= 0)
      : files;
    if (startVersion && selectedFiles.length === 0) {
      throw new Error(`No versioned migrations found at or after ${startVersion}`);
    }
    for (const file of selectedFiles) {
      const source = readFileSync(join(root, "migrations", file), "utf8");
      const sql = source.replace(/^\s*BEGIN\s*;\s*/i, "").replace(/\s*COMMIT\s*;\s*$/i, "");
      const digest = createHash("sha256").update(source).digest("hex");
      const existing = await client.query("SELECT sha256 FROM citefi_schema_migrations WHERE version=$1", [file]);
      if (existing.rows.length) {
        if (existing.rows[0].sha256 !== digest) throw new Error(`Applied migration was modified: ${file}`);
        console.log(`migration already applied: ${file}`);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO citefi_schema_migrations(version,sha256) VALUES($1,$2)", [file, digest]);
      console.log(`migration applied: ${file}`);
    }
    if (!startVersion || startVersion.localeCompare("0022", "en") < 0) {
      const verification = await client.query(`
      SELECT
        to_regclass('public.telemetry_incidents') IS NOT NULL AS incidents,
        to_regclass('public.telemetry_events') IS NOT NULL AS events,
        to_regclass('public.telemetry_incident_audit') IS NOT NULL AS audit,
        to_regclass('public.telemetry_notification_deliveries') IS NOT NULL AS deliveries,
        to_regclass('public.telemetry_ai_analyses') IS NOT NULL AS analyses,
        to_regclass('public.telemetry_ai_requests') IS NOT NULL AS ai_requests,
        EXISTS (
          SELECT 1 FROM pg_attribute a
          JOIN pg_class c ON c.oid=a.attrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname='telemetry_incidents'
            AND a.attname='assignee_user_id' AND NOT a.attisdropped
            AND a.atttypid='integer'::regtype AND NOT a.attnotnull
        ) AS assignee_column_shape,
        EXISTS (
          SELECT 1 FROM pg_constraint fk
          JOIN pg_class src ON src.oid=fk.conrelid
          JOIN pg_class target ON target.oid=fk.confrelid
          WHERE fk.contype='f' AND src.oid='public.telemetry_incidents'::regclass
            AND target.oid='public.users'::regclass
            AND fk.conkey=ARRAY[
              (SELECT attnum FROM pg_attribute
               WHERE attrelid=src.oid AND attname='assignee_user_id')
            ]::smallint[]
            AND fk.confkey=ARRAY[
              (SELECT attnum FROM pg_attribute
               WHERE attrelid=target.oid AND attname='id')
            ]::smallint[]
        ) AS assignee_users_fk,
        EXISTS (
          SELECT 1 FROM pg_index
          WHERE indexrelid='public.telemetry_ai_requests_pkey'::regclass
            AND indrelid='public.telemetry_ai_requests'::regclass
            AND indisunique AND indisprimary AND indisvalid
        ) AS ai_requests_primary_index,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indexrelid='public.telemetry_ai_requests_admin_incident_created_idx'::regclass
            AND i.indrelid='public.telemetry_ai_requests'::regclass AND i.indisvalid
            AND i.indnkeyatts=3
            AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='admin_user_id')
            AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='incident_id')
            AND i.indkey[2]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='created_at')
            AND pg_get_indexdef(i.indexrelid) ~* 'created_at DESC'
        ) AS ai_requests_lookup_index,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='public.telemetry_ai_requests'::regclass
            AND contype='p' AND conkey=ARRAY[
              (SELECT attnum FROM pg_attribute
               WHERE attrelid='public.telemetry_ai_requests'::regclass AND attname='id')
            ]::smallint[]
        ) AS ai_requests_primary_key,
        (SELECT count(*) FROM pg_constraint fk
          WHERE fk.conrelid='public.telemetry_ai_requests'::regclass
            AND fk.contype='f'
            AND fk.confrelid IN ('public.telemetry_incidents'::regclass, 'public.users'::regclass)
        ) = 2 AS ai_requests_foreign_keys,
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid='public.telemetry_notification_deliveries'::regclass
            AND i.indisunique AND i.indisvalid
            AND i.indnkeyatts=4
            AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='incident_id')
            AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='admin_user_id')
            AND i.indkey[2]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='notification_kind')
            AND i.indkey[3]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='evidence_version')
        ) AS notification_evidence_uniqueness,
        (SELECT count(*) FROM (VALUES
          ('telemetry_events_append_only','telemetry_events'),
          ('telemetry_incident_audit_append_only','telemetry_incident_audit'),
          ('telemetry_notification_deliveries_append_only','telemetry_notification_deliveries'),
          ('telemetry_ai_analyses_append_only','telemetry_ai_analyses'),
          ('telemetry_ai_requests_append_only','telemetry_ai_requests')
        ) required(trigger_name,table_name)
        JOIN pg_trigger t ON t.tgname=required.trigger_name
          AND t.tgrelid=to_regclass('public.' || required.table_name)
          AND NOT t.tgisinternal AND t.tgenabled <> 'D'
        JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16 AND (t.tgtype & 8) = 8
          AND p.proname=CASE WHEN required.table_name='telemetry_events'
            THEN 'telemetry_events_append_only_guard' ELSE 'telemetry_append_only_guard' END
        ) = 5 AS all_append_only_triggers,
        (SELECT count(*)::int
          FROM (VALUES
            ('telemetry_incidents_severity_check','telemetry_incidents'),
            ('telemetry_incidents_status_check','telemetry_incidents'),
            ('telemetry_incidents_count_check','telemetry_incidents'),
            ('telemetry_events_severity_check','telemetry_events')
          ) required(constraint_name,table_name)
          JOIN pg_constraint c ON c.conname=required.constraint_name
            AND c.conrelid=to_regclass('public.' || required.table_name)
            AND c.contype='c' AND c.convalidated
        ) = 4 AS all_incident_check_constraints`);
      if (!Object.values(verification.rows[0]).every(Boolean)) {
        throw new Error(`incident schema catalog verification failed: ${JSON.stringify(verification.rows[0])}`);
      }
    }
    const postSchemaVerification = await client.query(`
      SELECT
        to_regclass('public.credit_reservations') IS NOT NULL AS reservations,
        to_regclass('public.credit_reservation_quarantine') IS NOT NULL AS reservation_quarantine,
        to_regclass('public.stripe_credit_reconciliations') IS NOT NULL AS stripe_reconciliations,
        to_regclass('public.login_challenges') IS NOT NULL AS login_challenges,
        EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid=to_regclass('public.credit_balances')
            AND attname='allowance_debt' AND NOT attisdropped
        ) AS allowance_debt,
        EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid=to_regclass('public.social_posts')
            AND attname='billing_settled_at' AND NOT attisdropped
        ) AS social_settlement,
        EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid=to_regclass('public.articles')
            AND attname='podcast_billing_settled_at' AND NOT attisdropped
        ) AS podcast_settlement,
        (
          SELECT count(*) FROM pg_policy
          WHERE polrelid=to_regclass('public.credit_reservations')
            AND polname IN (
              'rls_credit_reservations_sel', 'rls_credit_reservations_ins',
              'rls_credit_reservations_upd', 'rls_credit_reservations_del'
            )
        ) = 4 AS reservation_policies,
        (
          SELECT relrowsecurity AND relforcerowsecurity
          FROM pg_class WHERE oid=to_regclass('public.credit_reservations')
        ) AS reservation_rls
    `);
    if (!Object.values(postSchemaVerification.rows[0]).every(Boolean)) {
      throw new Error(`post-schema migration catalog verification failed: ${JSON.stringify(postSchemaVerification.rows[0])}`);
    }
    await client.query("COMMIT");
    console.log("migration ledger and schema controls verified");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });