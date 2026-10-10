import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evidenceHash, planReviewRetention, executeReviewRetention,
  type ReferenceRows, type RetentionPolicy, type ReviewCopy,
} from "../../lib/publishing/review-retention";

const now = new Date("2026-10-09T12:00:00.000Z");
const target = "a".repeat(64);
const key = (team = 1, digest = "b") => `private/publishing-reviewed/${team}/${digest.repeat(64)}.png`;
const copy = (team = 1, digest = "b"): ReviewCopy => ({
  key: key(team, digest), size: 10, etag: `"${"c".repeat(32)}"`, lastModified: "2026-09-01T00:00:00.000Z",
});
function rows(): ReferenceRows {
  return {
    teams: [1, 2].map(id => ({ id, client_status: "active", deleted_at: null })),
    articles: [], article_assets: [], activity_logs: [], publishing_jobs: [], publishing_callbacks: [],
  };
}
function policy(): RetentionPolicy {
  return { version: 1, policyRef: "fixture-policy", target, teams: [
    { teamId: 1, orphanRetentionDays: 7, disposition: "delete-unapproved-orphans", legalHold: false, approvalHistoryComplete: true },
  ] };
}
const plan = (data = rows(), rules = policy(), objects = [copy()]) =>
  planReviewRetention(objects, data, rules, target, now);
const approval = () => ({
  id: 7, team_id: 1, resource_id: 10, resource: "articles", action: "article_exact_review_approved",
  details: { version: 1, reviewId: "fixture-review", assets: [{ pinnedKey: key() }],
    reviewedAt: "2026-10-01T00:00:00.000Z", reviewedBy: 5 },
});
const authorization = (approved = plan()) => ({
  version: 1, authorizationRef: "fixture-change", target,
  planHash: evidenceHash(approved), policyHash: approved.policyHash,
  expiresAt: "2026-10-10T00:00:00.000Z", allowDeletion: true, conditionalDeleteCertified: true,
});

test("only old, explicitly governed unapproved copies are candidates; team namespaces remain separate", () => {
  const result = plan(rows(), policy(), [copy(), copy(2), {
    ...copy(1, "d"), lastModified: "2026-10-08T00:00:00.000Z",
  }]);
  assert.equal(result.decisions.find(row => row.key === key())?.decision, "candidate");
  assert.equal(result.decisions.find(row => row.teamId === 2)?.reason, "policy-hold");
  assert.equal(result.decisions.find(row => row.key === key(1, "d"))?.reason, "retention-window");
});

test("all historical, superseded, rejected and soft-deleted evidence protects copies", () => {
  for (const table of ["articles", "article_assets", "activity_logs", "publishing_jobs", "publishing_callbacks"] as const) {
    const data = rows();
    data[table].push({ id: 1, team_id: 1, deleted_at: now, details: {
      oldMedia: `/api/publishing/review-media?key=${encodeURIComponent(key())}`,
    } });
    assert.equal(plan(data).decisions[0]?.reason, "referenced-version", table);
  }
  const data = rows();
  data.activity_logs.push(approval());
  assert.equal(plan(data).decisions[0]?.reason, "referenced-version");
});

test("pending/sent/uncertain and terminal jobs resolve through retained audit versions", () => {
  for (const status of ["pending", "queued", "processing", "sent", "uncertain", "delivered", "failed", "cancelled", "unknown"]) {
    const data = rows();
    data.activity_logs.push(approval());
    data.publishing_jobs.push({ id: 1, team_id: 1, article_id: 10, status,
      error_details: { dispatchContract: { reviewId: "fixture-review", submissionStarted: true } } });
    assert.equal(plan(data).decisions[0]?.reason, "referenced-version", status);
    data.activity_logs = [];
    assert.equal(plan(data).decisions[0]?.reason, "incomplete-reference-evidence", status);
  }
});

test("legacy approved content, malformed audit, missing callback job and ambiguous references fail closed", () => {
  const fixtures: ReferenceRows[] = [];
  let data = rows();
  data.articles.push({ id: 10, team_id: 1, approval_status: "approved" });
  fixtures.push(data);
  data = rows();
  data.activity_logs.push({ ...approval(), details: null });
  fixtures.push(data);
  data = rows();
  data.publishing_callbacks.push({ publishing_job_id: 999 });
  fixtures.push(data);
  data = rows();
  data.activity_logs.push({ details: `private/publishing-reviewed/1/unknown.png ${key(2)}` });
  fixtures.push(data);
  for (const fixture of fixtures) assert.equal(plan(fixture).decisions[0]?.reason, "incomplete-reference-evidence");
});

