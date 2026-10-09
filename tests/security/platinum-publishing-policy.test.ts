import test from "node:test";
import assert from "node:assert/strict";
import { assertReviewedArticle, publicationHash, callbackMatchesAttempt, canRetryPublication, dispatchContract } from "../../lib/publishing/dispatch-policy";
import { callbackStateUpdate } from "../../lib/publishing/callback-state";
import { cleanupUnacceptedReservations } from "../../lib/scheduled-reservation-cleanup";
import { readFileSync } from "node:fs";
import { drive, auth } from "googleapis/build/src/apis/drive/index.js";

const now = new Date("2026-10-09T01:00:00Z");
const article = { articleStatus: "COMPLETE", approvalStatus: "approved", approvalReviewedAt: now, updatedAt: now, deletedAt: null };
const content = { type: "article" as const, payload: { title: "Fixture", bodyHtml: "<p>Fixture only</p>" } };
const destination = { channel: "website", baseUrl: "https://example.invalid/blog" };
const hash = publicationHash(content, destination);
const details = (submissionStarted: boolean) => ({ dispatchContract: { version: 1, hash, submissionStarted,
  reviewId: "d2e7b201-bc73-4eb0-93bc-e4f9e1ae1772", publisherUserId: 1, publisherRole: "owner", publisherMembership: hash } });

test("only current explicitly reviewed complete content is admissible", () => {
  assert.doesNotThrow(() => assertReviewedArticle(article));
  for (const change of [
    { approvalStatus: "draft" }, { approvalStatus: "changes_requested" }, { approvalStatus: "in_review" },
    { approvalReviewedAt: null }, { articleStatus: "FAILED" }, { deletedAt: now },
    { updatedAt: new Date(now.getTime() + 1) },
  ]) assert.throws(() => assertReviewedArticle({ ...article, ...change }), /explicitly approved/);
});
test("version and destination hashes are canonical and detect material changes", () => {
  assert.equal(hash, publicationHash({ payload: { bodyHtml: "<p>Fixture only</p>", title: "Fixture" }, type: "article" }, destination));
  assert.equal(hash, publicationHash(content, { ...destination, baseUrl: "https://example.invalid/other-path" }));
  assert.notEqual(hash, publicationHash({ ...content, payload: { ...content.payload, title: "Changed" } }, destination));
  assert.notEqual(hash, publicationHash(content, { ...destination, baseUrl: "https://other.invalid" }));
  assert.notEqual(hash, publicationHash({ ...content, mediaToUpload: [] }, destination));
  assert.throws(() => publicationHash(content, { ...destination, baseUrl: "http://example.invalid" }), /HTTPS/);
});
test("malformed, missing and legacy dispatch contracts fail closed", () => {
  for (const value of [null, {}, { dispatchContract: {} }, { dispatchContract: { version: 1, hash: "bad", submissionStarted: false } }]) {
    assert.equal(dispatchContract(value), null);
  }
  assert.equal(dispatchContract(details(true))?.submissionStarted, true);
});
test("manual retry cannot reset delivered, active, pending or ambiguous jobs", () => {
  for (const status of ["delivered", "processing", "sent", "pending", "queued", "outcome_unknown", "cancelled"]) {
    assert.equal(canRetryPublication({ status, lastAttemptAt: now, errorDetails: details(false) }), false);
  }
  assert.equal(canRetryPublication({ status: "failed", lastAttemptAt: now, errorDetails: details(true) }), false);
  assert.equal(canRetryPublication({ status: "failed", lastAttemptAt: now, errorDetails: null }), false);
  assert.equal(canRetryPublication({ status: "failed", lastAttemptAt: null, errorDetails: null }), false);
  assert.equal(canRetryPublication({ status: "failed", lastAttemptAt: null,
    errorDetails: { dispatchContract: { version: 1, hash, submissionStarted: false } } }), false);
  assert.equal(canRetryPublication({ status: "failed", lastAttemptAt: now, errorDetails: details(false) }), true);
});
test("late callbacks cannot affect a different attempt, unsent retry or terminal job", () => {
  const job = { status: "sent", attempts: 2, lastAttemptAt: now, errorDetails: details(true) };
  assert.equal(callbackMatchesAttempt(job, now.toISOString()), true);
  assert.equal(callbackMatchesAttempt(job, new Date(now.getTime() - 1000).toISOString()), false);
  assert.equal(callbackMatchesAttempt(job), false);
  for (const status of ["pending", "queued", "failed", "cancelled", "delivered"]) {
    assert.equal(callbackMatchesAttempt({ ...job, status }, now.toISOString()), false);
    assert.equal(callbackStateUpdate({ status, attempts: 2, maxAttempts: 3 }, "success"), null);
  }
  assert.equal(callbackMatchesAttempt({ ...job, attempts: 1 }), true);
  assert.equal(callbackMatchesAttempt({ ...job, attempts: 1, errorDetails: null }), false);
  assert.equal(callbackMatchesAttempt({ ...job, errorDetails: details(false) }, now.toISOString()), false);
});
test("credit-release fault retains spending capacity and never invokes cap cancellation", async () => {
  let capCancelled = false;
  const fault = new Error("fixture credit release unavailable");
  const result = await cleanupUnacceptedReservations({
    releaseCredits: async () => { throw fault; },
    cancelCap: async () => { capCancelled = true; },
  });
  assert.equal(result.uncertain, true);
  assert.equal(result.stage, "credits");
  assert.equal(result.error, fault);
  assert.equal(capCancelled, false);
});
test("cleanup is ordered, and cap-release failure remains reconciliation work", async () => {
  const order: string[] = [];
  assert.deepEqual(await cleanupUnacceptedReservations({
    releaseCredits: async () => { order.push("credits"); },
    cancelCap: async () => { order.push("cap"); },
  }), { uncertain: false });
  assert.deepEqual(order, ["credits", "cap"]);
  const failure = await cleanupUnacceptedReservations({ cancelCap: async () => { throw new Error("fixture cap failure"); } });
  assert.equal(failure.uncertain, true);
  assert.equal(failure.stage, "cap");
  assert.deepEqual(await cleanupUnacceptedReservations({}), { uncertain: false });
});
test("production build cannot opt out of TypeScript errors", () => {
  assert.match(readFileSync("next.config.mjs", "utf8"), /ignoreBuildErrors:\s*false/);
});
test("opted-in Redis bootstrap secures reused daemons without deleting queue data", () => {
  const source = readFileSync("server/index.ts", "utf8");
  assert.match(source, /\['bind', '127\.0\.0\.1'\], \['protected-mode', 'yes'\]/);
  assert.match(source, /Local Redis could not be made private; refusing startup/);
  assert.doesNotMatch(source, /FLUSHALL|FLUSHDB|SHUTDOWN/);
});
test("scoped Drive import supplies the existing auth constructor and v3 client without API calls", () => {
  const client = drive({ version: "v3", auth: new auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/drive.file"] }) });
  assert.equal(typeof client.files.create, "function");
  assert.equal(typeof client.files.get, "function");
  assert.doesNotMatch(readFileSync("lib/google-drive.ts", "utf8"), /from ['"]googleapis['"]/);
});
