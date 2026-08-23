/**
 * Task #151 — Campaign service & tenant-isolation integration tests
 * =================================================================
 * Exercises the campaign-service orchestration layer directly (no HTTP, no AI,
 * no queues) against the current dev DB. Covers:
 *
 *   1. Create idempotency / retry semantics never duplicate rows.
 *   2. Team B cannot read/update/export Team A's campaign, AND the same-team
 *      composite FK rejects a cross-team child attachment at the DB level.
 *   3. URL → campaign → title-pool (job_batches.campaign_id) association, plus a
 *      ZIP export built from seeded completed content, and idempotent export
 *      audit recording.
 *
 * All queues/AI are bypassed by calling the service layer directly rather than
 * the API route (the route is what wires the AI research queue).
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/campaigns/campaign-service.test.ts
 */
import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

import { db, systemDb, closeDb } from "../../lib/db.js";
import { runWithSystemContext } from "../../lib/tenant-context.js";

// The tenant-aware `db` client requires an execution context. These tests
// deliberately run under a system context: tenant isolation is verified via the
// service layer's explicit teamId predicates (not RLS), which is the behaviour
// the app relies on when running as the privileged owner role.
function test(name: string, fn: () => void | Promise<void>) {
  return nodeTest(name, () =>
    runWithSystemContext("task-151 campaign test", fn)
  );
}
import {
  campaigns,
  campaignExports,
  clientBrandProfiles,
  jobBatches,
  articles,
} from "../../shared/schema.js";
import {
  createOrReuseCampaign,
  getCampaignByPublicId,
  getCampaignDetailByPublicId,
  updateCampaignPlan,
  loadCampaignExportContent,
  recordCampaignExport,
  linkBrandIntelligence,
  syncCampaignResearchCompletion,
  confirmBrandSnapshot,
} from "../../lib/campaign-service.js";
import { getClientBrandContext } from "../../lib/client-brand-profile-service.js";
import {
  makeRunId,
  seedCampaignFixtures,
  cleanupCampaignSeed,
  seedCompletedArticle,
  type CampaignSeed,
} from "./seed-campaign.js";

let seed: CampaignSeed;

function brandProfile(marker: string) {
  return {
    brandVoice: {
      toneAdjectives: [marker],
      brandValues: [`${marker}-value`],
    },
    positioning: {
      uniqueValueProposition: marker,
      trustSignals: [`${marker}-trust`],
    },
    targetAudience: {
      primaryPersona: `${marker}-persona`,
      actualPainPoints: [`${marker}-pain`],
      decisionDrivers: [`${marker}-driver`],
    },
    competitiveGaps: { clientAdvantages: [`${marker}-advantage`] },
    contentOpportunities: {
      uncoveredTopics: [`${marker}-topic`],
      highValueKeywords: [`${marker}-keyword`],
    },
    failureAnalysis: { messagingProblems: [`${marker}-problem`] },
    brandPolicyPack: {
      approvedClaims: [`${marker}-approved`],
      prohibitedClaims: [],
      prohibitedPhrases: [],
      toneLexicon: { approved: [marker], offBrand: [] },
    },
    localNicheIntelligence: { locationSignals: [`${marker}-location`] },
  };
}

before(async () => {
  seed = await seedCampaignFixtures(makeRunId());
});

after(async () => {
  try {
    await cleanupCampaignSeed(seed);
  } finally {
    await closeDb();
  }
});

// ── 1. Create idempotency / retry semantics ───────────────────────────────────

test("create is idempotent by (teamId, requestId): repeated calls reuse one row", async () => {
  const requestId = `${seed.runId}-create-idem`;
  const input = {
    requestId,
    name: "Idempotent Campaign",
    businessUrl: "https://acme.test",
    companyName: "Acme Co",
    goals: ["local_seo" as const],
    locations: [{ label: "Phoenix, AZ" }],
  };

  const first = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, input);
  assert.equal(first.reused, false, "first create must insert a new row");

  // Simulate 3 retries of the same logical request (network retry, double-click).
  const retries = await Promise.all([
    createOrReuseCampaign(seed.teamA.id, seed.userA.id, input),
    createOrReuseCampaign(seed.teamA.id, seed.userA.id, input),
    createOrReuseCampaign(seed.teamA.id, seed.userA.id, input),
  ]);
  for (const r of retries) {
    assert.equal(r.reused, true, "retries must reuse the existing campaign");
    assert.equal(r.campaign.id, first.campaign.id, "same campaign id every time");
  }

  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.teamId, seed.teamA.id),
        eq(campaigns.idempotencyKey, requestId)
      )
    );
  assert.equal(rows.length, 1, "exactly one campaign row must exist for the key");
});

