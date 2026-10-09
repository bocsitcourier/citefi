// Approved data/configuration change only; no migration or customer membership.
import pg from "pg";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = "/var/www/citefi";
const directory = `${root}/ops-recovery`;
const teamName = "Citefi System Canary Accounting";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query("SET LOCAL statement_timeout='10s'");
  const { rows: [identity] } = await db.query(`SELECT
    current_database()='citefi' AS expected_database,
    NOT row_security_active('public.teams') AS full_team_visibility`);
  if (!identity.expected_database || !identity.full_team_visibility) throw new Error("Unexpected database context");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('citefi-system-canary-accounting'))");
  const { rows: existing } = await db.query("SELECT id,created_by,deleted_at,stripe_customer_id,stripe_subscription_id FROM teams WHERE name=$1 FOR UPDATE", [teamName]);
  let teamId;
  if (existing.length > 1) throw new Error("Duplicate system team");
  if (existing.length === 1) {
    const team = existing[0];
    const { rows: [safe] } = await db.query(`SELECT
      EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='admin' AND account_status='active') AS admin_owner,
      NOT EXISTS(SELECT 1 FROM team_members WHERE team_id=$2) AS no_members`, [team.created_by,team.id]);
    if (!safe.admin_owner || !safe.no_members || team.deleted_at || team.stripe_customer_id || team.stripe_subscription_id) throw new Error("Existing team is not system-only");
    teamId = team.id;
  } else {
    // Ownership only: no changes to this administrator's login, default team,
    // memberships, customer credits, or billing. No new user/credential.
    const { rows: admins } = await db.query("SELECT id FROM users WHERE role='admin' AND account_status='active' AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR SHARE");
    if (!admins.length) throw new Error("No existing active platform administrator");
    const { rows: [team] } = await db.query(
      "INSERT INTO teams(name,created_by,billing_plan,billing_status) VALUES($1,$2,'free','active') RETURNING id",
      [teamName,admins[0].id]);
    teamId = team.id;
  }
  await db.query("COMMIT");
  await mkdir(`${directory}/backups`, { recursive: true, mode: 0o700 });
  // Separate non-secret configuration. Never read/modify the credentials file.
  const config = [
    `CANARY_ACCOUNTING_TEAM_ID=${teamId}`,
    `BACKUP_DIR=${directory}/backups`,
    `BACKUP_STATUS_FILE=${directory}/backups/status.json`,
    `RESTORE_VERIFICATION_STATUS_FILE=${directory}/backups/restore-verification-status.json`,
    "BACKUP_PRESERVE_ALL=true",
  ].join("\n") + "\n";
  await writeFile(`${directory}/recovery.env.tmp`, config, { mode: 0o600 });
  await rename(`${directory}/recovery.env.tmp`, `${directory}/recovery.env`);
  const previous = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (previous.status !== 0 && !/no crontab/i.test(previous.stderr)) throw new Error("Cannot safely read existing crontab");
  const marker = "# citefi-approved-preserve-all-backup";
  const lines = previous.stdout.split("\n").filter(line => !line.includes(marker));
  const command = `5 2 * * * /usr/bin/flock -n ${directory}/backup.lock /bin/bash ${directory}/run-backup.sh >> ${directory}/backup.log 2>&1 ${marker}`;
  const installed = spawnSync("crontab", ["-"], { input: [...lines,command,""].join("\n"), encoding: "utf8" });
  if (installed.status !== 0) throw new Error("Cannot install user backup schedule");
  console.log(JSON.stringify({ systemTeamId: teamId, customerMembershipsAdded: 0, credentialsChanged: false, backupScheduleInstalled: true }));
} catch {
  await db.query("ROLLBACK").catch(() => {});
  console.error("System-team provisioning refused or failed (details withheld).");
  process.exitCode = 1;
} finally { await db.end(); }
