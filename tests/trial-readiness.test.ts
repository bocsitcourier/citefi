import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateTrialReadiness, trialRateFitsReservation, type TrialReadinessSnapshot } from "../lib/trial/readiness";

const ready: TrialReadinessSnapshot = {
  sponsor: true, rate: { input: "100000", output: "400000" }, spent: "0",
  daily: "0", hourly: "0", concurrent: "0", sessions: "0",
  generatorConfigured: true, sessionConfigured: true,
};
test("readiness is explicitly not real delivery or a provider attempt", () => {
  assert.deepEqual(evaluateTrialReadiness(ready), { ok: true, check: "free_article_readiness",
    delivery: "not_tested", providerRequests: 0, failures: [] });
});
test("missing sponsor and missing or over-budget accepted rate fail closed", () => {
  for (const rate of [null, { input: null, output: 0 }, { input: -1, output: 0 },
    { input: "NaN", output: 0 }, { input: 0, output: 1000000000 }]) {
    assert.equal(trialRateFitsReservation(rate), false);
    const report = evaluateTrialReadiness({ ...ready, sponsor: false, rate });
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures, ["sponsor_not_provisioned", "sponsor_pricing_unavailable"]);
  }
});
test("blocked initialization, generator config and capacity are independently detected", () => {
  for (const change of [{ sessionConfigured: false }, { sessions: 1000 }]) {
    assert.deepEqual(evaluateTrialReadiness({ ...ready, ...change }).failures, ["initialization_blocked"]);
  }
  assert.deepEqual(evaluateTrialReadiness({ ...ready, generatorConfigured: false }).failures, ["generator_not_configured"]);
  assert.deepEqual(evaluateTrialReadiness({ ...ready, spent: 5000000 }).failures, ["daily_budget_exhausted"]);
  for (const change of [{ daily: 100 }, { hourly: 10 }, { concurrent: 3 }]) {
    assert.deepEqual(evaluateTrialReadiness({ ...ready, ...change }).failures, ["admission_at_capacity"]);
  }
  assert.equal(evaluateTrialReadiness({ ...ready, spent: "9007199254740992" }).ok, false);
});
test("native preflight stays read-only, selects accepted locked rates, retains all generating holds", () => {
  const source = readFileSync("lib/trial/readiness-server.ts", "utf8");
  assert.match(source, /accessMode: "read only"/);
  assert.match(source, /statement_timeout = '2000ms'/);
  assert.match(source, /v\.locked_at IS NOT NULL/);
  assert.match(source, /r\.effective_from<=now\(\)/);
  assert.match(source, /r\.effective_to>now\(\)/);
  assert.match(source, /v\.effective_from<=now\(\)/);
  assert.match(source, /v\.effective_to>now\(\)/);
  assert.match(source, /status='generating'\s+AND \(started_at IS NULL OR started_at>=now\(\)-\$\{TRIAL_STALE_AFTER_MS\}/);
  assert.doesNotMatch(source, /submitGemini|GoogleGenAI|generateArticleTrial|UPDATE |INSERT |DELETE |row_security|SET.*ROLE/i);
  assert.match(source, /logError/);
  assert.match(source, /recordTrialFailure/);
  const health = readFileSync("app/api/health/route.ts", "utf8");
  assert.match(health, /evaluateCanaryHealth/);
  assert.doesNotMatch(health, /getTrialReadiness/);
});
