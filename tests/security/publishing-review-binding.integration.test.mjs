import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

if (process.env.QA_ISOLATED_DATABASE !== "true") throw new Error("Owned isolated services required");
process.env.API_KEY_ENCRYPTION_SECRET = "qa-owned-review-encryption-32-bytes";
const live = process.env.QA_LIVE_PUBLISHING === "true" ? await import("../../QA/support/live-publishing-context.mjs") : null;
process.env.SESSION_SECRET = live ? process.env.QA_LIVE_SIGNING_SECRET : "qa-owned-review-signing-32-bytes-only";
process.env.NEXTAUTH_URL = live ? process.env.QA_LIVE_APP_URL : "https://qa.invalid";

const { db } = await import("../../lib/db.ts");
const { runWithSystemContext } = await import("../../lib/tenant-context.ts");
const schema = await import("../../shared/schema.ts");
const { users, teams, teamMembers, sessions, articles, articleAssets, jobBatches, publishingConnections, publishingJobs, activityLogs } = schema;
const { eq, and } = await import("drizzle-orm");
const { generateAccessToken, hashToken } = await import("../../lib/auth.ts");
const { encryptApiKey, hashApiKey } = await import("../../lib/publishing/auth/hmac.ts");
const { reviewMediaStore, sha256, signedReviewMediaUrl } = await import("../../lib/publishing/review-media.ts");
const { websiteAdapter } = await import("../../lib/publishing/channels/website/adapter.ts");
const { createPublishingJob, processPublishingJob } = await import("../../lib/publishing/index.ts");
const { getApprovalSnapshot } = await import("../../lib/publishing/review-binding.ts");
const { GET: preview, POST: decide } = await import("../../app/api/content/[id]/approve/route.ts");
const { PATCH: edit } = await import("../../app/api/content/[id]/update/route.ts");
const { POST: submit } = await import("../../app/api/publishing/jobs/route.ts");
const { GET: readVersion } = await import("../../app/api/publishing/review-media/route.ts");
const { GET: reviewQueue } = await import("../../app/api/content/review/route.ts");
const files = new Map();
// Owned byte fixture, not a real storage-provider call. Real PG/Redis and
// application handlers below exercise authority/atomicity/queue persistence.
if (!live) reviewMediaStore.read = async key => {
  if (!files.has(key)) throw Object.assign(new Error("Missing fixture asset"), { statusCode: 409 });
  return Buffer.from(files.get(key));
};
const realPin = reviewMediaStore.pin;
reviewMediaStore.pin = async (key, bytes) => {
  if (live) await realPin(key, bytes);
  if (!files.has(key)) files.set(key, Buffer.from(bytes));
};
async function setBytes(key, bytes) {
  if (live) await live.writeOwnedBytes(key, bytes);
  files.set(key, Buffer.from(bytes));
}
let sends = 0;
let deliveredPayload;
let deliveredKey;
const realPublish = websiteAdapter.publish.bind(websiteAdapter);
websiteAdapter.publish = async (payload, _connection, key, jobId) => {
  sends++; deliveredPayload = payload; deliveredKey = key;
  if (live) return realPublish(payload, _connection, key, jobId);
  return { success: true, publishedUrl: "https://example.invalid/owned-fixture" };
};
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await runWithSystemContext(`owned review regression: ${name}`, fn); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); failed++; }
}

