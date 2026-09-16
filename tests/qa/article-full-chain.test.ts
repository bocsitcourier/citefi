import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  startArticleChainFixture,
  type ArticleChainWorkers,
  type ArticleChainFixture,
} from "../../QA/support/article-chain-fixture";
import type { GeminiGenerateContentTransport } from "../../lib/gemini";

let fixture: ArticleChainFixture;
let workers: ArticleChainWorkers | undefined;

type TransportMode = "success" | "malformed" | "timeout";
const transportScenarios = new Map<string, TransportMode>();
let physicalProviderCalls = 0;

let debitPauseGate: {
  enabled: boolean;
  paused: boolean;
  entered: Promise<void>;
  release: Promise<void>;
  enter: () => void;
  releaseDebit: () => void;
} | null = null;

function articleMarkdown(title: string): string {
  const paragraph =
    `Residents and local teams can use this practical ${title} guide to make a clear, informed decision. ` +
    "Start with the goal, compare the available options, and ask each provider for written details " +
    "about timing, cost, safety, accessibility, and follow-up support. A short checklist keeps the " +
    "conversation focused while leaving room for personal circumstances and changing local conditions.";
  const paragraphs = Array.from({ length: 12 }, () => paragraph).join("\n\n");
  return `# ${title}

## What to consider

${paragraphs}

## Local planning checklist

Review the [service guide](https://example.com/services), the [planning checklist](https://example.com/services), and the [contact options](https://example.com/services) before choosing a next step. These links point to the owned destination supplied with the request.

## Frequently Asked Questions

### How should a reader begin?

Begin by writing down the desired outcome and the questions that matter most.

### What should be compared?

Compare transparent pricing, scope, timing, qualifications, and the support available after delivery.

### When should a plan be revisited?

Revisit the plan whenever circumstances, local requirements, or the reader's priorities change.

The result should be reviewed with the people responsible for carrying it out.`;
}

const transport: GeminiGenerateContentTransport = async (request) => {
  physicalProviderCalls += 1;
  const requestText = JSON.stringify(request.contents ?? "");
  const mode =
    [...transportScenarios.entries()]
      .find(([title]) => requestText.includes(title))?.[1] ?? "success";
  if (mode === "timeout") {
    throw new Error("provider timeout (QA transport)");
  }
  if (mode === "malformed") {
    return {
      responseId: `qa-malformed-${physicalProviderCalls}`,
      modelVersion: "gemini-3.5-flash",
      text: "this is not valid JSON",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 4,
        totalTokenCount: 16,
      },
    } as any;
  }
  const title = requestText.includes("QA article")
    ? "San Francisco Home-Care Planning"
    : "San Francisco Home-Care Planning";
  const body = {
    articleText: articleMarkdown(title),
    seoTitle: title,
    metaDescription: "A practical local planning guide for San Francisco readers.",
    slug: "san-francisco-home-care-planning",
    keywords: [
      "San Francisco home-care planning",
      "local home-care options",
      "home-care checklist",
      "care planning guide",
      "home support questions",
      "San Francisco services",
    ],
    hashtags: [
      "#SanFrancisco",
      "#HomeCare",
      "#CarePlanning",
      "#LocalServices",
      "#FamilySupport",
      "#Accessibility",
      "#CommunityCare",
      "#PlanningGuide",
    ],
    faq: [
      { question: "How should a reader begin?", answer: "Start with the desired outcome." },
      { question: "What should be compared?", answer: "Compare scope, cost, and support." },
      { question: "When should a plan be revisited?", answer: "Revisit it as needs change." },
    ],
    imagePrompts: [],
    wordCount: bodyWordCount(articleMarkdown(title)),
  };
  return {
    responseId: `qa-success-${physicalProviderCalls}`,
    modelVersion: "gemini-3.5-flash",
    text: JSON.stringify(body),
    usageMetadata: {
      promptTokenCount: 140,
      candidatesTokenCount: 780,
      totalTokenCount: 920,
    },
  } as any;
};

