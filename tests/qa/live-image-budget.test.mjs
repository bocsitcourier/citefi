import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";

const project = process.cwd();
const evidence = resolve(project, "QA/evidence/live-current");

test("retained native image response is receipted offline with complete capped token pricing", async t => {
  const root = mkdtempSync(resolve(tmpdir(), "image-budget-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = resolve(root, "QA/evidence/live-current");
  mkdirSync(target, { recursive: true });
  for (const file of ["budget-baseline.json", "media-pricing-current.md"]) {
    cpSync(resolve(evidence, file), resolve(target, file));
  }
  writeSyntheticLedger(target);
  const support = resolve(root, "QA/support");
  mkdirSync(support, { recursive: true });
  const modulePath = resolve(support, "live-media-budget.mjs");
  cpSync(resolve(project, "QA/support/live-media-budget.mjs"), modulePath);
  cpSync(resolve(project, "QA/support/budget-ledger-dispute.mjs"),
    resolve(support, "budget-ledger-dispute.mjs"));
  let budget;
  process.chdir(root);
  try {
    budget = await import(pathToFileURL(modulePath).href);
  } finally {
    process.chdir(project);
  }
  const native = JSON.parse(readFileSync(resolve(evidence,
    "live-media-image-20261008/image-native-response.json"), "utf8"));
  const run = reserveOfflineImage(budget, "offline-native-replay");
  const receipt = run.receive(run.submit(917, "offline-replay"), new Response(null, { status: 200 }), native);
  assert.equal(receipt.actualUsd, 0.068762);
  assert.equal(receipt.state, "receipted");
  assert.deepEqual(receipt.billedSplit, {
    inputTokens: 172, imageTokens: 1120, otherOutputTokens: 492, thinkingTokens: 0,
  });
  run.finish({ endToEndPass: true });

  const mutations = [
    body => body.candidates[0].content.parts.push({ text: "not image-only" }),
    body => { body.candidates[0].content.parts[0].text = "mixed part"; },
    body => { delete body.responseId; },
    body => { body.modelVersion = "wrong-model"; },
    body => {
      body.usageMetadata.candidatesTokenCount = 2521;
      body.usageMetadata.totalTokenCount = 2693;
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    // Each rejected outcome intentionally retains its lock, so isolate again.
    const isolatedRoot = resolve(root, `case-${index}`);
    const caseEvidence = resolve(isolatedRoot, "QA/evidence/live-current");
    mkdirSync(caseEvidence, { recursive: true });
    for (const file of ["budget-baseline.json", "media-pricing-current.md"]) {
      cpSync(resolve(evidence, file), resolve(caseEvidence, file));
    }
    writeSyntheticLedger(caseEvidence);
    const caseSupport = resolve(isolatedRoot, "QA/support");
    mkdirSync(caseSupport, { recursive: true });
    const caseModule = resolve(caseSupport, "budget.mjs");
    cpSync(modulePath, caseModule);
    cpSync(resolve(project, "QA/support/budget-ledger-dispute.mjs"),
      resolve(caseSupport, "budget-ledger-dispute.mjs"));
    let isolated;
    process.chdir(isolatedRoot);
    try { isolated = await import(pathToFileURL(caseModule).href); }
    finally { process.chdir(project); }
    const invalid = structuredClone(native);
    mutate(invalid);
    const rejected = reserveOfflineImage(isolated, `offline-invalid-${index}`);
    assert.throws(() => rejected.receive(rejected.submit(917, "offline"), new Response(null), invalid), /ambiguous/);
  }
});

async function isolatedBudget(t, files) {
  const root = mkdtempSync(resolve(tmpdir(), "image-budget-auth-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = resolve(root, "QA/evidence/live-current");
  mkdirSync(target, { recursive: true });
  for (const file of files.filter(file => file !== "budget-ledger.json" && file !== "test-two-settled-images")) {
    cpSync(resolve(evidence, file), resolve(target, file));
  }
  writeSyntheticLedger(target, files.includes("test-two-settled-images"));
  const support = resolve(root, "QA/support");
  mkdirSync(support, { recursive: true });
  const modulePath = resolve(support, "live-media-budget.mjs");
  cpSync(resolve(project, "QA/support/live-media-budget.mjs"), modulePath);
  cpSync(resolve(project, "QA/support/budget-ledger-dispute.mjs"),
    resolve(support, "budget-ledger-dispute.mjs"));
  process.chdir(root);
  try { return { budget: await import(pathToFileURL(modulePath).href), target }; }
  finally { process.chdir(project); }
}

function writeSyntheticLedger(target, twoSettledImages = false) {
  const baselineBytes = readFileSync(resolve(target, "budget-baseline.json"));
  const sourceSha256 = createHash("sha256").update(baselineBytes).digest("hex");
  const runs = twoSettledImages ? [
    { runId: "fixture-image-one", state: "settled", actualUsd: 0.068726,
      reservedUsd: 0.16, createdAt: "2026-10-09T00:55:00.000Z",
      calls: [{ role: "image" }] },
    { runId: "fixture-image-two", state: "settled", actualUsd: 0.068663,
      reservedUsd: 0.16, createdAt: "2026-10-09T01:04:00.000Z",
      calls: [{ role: "image" }] },
  ] : [];
  writeFileSync(resolve(target, "budget-ledger.json"), JSON.stringify({
    version: 2, ceilingUsd: 30, budgetBaseline: { sourceSha256 }, runs,
  }, null, 2));
}

function reserveOfflineImage(budget, runId) {
  const report = budget.preflight({ offline: true });
  return budget.reserveImageRun(runId, report, { offline: true });
}

test("a third image run under the exhausted owner authorization is refused before any lock or ledger write", async t => {
  const files = ["budget-baseline.json", "budget-ledger.json", "media-pricing-current.md",
    "budget.lock", "paid-verification-authorization-20261009.json", "test-two-settled-images"];
  const { budget, target } = await isolatedBudget(t, files);
  const before = Object.fromEntries(["budget-ledger.json", "budget.lock"]
    .map(f => [f, readFileSync(resolve(target, f), "utf8")]));
  assert.throws(() => reserveOfflineImage(budget, "live-image-third-denied"), /authorization exhausted/);
  for (const [f, text] of Object.entries(before)) assert.equal(readFileSync(resolve(target, f), "utf8"), text);
  assert.throws(() => readFileSync(resolve(target, "image-child.lock")), /ENOENT/);
});

test("held parent lock without an explicit image authorization is refused", async t => {
  const { budget } = await isolatedBudget(t, ["budget-baseline.json", "budget-ledger.json", "media-pricing-current.md", "budget.lock"]);
  assert.throws(() => reserveOfflineImage(budget, "live-image-unauthorized"), /no explicit image child-lock authorization/);
});
