import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { assertPaidQaLedgerResolved } from "../../QA/support/budget-ledger-dispute.mjs";
import { assertPaidMediaPermission, sharedBudget } from "../../QA/support/selected-media-plan.mjs";
import { reserveSelectedMediaRun } from "../../QA/support/selected-media-run.mjs";

const root = resolve("QA/evidence/live-current");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("the exact HEAD and MERGE_HEAD bytes are separately bound as non-authoritative history", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "budget-ledger-dispute.json"), "utf8"));
  assert.equal(manifest.status, "disputed");
  assert.equal(manifest.authoritativeCurrentBalance, false);
  assert.equal(manifest.financialInterpretation, "UNKNOWN — no settlement, refund, or free-call inference");
  assert.deepEqual(manifest.snapshots.map(({ side, sha256, authoritative }) =>
    [side, sha256, authoritative]), [
    ["HEAD", "70379464d6fef0de280ecb0d5c3a7921de8c200f2054f68bee0e4afbfebebb11", false],
    ["MERGE_HEAD", "94de5b68c8dabaa7d6e420f68ef1ea7ba90ace62befa3ad5016a82d6065900a2", false],
  ]);
  for (const snapshot of manifest.snapshots) {
    assert.equal(digest(readFileSync(resolve(root, "disputed-ledger-snapshots", snapshot.file))),
      snapshot.sha256);
  }
});

test("the live paid-QA ledger fence ignores environment bypass flags and blocks before writes", () => {
  const currentPath = resolve(root, "budget-ledger.json");
  const lockPath = resolve(root, "budget.lock");
  const currentBefore = readFileSync(currentPath);
  const lockBefore = existsSync(lockPath) ? readFileSync(lockPath) : null;
  const previous = process.env.QA_LEDGER_DISPUTE_BYPASS;
  process.env.QA_LEDGER_DISPUTE_BYPASS = "1";
  try {
    assert.throws(assertPaidQaLedgerResolved, /ledger dispute unresolved/);
    assert.throws(() => sharedBudget(), /ledger dispute unresolved/);
    assert.throws(() => assertPaidMediaPermission("podcast"), /ledger dispute unresolved/);
    assert.throws(() => reserveSelectedMediaRun("podcast", "dispute-guard-offline-test"),
      /ledger dispute unresolved/);
  } finally {
    if (previous === undefined) delete process.env.QA_LEDGER_DISPUTE_BYPASS;
    else process.env.QA_LEDGER_DISPUTE_BYPASS = previous;
  }
  assert.deepEqual(readFileSync(currentPath), currentBefore);
  assert.equal(existsSync(lockPath), lockBefore !== null);
  if (lockBefore) assert.deepEqual(readFileSync(lockPath), lockBefore);
});

test("changing cwd cannot redirect the module-bound dispute fence to forged owner JSON", async t => {
  const fixture = mkdtempSync(resolve(tmpdir(), "ledger-dispute-module-root-"));
  const moduleDirectory = resolve(fixture, "QA/support");
  const fixtureEvidence = resolve(fixture, "QA/evidence/live-current");
  const alternateCwd = resolve(fixture, "attacker-cwd");
  const alternateEvidence = resolve(alternateCwd, "QA/evidence/live-current");
  mkdirSync(moduleDirectory, { recursive: true });
  mkdirSync(fixtureEvidence, { recursive: true });
  mkdirSync(alternateEvidence, { recursive: true });
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  cpSync(resolve("QA/support/budget-ledger-dispute.mjs"),
    resolve(moduleDirectory, "budget-ledger-dispute.mjs"));
  for (const file of ["budget-ledger-dispute.json", "budget-ledger.json"]) {
    cpSync(resolve(root, file), resolve(fixtureEvidence, file));
  }
  cpSync(resolve(root, "disputed-ledger-snapshots"),
    resolve(fixtureEvidence, "disputed-ledger-snapshots"), { recursive: true });

  const manifest = JSON.parse(readFileSync(resolve(root, "budget-ledger-dispute.json"), "utf8"));
  const ledgerBytes = Buffer.from(JSON.stringify({ version: 2, runs: [] }));
  const snapshotSha256 = manifest.snapshots.map(snapshot => snapshot.sha256);
  const reconciliationEvidence = Buffer.from(JSON.stringify({
    status: "reconciled", snapshotSha256, reconciledLedgerSha256: digest(ledgerBytes),
  }));
  const ownerPermission = Buffer.from(JSON.stringify({
    approved: true, scope: "paid-qa", owner: "synthetic-test-owner",
    approvedAt: "2026-01-01T00:00:00.000Z",
    reconciledLedgerSha256: digest(ledgerBytes),
  }));
  const alternativeManifest = {
    ...manifest,
    status: "reconciled",
    authoritativeCurrentBalance: true,
    paidQaGate: { ...manifest.paidQaGate, blocked: false },
    resolution: {
      reconcilesSnapshotSha256: snapshotSha256,
      reconciliationEvidenceFile: "synthetic-reconciliation.json",
      reconciliationEvidenceSha256: digest(reconciliationEvidence),
      separateOwnerPermissionFile: "synthetic-owner-permission.json",
      ownerPermissionSha256: digest(ownerPermission),
      reconciledLedgerSha256: digest(ledgerBytes),
    },
  };
  writeFileSync(resolve(alternateEvidence, "budget-ledger-dispute.json"),
    JSON.stringify(alternativeManifest));
  writeFileSync(resolve(alternateEvidence, "budget-ledger.json"), ledgerBytes);
  writeFileSync(resolve(alternateEvidence, "synthetic-reconciliation.json"), reconciliationEvidence);
  writeFileSync(resolve(alternateEvidence, "synthetic-owner-permission.json"), ownerPermission);
  cpSync(resolve(root, "disputed-ledger-snapshots"),
    resolve(alternateEvidence, "disputed-ledger-snapshots"), { recursive: true });

  const previousCwd = process.cwd();
  try {
    process.chdir(alternateCwd);
    const fixtureGuard = await import(pathToFileURL(
      resolve(moduleDirectory, "budget-ledger-dispute.mjs")).href);
    assert.throws(fixtureGuard.assertPaidQaLedgerResolved, /ledger dispute unresolved/);
  } finally {
    process.chdir(previousCwd);
  }
});