function bodyWordCount(content: string): number {
  return content.replace(/[#*_()[\]]/g, " ").split(/\s+/).filter(Boolean).length;
}

function submissionBody(
  batchId: number,
  title: string | string[] = "San Francisco Home-Care Planning",
) {
  const selectedTitles = Array.isArray(title) ? title : [title];
  return {
    batchId,
    selectedTitles,
    targetUrl: "https://example.com/services",
    tone: "professional",
    wordCountMin: 500,
    wordCountMax: 1500,
    geographicFocus: "San Francisco",
    audience: "local families",
    businessName: "QA Article Chain",
  };
}

async function assertHttpOk(response: Response, label: string): Promise<void> {
  if (response.status !== 200) {
    throw new Error(`${label} returned HTTP ${response.status}: ${await response.text()}`);
  }
}

async function submit(
  batchId: number,
  key: string,
  title?: string | string[],
): Promise<Response> {
  return fetch(`${fixture.baseUrl}/api/jobs/batch-submit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${fixture.token}`,
      "content-type": "application/json",
      "x-idempotency-key": key,
      "x-skip-intelligence-gate": "1",
    },
    body: JSON.stringify(submissionBody(batchId, title)),
  });
}

async function waitForArticle(
  batchId: number,
  expected: "COMPLETE" | "FAILED",
  timeoutMs = 45_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await fixture.query<any>(
      `SELECT id, article_status AS "articleStatus", final_html_content AS "html",
              error_message AS "errorMessage"
       FROM articles WHERE batch_id = $1 ORDER BY id DESC LIMIT 1`,
      [batchId],
    );
    const status = rows[0]?.articleStatus;
    if (status === expected) return rows[0];
    if (status === "FAILED" && expected !== "FAILED") {
      throw new Error(
        `batch ${batchId} article failed before reaching ${expected}: ${rows[0]?.errorMessage ?? "unknown error"}`,
      );
    }
    if (status === "COMPLETE" && expected === "FAILED") {
      throw new Error(`batch ${batchId} unexpectedly completed while waiting for FAILED`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`batch ${batchId} did not reach ${expected}`);
}

async function waitForProviderCalls(
  minimum: number,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (physicalProviderCalls >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `provider transport reached ${physicalProviderCalls} calls; expected at least ${minimum}`,
  );
}

async function waitForBatchStatus(
  batchId: number,
  expected: string,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await fixture.query<{ status: string }>(
      `SELECT status FROM job_batches WHERE id = $1`,
      [batchId],
    );
    if (rows[0]?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`batch ${batchId} did not reach ${expected}`);
}

before(async () => {
  fixture = await startArticleChainFixture();
  workers = await fixture.startWorkers(transport, {
    afterDebit: async () => {
      const gate = debitPauseGate;
      if (!gate?.enabled || gate.paused) return;
      gate.paused = true;
      gate.enter();
      await gate.release;
    },
  });
});

after(async () => {
  await workers?.close();
  await fixture.stop();
});

test("authenticated submit reaches COMPLETE and retrieval is team-scoped", async () => {
  const title = "QA positive chain";
  transportScenarios.set(title, "success");
  const finalizationCallsBefore = workers!.getFinalizationGateCalls();
  const response = await submit(fixture.batchId, "qa-positive-chain-v1", title);
  await assertHttpOk(response, "positive submission");
  const article = await waitForArticle(fixture.batchId, "COMPLETE");
  assert.match(article.html, /<article\b/i);
  assert.match(article.html, /San Francisco/);
  assert.equal(
    workers!.getFinalizationGateCalls() - finalizationCallsBefore,
    1,
    "successful speed-mode article must execute the production finalization gate exactly once",
  );

  const retrieval = await fetch(`${fixture.baseUrl}/api/articles/list`, {
    headers: { authorization: `Bearer ${fixture.token}` },
  });
  await assertHttpOk(retrieval, "article retrieval");
  const rows = await retrieval.json() as Array<{ article_status: string }>;
  assert.ok(rows.some((row) => row.article_status === "COMPLETE"));
});

test("duplicate idempotency key creates one submission and one charge", async () => {
  const title = "QA duplicate chain";
  transportScenarios.set(title, "success");
  const batchId = await fixture.createBatch();
  const key = "qa-duplicate-chain-v1";
  const beforeCalls = physicalProviderCalls;
  const [first, second] = await Promise.all([submit(batchId, key, title), submit(batchId, key, title)]);
  // The idempotency claim can briefly surface a documented 503 while the
  // concurrent request observes the first request's durable submission.
  assert.ok([200, 409, 503].includes(first.status), `first status ${first.status}`);
  assert.ok([200, 409, 503].includes(second.status), `second status ${second.status}`);
  await waitForArticle(batchId, "COMPLETE");

  const evidence = await fixture.query<{
    submissions: number;
    debits: number;
    providerAttempts: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM credit_ledger WHERE team_id = $1 AND event_type = 'reserve'
        AND run_id LIKE $2) AS submissions,
       (SELECT count(*)::int FROM credit_ledger WHERE team_id = $1 AND event_type = 'debit'
        AND run_id LIKE $2) AS debits,
       (SELECT count(*)::int FROM provider_attempt_receipts WHERE team_id = $1
        AND status = 'accounted'
        AND resource_id IN (
          SELECT id::text FROM articles WHERE batch_id = $3
        )) AS "providerAttempts"`,
    [fixture.teamId, `batch:${batchId}:%`, batchId],
  );
  assert.equal(evidence[0]?.submissions, 1, "one reserve per submitted batch");
  assert.equal(evidence[0]?.debits, 1, "one debit per submitted batch");
  assert.equal(evidence[0]?.providerAttempts, 1, "one provider receipt per submitted batch");
  assert.equal(
    physicalProviderCalls - beforeCalls,
    1,
    "duplicate delivery must not replay the provider transport",
  );
});

test("two-article shared reservation waits for a paused sibling debit", async () => {
  const firstTitle = "QA paused debit first";
  const secondTitle = "QA paused debit sibling";
  transportScenarios.set(firstTitle, "success");
  transportScenarios.set(secondTitle, "success");
  const batchId = await fixture.createBatch();
  const batchRunPattern = `batch:${batchId}:%`;
  let enterPause!: () => void;
  let releaseDebit!: () => void;
  const entered = new Promise<void>((resolve) => { enterPause = resolve; });
  const released = new Promise<void>((resolve) => { releaseDebit = resolve; });
  debitPauseGate = {
    enabled: true,
    paused: false,
    entered,
    release: released,
    enter: enterPause,
    releaseDebit,
  };
  try {
    const beforeCalls = physicalProviderCalls;
    const response = await submit(
      batchId,
      "qa-paused-debit-shared-reservation-v1",
      [firstTitle, secondTitle],
    );
    await assertHttpOk(response, "paused-debit submission");
    await Promise.race([
      entered,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("first article debit did not pause")), 20_000),
      ),
    ]);

    await waitForProviderCalls(beforeCalls + 2);
    const pendingDeadline = Date.now() + 20_000;
    let pendingEvidence: { debits: number; releases: number } | undefined;
    while (Date.now() < pendingDeadline) {
      const rows = await fixture.query<{ debits: number; releases: number }>(
        `SELECT
           (SELECT count(*)::int FROM credit_ledger
              WHERE run_id LIKE $1 AND event_type = 'debit') AS debits,
           (SELECT count(*)::int FROM credit_ledger
              WHERE run_id LIKE $1 AND event_type = 'release') AS releases`,
        [batchRunPattern],
      );
      pendingEvidence = rows[0];
      if (pendingEvidence?.debits === 1 && pendingEvidence.releases === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(pendingEvidence?.debits, 1);
    assert.equal(
      pendingEvidence?.releases,
      0,
      "sibling completion must not release the paused article's shared reservation",
    );

    releaseDebit();
    await waitForProviderCalls(beforeCalls + 2);
    await waitForBatchStatus(batchId, "COMPLETE");
    const finalEvidence = await fixture.query<{
      reserveAmount: number;
      debitCount: number;
      debitAmount: number;
      releaseCount: number;
      releaseAmount: number;
      runStatuses: string;
    }>(
      `SELECT
         (SELECT COALESCE(sum(amount), 0)::int FROM credit_ledger
            WHERE run_id LIKE $1 AND event_type = 'reserve') AS "reserveAmount",
         (SELECT count(*)::int FROM credit_ledger
            WHERE run_id LIKE $1 AND event_type = 'debit') AS "debitCount",
         (SELECT COALESCE(sum(amount), 0)::int FROM credit_ledger
            WHERE run_id LIKE $1 AND event_type = 'debit') AS "debitAmount",
         (SELECT count(*)::int FROM credit_ledger
            WHERE run_id LIKE $1 AND event_type = 'release') AS "releaseCount",
         (SELECT COALESCE(sum(amount), 0)::int FROM credit_ledger
            WHERE run_id LIKE $1 AND event_type = 'release') AS "releaseAmount",
         (SELECT COALESCE(string_agg(status, ',' ORDER BY article_id), '')
            FROM article_runs ar
            INNER JOIN articles a ON a.id = ar.article_id
            WHERE a.batch_id = $2
              AND ar.billing_run_id LIKE $1) AS "runStatuses"`,
      [batchRunPattern, batchId],
    );
    assert.equal(finalEvidence[0]?.debitCount, 2);
    assert.equal(finalEvidence[0]?.debitAmount, -Number(finalEvidence[0]?.reserveAmount));
    assert.equal(finalEvidence[0]?.releaseCount, 0);
    assert.equal(finalEvidence[0]?.releaseAmount, 0);
    assert.equal(finalEvidence[0]?.runStatuses, "completed,completed");
  } finally {
    releaseDebit();
    debitPauseGate = null;
    transportScenarios.delete(firstTitle);
    transportScenarios.delete(secondTitle);
  }
});

test("malformed provider output and timeout fail without a published artifact", async () => {
  for (const mode of ["malformed", "timeout"] as const) {
    const batchId = await fixture.createBatch();
    const title = `QA ${mode} chain`;
    transportScenarios.set(title, mode);
    const beforeCalls = physicalProviderCalls;
    const response = await submit(batchId, `qa-${mode}-chain-v1`, title);
    await assertHttpOk(response, `${mode} submission`);
    const expectedProviderCalls = beforeCalls + 1;
    const article = await waitForArticle(batchId, "FAILED");
    // The first physical response/timeout durably advances the provider
    // receipt. Any queue redelivery must stop at the terminal receipt instead
    // of replaying a paid call.
    await waitForProviderCalls(expectedProviderCalls);
    await waitForBatchStatus(batchId, "FAILED");
    assert.equal(article.html, null, `${mode} must not publish HTML`);
    assert.notEqual(article.articleStatus, "COMPLETE");
    const settlement = await fixture.query<{
      batchStatus: string;
      reserves: number;
      reserveAmount: number;
      releases: number;
      releasedAmount: number;
      debits: number;
      reservationRemaining: number;
      reconciliationRequired: boolean;
      providerReceipts: number;
      providerStatuses: string;
    }>(
      `SELECT
         (SELECT status FROM job_batches WHERE id = $1) AS "batchStatus",
         (SELECT count(*)::int FROM credit_ledger
            WHERE run_id LIKE $2 AND event_type = 'reserve') AS reserves,
         (SELECT COALESCE(sum(amount), 0)::int FROM credit_ledger
            WHERE run_id LIKE $2 AND event_type = 'reserve') AS "reserveAmount",
         (SELECT count(*)::int FROM credit_ledger
            WHERE run_id LIKE $2 AND event_type = 'release') AS releases,
         (SELECT COALESCE(sum(amount), 0)::int FROM credit_ledger
            WHERE run_id LIKE $2 AND event_type = 'release') AS "releasedAmount",
         (SELECT count(*)::int FROM credit_ledger
            WHERE run_id LIKE $2 AND event_type = 'debit') AS debits,
         (SELECT remaining_amount::int FROM credit_reservations
            WHERE team_id = (SELECT team_id FROM job_batches WHERE id = $1)
              AND run_id LIKE $2 LIMIT 1) AS "reservationRemaining",
         (SELECT reconciliation_required_at IS NOT NULL FROM credit_reservations
            WHERE team_id = (SELECT team_id FROM job_batches WHERE id = $1)
              AND run_id LIKE $2 LIMIT 1) AS "reconciliationRequired",
         (SELECT count(*)::int FROM provider_attempt_receipts
            WHERE team_id = (SELECT team_id FROM job_batches WHERE id = $1)
              AND resource_type = 'article'
              AND resource_id = $3::text) AS "providerReceipts",
         (SELECT COALESCE(string_agg(status, ',' ORDER BY status), '')
            FROM provider_attempt_receipts
            WHERE team_id = (SELECT team_id FROM job_batches WHERE id = $1)
              AND resource_type = 'article'
              AND resource_id = $3::text) AS "providerStatuses"`,
      [batchId, `batch:${batchId}:%`, article.id],
    );
    assert.equal(settlement[0]?.batchStatus, "FAILED");
    assert.equal(settlement[0]?.reserves, 1);
    assert.equal(settlement[0]?.releases, 0, "provider uncertainty must not refund credits");
    assert.equal(settlement[0]?.releasedAmount, 0);
    assert.equal(settlement[0]?.debits, 0);
    assert.equal(
      settlement[0]?.reservationRemaining,
      settlement[0]?.reserveAmount,
      "this run's reservation must retain its remaining hold",
    );
    assert.equal(settlement[0]?.reconciliationRequired, true);
    assert.equal(settlement[0]?.providerReceipts, 1);
    assert.match(
      settlement[0]?.providerStatuses ?? "",
      mode === "timeout" ? /uncertain/ : /accounted/,
    );
    transportScenarios.delete(title);
  }
});

test("provider evidence is accounted once and remains non-replayable", async () => {
  const title = "QA no replay chain";
  transportScenarios.set(title, "success");
  const batchId = await fixture.createBatch();
  const beforeCalls = physicalProviderCalls;
  const key = "qa-provider-no-replay-v1";
  const initial = await submit(batchId, key, title);
  await assertHttpOk(initial, "provider evidence submission");
  await waitForArticle(batchId, "COMPLETE");
  const firstEvidence = await fixture.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM provider_attempt_receipts
      WHERE team_id = $1 AND status = 'accounted'
        AND resource_id IN (
          SELECT id::text FROM articles WHERE batch_id = $2
        )`,
    [fixture.teamId, batchId],
  );
  // Replaying the same HTTP operation is a durable idempotency read, not a new
  // queue/provider delivery.
  const replay = await submit(batchId, key, title);
  assert.ok([200, 409].includes(replay.status));
  const secondEvidence = await fixture.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM provider_attempt_receipts
      WHERE team_id = $1 AND status = 'accounted'
        AND resource_id IN (
          SELECT id::text FROM articles WHERE batch_id = $2
        )`,
    [fixture.teamId, batchId],
  );
  assert.equal(secondEvidence[0]?.count, firstEvidence[0]?.count);
  assert.equal(physicalProviderCalls - beforeCalls, 1);
});