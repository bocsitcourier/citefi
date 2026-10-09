// Owned disposable PostgreSQL/Redis only. No live receiver/provider access.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import dns from "node:dns";
import https from "node:https";
import { EventEmitter } from "node:events";
import { NextRequest } from "next/server";
if (process.env.QA_ISOLATED_DATABASE !== "true") throw new Error("Owned isolated database required");
process.env.API_KEY_ENCRYPTION_SECRET = "owned-fixture-only-encryption-key-32";
const { db, closeDb } = await import("../../lib/db.ts");
const { runWithSystemContext, runWithTenantContext, getDatabaseExecutionContext } = await import("../../lib/tenant-context.ts");
const schema = await import("../../shared/schema.ts");
const { users, teams, teamMembers, sessions, jobBatches, articles, publishingConnections, publishingJobs, publishingCallbacks } = schema;
const { eq, and } = await import("drizzle-orm");
const { generateAccessToken, hashToken } = await import("../../lib/auth.ts");
const { encryptApiKey, hashApiKey, generateSignature } = await import("../../lib/publishing/auth/hmac.ts");
const { createPublishingJob, processPublishingJob } = await import("../../lib/publishing/index.ts");
const { buildReviewManifest, persistReview } = await import("../../lib/publishing/review-binding.ts");
const { POST, GET } = await import("../../app/api/publishing/jobs/[id]/reconciliation/route.ts");
const { GET: list, DELETE: batchDelete } = await import("../../app/api/publishing/jobs/route.ts");
const { GET: getOne, DELETE: deleteOne } = await import("../../app/api/publishing/jobs/[id]/route.ts");
const { POST: retry } = await import("../../app/api/publishing/jobs/[id]/retry/route.ts");
const { POST: callback } = await import("../../app/api/publishing/callbacks/route.ts");
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed++; }
  catch (error) { console.error(`FAIL ${name}: ${error.stack}`); failed++; }
}
await runWithSystemContext("owned publishing reconciliation fixtures", async () => {
  const suffix = randomUUID();
  const [user] = await db.insert(users).values({ email: `operator-${suffix}@example.invalid`, accountStatus: "active", emailVerified: 1 }).returning();
  const [team] = await db.insert(teams).values({ name: `Owned publishing ${suffix}`, createdBy: user.id }).returning();
  const [foreign] = await db.insert(teams).values({ name: `Foreign ${suffix}`, createdBy: user.id }).returning();
  await db.insert(teamMembers).values({ userId: user.id, teamId: team.id, role: "owner" });
  await db.update(users).set({ defaultTeamId: team.id }).where(eq(users.id, user.id));
  const token = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
  await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) });
  const [batch] = await db.insert(jobBatches).values({ teamId: team.id, userId: user.id, coreTopic: "Owned fixture", targetUrl: "https://example.invalid", numArticlesRequested: 1 }).returning();
  const key = "fixture-native-receiver-key";
  const [connection] = await db.insert(publishingConnections).values({
    teamId: team.id, name: "Fixture receiver", channel: "website", status: "active", baseUrl: "https://example.invalid",
    apiKeyHash: hashApiKey(key), encryptedApiKey: encryptApiKey(key), capabilities: { articles: true, publishingReceiptV1: false },
  }).returning();
  const request = (body, method = body === undefined ? "GET" : "POST", auth = true) => new NextRequest("http://qa.invalid/api/publishing", {
    method, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const params = id => ({ params: Promise.resolve({ id: String(id) }) });
  const getJob = async id => (await db.select().from(publishingJobs).where(eq(publishingJobs.id, id)))[0];
  async function seed() {
    const now = new Date();
    const [article] = await db.insert(articles).values({
      teamId: team.id, batchId: batch.id, chosenTitle: `Fixture ${randomUUID()}`, finalHtmlContent: "<p>Owned body.</p>",
      articleStatus: "COMPLETE", approvalStatus: "approved", approvalReviewedAt: now, updatedAt: now, approvalTeamId: team.id,
    }).returning();
    const [currentConnection] = await db.select().from(publishingConnections).where(eq(publishingConnections.id, connection.id));
    await persistReview(db, article, await buildReviewManifest(db, article, currentConnection, "article"),
      { userId: user.id, teamId: team.id, role: "owner" });
    const job = await createPublishingJob(team.id, connection.id, "article", article.id, { userId: user.id, role: "owner" });
    await db.update(publishingJobs).set({ status: "outcome_unknown", attempts: 2, lastAttemptAt: new Date(Date.now() - 10000),
      lastError: "Simulated lost receiver reply", nextRetryAt: null,
      errorDetails: { ...job.errorDetails, dispatchContract: { ...job.errorDetails.dispatchContract, submissionStarted: true,
        receiverOrigin: "https://example.invalid", receiverKeyHash: hashApiKey(key) } },
    }).where(eq(publishingJobs.id, job.id));
    return getJob(job.id);
  }
  function native(job, outcome = "accepted", override = {}) {
    const receipt = { version: 1, receiptId: randomUUID(), jobId: job.publicId,
      dispatchAttempt: job.lastAttemptAt.toISOString(), contentHash: job.errorDetails.dispatchContract.hash,
      receiverOrigin: "https://example.invalid", outcome, final: true, operationFenced: outcome === "not_accepted",
      observedAt: new Date().toISOString(), ...(outcome === "accepted" ? { pageUrl: "https://example.invalid/owned-post" } : {}), ...override };
    const rawReceipt = JSON.stringify(receipt);
    return { action: "import", rawReceipt, signature: createHmac("sha256", key).update(`publishing-receipt-v1.${rawReceipt}`).digest("hex") };
  }
  async function importEvidence(job, outcome = "accepted") {
    const response = await POST(request(native(job, outcome)), params(job.id));
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).data.receiptId;
  }
  async function decisionInput(job, receiptId) {
    const current = await getJob(job.id);
    return { action: "decide", receiptId, decisionId: randomUUID(), reason: "Reviewed original signed receiver evidence",
      expectedAttempt: current.lastAttemptAt.toISOString(), expectedStatus: current.status, expectedUpdatedAt: current.updatedAt.toISOString() };
  }
  async function decide(job, outcome) {
    const receiptId = await importEvidence(job, outcome);
    const input = await decisionInput(job, receiptId);
    const response = await POST(request(input), params(job.id));
    assert.equal(response.status, 200, await response.clone().text());
    return input;
  }
  const accepted = await seed();
  await check("unauthenticated, ordinary member and client reviewer cannot inspect or adjudicate evidence", async () => {
    assert.equal((await GET(request(undefined, "GET", false), params(accepted.id))).status, 401);
    for (const role of ["member", "client_viewer"]) {
      await db.update(teamMembers).set({ role }).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)));
      assert.equal((await GET(request(), params(accepted.id))).status, 403);
      assert.equal((await POST(request(native(accepted)), params(accepted.id))).status, 403);
    }
    await db.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.teamId, team.id));
  });
  await check("owner with default-team session can inspect but cannot probe a foreign tenant operation", async () => {
    assert.equal((await GET(request(), params(accepted.id))).status, 200);
    const [other] = await db.insert(publishingJobs).values({ teamId: foreign.id, connectionId: connection.id, status: "outcome_unknown", contentType: "article" }).returning();
    assert.equal((await GET(request(), params(other.id))).status, 404);
    assert.equal((await POST(request(native(accepted)), params(other.id))).status, 404);
    assert.equal(getDatabaseExecutionContext().scope, "system");
  });
  await check("invalid IDs, JSON and oversized streamed evidence fail closed", async () => {
    assert.equal((await GET(request(), params(`${accepted.id}garbage`))).status, 400);
    assert.equal((await POST(request("{"), params(accepted.id))).status, 400);
    assert.equal((await POST(request("x".repeat(65537)), params(accepted.id))).status, 413);
  });
  await check("forged, wrong-attempt, wrong-destination and non-final receipts never authorize resending", async () => {
    const forged = native(accepted); forged.signature = "0".repeat(64);
    assert.equal((await POST(request(forged), params(accepted.id))).status, 400);
    for (const override of [
      { dispatchAttempt: new Date(accepted.lastAttemptAt.getTime() - 1000).toISOString() },
      { jobId: randomUUID() }, { contentHash: "f".repeat(64) }, { receiverOrigin: "https://foreign.invalid" },
      { operationFenced: false }, { final: false }, { outcome: "failure" },
    ]) assert.notEqual((await POST(request(native(accepted, "not_accepted", override)), params(accepted.id))).status, 200);
    assert.equal((await getJob(accepted.id)).status, "outcome_unknown");
    assert.equal((await retry(request({}), params(accepted.id))).status, 409);
  });
  await check("accepted proof rejects executable, credential-bearing and foreign URLs", async () => {
    for (const pageUrl of ["javascript:alert(1)", "https://dummy:fixture@example.invalid/post", "https://foreign.invalid/post"]) {
      assert.equal((await POST(request(native(accepted, "accepted", { pageUrl })), params(accepted.id))).status, 400);
    }
  });
  await check("legacy job and rotated original receiver cannot gain proof from a new signature", async () => {
    const legacy = await seed();
    await db.update(publishingJobs).set({ errorDetails: { dispatchContract: { version: 1,
      hash: legacy.errorDetails.dispatchContract.hash, submissionStarted: true } } }).where(eq(publishingJobs.id, legacy.id));
    assert.equal((await POST(request(native(legacy)), params(legacy.id))).status, 409);
    await db.update(publishingJobs).set({ errorDetails: {}, status: "failed", lastAttemptAt: null }).where(eq(publishingJobs.id, legacy.id));
    assert.equal((await retry(request({}), params(legacy.id))).status, 409);
    await assert.rejects(createPublishingJob(team.id, connection.id, "article", legacy.articleId, { userId: user.id, role: "owner" }), /legacy operation/);
    await db.update(publishingConnections).set({ baseUrl: "https://foreign.invalid" }).where(eq(publishingConnections.id, connection.id));
    assert.equal((await POST(request(native(accepted)), params(accepted.id))).status, 409);
    await db.update(publishingConnections).set({ baseUrl: "https://example.invalid", encryptedApiKey: encryptApiKey("rotated-fixture-key") }).where(eq(publishingConnections.id, connection.id));
    assert.equal((await POST(request(native(accepted)), params(accepted.id))).status, 400);
    await db.update(publishingConnections).set({ encryptedApiKey: encryptApiKey(key) }).where(eq(publishingConnections.id, connection.id));
  });
  await check("explicit live-read consent, matching bound origin and capability are required before network access", async () => {
    assert.equal((await POST(request({ action: "check", receiverOrigin: "https://example.invalid" }), params(accepted.id))).status, 400);
    assert.equal((await POST(request({ action: "check", authorizeLiveRead: true, receiverOrigin: "https://example.invalid" }), params(accepted.id))).status, 409);
    assert.equal((await POST(request({ action: "check", authorizeLiveRead: true, receiverOrigin: "http://127.0.0.1" }), params(accepted.id))).status, 409);
  });
  await check("authorized pinned receiver GET records native provenance; redirects and absence remain inconclusive", async () => {
    const checked = await seed();
    const proof = native(checked);
    const lookup = dns.promises.lookup, transport = https.request;
    let responseStatus = 200, calls = 0;
    try {
      await db.update(publishingConnections).set({ capabilities: { articles: true, publishingReceiptV1: true } }).where(eq(publishingConnections.id, connection.id));
      dns.promises.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
      https.request = (url, options, callback) => {
        calls++;
        assert.equal(options.method, "GET");
        assert.equal(url.origin, "https://example.invalid");
        assert.equal(url.pathname, `/api/v1/publishing/receipts/${checked.publicId}`);
        assert.equal(url.searchParams.get("dispatchAttempt"), checked.lastAttemptAt.toISOString());
        const stamp = options.headers["x-citefi-timestamp"];
        assert.equal(options.headers["x-citefi-receipt-read-signature"], createHmac("sha256", key)
          .update(`publishing-receipt-read-v1.${stamp}.${url.pathname}${url.search}`).digest("hex"));
        const req = new EventEmitter();
        req.setTimeout = () => req;
        req.destroy = () => {};
        req.end = body => {
          assert.equal(body, undefined);
          const res = new EventEmitter();
          res.statusCode = responseStatus;
          res.headers = { "content-type": "application/json", "x-citefi-receipt-signature": proof.signature,
            ...(responseStatus === 302 ? { location: "https://foreign.invalid/forbidden" } : {}) };
          res.destroy = () => {};
          res.resume = () => {};
          options.lookup("example.invalid", { all: true }, (error, addresses) => {
            assert.equal(error, null); assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
          });
          callback(res);
          queueMicrotask(() => { res.emit("data", Buffer.from(proof.rawReceipt)); res.emit("end"); });
        };
        return req;
      };
      const input = { action: "check", authorizeLiveRead: true, receiverOrigin: "https://example.invalid" };
      assert.equal((await POST(request(input), params(checked.id))).status, 200);
      const view = (await (await GET(request(), params(checked.id))).json()).data;
      assert.equal(view.receipts.length, 1); assert.equal(view.receipts[0].source, "pinned_read");
      assert.equal(view.audit[0].action, "live_read_authorized");
      assert.equal((await getJob(checked.id)).status, "outcome_unknown");
      for (const status of [302, 404]) {
        responseStatus = status;
        const before = calls;
        assert.equal((await POST(request(input), params(checked.id))).status, 409);
        assert.equal(calls, before + 1, "Never follow redirects");
        assert.equal((await getJob(checked.id)).status, "outcome_unknown");
      }
    } finally {
      dns.promises.lookup = lookup; https.request = transport;
      await db.update(publishingConnections).set({ capabilities: { articles: true, publishingReceiptV1: false } }).where(eq(publishingConnections.id, connection.id));
    }
  });
  let evidenceId;
  await check("parallel re-signed imports preserve one native receipt and one provenance event", async () => {
    const envelope = native(accepted);
    const responses = await Promise.all(Array.from({ length: 6 }, () => POST(request(envelope), params(accepted.id))));
    assert.ok(responses.every(row => row.status === 200));
    const ids = await Promise.all(responses.map(async row => (await row.json()).data.receiptId));
    assert.equal(new Set(ids).size, 1); evidenceId = ids[0];
    const view = (await (await GET(request(), params(accepted.id))).json()).data;
    assert.equal(view.receipts.length, 1);
    assert.equal(view.receipts[0].source, "native_import");
    assert.equal(view.audit.length, 1);
    assert.equal("signature" in view.receipts[0], false);
    assert.equal("raw" in view.receipts[0], false);
  });
  await check("same native receipt identifier with different content is retained as conflict, not replacement proof", async () => {
    const row = (await db.select().from(publishingCallbacks).where(eq(publishingCallbacks.id, evidenceId)))[0];
    const envelope = native(accepted, "accepted", { receiptId: row.payload.receipt.receiptId, pageUrl: "https://example.invalid/other" });
    assert.equal((await POST(request(envelope), params(accepted.id))).status, 409);
  });
  await check("stale compare-and-swap decision rejects without state/history mutation", async () => {
    const input = await decisionInput(accepted, evidenceId);
    input.expectedUpdatedAt = new Date(0).toISOString();
    assert.equal((await POST(request(input), params(accepted.id))).status, 409);
    assert.equal((await getJob(accepted.id)).status, "outcome_unknown");
  });
  await check("parallel duplicate accepted decisions settle once, preserve attempts and record original error", async () => {
    const input = await decisionInput(accepted, evidenceId);
    const responses = await Promise.all(Array.from({ length: 5 }, () => POST(request(input), params(accepted.id))));
    assert.ok(responses.every(row => row.status === 200));
    const current = await getJob(accepted.id);
    assert.equal(current.status, "delivered"); assert.equal(current.attempts, 2);
    assert.equal(current.lastAttemptAt.toISOString(), accepted.lastAttemptAt.toISOString());
    assert.equal(current.errorDetails.dispatchContract.submissionStarted, true);
    assert.equal(current.errorDetails.reconciliation.decision.priorError, "Simulated lost receiver reply");
    assert.equal(current.errorDetails.reconciliation.audit.filter(e => e.action === "adjudicated").length, 1);
    assert.equal((await POST(request({ ...input, decisionId: randomUUID() }), params(accepted.id))).status, 409);
    assert.equal((await retry(request({}), params(accepted.id))).status, 409);
    assert.equal((await POST(request({ action: "replacement", decisionId: input.decisionId }), params(accepted.id))).status, 409);
  });
  const rejected = await seed();
  let rejection;
  await check("proven not-accepted decision preserves original submission fence and never resets the job", async () => {
    rejection = await decide(rejected, "not_accepted");
    const current = await getJob(rejected.id);
    assert.equal(current.status, "not_accepted"); assert.equal(current.attempts, 2);
    assert.equal(current.lastAttemptAt.toISOString(), rejected.lastAttemptAt.toISOString());
    assert.equal(current.errorDetails.dispatchContract.submissionStarted, true);
    assert.equal(current.nextRetryAt, null);
    assert.equal((await retry(request({}), params(rejected.id))).status, 409);
    assert.equal((await processPublishingJob(rejected.id)).errorCode, "JOB_NOT_CLAIMABLE");
  });
  await check("replacement rejects stale approval, changed destination, and archived workspace", async () => {
    const body = { action: "replacement", decisionId: rejection.decisionId };
    await db.update(articles).set({ approvalStatus: "draft" }).where(eq(articles.id, rejected.articleId));
    assert.equal((await POST(request(body), params(rejected.id))).status, 409);
    await db.update(articles).set({ approvalStatus: "approved" }).where(eq(articles.id, rejected.articleId));
    await db.update(publishingConnections).set({ baseUrl: "https://foreign.invalid" }).where(eq(publishingConnections.id, connection.id));
    assert.equal((await POST(request(body), params(rejected.id))).status, 409);
    await db.update(publishingConnections).set({ baseUrl: "https://example.invalid" }).where(eq(publishingConnections.id, connection.id));
    await db.update(teams).set({ clientStatus: "archived" }).where(eq(teams.id, team.id));
    assert.equal((await POST(request(body), params(rejected.id))).status, 403);
    await db.update(teams).set({ clientStatus: "active" }).where(eq(teams.id, team.id));
  });
  let successor;
  await check("concurrent explicit replacement authorizations create one new operation with current approval and retained links", async () => {
    const body = { action: "replacement", decisionId: rejection.decisionId };
    const responses = await Promise.all(Array.from({ length: 6 }, () => POST(request(body), params(rejected.id))));
    for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
    const ids = await Promise.all(responses.map(async row => (await row.json()).data.replacementJobId));
    assert.equal(new Set(ids).size, 1); successor = await getJob(ids[0]);
    assert.notEqual(successor.id, rejected.id); assert.notEqual(successor.publicId, rejected.publicId);
    assert.equal(successor.status, "pending"); assert.equal(successor.attempts, 0);
    assert.equal(successor.errorDetails.replacementOf, rejected.id);
    const original = await getJob(rejected.id);
    assert.equal(original.status, "not_accepted"); assert.equal(original.attempts, 2);
    assert.equal(original.errorDetails.reconciliation.replacementJobId, successor.id);
    assert.equal(original.errorDetails.reconciliation.audit.filter(e => e.action === "replacement_authorized").length, 1);
    const ordinary = await createPublishingJob(team.id, connection.id, "article", rejected.articleId, { userId: user.id, role: "owner" });
    assert.ok([rejected.id, successor.id].includes(ordinary.id));
    assert.equal((await db.select().from(publishingJobs).where(eq(publishingJobs.articleId, rejected.articleId))).length, 2);
  });
  await check("late contradictory signed success fences replacement before any submission", async () => {
    const payload = JSON.stringify({ jobId: rejected.publicId, status: "success", dispatchAttempt: rejected.lastAttemptAt.toISOString(),
      timestamp: new Date().toISOString(), pageUrl: "https://example.invalid/contradiction" });
    const timestamp = String(Date.now());
    const response = await callback(new NextRequest("http://qa.invalid/api/publishing/callbacks", { method: "POST", body: payload,
      headers: { "x-citefi-timestamp": timestamp, "x-citefi-signature": generateSignature(payload, key, timestamp) } }));
    assert.equal(response.status, 200);
    assert.equal((await getJob(rejected.id)).errorDetails.reconciliationConflict, true);
    assert.equal((await processPublishingJob(successor.id)).success, false);
    assert.equal((await getJob(successor.id)).errorDetails.dispatchContract.submissionStarted, false);
    assert.equal((await POST(request({ action: "replacement", decisionId: rejection.decisionId }), params(rejected.id))).status, 409);
  });
  await check("cross-job receipt and contradictory native outcomes cannot be selectively adjudicated", async () => {
    const conflicting = await seed();
    await importEvidence(conflicting, "accepted");
    const negativeId = await importEvidence(conflicting, "not_accepted");
    assert.equal((await POST(request(await decisionInput(conflicting, negativeId)), params(conflicting.id))).status, 409);
    assert.equal((await POST(request(await decisionInput(conflicting, evidenceId)), params(conflicting.id))).status, 409);
    assert.equal((await getJob(conflicting.id)).status, "outcome_unknown");
  });
  await check("a second proven rejection permits one linked successor without resetting earlier attempts", async () => {
    const first = await seed();
    const receipt = await importEvidence(first, "not_accepted");
    const input = await decisionInput(first, receipt);
    assert.equal((await POST(request(input), params(first.id))).status, 200);
    const one = (await (await POST(request({ action: "replacement", decisionId: input.decisionId }), params(first.id))).json()).data.replacementJobId;
    const second = await getJob(one);
    await db.update(publishingJobs).set({ status: "outcome_unknown", attempts: 1, lastAttemptAt: new Date(Date.now() - 1000),
      errorDetails: { ...second.errorDetails, dispatchContract: { ...second.errorDetails.dispatchContract, submissionStarted: true,
        receiverOrigin: "https://example.invalid", receiverKeyHash: hashApiKey(key) } } }).where(eq(publishingJobs.id, one));
    const attempt = await getJob(one);
    const evidence = await importEvidence(attempt, "not_accepted");
    const decision = await decisionInput(attempt, evidence);
    assert.equal((await POST(request(decision), params(one))).status, 200);
    const response = await POST(request({ action: "replacement", decisionId: decision.decisionId }), params(one));
    assert.equal(response.status, 200);
    const last = (await response.json()).data.replacementJobId;
    assert.notEqual(last, first.id); assert.notEqual(last, one);
    assert.equal((await getJob(first.id)).attempts, 2);
    assert.equal((await getJob(one)).attempts, 1);
    assert.equal((await getJob(last)).attempts, 0);
  });
  await check("member/client safe visibility contains no contract, raw receipt, signatures or operator notes", async () => {
    for (const role of ["member", "client_viewer"]) {
      await db.update(teamMembers).set({ role }).where(eq(teamMembers.teamId, team.id));
      const response = await list(request());
      assert.equal(response.status, 200);
      const rows = (await response.json()).data;
      assert.equal(rows.find(j => j.id === rejected.id).reconciliationStatus, "conflicting_evidence");
      const row = rows.find(j => j.id === accepted.id);
      assert.equal(row.canReconcile, false); assert.equal(row.retryable, false);
      assert.equal(row.reconciliationStatus, "accepted");
      assert.equal(row.deletable, false); assert.equal("errorDetails" in row, false);
      assert.equal(JSON.stringify(rows).includes("Reviewed original signed"), false);
      const single = await getOne(request(), params(accepted.id));
      assert.equal(single.status, 200); assert.equal("errorDetails" in (await single.json()).data, false);
      assert.equal((await GET(request(), params(accepted.id))).status, 403);
      if (role === "client_viewer") {
        const [agencyConnection] = await db.insert(publishingConnections).values({
          teamId: foreign.id, name: "Private agency receiver", channel: "website",
          status: "active", baseUrl: "https://example.invalid",
        }).returning();
        const [agencyBatch] = await db.insert(jobBatches).values({
          teamId: foreign.id, userId: user.id, coreTopic: "Owned agency fixture",
          targetUrl: "https://example.invalid", numArticlesRequested: 1,
        }).returning();
        const [agencyArticle] = await db.insert(articles).values({
          teamId: foreign.id, batchId: agencyBatch.id, chosenTitle: "Explicitly assigned agency publication",
          approvalTeamId: team.id,
        }).returning();
        const [agencyJob] = await db.insert(publishingJobs).values({
          teamId: foreign.id, connectionId: agencyConnection.id, articleId: agencyArticle.id,
          contentType: "article", status: "delivered", errorDetails: { privateAgencyEvidence: "never expose" },
        }).returning();
        const agencySummary = await getOne(request(), params(agencyJob.id));
        assert.equal(agencySummary.status, 200);
        const safeAgency = (await agencySummary.json()).data;
        assert.equal(safeAgency.articleTitle, agencyArticle.chosenTitle);
        assert.equal("errorDetails" in safeAgency, false);
        assert.equal(safeAgency.connectionBaseUrl, null);
        await db.update(articles).set({ approvalTeamId: null }).where(eq(articles.id, agencyArticle.id));
        assert.equal((await getOne(request(), params(agencyJob.id))).status, 404);
        await runWithTenantContext({ actorType: "web", userId: user.id, teamId: team.id, role }, async () => {
          assert.equal((await db.select().from(publishingJobs)).length, 0);
          assert.equal((await db.select().from(publishingCallbacks)).length, 0);
          assert.equal((await db.select().from(publishingConnections)).length, 0);
        });
        await db.update(articles).set({ approvalTeamId: null }).where(eq(articles.id, accepted.articleId));
        assert.equal((await getOne(request(), params(accepted.id))).status, 404);
        await db.update(articles).set({ approvalTeamId: team.id }).where(eq(articles.id, accepted.articleId));
      }
    }
    await db.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.teamId, team.id));
  });
  await check("single and bulk deletion preserve attempted operations and replacement history", async () => {
    await db.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.teamId, team.id));
    assert.equal((await deleteOne(request(undefined, "DELETE"), params(accepted.id))).status, 409);
    assert.equal((await deleteOne(request(undefined, "DELETE"), params(successor.id))).status, 409);
    const response = await batchDelete(request({ ids: [accepted.id, rejected.id, successor.id] }, "DELETE"));
    assert.ok([200, 400].includes(response.status));
    assert.ok(await getJob(accepted.id)); assert.ok(await getJob(rejected.id)); assert.ok(await getJob(successor.id));
  });
  await check("revoked operator cannot apply an evidence decision even with a still-valid session", async () => {
    const job = await seed(), id = await importEvidence(job);
    const input = await decisionInput(job, id);
    await db.update(teamMembers).set({ role: "member" }).where(eq(teamMembers.teamId, team.id));
    assert.equal((await POST(request(input), params(job.id))).status, 403);
    assert.equal((await getJob(job.id)).status, "outcome_unknown");
  });
});
await closeDb();
console.log(JSON.stringify({ environment: "owned isolated PostgreSQL/Redis; offline receiver policy", passed, failed, receiverCalls: 0, paidCalls: 0 }));
process.exit(failed ? 1 : 0);
