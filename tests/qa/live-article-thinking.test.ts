import assert from "node:assert/strict";
import test from "node:test";
import { GenerateContentResponse } from "@google/genai";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { PLAN, validateRequest, requireArchitectApproval } from "../../QA/support/live-article-budget.mjs";
import { verifyLiveAccounting } from "../../QA/support/live-article-accounting.mjs";
import { articleGenerationLimits } from "../../lib/article-request-limits";
import { extractGeminiRequestLimits, submitGeminiWithReceipt } from "../../lib/gemini-attempt-receipt";
import { MemoryProviderAttemptReceiptStore, MemoryProviderAttemptReceiptSpool } from "../../lib/provider-attempt-receipts";

test("bounded configuration is model-specific, serialized and persisted without prompts", async () => {
  const config = articleGenerationLimits("gemini-3.5-flash", { maxOutputTokens: 16384, thinkingLevel: "MINIMAL" });
  assert.deepEqual(config, { maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: "MINIMAL" } });
  assert.deepEqual(articleGenerationLimits("gemini-2.5-flash"), { maxOutputTokens: 65536 });
  assert.throws(() => articleGenerationLimits("gemini-2.5-flash", { maxOutputTokens: 16384, thinkingLevel: "MINIMAL" }));
  assert.throws(() => articleGenerationLimits("gemini-3.5-flash", { maxOutputTokens: 0 }));
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  await submitGeminiWithReceipt(
    { model: "gemini-3.5-flash", contents: "private prompt never persisted", config },
    { teamId: 1, articleId: 1, operationType: "article_generation" },
    async () => Object.assign(new GenerateContentResponse(), { responseId: "offline-receipt", usageMetadata: {
      promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 60,
    } }),
    { store, spool, validateOwnership: async () => undefined, recordUsage: async () => ({ inserted: true }) },
  );
  const [receipt] = [...store.rows.values()];
  assert.equal(receipt!.requestMetadata.thinkingLevel, "MINIMAL");
  assert.equal(receipt!.requestMetadata.maxOutputTokens, 16384);
  assert.equal(receipt!.responseUsage?.outputUnits, 50);
  assert.equal(JSON.stringify(receipt).includes("private prompt"), false);
  assert.equal(extractGeminiRequestLimits(config).thinkingBudget, undefined);
});

test("strict request guard rejects unsupported reasoning controls before submission", () => {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
  const request = (thinkingConfig: unknown, maxOutputTokens = 16384) => ({
    method: "POST", body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "offline" }] }],
      generationConfig: { maxOutputTokens, thinkingConfig },
    }),
  });
  assert.equal(validateRequest(url, request({ thinkingLevel: "MINIMAL" })).call.role, "article");
  for (const value of [undefined, {}, { thinkingBudget: 0 }, { thinkingLevel: "HIGH" },
    { thinkingLevel: "MINIMAL", thinkingBudget: 0 }, { thinkingLevel: "MINIMAL", includeThoughts: true }]) {
    assert.throws(() => validateRequest(url, request(value)));
  }
  assert.throws(() => validateRequest(url, request({ thinkingLevel: "MINIMAL" }, 65536)));
});

test("approval must bind an explicit case, configuration and historical baseline", () => {
  const report = { configurationSha256: "config", budgetBaseline: { sourceSha256: "baseline" } };
  const approval = { decision: "APPROVED", caseId: "offline-only-case", configurationSha256: "config",
    baselineSha256: "baseline", reviewEvidence: "architect review" };
  requireArchitectApproval("offline-only-case", report, approval);
  for (const changed of [null, { ...approval, decision: "PENDING" },
    { ...approval, caseId: "another-case" }, { ...approval, configurationSha256: "old" },
    { ...approval, baselineSha256: "old" }]) {
    assert.throws(() => requireArchitectApproval("offline-only-case", report, changed));
  }
  assert.throws(() => requireArchitectApproval(undefined, report, approval));
});

