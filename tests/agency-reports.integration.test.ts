import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../lib/db";
import {
  approveAgencyClientReport,
  approveAgencyReportConfig,
  createAgencyClientReport,
  getAgencyReportDetail,
  getApprovedClientSafeReport,
  listAgencyReports,
  recordAgencyReportDelivery,
  sendApprovedAgencyReport,
  upsertAgencyReportConfig,
} from "../lib/agency-report-service";
import { runWithTenantContext } from "../lib/tenant-context";
import {
  articles,
  agencyClientReports,
  agencyReportConfigs,
  agencyReportDeliveries,
  agencyReportFinancialSnapshots,
} from "../shared/schema";

const connectionString = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for agency report integration tests");

const suffix = `${Date.now()}-${process.pid}`;
const providerPrefix = `test:agency-reports:${suffix}`;
const periodStart = new Date("2042-04-01T00:00:00.000Z");
const periodEnd = new Date("2042-05-01T00:00:00.000Z");
const providerCostMicrousd = 3_500;
const creditDebits = 18;
const markupBasisPoints = 2_500;

let owner: Client;
let userId: number;
let agencyTeamId: number;
let clientTeamId: number;
let unrelatedTeamId: number;

const agencyContext = <T>(fn: () => T | Promise<T>) => runWithTenantContext({
  actorType: "web",
  userId,
  teamId: agencyTeamId,
  role: "admin",
}, async () => await fn());

const clientContext = <T>(fn: () => T | Promise<T>) => runWithTenantContext({
  actorType: "web",
  userId,
  teamId: clientTeamId,
  role: "client_viewer",
}, async () => await fn());

const unrelatedContext = <T>(fn: () => T | Promise<T>) => runWithTenantContext({
  actorType: "web",
  userId,
  teamId: unrelatedTeamId,
  role: "member",
}, async () => await fn());

function assertNoPrivateSnapshotKeys(value: unknown): void {
  const privateKey = /(prompt|provider|cogs|cost|margin|markup|internal)/i;
  if (Array.isArray(value)) {
    for (const child of value) assertNoPrivateSnapshotKeys(child);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assert.doesNotMatch(key, privateKey);
    assertNoPrivateSnapshotKeys(child);
  }
}

