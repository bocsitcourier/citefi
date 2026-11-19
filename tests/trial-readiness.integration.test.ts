import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { NextRequest } from "next/server";
import { closeDb } from "../lib/db";
import { inspectTrialReadiness, getTrialReadiness } from "../lib/trial/readiness-server";
import { TRIAL_COOKIE } from "../lib/trial/contracts";
import { createTrialSession, generateArticleTrial, readTrial, tokenHash } from "../lib/trial/server";

const target = new URL(process.env.DATABASE_URL!);
if (process.env.QA_ISOLATED_DATABASE !== "true" ||
    target.hostname !== "127.0.0.1" || target.port !== "55481" || target.pathname !== "/citefi_qa") {
  throw new Error("Owned isolated readiness fixture required");
}

test("native readiness and trial admission agree without replaying or releasing stale holds", async t => {
  const client = new Client({ connectionString: target.toString() });
  await client.connect();
  try {
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public_trial_sponsor")).rows[0].n, 0);
    const reports = await Promise.all(Array.from({ length: 8 }, () => getTrialReadiness()));
    const first = reports[0];
    assert.ok(first);
    assert.ok(reports.every(report => report.reference === first.reference));
    assert.ok(first.failures.includes("sponsor_not_provisioned"));
    assert.equal(first.delivery, "not_tested");
    assert.equal(first.providerRequests, 0);
    const incident = await client.query(
      "SELECT count(*)::int AS n FROM error_logs WHERE error_message LIKE '[PublicArticleTrial]%' AND stack_trace LIKE $1",
      [`%${first.reference}%`]);
    assert.equal(incident.rows[0].n, 1, "a coalesced failure reaches the existing redacted incident sink");
    const telemetry = await client.query(
      "SELECT incident_id,metadata FROM telemetry_events WHERE request_id=$1", [first.reference]);
    assert.equal(telemetry.rows.length, 1, "the failure must reach durable incident telemetry, not only local spool");
    assert.ok(telemetry.rows[0].incident_id);
    assert.equal(telemetry.rows[0].metadata.providerRequests, 0);

    const makeSession = (cookie?: string) => new NextRequest("http://trial.test.invalid/api/trial/session", {
      method: "POST",
      headers: { origin: "http://trial.test.invalid", "x-trial-request": "1", ...(cookie ? { cookie } : {}) },
    });
    const unavailable = await createTrialSession(makeSession());
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("set-cookie"), null);
    const unavailableBody = await unavailable.json();
    assert.equal(unavailableBody.reference, first.reference);
    assert.ok(unavailableBody.error.includes(first.reference));
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public_trial_documents")).rows[0].n, 0);

    const existingToken = "a".repeat(64);
    await client.query(`INSERT INTO public_trial_documents(token_hash,ip_hash,expires_at)
      VALUES ($1, repeat('b',64), now()+interval '1 day')`, [tokenHash(existingToken)]);
    try {
      const existing = await createTrialSession(makeSession(`${TRIAL_COOKIE}=${existingToken}`));
      assert.equal(existing.status, 200);
      assert.equal((await existing.json()).status, "created");
      assert.equal((await client.query("SELECT count(*)::int AS n FROM public_trial_documents")).rows[0].n, 1);
    } finally {
      await client.query("DELETE FROM public_trial_documents WHERE token_hash=$1", [tokenHash(existingToken)]);
    }

    // All rows below are disposable synthetic fixture data, never production.
    const user = (await client.query("INSERT INTO users(email) VALUES ('offer-readiness@citefi.invalid') RETURNING id")).rows[0].id;
    const team = (await client.query(
      "INSERT INTO teams(name,created_by) VALUES ('Owned readiness sponsor',$1) RETURNING id", [user])).rows[0].id;
    await client.query("INSERT INTO public_trial_sponsor(singleton,team_id) VALUES(true,$1)", [team]);
    assert.equal((await inspectTrialReadiness()).ok, true, "the real accepted locked fixture rate is usable");

    const secret = process.env.SESSION_SECRET;
    try {
      delete process.env.SESSION_SECRET;
      assert.deepEqual((await inspectTrialReadiness()).failures, ["initialization_blocked"]);
    } finally { process.env.SESSION_SECRET = secret; }

    await client.query(`INSERT INTO public_trial_documents(token_hash,ip_hash,team_id,status,reserve_microusd,started_at,expires_at)
      SELECT repeat(md5('readiness-hold-'||i),2),repeat(md5('synthetic'),2),$1,'generating',50000,
        now()-interval '20 minutes',now()+interval '1 day' FROM generate_series(1,3) i`, [team]);
    const fingerprint = async () => (await client.query(`SELECT
      (SELECT md5(coalesce(string_agg(to_jsonb(d)::text,'' ORDER BY id),'')) FROM public_trial_documents d) AS documents,
      (SELECT count(*) FROM provider_attempt_receipts) AS attempts,
      (SELECT count(*) FROM provider_usage_ledger) AS ledger,
      (SELECT count(*) FROM credit_reservations) AS reservations,
      (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class
        WHERE oid IN ('public_trial_documents'::regclass,'public_trial_sponsor'::regclass)) AS rls`)).rows[0];
    const before = await fingerprint();
    assert.equal(before.rls, true);
    assert.equal((await inspectTrialReadiness()).ok, true, "stale work cannot block new session setup indefinitely");
    assert.deepEqual(await fingerprint(), before, "stale generating holds and financial rows stay unchanged");

    const now = Date.now();
    const readinessClock = t.mock.method(Date, "now", () => now + 61_000);
    const session = await createTrialSession(makeSession()).finally(() => readinessClock.mock.restore());
    assert.equal(session.status, 200);
    const cookie = session.headers.get("set-cookie")!.split(";")[0]!;
    const read = await readTrial(new NextRequest("http://trial.test.invalid/api/trial", { headers: { cookie } }));
    assert.equal((await read.json()).status, "created");
    const generate = () => new NextRequest("http://trial.test.invalid/api/trial/generate", {
      method: "POST",
      headers: { origin: "http://trial.test.invalid", "x-trial-request": "1", cookie },
      body: JSON.stringify({ topic: "Choosing a local repair shop", businessName: "Example Repair",
        city: "Boston", audience: "Local homeowners" }),
    });
    let admitted = 0;
    const verificationProvider = async () => {
      admitted++;
      return "A useful article title\n\n" + "Practical details for customers before choosing a repair shop. ".repeat(65);
    };
    const draftResponse = await generateArticleTrial(generate(), verificationProvider);
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    assert.equal(draft.status, "ready");
    assert.equal(draft.access, "preview");
    assert.equal(draft.title, "A useful article title");
    assert.ok(draft.preview);
    assert.equal(draft.text, undefined);
    assert.equal(draft.canExport, false);
    await generateArticleTrial(generate(), verificationProvider);
    assert.equal(admitted, 1, "the existing article is returned rather than requesting another");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM public_trial_documents
      WHERE status='uncertain' AND reserve_microusd=50000`)).rows[0].n, 3,
      "native admission marks stale attempts uncertain without releasing their reserves");

    await client.query(`INSERT INTO public_trial_documents(token_hash,ip_hash,team_id,status,reserve_microusd,started_at,expires_at)
      SELECT repeat(md5('readiness-active-'||i),2),repeat(md5('synthetic'),2),$1,'generating',50000,
        now(),now()+interval '1 day' FROM generate_series(1,3) i`, [team]);
    assert.deepEqual((await inspectTrialReadiness()).failures, ["admission_at_capacity"]);
    await client.query(`INSERT INTO public_trial_documents(token_hash,ip_hash,expires_at)
      SELECT repeat(md5('readiness-session-'||i),2),repeat(md5('synthetic'),2),now()+interval '1 day'
      FROM generate_series(1,993) i`);
    const capped = await inspectTrialReadiness();
    assert.ok(capped.failures.includes("initialization_blocked"));
    assert.ok(capped.failures.includes("admission_at_capacity"));
    assert.equal(capped.providerRequests, 0);
  } finally {
    await closeDb();
    await client.end();
  }
});
