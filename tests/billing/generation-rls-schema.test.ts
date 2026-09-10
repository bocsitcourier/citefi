import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  campaignAds, campaignAdApprovals, providerUsageLedger,
  providerRates, providerRateVersions,
} from "../../shared/schema";

test("generation security controls survive declarative schema pushes", () => {
  for (const table of [
    campaignAds, campaignAdApprovals, providerUsageLedger, providerRates, providerRateVersions,
  ]) {
    const config = getTableConfig(table);
    assert.equal(config.enableRLS, true, `${config.name} must explicitly enable RLS in the ORM`);
  }
});

test("all existing public policy tables enforce RLS and all five repaired tables retain policies", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL });
  await client.connect();
  try {
    const disabled = await client.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
    `);
    assert.deepEqual(disabled.rows, []);
    const repaired = await client.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.oid)::int AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid=c.oid
      WHERE n.nspname='public' AND c.relname = ANY($1)
      GROUP BY c.oid
    `, [[
      "campaign_ads", "campaign_ad_approvals", "provider_usage_ledger",
      "provider_rates", "provider_rate_versions",
    ]]);
    assert.equal(repaired.rows.length, 5);
    for (const row of repaired.rows) {
      assert.ok(row.relrowsecurity && row.relforcerowsecurity && row.policies > 0, row.relname);
    }
  } finally {
    await client.end();
  }
});