before(async () => {
  owner = new Client({ connectionString });
  await owner.connect();

  const migration = await owner.query<{
    config: string | null;
    report: string | null;
    financial: string | null;
    delivery: string | null;
  }>(`SELECT to_regclass('public.agency_report_configs')::text AS config,
             to_regclass('public.agency_client_reports')::text AS report,
             to_regclass('public.agency_report_financial_snapshots')::text AS financial,
             to_regclass('public.agency_report_deliveries')::text AS delivery`);
  assert.deepEqual(migration.rows[0], {
    config: "agency_report_configs",
    report: "agency_client_reports",
    financial: "agency_report_financial_snapshots",
    delivery: "agency_report_deliveries",
  }, "migration 0019 must be applied before running this suite");
  const evidenceFunction = await owner.query<{ function_name: string | null }>(
    `SELECT to_regprocedure(
      'citefi_rls.agency_report_period_evidence(integer,integer,timestamp without time zone,timestamp without time zone)'
    )::text AS function_name`
  );
  assert.ok(evidenceFunction.rows[0]?.function_name);
  const requiredConstraints = [
    "agency_report_financial_snapshots_report_pair_fk",
    "agency_report_deliveries_report_pair_fk",
    "agency_client_reports_period_valid",
    "agency_report_deliveries_error_valid",
  ];
  const constraints = await owner.query<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
    [requiredConstraints]
  );
  assert.deepEqual(
    new Set(constraints.rows.map((row) => row.conname)),
    new Set(requiredConstraints),
    "migration 0019 must retrofit all report constraints after db:push"
  );
  const compositeUnique = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_indexes
      WHERE schemaname='public' AND tablename='agency_client_reports'
        AND indexname='agency_client_reports_id_agency_client_unique'`
  );
  assert.equal(Number(compositeUnique.rows[0]?.count ?? 0), 1);
  const broadCreditPolicy = await owner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_policies
      WHERE schemaname='public' AND tablename='credit_ledger'
        AND policyname='agency_report_credit_ledger_select'`
  );
  assert.equal(Number(broadCreditPolicy.rows[0]?.count ?? 0), 0);

  const users = await owner.query<{ id: number }>(
    `SELECT u.id
       FROM users u
      WHERE u.account_status = 'active'
        AND u.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
           WHERE tm.user_id = u.id AND t.deleted_at IS NULL
        )
      ORDER BY u.id
      LIMIT 1`
  );
  if (!users.rows[0]) throw new Error("Agency report integration test requires an existing active test user");
  userId = users.rows[0].id;

  await owner.query("BEGIN");
  try {
    const agency = await owner.query<{ id: number }>(
      `INSERT INTO teams (name, created_by, billing_plan, billing_status, client_status)
       VALUES ($1, $2, 'agency', 'active', 'active') RETURNING id`,
      [`Agency reports integration agency ${suffix}`, userId]
    );
    agencyTeamId = agency.rows[0]!.id;
    const client = await owner.query<{ id: number }>(
      `INSERT INTO teams (name, created_by, billing_plan, billing_status, parent_team_id, client_status)
       VALUES ($1, $2, 'free', 'active', $3, 'active') RETURNING id`,
      [`Agency reports integration client ${suffix}`, userId, agencyTeamId]
    );
    clientTeamId = client.rows[0]!.id;
    const unrelated = await owner.query<{ id: number }>(
      `INSERT INTO teams (name, created_by, billing_plan, billing_status, client_status)
       VALUES ($1, $2, 'free', 'active', 'active') RETURNING id`,
      [`Agency reports integration unrelated ${suffix}`, userId]
    );
    unrelatedTeamId = unrelated.rows[0]!.id;

    await owner.query(
      `INSERT INTO team_members (team_id, user_id, role) VALUES
       ($1, $4, 'admin'), ($2, $4, 'client_viewer'), ($3, $4, 'member')`,
      [agencyTeamId, clientTeamId, unrelatedTeamId, userId]
    );
    const campaign = await owner.query<{ id: number }>(
      `INSERT INTO campaigns (team_id,created_by,name,status,created_at)
       VALUES ($1,$2,$3,'active','2042-04-02T00:00:00Z') RETURNING id`,
      [clientTeamId, userId, `Agency report evidence ${suffix}`]
    );
    const campaignId = campaign.rows[0]!.id;
    const batch = await owner.query<{ id: number }>(
      `INSERT INTO job_batches
       (user_id,team_id,campaign_id,core_topic,target_url,status,num_articles_requested,created_at)
       VALUES ($1,$2,$3,'Safe aggregate topic','https://example.invalid','COMPLETE',1,'2042-04-03T00:00:00Z')
       RETURNING id`,
      [userId, clientTeamId, campaignId]
    );
    await owner.query(
      `INSERT INTO articles
       (batch_id,team_id,campaign_id,article_status,approval_status,chosen_title,final_html_content,image_prompts_json,created_at)
       VALUES ($1,$2,$3,'COMPLETE','approved','Safe article title',
         'private article body','["private image prompt"]'::jsonb,'2042-04-04T00:00:00Z')`,
      [batch.rows[0]!.id, clientTeamId, campaignId]
    );
    await owner.query(
      `INSERT INTO social_posts
       (user_id,team_id,campaign_id,platforms_json,status,topic,title,location,prompt,created_at)
       VALUES ($1,$2,$3,'["linkedin"]'::jsonb,'COMPLETE','private social topic',
         'Safe social aggregate','US','private social prompt','2042-04-05T00:00:00Z')`,
      [userId, clientTeamId, campaignId]
    );
    await owner.query(
      `INSERT INTO video_ideas
       (user_id,team_id,campaign_id,idea_title,short_idea,status,style_prompt,created_at)
       VALUES ($1,$2,$3,'Safe video aggregate','private video details','COMPLETED',
         'private video prompt','2042-04-06T00:00:00Z')`,
      [userId, clientTeamId, campaignId]
    );
    const connection = await owner.query<{ id: number }>(
      `INSERT INTO publishing_connections
       (team_id,name,channel,status,created_at)
       VALUES ($1,'Report fixture connection','wordpress','active','2042-04-07T00:00:00Z')
       RETURNING id`,
      [clientTeamId]
    );
    await owner.query(
      `INSERT INTO publishing_jobs
       (team_id,connection_id,content_type,status,created_at)
       VALUES ($1,$2,'article','published','2042-04-08T00:00:00Z')`,
      [clientTeamId, connection.rows[0]!.id]
    );
    await owner.query(
      `INSERT INTO campaign_exports
       (team_id,campaign_id,requested_by,request_key,kind,status,created_at)
       VALUES ($1,$2,$3,$4,'bundle','completed','2042-04-09T00:00:00Z')`,
      [clientTeamId, campaignId, userId, `${providerPrefix}:export`]
    );
    await owner.query(
      `INSERT INTO content_performance_metrics
       (team_id,content_type,views,clicks,shares,likes,comments,created_at)
       VALUES ($1,'article',120,12,3,9,2,'2042-04-10T00:00:00Z')`,
      [clientTeamId]
    );
    await owner.query(
      `INSERT INTO daily_briefs
       (team_id,user_id,local_date,status,today_focus_type,sections_json,created_at)
       VALUES ($1,$2,'2042-04-11','generated','conversion',
         '{"todayFocus":{"action":"Repurpose the approved article","why":"Recorded brief evidence"}}'::jsonb,
         '2042-04-11T00:00:00Z')`,
      [clientTeamId, userId]
    );
    await owner.query(
      `INSERT INTO provider_usage_ledger
       (source_event_id, team_id, agency_team_id, event_type, operation_type,
        provider, model, unit_type, unit_count, cost_microusd, rate_snapshot, occurred_at)
       VALUES
       ($1, $3, $4, 'usage', 'agency_report_test', 'test-provider', 'immutable-model',
        'requests', 1, 1001, '{"fixture":true}'::jsonb, '2042-04-10T00:00:00Z'),
       ($2, $3, $4, 'usage', 'agency_report_test', 'test-provider', 'immutable-model',
        'requests', 1, 2499, '{"fixture":true}'::jsonb, '2042-04-11T00:00:00Z')`,
      [`${providerPrefix}:provider:1`, `${providerPrefix}:provider:2`, clientTeamId, agencyTeamId]
    );
    await owner.query(
      `INSERT INTO credit_ledger
       (team_id, user_id, amount, balance_after, event_type, idempotency_key, created_at)
       VALUES ($1, $2, -7, 100, 'debit', $3, '2042-04-12T00:00:00Z'),
              ($1, $2, -11, 89, 'debit', $4, '2042-04-13T00:00:00Z')`,
      [clientTeamId, userId, `${providerPrefix}:credit:1`, `${providerPrefix}:credit:2`]
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
});