await runWithSystemContext("owned exact review seed", async () => {
  const suffix = randomUUID();
  async function person(name, teamId, role = "member") {
    const [user] = await db.insert(users).values({ email: `${name}-${suffix}@example.invalid`, accountStatus: "active", emailVerified: 1 }).returning();
    if (teamId) await db.insert(teamMembers).values({ userId: user.id, teamId, role });
    if (teamId) await db.update(users).set({ defaultTeamId: teamId }).where(eq(users.id, user.id));
    const token = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) });
    return { ...user, token, role };
  }
  const owner = await person("owner");
  const [team] = await db.insert(teams).values({ name: "Owned review team", createdBy: owner.id }).returning();
  await db.insert(teamMembers).values({ userId: owner.id, teamId: team.id, role: "owner" });
  await db.update(users).set({ defaultTeamId: team.id }).where(eq(users.id, owner.id));
  owner.role = "owner";
  const reviewer = await person("reviewer", team.id);
  const publisher = await person("publisher", team.id);
  const [clientTeam] = await db.insert(teams).values({ name: "Assigned client", createdBy: owner.id, parentTeamId: team.id }).returning();
  const client = await person("client-reviewer", clientTeam.id, "client_viewer");
  const foreign = await person("foreign");
  const [foreignTeam] = await db.insert(teams).values({ name: "Foreign fixture", createdBy: foreign.id }).returning();
  await db.insert(teamMembers).values({ userId: foreign.id, teamId: foreignTeam.id, role: "owner" });
  await db.update(users).set({ defaultTeamId: foreignTeam.id }).where(eq(users.id, foreign.id));
  const [batch] = await db.insert(jobBatches).values({ teamId: team.id, userId: owner.id, coreTopic: "Owned fixture", targetUrl: "https://example.invalid", numArticlesRequested: 1 }).returning();
  const rawKey = live ? process.env.QA_LIVE_RECEIVER_KEY : "qa-reviewed-account";
  const [connection] = await db.insert(publishingConnections).values({
    teamId: team.id, name: "Owned destination account", channel: "website", status: "active", baseUrl: live ? process.env.QA_LIVE_RECEIVER_URL : "https://example.invalid/blog",
    apiKeyHash: hashApiKey(rawKey), encryptedApiKey: encryptApiKey(rawKey),
  }).returning();
  const [otherConnection] = await db.insert(publishingConnections).values({
    teamId: team.id, name: "Other account, same origin", channel: "website", status: "active", baseUrl: live ? `${process.env.QA_LIVE_RECEIVER_URL}/other-account` : "https://example.invalid/news",
    apiKeyHash: hashApiKey("different-account"), encryptedApiKey: encryptApiKey("different-account"),
  }).returning();
  const req = (actor, url, body, method = "POST") => new NextRequest(`https://qa.invalid${url}`, {
    method: body === undefined ? "GET" : method,
    headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const params = id => ({ params: Promise.resolve({ id: String(id) }) });
  const row = async id => (await db.select().from(articles).where(eq(articles.id, id)))[0];
  const snapshotFor = async id => db.transaction(async tx => getApprovalSnapshot(tx, await row(id)));
  const jobRow = async id => (await db.select().from(publishingJobs).where(eq(publishingJobs.id, id)))[0];
  const actor = { userId: publisher.id, role: "member" };
  async function fixture({ media = true, assigned = null } = {}) {
    const [article] = await db.insert(articles).values({
      teamId: team.id, batchId: batch.id, chosenTitle: `Owned review ${randomUUID()}`, slug: `owned-${randomUUID()}`, articleStatus: "COMPLETE",
      finalHtmlContent: "<p>Reviewed owned article text.</p>", approvalStatus: "in_review", approvalTeamId: assigned, approvalRequestedAt: new Date(),
    }).returning();
    let asset, key;
    if (media) {
      key = `private/articles/${article.id}/owned${live ? `-${live.runId}.png` : ".webp"}`;
      const url = `/api/public-objects/${key}`;
      await setBytes(key, live ? Buffer.concat([live.imageBytes, Buffer.from(String(article.id))]) : Buffer.from("owned image bytes v1"));
      [asset] = await db.insert(articleAssets).values({ articleId: article.id, teamId: team.id, storageUrl: url, altText: "Reviewed image" }).returning();
      await db.update(articles).set({ heroImageUrl: url }).where(eq(articles.id, article.id));
    }
    return { article: await row(article.id), asset, key };
  }
  async function load(article, who = reviewer, conn = connection) {
    const response = await preview(req(who, `/api/content/${article.id}/approve?connectionId=${conn.id}&contentType=article`), params(article.id));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.review;
  }
  async function approve(article, who = reviewer, review, conn = connection) {
    review ??= await load(article, who, conn);
    return decide(req(who, `/api/content/${article.id}/approve`, {
      action: "approved", connectionId: conn.id, contentType: "article", reviewDigest: review.digest,
    }), params(article.id));
  }
  async function approvedFixture(options) {
    const data = await fixture(options);
    const review = await load(data.article);
    const response = await approve(data.article, reviewer, review);
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    return { ...data, review };
  }
  async function expectBlockedJob(data, mutate) {
    const job = await createPublishingJob(team.id, connection.id, "article", data.article.id, actor);
    await mutate();
    const before = sends;
    assert.equal((await processPublishingJob(job.id)).success, false);
    assert.equal(sends, before);
    assert.equal((await jobRow(job.id)).errorDetails.dispatchContract.submissionStarted, false);
  }

  await check("legacy approval history is preserved but cannot admit or dispatch", async () => {
    const { article } = await fixture({ media: false });
    const now = new Date();
    await db.update(articles).set({ approvalStatus: "approved", approvalReviewedAt: now, updatedAt: now }).where(eq(articles.id, article.id));
    await assert.rejects(createPublishingJob(team.id, connection.id, "article", article.id, actor), /exact destination and asset review/);
    assert.equal((await row(article.id)).approvalStatus, "approved");
  });
  await check("review exposes exact payload, destination/account identity and immutable byte versions", async () => {
    const data = await fixture();
    const review = await load(data.article);
    assert.equal(review.destination.id, connection.id);
    assert.equal(review.destination.origin, live ? process.env.QA_LIVE_RECEIVER_URL : "https://example.invalid");
    assert.match(review.destination.accountFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(review.assets[0].sha256, sha256(files.get(data.key)));
    const media = review.formatted.mediaToUpload[0].sourceUrl;
    const response = await readVersion(new NextRequest(media));
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), files.get(data.key).toString());
    const forged = new URL(media); forged.searchParams.set("signature", "0".repeat(64));
    assert.equal((await readVersion(new NextRequest(forged))).status, 404);
  });
  for (const [name, mutation] of [
    ["source bytes changed at stable URL", async data => setBytes(data.key, Buffer.from("owned image bytes v2"))],
    ["asset metadata changed", async data => db.update(articleAssets).set({ altText: "Not reviewed" }).where(eq(articleAssets.id, data.asset.id))],
    ["content changed without updatedAt reset", async data => db.update(articles).set({ metaDescription: "Unreviewed metadata" }).where(eq(articles.id, data.article.id))],
    ["asset inserted after preview", async data => {
      const key = `private/articles/${data.article.id}/added${live ? `-${live.runId}.png` : ".webp"}`; await setBytes(key, Buffer.from("new unreviewed asset"));
      await db.insert(articleAssets).values({ articleId: data.article.id, teamId: team.id, storageUrl: `/api/public-objects/${key}` });
    }],
  ]) {
    await check(`stale browser approval rejects ${name}`, async () => {
      const data = await fixture(); const review = await load(data.article); await mutation(data);
      assert.equal((await approve(data.article, reviewer, review)).status, 409);
      assert.equal(await snapshotFor(data.article.id), null);
    });
  }
  await check("stale browser approval rejects credential/account change on same origin", async () => {
    const data = await fixture(); const review = await load(data.article);
    await db.update(publishingConnections).set({ apiKeyHash: hashApiKey("rotated-account") }).where(eq(publishingConnections.id, connection.id));
    assert.equal((await approve(data.article, reviewer, review)).status, 409);
    await db.update(publishingConnections).set({ apiKeyHash: connection.apiKeyHash }).where(eq(publishingConnections.id, connection.id));
  });
  await check("pre-admission mutation of exact asset bytes rejects without a job", async () => {
    const data = await approvedFixture(); await setBytes(data.key, Buffer.from("owned image bytes v2"));
    await assert.rejects(createPublishingJob(team.id, connection.id, "article", data.article.id, actor), /review again/);
    assert.equal((await db.select().from(publishingJobs).where(eq(publishingJobs.articleId, data.article.id))).length, 0);
  });
  await check("pre-admission credential revision and different same-origin account both reject", async () => {
    const data = await approvedFixture();
    await assert.rejects(createPublishingJob(team.id, otherConnection.id, "article", data.article.id, actor), /review again/);
    await db.update(publishingConnections).set({ encryptedApiKey: encryptApiKey(rawKey) }).where(eq(publishingConnections.id, connection.id));
    await assert.rejects(createPublishingJob(team.id, connection.id, "article", data.article.id, actor), /review again/);
    await db.update(publishingConnections).set({ encryptedApiKey: connection.encryptedApiKey }).where(eq(publishingConnections.id, connection.id));
  });
  await check("eight parallel owned API admissions create one operation", async () => {
    const data = await approvedFixture();
    const responses = await Promise.all(Array.from({ length: 8 }, () => submit(req(publisher, "/api/publishing/jobs", { connectionId: connection.id, contentId: data.article.id, contentType: "article" }))));
    const ids = [];
    for (const response of responses) { const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); ids.push(body.data.id); }
    assert.equal(new Set(ids).size, 1);
    assert.equal((await jobRow(ids[0])).status, "pending");
  });
  await check("review queue correlates immutable evidence to the correct approved article", async () => {
    const data = await approvedFixture({ media: false });
    const response = await reviewQueue(req(publisher, "/api/content/review?status=approved"));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.articles.find(article => article.id === data.article.id).publishingReviewBound, true);
    const legacy = body.articles.find(article => article.approvalReviewedAt && article.publishingReviewBound === false);
    assert.ok(legacy, "Legacy approval must not inherit another article's evidence");
  });
  await check("delayed jobs reject source mutation and cannot substitute immutable copy", async () => {
    const data = await approvedFixture();
    const frozen = Buffer.from(live ? await reviewMediaStore.read(data.review.assets[0].pinnedKey) : files.get(data.review.assets[0].pinnedKey));
    await expectBlockedJob(data, async () => setBytes(data.key, Buffer.from("owned image bytes v2")));
    assert.deepEqual(live ? await reviewMediaStore.read(data.review.assets[0].pinnedKey) : files.get(data.review.assets[0].pinnedKey), frozen);
  });
  await check("delayed jobs reject destination credentials changed after admission", async () => {
    const data = await approvedFixture();
    await expectBlockedJob(data, async () => db.update(publishingConnections).set({ apiKeyHash: hashApiKey("rotated") }).where(eq(publishingConnections.id, connection.id)));
    await db.update(publishingConnections).set({ apiKeyHash: connection.apiKeyHash }).where(eq(publishingConnections.id, connection.id));
  });
  await check("delayed jobs reject reviewer role revocation", async () => {
    const data = await approvedFixture();
    await expectBlockedJob(data, async () => db.update(teamMembers).set({ role: "client_viewer" }).where(and(eq(teamMembers.userId, reviewer.id), eq(teamMembers.teamId, team.id))));
    await db.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.userId, reviewer.id), eq(teamMembers.teamId, team.id)));
  });
  await check("delayed jobs reject publisher role revocation", async () => {
    const data = await approvedFixture();
    await expectBlockedJob(data, async () => db.update(teamMembers).set({ role: "client_viewer" }).where(and(eq(teamMembers.userId, publisher.id), eq(teamMembers.teamId, team.id))));
    await db.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.userId, publisher.id), eq(teamMembers.teamId, team.id)));
  });
  await check("removed and re-added reviewer membership does not revive old consent", async () => {
    const data = await approvedFixture();
    await db.delete(teamMembers).where(and(eq(teamMembers.userId, reviewer.id), eq(teamMembers.teamId, team.id)));
    await db.insert(teamMembers).values({ userId: reviewer.id, teamId: team.id, role: "member" });
    await assert.rejects(createPublishingJob(team.id, connection.id, "article", data.article.id, actor), /membership was replaced/);
  });
  await check("stale browser editor save cannot overwrite reviewed content; fresh save revokes consent", async () => {
    const data = await approvedFixture({ media: false });
    const before = await row(data.article.id);
    const stale = await edit(req(publisher, `/api/content/${before.id}/update`, { title: "Stale overwrite", expectedUpdatedAt: data.article.updatedAt.toISOString() }, "PATCH"), params(before.id));
    assert.equal(stale.status, 409);
    assert.equal((await row(before.id)).approvalStatus, "approved");
    const fresh = await edit(req(publisher, `/api/content/${before.id}/update`, { title: "Fresh change", expectedUpdatedAt: before.updatedAt.toISOString() }, "PATCH"), params(before.id));
    assert.equal(fresh.status, 200, JSON.stringify(await fresh.json()));
    const after = await row(before.id);
    assert.equal(await snapshotFor(after.id), null); assert.equal(after.approvalStatus, "draft");
    const history = await db.select().from(activityLogs).where(and(eq(activityLogs.resourceId, before.id), eq(activityLogs.action, "article_exact_review_approved")));
    assert.equal(history.length, 1); assert.equal(history[0].details.digest, data.review.digest);
  });
  await check("only assigned client team reviews; administrators cannot bypass assignment", async () => {
    const data = await fixture({ assigned: clientTeam.id });
    assert.equal((await approve(data.article, owner, { digest: "0".repeat(64) })).status, 404);
    const clientReview = await load(data.article, client);
    assert.equal((await approve(data.article, client, clientReview)).status, 200);
    await createPublishingJob(team.id, connection.id, "article", data.article.id, actor);
    assert.equal((await decide(req(client, `/api/content/${data.article.id}/approve`, {
      action: "changes_requested", approvalTeamId: null, expectedUpdatedAt: (await row(data.article.id)).updatedAt.toISOString(),
    }), params(data.article.id))).status, 403);
    const current = await row(data.article.id);
    assert.equal((await decide(req(owner, `/api/content/${current.id}/approve`, {
      action: "in_review", approvalTeamId: null, expectedUpdatedAt: current.updatedAt.toISOString(),
    }), params(current.id))).status, 200);
    assert.equal(await snapshotFor(current.id), null);
    assert.equal((await approve(current, client, clientReview)).status, 404);
  });
  await check("foreign tenant cannot inspect or approve assigned manifest", async () => {
    const data = await fixture();
    assert.equal((await preview(req(foreign, `/api/content/${data.article.id}/approve?connectionId=${connection.id}`), params(data.article.id))).status, 404);
    assert.equal((await approve(data.article, foreign, { digest: "0".repeat(64) })).status, 404);
  });
  await check("dispatch uses exact approved bytes/payload and locked credential; duplicate workers send once", async () => {
    const data = await approvedFixture();
    const job = await createPublishingJob(team.id, connection.id, "article", data.article.id, actor);
    const before = sends;
    const results = await Promise.all([processPublishingJob(job.id), processPublishingJob(job.id)]);
    assert.equal(sends - before, 1); assert.equal(results.some(result => result.success), true);
    assert.equal(deliveredKey, rawKey);
    assert.match(deliveredPayload.mediaToUpload[0].sourceUrl, /\/api\/publishing\/review-media\?/);
    const response = await readVersion(new NextRequest(deliveredPayload.mediaToUpload[0].sourceUrl));
    assert.equal(response.status, 200);
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), data.review.assets[0].sha256);
    if (live) await live.verifyReceiver(job.publicId, data.review.assets[0].sha256);
  });
  await check("delayed dispatch renews expired preview links without changing reviewed byte identity", async () => {
    if (live) {
      // Mint the review link 31 minutes in the past. The deployed server keeps
      // its real clock: this proves an actually expired URL is refused and
      // fresh dispatch URLs work, without a 31-minute wall-clock sleep.
      const originalNow = Date.now;
      const data = await approvedFixture();
      let oldUrl;
      // Alter only link issuance, never SDK signing, SQL or receiver clocks.
      try {
        Date.now = () => originalNow() - 31 * 60 * 1000;
        oldUrl = new URL(signedReviewMediaUrl(data.review.assets[0].pinnedKey), process.env.QA_LIVE_APP_URL).href;
      }
      finally { Date.now = originalNow; }
      const expired = await fetch(oldUrl);
      assert.equal(expired.status, 404);
      const job = await createPublishingJob(team.id, connection.id, "article", data.article.id, actor);
      await db.update(publishingJobs).set({ createdAt: new Date(originalNow() - 31 * 60 * 1000) }).where(eq(publishingJobs.id, job.id));
      assert.equal((await processPublishingJob(job.id)).success, true);
      const fresh = await fetch(deliveredPayload.mediaToUpload[0].sourceUrl);
      assert.equal(fresh.status, 200);
      assert.equal(sha256(Buffer.from(await fresh.arrayBuffer())), data.review.assets[0].sha256);
      await live.verifyReceiver(job.publicId, data.review.assets[0].sha256);
      return;
    }
    const data = await approvedFixture();
    const job = await createPublishingJob(team.id, connection.id, "article", data.article.id, actor);
    const originalNow = Date.now;
    const later = originalNow() + 31 * 60 * 1000;
    try {
      Date.now = () => later;
      assert.equal((await readVersion(new NextRequest(data.review.formatted.mediaToUpload[0].sourceUrl))).status, 404);
      assert.equal((await processPublishingJob(job.id)).success, true);
      const fresh = await readVersion(new NextRequest(deliveredPayload.mediaToUpload[0].sourceUrl));
      assert.equal(fresh.status, 200);
      assert.equal(sha256(Buffer.from(await fresh.arrayBuffer())), data.review.assets[0].sha256);
    } finally { Date.now = originalNow; }
  });
  await check("corruption of pinned version fails closed at dispatch and download", async () => {
    const data = await approvedFixture();
    await expectBlockedJob(data, async () => setBytes(data.review.assets[0].pinnedKey, Buffer.from("tampered frozen bytes")));
    assert.equal((await readVersion(new NextRequest(data.review.formatted.mediaToUpload[0].sourceUrl))).status, 409);
  });
  if (live) await check("lost real receiver response remains ambiguous and cannot duplicate delivery", async () => {
    const data = await approvedFixture();
    const job = await createPublishingJob(team.id, connection.id, "article", data.article.id, actor);
    try {
      await live.loseResponseFor(job.publicId);
      const before = sends;
      assert.equal((await processPublishingJob(job.id)).success, false);
      assert.equal((await jobRow(job.id)).errorDetails.dispatchContract.submissionStarted, true);
      await processPublishingJob(job.id);
      assert.equal(sends - before, 1);
      await live.verifyReceiver(job.publicId, data.review.assets[0].sha256);
    } finally { await live.clearLostResponses(); }
  });
});

console.log(`Exact review integration: ${passed} passed, ${failed} failed. Owned PG/Redis; ${live ? "real staging Spaces and real HTTPS receiver; no paid generation or customer publication" : "byte-store/receiver are explicit fixtures; no paid/external calls"}.`);
process.exit(failed ? 1 : 0);