test("privacy-erased history, legal holds and archived/deleted/missing teams are never orphan cleanup", () => {
  for (const change of [{ legalHold: true }, { approvalHistoryComplete: false }, { disposition: "retain" as const }]) {
    const rules = policy();
    Object.assign(rules.teams[0]!, change);
    assert.equal(plan(rows(), rules).decisions[0]?.reason, "policy-hold");
  }
  for (const change of [{ deleted_at: now }, { client_status: "archived" }]) {
    const data = rows();
    Object.assign(data.teams[0]!, change);
    assert.equal(plan(data).decisions[0]?.reason, "privacy-or-archived-team-hold");
  }
  const data = rows(); data.teams = [];
  assert.equal(plan(data).decisions[0]?.reason, "privacy-or-archived-team-hold");
});

test("unsafe metadata, short retention, duplicated rules/inventory, wrong targets are rejected or retained", () => {
  for (const change of [{ etag: "*" }, { size: -1 }, { lastModified: "" }, { key: "private/articles/10/foo.png" }]) {
    assert.equal(plan(rows(), policy(), [{ ...copy(), ...change }]).decisions[0]?.reason, "invalid-object-evidence");
  }
  assert.throws(() => plan(rows(), { ...policy(), target: "e".repeat(64) }));
  const short = policy(); short.teams[0]!.orphanRetentionDays = 0;
  assert.throws(() => plan(rows(), short));
  const duplicate = policy(); duplicate.teams.push({ ...duplicate.teams[0]! });
  assert.throws(() => plan(rows(), duplicate));
  assert.throws(() => plan(rows(), policy(), [copy(), copy()]));
});

test("execution rechecks references and object identity; never adds new candidates", async () => {
  const approved = plan();
  const data = rows(); data.activity_logs.push(approval());
  const deletes: string[] = [], events: string[] = [];
  const run = (fresh: ReturnType<typeof plan>) => executeReviewRetention({
    approved, fresh, authorization: authorization(approved), now,
    remove: async object => { deletes.push(object.key); },
    record: async event => { events.push(event.outcome); },
  });
  await run(plan(data));
  await run(plan(rows(), policy(), [{ ...copy(), etag: `"${"e".repeat(32)}"` }]));
  await run(plan(rows(), policy(), [{ ...copy(), lastModified: "2026-09-02T00:00:00.000Z" }]));
  assert.equal(deletes.length, 0);
  await run(plan(rows(), policy(), [copy(), copy(1, "d")]));
  assert.deepEqual(deletes, [key()]);
  assert.deepEqual(events.slice(-2), ["delete-intent", "deleted"]);
});

test("authorization binds reviewed plan, target and policy with bounded freshness", async () => {
  const approved = plan();
  for (const change of [{ allowDeletion: false }, { conditionalDeleteCertified: false },
    { target: "e".repeat(64) }, { planHash: "e".repeat(64) },
    { policyHash: "e".repeat(64) }, { expiresAt: now.toISOString() }]) {
    await assert.rejects(executeReviewRetention({
      approved, fresh: approved, authorization: { ...authorization(approved), ...change }, now,
      remove: async () => { assert.fail("Must not delete"); }, record: async () => {},
    }));
  }
  await assert.rejects(executeReviewRetention({
    approved, fresh: approved, authorization: authorization(approved), now: new Date("2026-10-11T00:00:00Z"),
    remove: async () => { assert.fail("Must not delete"); }, record: async () => {},
  }));
  const changed = policy(); changed.policyRef = "new-policy";
  await assert.rejects(executeReviewRetention({
    approved, fresh: plan(rows(), changed), authorization: authorization(approved), now,
    remove: async () => { assert.fail("Must not delete"); }, record: async () => {},
  }));
});

test("journal failure prevents deletion; storage failure leaves intent, stops batch and propagates", async () => {
  const approved = plan(rows(), policy(), [copy(), copy(1, "d")]);
  await assert.rejects(executeReviewRetention({
    approved, fresh: approved, authorization: authorization(approved), now,
    record: async () => { throw new Error("Journal unavailable"); },
    remove: async () => { assert.fail("Must not delete without durable intent"); },
  }), /Journal unavailable/);
  const events: string[] = []; let attempts = 0;
  await assert.rejects(executeReviewRetention({
    approved, fresh: approved, authorization: authorization(approved), now,
    record: async event => { events.push(event.outcome); },
    remove: async () => { attempts++; throw new Error("Conditional delete failed"); },
  }), /Conditional delete failed/);
  assert.equal(attempts, 1);
  assert.deepEqual(events, ["delete-intent"]);
});