after(async () => {
  if (owner) {
    if (!agencyTeamId) {
      await owner.end();
      await closeDb();
      return;
    }
    await owner.query("BEGIN").catch(() => undefined);
    try {
      // These production tables are intentionally append-only. The owner-only,
      // transaction-scoped fixture teardown takes exclusive locks while its
      // triggers are disabled, and rollback restores them on any failure.
      await owner.query("LOCK TABLE provider_usage_ledger, agency_report_financial_snapshots, agency_report_deliveries IN ACCESS EXCLUSIVE MODE");
      await owner.query("ALTER TABLE provider_usage_ledger DISABLE TRIGGER provider_usage_ledger_append_only");
      await owner.query("ALTER TABLE agency_report_financial_snapshots DISABLE TRIGGER agency_report_financial_snapshot_immutable");
      await owner.query("ALTER TABLE agency_report_deliveries DISABLE TRIGGER agency_report_deliveries_append_only");
      await owner.query("DELETE FROM provider_usage_ledger WHERE source_event_id LIKE $1", [`${providerPrefix}:%`]);
      await owner.query("DELETE FROM agency_report_deliveries WHERE agency_team_id = $1", [agencyTeamId]);
      await owner.query("DELETE FROM agency_report_financial_snapshots WHERE agency_team_id = $1", [agencyTeamId]);
      await owner.query("DELETE FROM agency_client_reports WHERE agency_team_id = $1", [agencyTeamId]);
      await owner.query("DELETE FROM agency_report_configs WHERE agency_team_id = $1", [agencyTeamId]);
      await owner.query("DELETE FROM credit_ledger WHERE idempotency_key LIKE $1", [`${providerPrefix}:%`]);
      await owner.query("DELETE FROM content_performance_metrics WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM publishing_jobs WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM publishing_connections WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM campaign_exports WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM daily_briefs WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM social_posts WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM video_ideas WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM articles WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM job_batches WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM campaigns WHERE team_id = $1", [clientTeamId]);
      await owner.query("DELETE FROM team_members WHERE team_id = ANY($1::int[])", [[agencyTeamId, clientTeamId, unrelatedTeamId]]);
      await owner.query("DELETE FROM teams WHERE id = ANY($1::int[])", [[clientTeamId, unrelatedTeamId, agencyTeamId]]);
      await owner.query("ALTER TABLE provider_usage_ledger ENABLE TRIGGER provider_usage_ledger_append_only");
      await owner.query("ALTER TABLE agency_report_financial_snapshots ENABLE TRIGGER agency_report_financial_snapshot_immutable");
      await owner.query("ALTER TABLE agency_report_deliveries ENABLE TRIGGER agency_report_deliveries_append_only");
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await owner.end();
    }
  }
  await closeDb();
});

