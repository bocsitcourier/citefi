// Owner-approved, offline-only shared-budget reconciliation of ONE retained
// image attempt. Never calls providers, opens a DB, or changes app receipts.
import assert from "node:assert/strict";
import {
  closeSync, existsSync, fsyncSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sha256, valueRetainedImage } from "../QA/support/image-reconciliation.mjs";

const [mode = "preflight"] = process.argv.slice(2);
assert.ok(["preflight", "reconcile"].includes(mode), "Use preflight or reconcile");
const root = resolve("QA/evidence/live-current");
const runId = "live-media-image-20261008";
const directory = join(root, runId);
const ledgerPath = join(root, "budget-ledger.json");
const lockPath = join(root, "budget.lock");
const reconciliationLock = join(root, "offline-reconciliation.lock");
const approvalText = readFileSync(join(directory, "owner-reconciliation-approval.json"), "utf8");
const approval = JSON.parse(approvalText);
assert.equal(approval.runId, runId);
assert.equal(approval.decision, "authorize_offline_reconciliation");
assert.equal(approval.newPaidCallsAuthorized, false);

const pricingPath = join(root, "media-pricing-current.md");
const pricingText = readFileSync(pricingPath, "utf8");
assert.equal(sha256(pricingText), "a703d6e0d895539b01139d913bdceea3d28ec104311284aee3b2497f714dfbd3");
const receipt = JSON.parse(readFileSync(join(directory, "image-receipt.json"), "utf8"));
const response = JSON.parse(readFileSync(join(directory, "image-native-response.json"), "utf8"));
const value = valueRetainedImage(response, receipt);
assert.equal(value.costMicrousd, 68_762, "Approval covers this retained attempt only");
const originalOutcomeText = readFileSync(join(directory, "image-outcome.json"), "utf8");
assert.equal(JSON.parse(originalOutcomeText).endToEndPass, false);
const baselineText = readFileSync(join(root, "budget-baseline.json"), "utf8");
const baseline = JSON.parse(baselineText);
assert.equal(baseline.ceilingUsd, 30);
assert.equal(baseline.knownPriorUsd, 0.517071);
assert.equal(baseline.historicalHoldUsd, 6);
assert.equal(baseline.historicalCalls, "UNKNOWN / UNRECONCILED");
const beforeText = readFileSync(ledgerPath, "utf8");
const ledger = JSON.parse(beforeText);
assert.equal(ledger.version, 2);
assert.equal(ledger.budgetBaseline.sourceSha256, sha256(baselineText));
const matches = ledger.runs.filter((run) => run.runId === runId);
assert.equal(matches.length, 1);
const run = matches[0];
assert.equal(run.calls?.length, 1);
assert.equal(run.calls[0].requestSha256, receipt.requestSha256);
assert.equal(run.calls[0].providerRequestId, response.responseId);
assert.equal(run.calls[0].physicalCount, 1);

if (run.state === "settled") {
  assert.equal(run.actualUsd, value.usageEstimateUsd);
  assert.equal(run.reconciliation?.kind, "owner-approved-offline-native-usage");
  console.log(JSON.stringify({ alreadyReconciled: true, value, totalBudget: ledger.totalBudget }, null, 2));
  process.exit(0);
}
assert.equal(run.state, "pending");
assert.equal(run.reservedUsd, 0.16);
const heldLockText = readFileSync(lockPath, "utf8");
assert.equal(JSON.parse(heldLockText).runId, runId);
assert.equal(JSON.parse(heldLockText).stage, "image");
// Require the failed run's exports before any shared-budget mutation.
const dbExport = JSON.parse(readFileSync(join(directory, "owned-db-export.json"), "utf8"));
assert.ok(Array.isArray(dbExport.providerAttemptReceipts));
assert.ok(Array.isArray(dbExport.providerUsageLedger));
assert.equal(dbExport.providerUsageLedger.length, 0);
assert.ok(existsSync(join(directory, "receipt-spool")));
assert.equal(JSON.parse(readFileSync(join(directory, "retained-image-decode.json"), "utf8")).fullPixelDecode, true);

let committedMicrousd = 0;
for (const entry of ledger.runs) {
  const amount = entry.runId === runId ? value.usageEstimateUsd :
    entry.state === "settled" ? entry.actualUsd : entry.reservedUsd;
  assert.ok(Number.isFinite(amount) && amount >= 0);
  committedMicrousd += Math.ceil(amount * 1_000_000);
}
const totalBudget = {
  ...ledger.totalBudget,
  newCommittedUsd: committedMicrousd / 1_000_000,
  availableUsd: (30_000_000 - 517_071 - 6_000_000 - committedMicrousd) / 1_000_000,
};
const reconciliation = {
  kind: "owner-approved-offline-native-usage",
  runId,
  reconciledAt: new Date().toISOString(),
  ownerApprovalSha256: sha256(approvalText),
  pricingSha256: sha256(pricingText),
  nativeResponseSha256: receipt.responseSha256,
  originalReceiptSha256: sha256(readFileSync(join(directory, "image-receipt.json"), "utf8")),
  originalFailedOutcomeSha256: sha256(originalOutcomeText),
  originalLedgerSha256: sha256(beforeText),
  providerRequestId: response.responseId,
  ...value,
  originalApplicationEndToEndPass: false,
  applicationReceiptsOrCreditsModified: false,
  customerDatabaseAccessed: false,
  newPhysicalSubmissions: 0,
  historicalCalls: "UNKNOWN / UNRECONCILED",
  certification: "NOT CERTIFIED",
  totalBudget,
};
console.log(JSON.stringify({ mode, reconciliation }, null, 2));
if (mode === "preflight") process.exit(0);

function durableWrite(path, bytes, exclusive = false) {
  const temporary = exclusive ? path : `${path}.reconciliation-tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) renameSync(temporary, path);
  const parent = openSync(dirname(path), "r");
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
// A second lock serializes reconciliation while preserving the paid-run hold.
// Any failure leaves both locks/evidence intact for investigation.
durableWrite(reconciliationLock, JSON.stringify({ runId, mode, pid: process.pid }), true);
assert.equal(readFileSync(ledgerPath, "utf8"), beforeText, "Ledger changed during reconciliation");
assert.equal(readFileSync(lockPath, "utf8"), heldLockText, "Held lock changed during reconciliation");
durableWrite(join(directory, "ledger-before-offline-reconciliation.json"), beforeText, true);
durableWrite(join(directory, "owner-approved-reconciliation.json"), `${JSON.stringify(reconciliation, null, 2)}\n`, true);
run.state = "settled";
run.actualUsd = value.usageEstimateUsd;
run.reconciliation = reconciliation;
// Keep the original ambiguous attempt untouched as forensic evidence. The
// new reconciliation is explicit and does not manufacture an app receipt.
ledger.totalBudget = totalBudget;
durableWrite(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
assert.deepEqual(JSON.parse(readFileSync(ledgerPath, "utf8")), ledger);
assert.equal(readFileSync(lockPath, "utf8"), heldLockText);
unlinkSync(lockPath);
unlinkSync(reconciliationLock);
const parent = openSync(root, "r");
try { fsyncSync(parent); } finally { closeSync(parent); }
console.log("Owner-approved offline reconciliation committed; original route still FAIL / NOT CERTIFIED.");
