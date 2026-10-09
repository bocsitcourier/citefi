import fs from "node:fs";
import crypto from "node:crypto";

// Declarative SQL comes from the checksum-bound, validated release, never input
// supplied by a customer. No historical migration or migration ledger is replayed.
export function planAdditions(sql, diff) {
  const identifier = /^[a-z][a-z0-9_]*$/;
  const names = [...diff.missingTables, ...diff.missingColumns.flatMap(c => [c.table, c.column])];
  if (names.some(name => !identifier.test(name))) throw new Error("Invalid schema identifier");
  const normalize = value => value.toLowerCase().replace(/^varchar/, "character varying").replace(/\s+/g, "");
  if (diff.typeDrift.some(d => normalize(d.expected) !== normalize(d.actual))) {
    throw new Error("Existing column types differ; additive-only recovery stopped");
  }
  const blocks = new Map([...sql.matchAll(/CREATE TABLE "([a-z][a-z0-9_]*)" \(\n[\s\S]*?\n\);/g)].map(m => [m[1], m[0]]));
  const tables = new Set(diff.missingTables), additions = [];
  for (const table of tables) {
    if (!blocks.has(table)) throw new Error("Missing canonical table definition");
    additions.push(blocks.get(table));
  }
  for (const column of diff.missingColumns) {
    if (column.notNull && !column.hasDefault) throw new Error("Required historical-row backfill needs separate review");
    const definition = blocks.get(column.table)?.split("\n").find(line => line.startsWith(`"${column.column}" `));
    if (!definition || /[;\r]/.test(definition)) throw new Error("Unsupported column definition");
    additions.push(`ALTER TABLE "${column.table}" ADD COLUMN ${definition.replace(/,$/, "")};`);
  }
  const rest = sql.replace(/CREATE TABLE "[a-z][a-z0-9_]*" \(\n[\s\S]*?\n\);/g, "");
  for (const statement of rest.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)) {
    const table = statement.match(/^ALTER TABLE "([^"]+)"/)?.[1] ??
      statement.match(/^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/)?.[1];
    if (!table) throw new Error("Unsupported canonical SQL statement");
    const newColumns = diff.missingColumns.filter(c => c.table === table).map(c => c.column);
    const affected = tables.has(table) || newColumns.some(c => statement.includes(`"${c}"`));
    if (!affected) continue;
    if (!/^(ALTER TABLE "[^"]+" (ADD CONSTRAINT|ENABLE ROW LEVEL SECURITY)|CREATE (UNIQUE )?INDEX )/.test(statement)) {
      throw new Error("Non-additive statement rejected");
    }
    additions.push(statement.replace(/;$/, "") + ";");
  }
  for (const table of tables) {
    if (sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`)) {
      if (!["provider_attempt_receipts", "credit_reservations"].includes(table)) throw new Error("New protected table policies require explicit review");
      if (table === "provider_attempt_receipts") additions.push(`ALTER TABLE provider_attempt_receipts FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON provider_attempt_receipts TO citefi_tenant;
GRANT USAGE, SELECT ON SEQUENCE provider_attempt_receipts_id_seq TO citefi_tenant;
CREATE POLICY provider_attempt_receipts_select ON provider_attempt_receipts FOR SELECT TO citefi_tenant
 USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY provider_attempt_receipts_insert ON provider_attempt_receipts FOR INSERT TO citefi_tenant
 WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY provider_attempt_receipts_update ON provider_attempt_receipts FOR UPDATE TO citefi_tenant
 USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
 WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());`);
      if (table === "credit_reservations") {
        additions.push(`ALTER TABLE credit_reservations FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON credit_reservations TO citefi_tenant;
GRANT USAGE, SELECT ON SEQUENCE credit_reservations_id_seq TO citefi_tenant;`);
        for (const [suffix, operation] of [["sel","SELECT"], ["ins","INSERT"], ["upd","UPDATE"], ["del","DELETE"]]) {
          const predicate = "(citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())";
          additions.push(`CREATE POLICY rls_credit_reservations_${suffix} ON credit_reservations FOR ${operation} TO citefi_tenant
 ${operation !== "INSERT" ? `USING ${predicate}` : ""} ${["INSERT","UPDATE"].includes(operation) ? `WITH CHECK ${predicate}` : ""};`);
        }
      }
    }
    if (table === "stripe_credit_reconciliations") additions.push(`ALTER TABLE stripe_credit_reconciliations
 ADD CONSTRAINT recovery_stripe_currency_nonnegative CHECK(currency_amount >= 0),
 ADD CONSTRAINT recovery_stripe_credits_nonnegative CHECK(credits_reversed >= 0),
 ADD CONSTRAINT recovery_stripe_status_valid CHECK(status IN ('pending','processing','completed','failed','cancelled'));`);
  }
  for (const [table, column] of [["credit_balances","allowance_debt"], ["credit_balances","purchased_debt"], ["credit_ledger","reversed_credits"]]) {
    if (diff.missingColumns.some(c => c.table === table && c.column === column)) additions.push(
      `ALTER TABLE "${table}" ADD CONSTRAINT "recovery_${column}_nonnegative" CHECK ("${column}" >= 0);`);
  }
  if (tables.has("login_challenges")) additions.push(`ALTER TABLE login_challenges
 ADD CONSTRAINT login_challenges_method_check CHECK (method IN ('totp','email','totp_setup')),
 ADD CONSTRAINT login_challenges_email_code CHECK (
 (method='email' AND email_code_hash IS NOT NULL) OR (method IN ('totp','totp_setup') AND email_code_hash IS NULL));`);
  const appendOnly = ["telemetry_events", "telemetry_incident_audit", "telemetry_ai_analyses",
    "telemetry_ai_requests", "telemetry_notification_deliveries"].filter(t => tables.has(t));
  if (appendOnly.length) {
    additions.push(`CREATE FUNCTION telemetry_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;`);
    for (const table of appendOnly) additions.push(`CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON ${table}
 FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();`);
  }
  for (const table of [...tables].filter(t => t.startsWith("telemetry_"))) additions.push(
    `REVOKE ALL ON "${table}" FROM citefi_tenant;`);
  if (tables.has("telemetry_incidents")) additions.push(`ALTER TABLE telemetry_incidents
 ADD CONSTRAINT telemetry_incidents_severity_check CHECK(severity IN ('warning','error','critical')),
 ADD CONSTRAINT telemetry_incidents_status_check CHECK(status IN ('open','acknowledged','resolved','ignored')),
 ADD CONSTRAINT telemetry_incidents_count_check CHECK(occurrence_count > 0 AND evidence_version > 0);`);
  if (tables.has("telemetry_events")) additions.push(`ALTER TABLE telemetry_events
 ADD CONSTRAINT telemetry_events_severity_check CHECK(severity IN ('warning','error','critical'));`);
  return additions.join("\n\n") + "\n";
}

if (process.argv[1]?.endsWith("/plan-additions.mjs")) {
  try {
    const plan = planAdditions(fs.readFileSync(process.argv[2], "utf8"), JSON.parse(fs.readFileSync(process.argv[3], "utf8")));
    fs.writeFileSync(process.argv[4], plan, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ sha256: crypto.createHash("sha256").update(plan).digest("hex") }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
