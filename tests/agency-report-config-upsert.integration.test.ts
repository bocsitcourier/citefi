import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { closeDb } from "../lib/db";
import { upsertAgencyReportConfig } from "../lib/agency-report-service";
import { runWithTenantContext } from "../lib/tenant-context";

const connectionString = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for agency config upsert integration tests");

const suffix = `${Date.now()}-${process.pid}`;
let owner: Client;
let userId: number;
let agencyTeamId: number;
let clientTeamId: number;

const agencyContext = <T>(fn: () => T | Promise<T>) => runWithTenantContext({
  actorType: "web",
  userId,
  teamId: agencyTeamId,
  role: "admin",
}, async () => await fn());

before(async () => {
  owner = new Client({ connectionString });
  await owner.connect();
  const users = await owner.query<{ id: number }>(
    `SELECT id FROM users
      WHERE account_status = 'active' AND deleted_at IS NULL
      ORDER BY id LIMIT 1`,
  );
  if (!users.rows[0]) throw new Error("Agency config upsert test requires an active user");
  userId = users.rows[0].id;

  const agency = await owner.query<{ id: number }>(
    `INSERT INTO teams (name, created_by, billing_plan, billing_status, client_status)
     VALUES ($1, $2, 'agency', 'active', 'active') RETURNING id`,
    [`Config upsert regression agency ${suffix}`, userId],
  );
  agencyTeamId = agency.rows[0]!.id;
  const client = await owner.query<{ id: number }>(
    `INSERT INTO teams (name, created_by, billing_plan, billing_status, parent_team_id, client_status)
     VALUES ($1, $2, 'free', 'active', $3, 'active') RETURNING id`,
    [`Config upsert regression client ${suffix}`, userId, agencyTeamId],
  );
  clientTeamId = client.rows[0]!.id;
  await owner.query(
    `INSERT INTO team_members (team_id, user_id, role)
     VALUES ($1, $2, 'admin')`,
    [agencyTeamId, userId],
  );
});

after(async () => {
  if (owner) {
    await owner.query("BEGIN");
    try {
      if (agencyTeamId) {
        await owner.query("DELETE FROM agency_report_configs WHERE agency_team_id = $1", [agencyTeamId]);
        await owner.query("DELETE FROM team_members WHERE team_id = $1", [agencyTeamId]);
        await owner.query("DELETE FROM teams WHERE id = $1", [clientTeamId]);
        await owner.query("DELETE FROM teams WHERE id = $1", [agencyTeamId]);
      }
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    } finally {
      await owner.end();
    }
  }
  await closeDb();
});

test("locked report config upsert updates the existing row without requiring a composite unique index", async () => {
  const first = await agencyContext(() => upsertAgencyReportConfig({
    clientTeamId,
    displayName: "Locked config first version",
    logoUrl: null,
    accentColor: "#123ABC",
    recipients: [],
    cadence: "manual",
    clientVisibleSections: {},
    markupBasisPoints: 0,
  }));
  assert.ok(first?.id);

  const second = await agencyContext(() => upsertAgencyReportConfig({
    clientTeamId,
    displayName: "Locked config second version",
    logoUrl: null,
    accentColor: "#123ABC",
    recipients: [],
    cadence: "manual",
    clientVisibleSections: {},
    markupBasisPoints: 0,
  }));
  assert.equal(second?.id, first.id);
  assert.equal(second?.displayName, "Locked config second version");
  assert.equal(second?.approvalStatus, "draft");
});