test("live accounting rejects candidate-only pricing, missing native usage and wrong locked rates", () => {
  const call = PLAN.calls[0]!;
  const receipt = { provider: call.provider, model: call.model, team_id: 1, status: "accounted",
    source_event_id: "offline-event", provider_request_id: "offline-native-id",
    request_metadata: { maxOutputTokens: 16384, thinkingLevel: "MINIMAL" },
    response_usage: { inputUnits: 6674, outputUnits: 16368, raw: {
      promptTokenCount: 6674, thoughtsTokenCount: 15004, candidatesTokenCount: 1364, totalTokenCount: 23042,
    } } };
  const row = { provider: call.provider, model: call.model, team_id: 1,
    source_event_id: "offline-event", provider_request_id: "offline-native-id",
    input_units: 6674, output_units: 16368, unit_count: 23042, cost_microusd: "157323",
    rate_version_id: 1, provider_rate_id: 1,
    rate_snapshot: { inputMicrousdPerMillion: 1500000, outputMicrousdPerMillion: 9000000 } };
  const tables = { provider_attempt_receipts: [receipt], provider_usage_ledger: [row] };
  assert.equal(verifyLiveAccounting(tables, [call], 1), true);
  assert.equal(verifyLiveAccounting({ ...tables, provider_usage_ledger: [{ ...row, output_units: 1364, cost_microusd: "22287" }] }, [call], 1), false);
  assert.equal(verifyLiveAccounting({ ...tables, provider_usage_ledger: [{ ...row, rate_snapshot: { ...row.rate_snapshot, outputMicrousdPerMillion: 1000000 } }] }, [call], 1), false);
  assert.equal(verifyLiveAccounting({ ...tables, provider_attempt_receipts: [{ ...receipt, response_usage: { ...receipt.response_usage, raw: {} } }] }, [call], 1), false);
  assert.equal(verifyLiveAccounting(tables, [call], 2), false);
});

test("isolated ledger forbids physical replay and pass without a genuine judge; settlement releases the hold", () => {
  const root = mkdtempSync(join(tmpdir(), "offline-live-budget-"));
  const evidence = join(root, "QA/evidence/live-current");
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, "budget-baseline.json"), JSON.stringify({
    version: 1, ceilingUsd: 30, knownPriorUsd: 0.517071, historicalHoldUsd: 6,
    historicalCalls: "UNKNOWN / UNRECONCILED",
  }));
  for (const file of ["google-pricing-source.md", "openai-gpt41mini-pricing-source.md", "thinking-controls-source.md"]) {
    writeFileSync(join(evidence, file), "Offline fixture source only. ".repeat(10));
  }
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      import { PLAN, preflight, reserveRun } from ${JSON.stringify(resolve("QA/support/live-article-budget.mjs"))};
      const budget = reserveRun("offline-unique-case", preflight());
      const call = PLAN.calls[0];
      const attempt = budget.submit(call, 100, "offline-request");
      assert.throws(() => budget.submit(call, 100, "offline-replay"));
      budget.receive(call, attempt, new Response("{}", {status: 200}), {
        responseId: "offline-native", modelVersion: call.model,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 60 },
      });
      assert.throws(() => budget.finish({endToEndPass: true}));
      budget.finish({endToEndPass: false});
      const ledger = JSON.parse(readFileSync("QA/evidence/live-current/budget-ledger.json"));
      assert.equal(ledger.runs[0].state, "settled");
      assert.equal(ledger.runs[0].actualUsd, 0.000465);
      assert.equal(ledger.totalBudget.historicalHoldUsd, 6);
      const settlement = JSON.parse(readFileSync("QA/evidence/live-current/offline-unique-case/budget-settlement.json"));
      assert.equal(settlement.remainingReservedUsd, 0);
      assert.throws(() => reserveRun("offline-unique-case", preflight()));
    `], { cwd: root, stdio: "pipe" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