test("same requestId across different teams creates distinct campaigns", async () => {
  const requestId = `${seed.runId}-cross-team-key`;
  const base = {
    requestId,
    name: "Shared Key Campaign",
    businessUrl: "https://acme.test",
    companyName: "Acme Co",
    goals: ["brand_awareness" as const],
    locations: [],
  };

  const a = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, base);
  const b = await createOrReuseCampaign(seed.teamB.id, seed.userB.id, base);
  assert.notEqual(a.campaign.id, b.campaign.id, "teams must not share a campaign");
  assert.equal(a.campaign.teamId, seed.teamA.id);
  assert.equal(b.campaign.teamId, seed.teamB.id);
});

test("different businesses in one team keep isolated brand snapshots", async () => {
  const first = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, {
    requestId: `${seed.runId}-brand-a`,
    name: "Brand A",
    businessUrl: "https://brand-a.test",
    companyName: "Brand A",
    goals: ["brand_awareness" as const],
    locations: [],
  });
  const second = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, {
    requestId: `${seed.runId}-brand-b`,
    name: "Brand B",
    businessUrl: "https://brand-b.test",
    companyName: "Brand B",
    goals: ["lead_generation" as const],
    locations: [],
  });

  await systemDb.insert(clientBrandProfiles).values({
    teamId: seed.teamA.id,
    websiteUrl: "https://brand-a.test",
    companyName: "Brand A",
    status: "complete",
    profileJson: brandProfile("BRAND_A_MARKER"),
  });

  const linkedA = await linkBrandIntelligence(seed.teamA.id, first.campaign.id);
  const linkedB = await linkBrandIntelligence(seed.teamA.id, second.campaign.id);
  assert.equal(linkedA.matched, true);
  assert.equal(linkedA.status, "complete");
  assert.equal(linkedB.matched, false);
  assert.equal(linkedB.status, "pending");

  await systemDb
    .update(clientBrandProfiles)
    .set({
      websiteUrl: "https://brand-b.test",
      companyName: "Brand B",
      status: "complete",
      profileJson: brandProfile("BRAND_B_MARKER"),
    })
    .where(eq(clientBrandProfiles.teamId, seed.teamA.id));
  await syncCampaignResearchCompletion(seed.teamA.id, "complete", {
    campaignId: second.campaign.id,
    websiteUrl: "https://brand-b.test",
    snapshot: brandProfile("BRAND_B_MARKER"),
  });

  assert.equal((await confirmBrandSnapshot(seed.teamA.id, first.campaign.id)).ok, true);
  assert.equal((await confirmBrandSnapshot(seed.teamA.id, second.campaign.id)).ok, true);
  const detailA = await getCampaignDetailByPublicId(seed.teamA.id, first.campaign.publicId);
  const detailB = await getCampaignDetailByPublicId(seed.teamA.id, second.campaign.publicId);
  assert.equal(
    (detailA?.brandProfile as any)?.positioning?.uniqueValueProposition,
    "BRAND_A_MARKER"
  );
  assert.equal(
    (detailB?.brandProfile as any)?.positioning?.uniqueValueProposition,
    "BRAND_B_MARKER"
  );
  const contextA = await getClientBrandContext(seed.teamA.id, first.campaign.id);
  const legacyTeamContext = await getClientBrandContext(seed.teamA.id);
  assert.match(contextA, /BRAND_A_MARKER/);
  assert.doesNotMatch(contextA, /BRAND_B_MARKER/);
  assert.match(legacyTeamContext, /BRAND_B_MARKER/);

  await syncCampaignResearchCompletion(seed.teamA.id, "complete", {
    campaignId: first.campaign.id,
    websiteUrl: "https://brand-a.test",
    snapshot: brandProfile("OVERWRITE_ATTEMPT"),
  });
  await syncCampaignResearchCompletion(seed.teamA.id, "failed", {
    campaignId: first.campaign.id,
  });
  await syncCampaignResearchCompletion(seed.teamA.id, "failed");
  const confirmedA = await getCampaignDetailByPublicId(
    seed.teamA.id,
    first.campaign.publicId
  );
  assert.equal(confirmedA?.campaign.brandStatus, "confirmed");
  assert.equal(
    (confirmedA?.brandProfile as any)?.positioning?.uniqueValueProposition,
    "BRAND_A_MARKER"
  );

  await systemDb
    .delete(clientBrandProfiles)
    .where(eq(clientBrandProfiles.teamId, seed.teamA.id));
});

