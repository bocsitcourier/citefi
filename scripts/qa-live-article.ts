/**
 * Separate opt-in paid harness. Never load .env files or application startup.
 * Preflight and smoke are free; only --live may create owned fixture services.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from "node:fs";
import {
  PLAN, ROOT, preflight, reserveRun, installNetworkGuard, durableJson, validateRequest, sha256,
} from "../QA/support/live-article-budget.mjs";
import { assertPaidQaLedgerResolved } from "../QA/support/budget-ledger-dispute.mjs";
import type { ArticleChainFixture, ArticleChainWorkers } from "../QA/support/article-chain-fixture";

function smoke() {
  const request = {
    method: "POST",
    body: JSON.stringify({ model: "gpt-4.1-mini", max_tokens: 2048,
      messages: [{ role: "user", content: "You are a strict editorial reviewer. Offline validation only." }] }),
  };
  assert.equal(validateRequest(new URL("https://api.openai.com/v1/chat/completions"), request).call.role, "judge");
  const geminiRequest = { method: "POST", body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "offline validation only" }] }],
    generationConfig: { maxOutputTokens: 16384, responseMimeType: "application/json" },
  }) };
  const geminiUrl = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  assert.equal(validateRequest(geminiUrl, geminiRequest).call.role, "article");
  assert.throws(() => validateRequest(geminiUrl, {
    ...geminiRequest, body: JSON.stringify({
      ...JSON.parse(geminiRequest.body), generationConfig: { maxOutputTokens: 65536 },
    }),
  }));
  for (const [url, body] of [
    ["https://evil.invalid/v1/chat/completions", JSON.parse(request.body)],
    ["https://api.openai.com/v1/chat/completions", { ...JSON.parse(request.body), max_tokens: undefined }],
    ["https://api.openai.com/v1/chat/completions", { ...JSON.parse(request.body), tools: [] }],
    ["https://api.openai.com/v1/chat/completions", { ...JSON.parse(request.body), model: "unapproved" }],
    ["https://api.openai.com/v1/chat/completions", { ...JSON.parse(request.body), messages: [{ content: "x".repeat(50001) }] }],
  ] as const) {
    assert.throws(() => validateRequest(new URL(url), { method: "POST", body: JSON.stringify(body) }));
  }
  console.log("OFFLINE GUARD SMOKE PASS: no services, databases, SDKs, or network calls started");
}

async function seedRealRates(fixture: ArticleChainFixture) {
  // Fixture query connects exclusively to its owned, freshly verified cluster.
  // Rate history is immutable. Add newer official rows; never delete or weaken
  // immutable-rate triggers to replace the fixture's historical synthetic row.
  const [version] = await fixture.query<{ id: number }>(
    `INSERT INTO provider_rate_versions (version, evidence_url, source_note, effective_from)
     VALUES ('live-article-official-v1', $1, $2, NOW()) RETURNING id`,
    [PLAN.calls[0]!.url, "Parent verified official standard rates; persisted pricing source hashes in preflight"],
  );
  for (const call of PLAN.calls) {
    await fixture.query(
      `INSERT INTO provider_rates (rate_version_id, provider, model, unit_type,
        input_microusd_per_million, output_microusd_per_million, effective_from, evidence_url)
       VALUES ($1,$2,$3,'tokens',$4,$5,NOW(),$6)`,
      [version!.id, call.provider, call.model,
        Math.round(call.inputUsdPerMillion * 1e6), Math.round(call.outputUsdPerMillion * 1e6), call.url],
    );
  }
}

async function wrongTenantToken(fixture: ArticleChainFixture) {
  const email = "live-article-other-tenant@citefi.invalid";
  const [user] = await fixture.query<{ id: number }>(
    `INSERT INTO users (email, role, account_status, email_verified, full_name)
     VALUES ($1,'team_member','active',1,'Live QA Other Tenant') RETURNING id`, [email],
  );
  const [team] = await fixture.query<{ id: number }>(
    `INSERT INTO teams (name, created_by, billing_plan, billing_status)
    VALUES ('Live QA Other Tenant',$1,'paid','active') RETURNING id`, [user!.id],
  );
  await fixture.query("UPDATE users SET default_team_id=$1 WHERE id=$2", [team!.id, user!.id]);
  await fixture.query("INSERT INTO team_members (team_id,user_id,role) VALUES ($1,$2,'admin')", [team!.id, user!.id]);
  const { generateAccessToken, hashToken } = await import("../lib/auth");
  const token = generateAccessToken({ userId: user!.id, email, role: "team_member" });
  await fixture.query(
    `INSERT INTO sessions (user_id,token_hash,ip_address,user_agent,is_active,expires_at,
      last_activity_at,team_context_id,auth_assurance,mfa_verified_at)
     VALUES ($1,$2,'127.0.0.1','live-article-qa',1,NOW()+INTERVAL '1 day',NOW(),$3,'mfa',NOW())`,
    [user!.id, hashToken(token), team!.id],
  );
  return token; // runtime only, never exported
}

async function runLive() {
  assertPaidQaLedgerResolved();
  if (process.env.QA_LIVE_ARTICLE !== "I_AUTHORIZE_BOUNDED_LIVE_ARTICLE") {
    throw new Error("Explicit QA_LIVE_ARTICLE authorization required");
  }
  if (!process.env.GEMINI_API_KEY || !process.env.OPENAI_API_KEY) {
    throw new Error("Both provider credentials must already be injected; no dotenv fallback");
  }
  const wordCountMax = Number(process.env.QA_LIVE_WORD_MAX ?? 1400);
  if (![1400, 2000].includes(wordCountMax)) {
    throw new Error("Live QA word maximum must be explicitly 1400 or 2000");
  }
  const report = preflight();
  const budget = reserveRun(process.env.QA_LIVE_RUN_ID ?? "first-article-v1", report);
  durableJson(join(budget.directory, "requested-profile.json"), {
    wordCountMin: 700, wordCountMax,
    purpose: "Explicit requested word range; production validation remains unchanged",
  });
  installNetworkGuard(budget);
  let fixture: ArticleChainFixture | undefined;
  let workers: ArticleChainWorkers | undefined;
  let outcome: Record<string, unknown> = { status: "FAILED", endToEndPass: false };
  let exported = false;
  let stage = "owned-fixture-startup";
  try {
    const { startArticleChainFixture } = await import("../QA/support/article-chain-fixture");
    fixture = await startArticleChainFixture({
      authorization: "bounded-live-article", model: PLAN.calls[0]!.model,
      maxOutputTokens: PLAN.calls[0]!.maxOutputTokens,
      receiptDirectory: join(budget.directory, "production-receipt-spool"),
    });
    stage = "official-rate-seed";
    await seedRealRates(fixture);
    const otherToken = await wrongTenantToken(fixture);
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { timeout: 180000 } });
    stage = "owned-workers";
    workers = await fixture.startWorkers((request) => client.models.generateContent(request));
    // Exactly ONE authenticated submission. No submit retry, job replay, or polling generation endpoint.
    stage = "authenticated-single-submission";
    const submitted = await fetch(`${fixture.baseUrl}/api/jobs/batch-submit`, {
      method: "POST",
      headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json",
        "x-idempotency-key": "live-first-article-v1", "x-skip-intelligence-gate": "1" },
      body: JSON.stringify({
        batchId: fixture.batchId, selectedTitles: ["San Francisco Home-Care Planning"],
        targetUrl: "https://example.com/services", tone: "professional",
        wordCountMin: 700, wordCountMax, geographicFocus: "San Francisco",
        audience: "local families", businessName: "QA Article Chain",
        customInstructions: "This is a synthetic QA brief, not verified research. Do not invent facts or statistics. Include at least three useful links to the supplied target URL and an explicit Frequently Asked Questions section with at least three questions. Preserve Markdown headings and paragraphs.",
      }),
    });
    durableJson(join(budget.directory, "submission.json"), { status: submitted.status, body: await submitted.json() });
    assert.equal(submitted.status, 200, "Authenticated submission must succeed");
    stage = "await-production-output";
    let article: any;
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      [article] = await fixture.query(
        `SELECT id, article_status, final_html_content, error_message FROM articles
         WHERE batch_id=$1 ORDER BY id DESC LIMIT 1`, [fixture.batchId],
      );
      if (article && ["COMPLETE", "FAILED"].includes(article.article_status)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(article, "No article persisted");
    // Retrieval and denial are checked even when a production output gate rejects.
    stage = "retrieval-and-tenant-denial";
    const url = `${fixture.baseUrl}/api/content/${article.id}`;
    const retrieved = await fetch(url, { headers: { authorization: `Bearer ${fixture.token}` } });
    const body = await retrieved.json();
    durableJson(join(budget.directory, "retrieved-artifact.json"), { status: retrieved.status, body });
    const denied = await fetch(url, { headers: { authorization: `Bearer ${otherToken}` } });
    durableJson(join(budget.directory, "wrong-tenant.json"), { status: denied.status, body: await denied.json() });
    assert.equal(retrieved.status, 200);
    assert.equal(denied.status, 404, "Other authenticated tenant must not retrieve the article");
    assert.equal(body.article.id, article.id);
    assert.equal(body.article.htmlContent, article.final_html_content, "HTTP artifact must equal persisted output");
    if (typeof body.article.htmlContent === "string") {
      const fd = openSync(join(budget.directory, "article.html"), "w", 0o600);
      try { writeFileSync(fd, body.article.htmlContent); fsyncSync(fd); } finally { closeSync(fd); }
    }
    outcome = { status: article.article_status, endToEndPass: false, articleId: article.id,
      retrievedStatus: retrieved.status, wrongTenantStatus: denied.status,
      artifactSha256: sha256(body.article.htmlContent ?? ""),
      guardianCalls: workers.getGuardianAuditCalls(), judgeGateCalls: workers.getFinalizationGateCalls(),
      profile: report.syntheticBoundary, skipped: report.skipped };
    assert.equal(article.article_status, "COMPLETE", "Production gate rejected or timed out; not an end-to-end pass");
    assert.ok(body.article.htmlContent?.length > 0);
    assert.ok(workers.getGuardianAuditCalls() > 0);
    assert.ok(workers.getFinalizationGateCalls() > 0);
    outcome.endToEndPass = true;
  } catch (error) {
    // Do not copy SDK error objects, headers, credential-bearing URLs or stack traces.
    outcome.failureType = error instanceof Error ? error.name : "UnknownFailure";
    outcome.failureStage = stage;
    if (error instanceof assert.AssertionError) outcome.assertion = error.message;
    outcome.endToEndPass = false;
    process.exitCode = 1;
  } finally {
    await workers?.close();
    if (fixture) {
      const tables: Record<string, any[]> = {};
      for (const table of ["provider_attempt_receipts", "provider_usage_ledger", "credit_ledger",
        "article_runs", "article_assets", "articles", "content_reviews"]) {
        tables[table] = await fixture.query(`SELECT * FROM ${table}`);
        durableJson(join(budget.directory, `${table}.json`), tables[table]);
      }
      const expectedCreditRunId = `batch:${fixture.batchId}:live-first-article-v1`;
      tables.credit_reservations = await fixture.query(
        "SELECT * FROM credit_reservations WHERE team_id=$1 AND run_id=$2",
        [fixture.teamId, expectedCreditRunId],
      );
      durableJson(join(budget.directory, "credit_reservations.json"), tables.credit_reservations);
      tables.job_batches = await fixture.query(
        "SELECT * FROM job_batches WHERE id=$1 AND team_id=$2",
        [fixture.batchId, fixture.teamId],
      );
      durableJson(join(budget.directory, "job_batches.json"), tables.job_batches);
      if (outcome.endToEndPass) {
        const receipts = tables.provider_attempt_receipts!;
        const [currentReservation] = tables.credit_reservations!;
        const [currentBatch] = tables.job_batches!;
        const runDebits = tables.credit_ledger!.filter((row) =>
          row.team_id === fixture!.teamId &&
          row.run_id === expectedCreditRunId &&
          row.event_type === "debit",
        );
        outcome.accountingVerified =
          PLAN.calls.every((planned) => receipts.some((receipt) =>
            receipt.provider === planned.provider && receipt.model === planned.model &&
            receipt.provider_request_id && receipt.status === "accounted")) &&
          tables.provider_usage_ledger!.length === PLAN.calls.length &&
          tables.credit_ledger!.filter((row) => row.event_type === "debit").length === 1 &&
          currentReservation?.team_id === fixture.teamId &&
          currentReservation.run_id === expectedCreditRunId &&
          Number(currentReservation.remaining_amount) === 0 &&
          currentReservation.status === "DEBITED" &&
          currentBatch?.id === fixture.batchId &&
          currentBatch.team_id === fixture.teamId &&
          currentBatch.status === "COMPLETE" &&
          runDebits.length === 1 &&
          runDebits[0]?.team_id === fixture.teamId &&
          Math.abs(Number(runDebits[0]?.amount)) === Number(currentReservation.original_amount);
        if (!outcome.accountingVerified) {
          outcome.endToEndPass = false;
          outcome.failureStage = "durable-accounting-verification";
          process.exitCode = 1;
        }
      }
    }
    // All independent/provider/DB receipts and exact HTTP artifact precede cleanup.
    budget.finish(outcome);
    exported = true;
    if (exported && fixture) {
      if (workers) {
        await (await import("../lib/gemini")).closeGeminiRateLimiter();
        await (await import("../lib/openai-client")).closeOpenAIClient();
      }
      await (await import("../lib/db")).closeDb();
      await fixture.stop();
    }
    console.log(JSON.stringify({ evidence: budget.directory, ...outcome }));
  }
}

const mode = process.argv[2];
if (mode === "--smoke") smoke();
else if (mode === "--preflight") {
  const report = preflight();
  console.log(JSON.stringify({ evidence: ROOT, maximumUsd: report.maximumUsd, subcapUsd: 2, physicalCallsMaximum: 2 }));
} else if (mode === "--live") {
  assertPaidQaLedgerResolved();
  runLive().catch((error) => {
    mkdirSync(ROOT, { recursive: true });
    durableJson(join(ROOT, "harness-failure.json"), {
      type: error instanceof Error ? error.name : "UnknownFailure",
      message: "Harness aborted. Any existing reservation/lock must be reconciled; no automatic replay.",
    });
    console.error("Live harness failed; inspect durable evidence, do not replay automatically.");
    process.exitCode = 1;
  });
} else {
  throw new Error("Choose --smoke, --preflight, or explicit opt-in --live");
}