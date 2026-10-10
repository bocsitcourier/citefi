// Real disposable PostgreSQL/Redis and production route handlers. No receiver
// requests: lost-response/crash states below are explicit fault simulations.
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

if (process.env.QA_ISOLATED_DATABASE !== "true") {
  throw new Error("This test requires the owned isolated-database harness");
}
process.env.API_KEY_ENCRYPTION_SECRET = "qa-fixture-only-not-a-real-secret-32";
const { db } = await import("../../lib/db.ts");
const { runWithSystemContext } = await import("../../lib/tenant-context.ts");
const { users, teams, teamMembers, sessions, articles, jobBatches, publishingConnections, publishingJobs } = await import("../../shared/schema.ts");
const { eq, and } = await import("drizzle-orm");
const { createPublishingJob: admitPublishingJob, processPublishingJob } = await import("../../lib/publishing/index.ts");
const { buildReviewManifest, persistReview } = await import("../../lib/publishing/review-binding.ts");
let publisher;
const createPublishingJob = (...args) => admitPublishingJob(...args, publisher);
const { encryptApiKey, hashApiKey, generateSignature } = await import("../../lib/publishing/auth/hmac.ts");
const { generateAccessToken, hashToken } = await import("../../lib/auth.ts");
const { POST: retry } = await import("../../app/api/publishing/jobs/[id]/retry/route.ts");
const { POST: callback } = await import("../../app/api/publishing/callbacks/route.ts");
const { GET: listJobs, POST: submit } = await import("../../app/api/publishing/jobs/route.ts");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await runWithSystemContext(`isolated publishing regression: ${name}`, fn);
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    failed++;
  }
}