// ── 2. Tenant isolation + composite FK ────────────────────────────────────────

test("team B cannot read, detail-load, update, or export team A's campaign", async () => {
  const created = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, {
    requestId: `${seed.runId}-isolation`,
    name: "Team A Only",
    businessUrl: "https://a-only.test",
    companyName: "A Only",
    goals: ["lead_generation" as const],
    locations: [],
  });
  const publicId = created.campaign.publicId;

  // Team A can read it.
  const readA = await getCampaignByPublicId(seed.teamA.id, publicId);
  assert.ok(readA, "team A must read its own campaign");

  // Team B cannot read/detail it.
  const readB = await getCampaignByPublicId(seed.teamB.id, publicId);
  assert.equal(readB, null, "team B must not read team A's campaign");
  const detailB = await getCampaignDetailByPublicId(seed.teamB.id, publicId);
  assert.equal(detailB, null, "team B must not detail-load team A's campaign");

  // Team B cannot update it (predicate finds no row → null, no mutation).
  const updateB = await updateCampaignPlan(
    seed.teamB.id,
    created.campaign.id,
    { name: "HIJACKED" }
  );
  assert.equal(updateB, null, "team B update must be a no-op returning null");
  const [afterUpdate] = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, created.campaign.id));
  if (!afterUpdate) throw new Error("Campaign disappeared after denied update");
  assert.equal(afterUpdate.name, "Team A Only", "name must be unchanged");

  // Team B cannot export it (export content load is tenant-scoped).
  const exportB = await loadCampaignExportContent(
    seed.teamB.id,
    created.campaign.id
  );
  assert.equal(exportB, null, "team B must not load export content");
  const recordB = await recordCampaignExport(seed.teamB.id, created.campaign.id, {
    requestedBy: seed.userB.id,
    requestKey: `${seed.runId}-b-attempt`,
    kind: "zip",
  });
  assert.equal(recordB, null, "team B must not record an export for team A");
});

test("same-team composite FK rejects cross-team child attachment", async () => {
  // Campaign owned by team A.
  const created = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, {
    requestId: `${seed.runId}-fk`,
    name: "FK Guard",
    businessUrl: "https://fk.test",
    companyName: "FK Co",
    goals: ["local_seo" as const],
    locations: [],
  });

  // Attempt to attach a team-B batch to team-A's campaign. The composite FK
  // (team_id, campaign_id) -> campaigns(team_id, id) has no matching
  // (teamB, campaignId) row, so the DB must reject the insert.
  await assert.rejects(
    async () =>
      systemDb.insert(jobBatches).values({
        userId: seed.userB.id,
        teamId: seed.teamB.id, // different team than the campaign
        campaignId: created.campaign.id,
        coreTopic: "cross-team attempt",
        targetUrl: "https://x.test",
        status: "PENDING",
        numArticlesRequested: 0,
      }),
    /foreign key|violates|constraint/i,
    "cross-team attachment must be rejected by the composite FK"
  );

  // Same team attachment succeeds (sanity: FK is not simply blocking everything).
  const [okBatch] = await systemDb
    .insert(jobBatches)
    .values({
      userId: seed.userA.id,
      teamId: seed.teamA.id,
      campaignId: created.campaign.id,
      coreTopic: "same-team ok",
      targetUrl: "https://ok.test",
      status: "PENDING",
      numArticlesRequested: 0,
    })
    .returning({ id: jobBatches.id, campaignId: jobBatches.campaignId });
  if (!okBatch) throw new Error("Failed to insert same-team batch");
  assert.equal(okBatch.campaignId, created.campaign.id);
});

// ── 3. URL → campaign → title-pool association + ZIP export content ────────────