test("Task 154 agency reports enforce accounting, immutability, RLS, and delivery idempotency", async (t) => {
  let reportId = 0;
  let auditDeliveryId = 0;

  await t.test("agency admin approves config and concurrent generation returns one immutable report", async () => {
    await agencyContext(() => upsertAgencyReportConfig({
      clientTeamId,
      displayName: "Fixture Client",
      logoUrl: null,
      accentColor: "#123ABC",
      recipients: ["client@example.invalid"],
      cadence: "manual",
      clientVisibleSections: {},
      markupBasisPoints,
    }));
    await agencyContext(() => approveAgencyReportConfig(clientTeamId));

    const generated = await agencyContext(() => Promise.all(Array.from({ length: 8 }, () =>
      createAgencyClientReport({ clientTeamId, periodStart, periodEnd })
    )));
    reportId = generated[0]!.report.id;
    assert.ok(generated.every((result) => result.report.id === reportId));
    assert.equal(generated.filter((result) => result.inserted).length, 1);

    const repeated = await agencyContext(() =>
      createAgencyClientReport({ clientTeamId, periodStart, periodEnd }));
    assert.equal(repeated.report.id, reportId);
    assert.equal(repeated.inserted, false);

    const rebilling = generated[0]!.report.agencyRebillingSnapshot as Record<string, unknown>;
    assert.deepEqual(rebilling, {
      providerCostMicrousd,
      creditDebits,
      approvedMarkupBasisPoints: markupBasisPoints,
      revenueMicrousd: 4_375,
      marginMicrousd: 875,
      revenueAvailable: true,
    });
    const clientSafe = generated[0]!.report.clientSafeSnapshot as any;
    assertNoPrivateSnapshotKeys(clientSafe);
    assert.deepEqual(clientSafe.campaigns, [{ status: "active", count: 1 }]);
    assert.deepEqual(clientSafe.articles, [{ status: "COMPLETE", approval: "approved", count: 1 }]);
    assert.deepEqual(clientSafe.socialAssets, [{ status: "COMPLETE", count: 1 }]);
    assert.deepEqual(clientSafe.videoAssets, [{ status: "COMPLETED", count: 1 }]);
    assert.deepEqual(clientSafe.publishing, {
      available: true,
      statuses: [{ status: "published", count: 1 }],
    });
    assert.deepEqual(clientSafe.exports, [{ status: "completed", count: 1 }]);
    assert.deepEqual(clientSafe.performance, {
      available: true, samples: 1, views: 120, clicks: 12, shares: 3, likes: 9, comments: 2,
    });
    assert.equal(clientSafe.dailyBriefThemes.available, true);
    assert.deepEqual(clientSafe.recommendations.items, [{
      localDate: "2042-04-11",
      action: "Repurpose the approved article",
      why: "Recorded brief evidence",
    }]);
    const rawClientArticles = await agencyContext(() =>
      db.select({ id: articles.id }).from(articles).where(eq(articles.teamId, clientTeamId)));
    assert.deepEqual(rawClientArticles, [], "agency must not receive raw client article access");
  });

  await t.test("unrelated teams cannot create or read agency reports", async () => {
    await assert.rejects(
      agencyContext(() => createAgencyClientReport({
        clientTeamId: unrelatedTeamId,
        periodStart,
        periodEnd,
      })),
      /active direct child/
    );
    await assert.rejects(
      agencyContext(() => listAgencyReports(unrelatedTeamId)),
      /active direct child/
    );
    const unrelatedRead = await unrelatedContext(() =>
      getApprovedClientSafeReport(unrelatedTeamId, reportId));
    assert.equal(unrelatedRead, null);
    const unrelatedRawRows = await unrelatedContext(() =>
      db.select({ id: agencyClientReports.id }).from(agencyClientReports)
        .where(eq(agencyClientReports.id, reportId)));
    assert.deepEqual(unrelatedRawRows, []);
  });

  await t.test("snapshot fields and delivery history are database-enforced immutable", async () => {
    await assert.rejects(
      agencyContext(() => db.update(agencyClientReports)
        .set({ clientSafeSnapshot: { changed: true } })
        .where(eq(agencyClientReports.id, reportId))),
      /snapshots are immutable/
    );
    await assert.rejects(
      agencyContext(() => db.update(agencyReportFinancialSnapshots)
        .set({ rebillingSnapshot: { changed: true } })
        .where(eq(agencyReportFinancialSnapshots.reportId, reportId))),
      /financial snapshots are immutable|permission denied/
    );
    await assert.rejects(
      agencyContext(() => db.delete(agencyReportFinancialSnapshots)
        .where(eq(agencyReportFinancialSnapshots.reportId, reportId))),
      /financial snapshots are immutable|permission denied/
    );
    const recorded = await agencyContext(() => recordAgencyReportDelivery({
      reportId,
      channel: "portal",
      recipient: "client@example.invalid",
      status: "delivered",
      idempotencyKey: `${providerPrefix}:portal`,
    }));
    auditDeliveryId = recorded.delivery.id;
    await assert.rejects(
      agencyContext(() => db.update(agencyReportDeliveries)
        .set({ status: "sent" })
        .where(eq(agencyReportDeliveries.id, auditDeliveryId))),
      /append-only|permission denied/
    );
    await assert.rejects(
      agencyContext(() => db.delete(agencyReportDeliveries)
        .where(eq(agencyReportDeliveries.id, auditDeliveryId))),
      /append-only|permission denied/
    );
  });

  await t.test("client viewer reads only the approved client-safe service projection", async () => {
    await agencyContext(() => approveAgencyClientReport(reportId));
    const clientReport = await clientContext(() =>
      getApprovedClientSafeReport(clientTeamId, reportId));
    assert.equal(clientReport?.id, reportId);
    assertNoPrivateSnapshotKeys(clientReport?.clientSafeSnapshot);
    assert.equal("agencyRebillingSnapshot" in (clientReport as object), false);

    await assert.rejects(
      clientContext(() => getAgencyReportDetail(reportId)),
      /agency owner or admin/
    );
    const [rawReports, configs, financialSnapshots, deliveries] = await clientContext(() => Promise.all([
      db.select().from(agencyClientReports).where(eq(agencyClientReports.id, reportId)),
      db.select().from(agencyReportConfigs),
      db.select().from(agencyReportFinancialSnapshots),
      db.select().from(agencyReportDeliveries),
    ]));
    assert.equal(rawReports.length, 1);
    assert.equal("agencyRebillingSnapshot" in rawReports[0]!, false);
    assert.deepEqual(configs, []);
    assert.deepEqual(financialSnapshots, []);
    assert.deepEqual(deliveries, []);
  });

  await t.test("failed email retries once, success suppresses duplicates, and history remains append-only", async () => {
    let attempts = 0;
    const fakeDeliverer = async () => {
      attempts++;
      if (attempts === 1) throw new Error("deterministic fixture failure");
    };
    const failed = await agencyContext(() =>
      sendApprovedAgencyReport(reportId, fakeDeliverer));
    assert.deepEqual(failed.outcomes, [{
      recipient: "client@example.invalid",
      status: "failed",
    }]);
    const sent = await agencyContext(() =>
      sendApprovedAgencyReport(reportId, fakeDeliverer));
    assert.deepEqual(sent.outcomes, [{
      recipient: "client@example.invalid",
      status: "sent",
    }]);
    const skipped = await agencyContext(() =>
      sendApprovedAgencyReport(reportId, fakeDeliverer));
    assert.deepEqual(skipped.outcomes, [{
      recipient: "client@example.invalid",
      status: "skipped",
    }]);
    assert.equal(attempts, 2);

    const detail = await agencyContext(() => getAgencyReportDetail(reportId));
    const emailHistory = detail!.deliveries.filter((row) => row.channel === "email");
    assert.equal(emailHistory.length, 4);
    assert.deepEqual(emailHistory.map((row) => row.status), ["pending", "failed", "pending", "sent"]);
    assert.equal(new Set(emailHistory.map((row) => row.idempotencyKey)).size, 4);
  });

  await t.test("repeatable-read generation excludes a ledger append committed after its snapshot", async () => {
    const concurrentStart = new Date("2042-06-01T00:00:00.000Z");
    const concurrentEnd = new Date("2042-07-01T00:00:00.000Z");
    await owner.query("BEGIN");
    await owner.query("LOCK TABLE provider_usage_ledger IN ACCESS EXCLUSIVE MODE");
    const generation = agencyContext(() =>
      createAgencyClientReport({ clientTeamId, periodStart: concurrentStart, periodEnd: concurrentEnd }));
    for (let attempt = 0; attempt < 50; attempt++) {
      const blocked = await owner.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM pg_locks l
           JOIN pg_class c ON c.oid = l.relation
          WHERE c.relname = 'provider_usage_ledger' AND NOT l.granted`
      );
      if (Number(blocked.rows[0]?.count ?? 0) > 0) break;
      if (attempt === 49) throw new Error("generation did not reach the blocked ledger read");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await owner.query(
      `INSERT INTO provider_usage_ledger
       (source_event_id, team_id, agency_team_id, event_type, operation_type,
        provider, model, unit_type, unit_count, cost_microusd, rate_snapshot, occurred_at)
       VALUES ($1, $2, $3, 'usage', 'agency_report_concurrency_test',
        'test-provider', 'immutable-model', 'requests', 1, 777, '{"fixture":true}'::jsonb,
        '2042-06-10T00:00:00Z')`,
      [`${providerPrefix}:provider:concurrent`, clientTeamId, agencyTeamId]
    );
    await owner.query("COMMIT");
    const generated = await generation;
    assert.equal(
      (generated.report.agencyRebillingSnapshot as { providerCostMicrousd: number }).providerCostMicrousd,
      0,
    );
  });

  await t.test("an accepted email with failed terminal audit is never sent twice", async () => {
    const uncertainStart = new Date("2042-07-01T00:00:00.000Z");
    const uncertainEnd = new Date("2042-08-01T00:00:00.000Z");
    const generated = await agencyContext(() =>
      createAgencyClientReport({ clientTeamId, periodStart: uncertainStart, periodEnd: uncertainEnd }));
    await agencyContext(() => approveAgencyClientReport(generated.report.id));
    let accepted = 0;
    const acceptedDeliverer = async () => { accepted++; };
    await assert.rejects(
      agencyContext(() => sendApprovedAgencyReport(
        generated.report.id,
        acceptedDeliverer,
        async () => { throw new Error("terminal audit unavailable"); },
      )),
      /terminal audit unavailable/,
    );
    const retry = await agencyContext(() =>
      sendApprovedAgencyReport(generated.report.id, acceptedDeliverer));
    assert.deepEqual(retry.outcomes, [{
      recipient: "client@example.invalid",
      status: "skipped",
    }]);
    assert.equal(accepted, 1);
  });
});