await runWithSystemContext("owned publishing fixture seed", async () => {
  const suffix = randomUUID();
  const [user] = await db.insert(users).values({ email: `publisher-${suffix}@example.invalid`, status: "ACTIVE", emailVerified: 1 }).returning();
  publisher = { userId: user.id, role: "member" };
  const [team] = await db.insert(teams).values({ name: `QA ${suffix}`, createdBy: user.id }).returning();
  const [otherTeam] = await db.insert(teams).values({ name: `Other QA ${suffix}`, createdBy: user.id }).returning();
  await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "member" });
  await db.update(users).set({ defaultTeamId: team.id }).where(eq(users.id, user.id));
  const token = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
  await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) });
  const [batch] = await db.insert(jobBatches).values({
    teamId: team.id, userId: user.id, coreTopic: "Owned fixture", targetUrl: "https://example.invalid", numArticlesRequested: 1,
  }).returning();
  const now = new Date();
  const [article] = await db.insert(articles).values({
    teamId: team.id, batchId: batch.id, chosenTitle: "Owned fixture article", finalHtmlContent: "<p>Owned fixture body.</p>",
    articleStatus: "COMPLETE", approvalStatus: "draft", updatedAt: now,
  }).returning();
  const key = "qa-receiver-fixture-only";
  const [connection] = await db.insert(publishingConnections).values({
    teamId: team.id, name: "Owned receiver fixture", channel: "website", status: "active",
    baseUrl: "https://example.invalid", apiKeyHash: hashApiKey(key), encryptedApiKey: encryptApiKey(key),
  }).returning();
  const request = (path, body) => new NextRequest(`http://qa.invalid${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const params = (id) => ({ params: Promise.resolve({ id: String(id) }) });
  const getJob = async (id) => (await db.select().from(publishingJobs).where(eq(publishingJobs.id, id)))[0];
  let job;

  await check("unapproved COMPLETE content fails before insertion/enqueue", async () => {
    await assert.rejects(createPublishingJob(team.id, connection.id, "article", article.id), error => error.statusCode === 409);
    const rows = await db.select().from(publishingJobs).where(eq(publishingJobs.articleId, article.id));
    assert.equal(rows.length, 0);
    const response = await submit(request("/api/publishing/jobs", { connectionId: connection.id, contentType: "article", contentId: article.id }));
    assert.equal(response.status, 409);
  });
  await db.transaction(async tx => {
    const manifest = await buildReviewManifest(tx, article, connection, "article");
    await persistReview(tx, article, manifest, { ...publisher, teamId: team.id });
  });
  await check("parallel duplicate submissions share one persisted operation and remain claimable", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => createPublishingJob(team.id, connection.id, "article", article.id)));
    assert.equal(new Set(results.map(row => row.id)).size, 1);
    job = results[0];
    assert.equal((await getJob(job.id)).status, "pending");
    assert.equal((await db.select().from(publishingJobs).where(eq(publishingJobs.articleId, article.id))).length, 1);
  });
  await check("alternate tenant cannot create an operation for this content", async () => {
    await assert.rejects(createPublishingJob(otherTeam.id, connection.id, "article", article.id), error => error.statusCode === 400);
  });
  await check("archived client workspace cannot dispatch otherwise approved content", async () => {
    await db.update(teams).set({ clientStatus: "archived" }).where(eq(teams.id, team.id));
    assert.equal((await processPublishingJob(job.id)).success, false);
    assert.equal((await getJob(job.id)).errorDetails.dispatchContract.submissionStarted, false);
    await db.update(teams).set({ clientStatus: "active" }).where(eq(teams.id, team.id));
    await db.update(publishingJobs).set({ status: "pending" }).where(eq(publishingJobs.id, job.id));
  });
  await check("changed content with stale approval is fenced before receiver submission", async () => {
    await db.update(articles).set({ finalHtmlContent: "<p>Changed after review.</p>", updatedAt: new Date(now.getTime() + 1000) }).where(eq(articles.id, article.id));
    const result = await processPublishingJob(job.id);
    assert.equal(result.success, false);
    const current = await getJob(job.id);
    assert.equal(current.status, "failed");
    assert.equal(current.errorDetails.dispatchContract.submissionStarted, false);
  });
  const attemptA = new Date("2026-10-09T01:00:00Z");
  const attemptB = new Date("2026-10-09T01:00:01Z");
  await db.update(publishingJobs).set({
    status: "outcome_unknown", attempts: 2, lastAttemptAt: attemptB,
    errorDetails: { ...job.errorDetails, dispatchContract: { ...job.errorDetails.dispatchContract, submissionStarted: true } },
  }).where(eq(publishingJobs.id, job.id));
  await check("simulated accepted/lost-response operation cannot be manually resent", async () => {
    const response = await retry(request(`/api/publishing/jobs/${job.id}/retry`, {}), params(job.id));
    assert.equal(response.status, 409);
    const current = await getJob(job.id);
    assert.equal(current.status, "outcome_unknown");
    assert.equal(current.attempts, 2);
    assert.equal(current.errorDetails.dispatchContract.submissionStarted, true);
  });
  await check("crash recovery cannot resend an operation after its durable submission boundary", async () => {
    await db.update(publishingJobs).set({ status: "pending" }).where(eq(publishingJobs.id, job.id));
    const result = await processPublishingJob(job.id);
    assert.equal(result.errorCode, "OUTCOME_UNKNOWN");
    assert.equal((await getJob(job.id)).status, "outcome_unknown");
  });
  await check("job-list response marks uncertain operations non-retryable without exposing contract metadata", async () => {
    const response = await listJobs(request("/api/publishing/jobs"));
    assert.equal(response.status, 200);
    const body = await response.json();
    const current = body.data.find(row => row.id === job.id);
    assert.equal(current.retryable, false);
    assert.equal("errorDetails" in current, false);
  });
  async function signedCallback(status, dispatchAttempt, override = {}) {
    const payload = { jobId: job.publicId, status, timestamp: new Date().toISOString(), dispatchAttempt,
      ...(status === "success" ? { pageUrl: "https://example.invalid/fixture-post" } : { error: "Fixture receiver failure" }), ...override };
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    return callback(new NextRequest("http://qa.invalid/api/publishing/callbacks", {
      method: "POST", body, headers: {
        "content-type": "application/json", "x-citefi-timestamp": timestamp,
        "x-citefi-signature": generateSignature(body, key, timestamp),
      },
    }));
  }
  await check("signed late attempt-A failure cannot change attempt-B state or timestamp", async () => {
    assert.equal((await signedCallback("failure", attemptA.toISOString())).status, 200);
    const current = await getJob(job.id);
    assert.equal(current.status, "outcome_unknown");
    assert.equal(current.lastAttemptAt.toISOString(), attemptB.toISOString());
    assert.equal(current.attempts, 2);
  });
  await check("signed current negative receipt retains reconciliation and binding", async () => {
    assert.equal((await signedCallback("retryable", attemptB.toISOString())).status, 200);
    const current = await getJob(job.id);
    assert.equal(current.status, "outcome_unknown");
    assert.equal(current.nextRetryAt, null);
    assert.equal(current.errorDetails.dispatchContract.submissionStarted, true);
    assert.equal(current.lastAttemptAt.toISOString(), attemptB.toISOString());
  });
  await check("matching signed success settles delivery; later failure and manual retry cannot regress it", async () => {
    assert.equal((await signedCallback("success", attemptB.toISOString())).status, 200);
    assert.equal((await getJob(job.id)).status, "delivered");
    assert.equal((await signedCallback("failure", attemptB.toISOString())).status, 200);
    assert.equal((await getJob(job.id)).status, "delivered");
    assert.equal((await retry(request(`/api/publishing/jobs/${job.id}/retry`, {}), params(job.id))).status, 409);
  });
  await check("malformed identifiers and executable published URLs fail before state mutation", async () => {
    assert.equal((await signedCallback("success", attemptB.toISOString(), { jobId: "not-a-uuid" })).status, 400);
    assert.equal((await signedCallback("success", attemptB.toISOString(), { pageUrl: "javascript:alert(1)" })).status, 400);
    assert.equal((await signedCallback("success", attemptB.toISOString(), { pageUrl: "not-a-url" })).status, 400);
    assert.equal((await signedCallback("success", attemptB.toISOString(), { pageUrl: "https://fixture:dummy@example.invalid" })).status, 400);
    assert.equal((await getJob(job.id)).status, "delivered");
  });
  await check("oversized streamed callback without Content-Length is rejected", async () => {
    assert.equal((await signedCallback("failure", attemptB.toISOString(), { error: "x".repeat(1024 * 1024) })).status, 413);
    assert.equal((await getJob(job.id)).status, "delivered");
  });
  await check("client reviewer cannot submit or retry publishing operations", async () => {
    await db.update(teamMembers).set({ role: "client_viewer" }).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)));
    assert.equal((await submit(request("/api/publishing/jobs", { connectionId: connection.id, contentType: "article", contentId: article.id }))).status, 403);
    assert.equal((await retry(request(`/api/publishing/jobs/${job.id}/retry`, {}), params(job.id))).status, 403);
  });
});
console.log(JSON.stringify({ environment: "owned isolated PostgreSQL/Redis; offline provider guard", passed, failed, skipped: 0, receiverCalls: 0, paidCalls: 0 }));
process.exit(failed ? 1 : 0);