test("title-pool batch associates with its campaign and appears in detail counts", async () => {
  const created = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, {
    requestId: `${seed.runId}-titlepool`,
    name: "Title Pool Campaign",
    businessUrl: "https://titles.test",
    companyName: "Titles Co",
    goals: ["thought_leadership" as const],
    locations: [{ label: "Austin, TX" }],
  });

  // Mimic the title-pool route's DB write (AI/research bypassed): a job_batches
  // row carrying campaign_id + a title pool JSON, attached to the campaign.
  const [batch] = await systemDb
    .insert(jobBatches)
    .values({
      userId: seed.userA.id,
      teamId: seed.teamA.id,
      campaignId: created.campaign.id,
      coreTopic: "best coffee austin",
      targetUrl: created.campaign.businessUrl!,
      status: "PENDING",
      numArticlesRequested: 0,
      titlePoolJson: {
        isMultiCity: false,
        titles: ["Best Coffee in Austin", "Austin Coffee Guide"],
        primaryKeywords: ["austin coffee"],
      },
    })
    .returning({ id: jobBatches.id, campaignId: jobBatches.campaignId });
  if (!batch) throw new Error("Failed to seed title-pool batch");
  assert.equal(batch.campaignId, created.campaign.id);

  const detail = await getCampaignDetailByPublicId(
    seed.teamA.id,
    created.campaign.publicId
  );
  assert.ok(detail, "detail must load for the owning team");
  assert.equal(detail!.counts.batches, 1, "batch must count under the campaign");
  assert.equal(
    detail!.batches.some((b) => b.id === batch.id),
    true,
    "batch must appear in campaign detail batches"
  );
});

test("campaign export loads seeded completed content and records the audit row idempotently", async () => {
  const created = await createOrReuseCampaign(seed.teamA.id, seed.userA.id, {
    requestId: `${seed.runId}-export`,
    name: "Export Campaign",
    businessUrl: "https://export.test",
    companyName: "Export Co",
    goals: ["local_seo" as const],
    locations: [],
  });

  const html =
    "<h1>Seeded Title</h1><p>Body <strong>content</strong> for export.</p>";
  await seedCompletedArticle({
    teamId: seed.teamA.id,
    userId: seed.userA.id,
    campaignId: created.campaign.id,
    title: "Seeded Title",
    html,
    slug: `${seed.runId}-seeded`,
  });

  const content = await loadCampaignExportContent(
    seed.teamA.id,
    created.campaign.id
  );
  assert.ok(content, "export content must load for the owning team");
  assert.equal(content!.articles.length, 1, "one seeded article must be present");
  const firstArticle = content!.articles[0];
  if (!firstArticle) throw new Error("Seeded export article missing");
  assert.equal(firstArticle.finalHtmlContent, html);

  // Build a ZIP from the loaded content to prove the export payload is complete
  // and streamable without any external call. (Mirrors the route's archiver use.)
  const archiver = (await import("archiver")).default;
  const { PassThrough } = await import("node:stream");
  const archive = archiver("zip", { zlib: { level: 9 } });
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    sink.on("end", resolve);
    archive.on("error", reject);
  });
  archive.pipe(sink);
  archive.append(JSON.stringify({ name: created.campaign.name }), {
    name: "campaign.json",
  });
  for (const a of content!.articles) {
    if (a.finalHtmlContent) {
      archive.append(a.finalHtmlContent, {
        name: `articles/html/${a.slug || a.id}.html`,
      });
    }
  }
  await archive.finalize();
  await done;
  const zipBuf = Buffer.concat(chunks);
  assert.ok(zipBuf.length > 0, "ZIP output must be non-empty");
  // ZIP local file header signature.
  assert.equal(zipBuf.slice(0, 2).toString("ascii"), "PK", "valid ZIP magic");

  // Idempotent export audit record: same request key → single row.
  const requestKey = `${seed.runId}-export-key`;
  const rec1 = await recordCampaignExport(seed.teamA.id, created.campaign.id, {
    requestedBy: seed.userA.id,
    requestKey,
    kind: "zip",
    status: "ready",
    filters: { articles: 1 },
  });
  const rec2 = await recordCampaignExport(seed.teamA.id, created.campaign.id, {
    requestedBy: seed.userA.id,
    requestKey,
    kind: "zip",
    status: "ready",
    filters: { articles: 1 },
  });
  assert.ok(rec1 && rec2, "both export records must resolve");
  assert.equal(rec1!.id, rec2!.id, "retried export must reuse the audit row");

  const exportRows = await db
    .select({ id: campaignExports.id })
    .from(campaignExports)
    .where(
      and(
        eq(campaignExports.teamId, seed.teamA.id),
        eq(campaignExports.requestKey, requestKey)
      )
    );
  assert.equal(exportRows.length, 1, "exactly one export audit row per key");
});
